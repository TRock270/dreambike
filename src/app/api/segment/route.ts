// POST /api/segment: SAM 3.1 concept or point segmentation (SPEC.md 5, 6.1).
// Validates before any reservation; live calls go through withReservation.
import { createHash } from "node:crypto";
import sharp from "sharp";
import { ENVELOPE_LIMIT_BYTES, ImageFile, SegmentPayload, SegmentResponse } from "@/lib/contracts";
import type { BinaryMask } from "@/lib/coordinates";
import { AppError } from "@/lib/errors";
import { MOCK_SEGMENT_WARNING, mockConcept, mockPoints } from "@/lib/mocks/segment";
import { maskBox } from "@/lib/parts";
import { loadConfig } from "@/lib/server/config";
import {
  assertSameOrigin, errorResponse, jsonResponse, parseMultipart, readBodyLimited, requestIdOf,
} from "@/lib/server/http";
import { VERIFIED_SAM_DOWNSCALED, VERIFIED_SAM_PLACEMENT, VERIFIED_SAM_POINTS, maskToPng, placeSamRasters, toDataUrl } from "@/lib/server/images";
import { samConceptText, samPointsText, segment } from "@/lib/server/meta";
import { loadPrices, withReservation } from "@/lib/server/paid";

export const runtime = "nodejs";
export const maxDuration = 45;

const DEADLINE_MS = 40_000;
const BODY_LIMIT = 1_250_000 + 50_000;

export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now();
  const requestId = requestIdOf(req);
  try {
    const config = loadConfig();
    assertSameOrigin(req, config, process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL_ENV));
    if (!req.headers.get("x-request-id") || requestId !== req.headers.get("x-request-id")) {
      throw new AppError("INVALID_REQUEST", "X-Request-Id must be a UUID.");
    }
    const form = await parseMultipart(req, await readBodyLimited(req, BODY_LIMIT));
    const keys = [...form.keys()];
    if (keys.length !== 2 || form.getAll("payload").length !== 1 || form.getAll("image").length !== 1) {
      throw new AppError("INVALID_REQUEST");
    }
    const rawPayload = form.get("payload");
    let payloadJson: unknown;
    try {
      payloadJson = typeof rawPayload === "string" ? JSON.parse(rawPayload) : null;
    } catch {
      throw new AppError("INVALID_REQUEST");
    }
    const payload = SegmentPayload.safeParse(payloadJson);
    const image = ImageFile.safeParse(form.get("image"));
    if (!payload.success || !image.success) throw new AppError("INVALID_REQUEST");
    const p = payload.data;
    const bytes = new Uint8Array(await image.data.arrayBuffer());

    // The declared size must equal the decoded WebP (one coordinate space).
    const meta = await sharp(bytes).metadata().catch(() => null);
    if (!meta || meta.format !== "webp" || (meta.pages ?? 1) > 1) throw new AppError("INVALID_IMAGE");
    if (meta.width !== p.width || meta.height !== p.height) {
      throw new AppError("INVALID_REQUEST", "Declared size does not match the image.");
    }

    let masks: { mask: BinaryMask; confidence: number | null; objectId: string }[];
    let complete = true;
    const warnings: string[] = [];
    // Live point clicks are refused while VERIFIED_SAM_POINTS is false, so do not send users there.
    const hint = config.mode === "live" && !VERIFIED_SAM_POINTS ? "pick another part from the list" : "select them by point";
    if (config.mode === "mock") {
      const shapes = p.mode === "concept" ? mockConcept(p.width, p.height, p.phrase) : mockPoints(p.width, p.height, p.points);
      masks = shapes.map((mask, i) => ({ mask, confidence: null, objectId: String(i) }));
      warnings.push(MOCK_SEGMENT_WARNING);
    } else {
      if (config.mode !== "live") throw new AppError("LIVE_DISABLED");
      // Without a verified placement every box-sized mask would be paid for
      // and then rejected; refuse before any reservation instead.
      if (VERIFIED_SAM_PLACEMENT === null) {
        throw new AppError("FEATURE_DISABLED", "Live part detection waits for the mask placement check (U01).");
      }
      // Downscaled rasters (long edge 1024): the bike outline overlay was
      // owner-checked on 2026-10-28 (VERIFIED_SAM_DOWNSCALED). Point clicks have
      // no owner-checked overlay yet and returned the whole bike, so they stay
      // refused before paying (VERIFIED_SAM_POINTS). Another phrase with a part
      // over 1024 px is paid and placed by the same verified upscale.
      if ((!VERIFIED_SAM_DOWNSCALED || !VERIFIED_SAM_POINTS) && p.mode === "points") {
        throw new AppError("FEATURE_DISABLED", "Live selection by point waits for the mask placement check (U01). Pick a part from the list.");
      }
      if (!VERIFIED_SAM_DOWNSCALED && p.mode === "concept" && p.phrase.trim().toLowerCase() === "motorcycle") {
        throw new AppError("FEATURE_DISABLED", "The live bike outline waits for the mask placement check (U01).");
      }
      const text = p.mode === "concept" ? samConceptText(p.phrase) : samPointsText(p.width, p.height, p.points);
      const input = { width: p.width, height: p.height, dataUrl: toDataUrl("image/webp", bytes) };
      const prices = loadPrices();
      const result = await withReservation({
        req, route: "/api/segment", model: "sam-3.1", amountMicroUsd: prices.reservations["sam-3.1"]!,
        // One total deadline for the route, counted from the request start.
        requestId, deadlineMs: Math.max(1_000, DEADLINE_MS - (Date.now() - startedAt)),
        payloadDigest: createHash("sha256").update(JSON.stringify(p)).update(bytes).digest("hex"),
      }, async (signal) => ({
        value: await segment(input, text, signal),
        chargedMicroUsd: prices.prices["sam-3.1"]?.perImageMicroUsd ?? null,
      }));
      complete = result.complete;
      if (!result.complete) warnings.push("Segmentation ended early; results may be partial.");
      const placed = placeSamRasters(result.objects, p.width, p.height);
      masks = placed.masks;
      // SAM found something but none of it could be placed: say so, not "nothing found".
      if (masks.length === 0 && placed.dropped > 0) throw new AppError("MASK_PLACEMENT_UNKNOWN");
      if (placed.dropped > 0) {
        complete = false;
        warnings.push(p.mode === "points"
          ? "The outline at that point could not be placed; pick the part from the list."
          : `Some parts could not be placed; ${hint}.`);
      }
    }
    const body = SegmentResponse.parse(await respond(p.width, p.height, masks, complete, warnings, hint));
    // Measure the real JSON; drop the smallest objects until it fits the envelope.
    while (body.objects.length > 0 && JSON.stringify(body).length > ENVELOPE_LIMIT_BYTES) {
      body.objects.pop();
      if (body.complete) body.warnings.push(`Some parts were left out to keep the response small; ${hint}.`);
      body.complete = false;
    }
    return jsonResponse(body);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

/**
 * Largest-area objects first; stop before the encoded response passes the
 * envelope (never truncate one mask). Omitted objects mean complete=false.
 */
async function respond(width: number, height: number,
  masks: { mask: BinaryMask; confidence: number | null; objectId: string }[], complete: boolean, warnings: string[],
  hint: string) {
  const sized = masks.map((m) => ({ ...m, area: m.mask.pixels.reduce((a, v) => a + v, 0), box: maskBox(m.mask) }))
    .filter((m) => m.box !== null)
    .sort((a, b) => b.area - a.area);
  const objects = [];
  let budget = ENVELOPE_LIMIT_BYTES - 4_000;
  if (sized.length > 16) {
    complete = false;
    warnings.push(`More parts were found than one answer can carry; ${hint}.`);
  }
  for (const m of sized.slice(0, 16)) {
    const dataUrl = toDataUrl("image/png", await maskToPng(m.mask));
    // Skip a mask that does not fit, but keep trying the smaller ones; never truncate a mask.
    if (dataUrl.length > 666_800 || dataUrl.length + 300 > budget) {
      if (complete) warnings.push(`Some parts were left out to keep the response small; ${hint}.`);
      complete = false;
      continue;
    }
    budget -= dataUrl.length + 300;
    objects.push({ objectId: m.objectId, box: m.box!, confidence: m.confidence,
      mask: { encoding: "png_binary_full_image" as const, width, height, dataUrl } });
  }
  return { width, height, objects, complete, warnings: warnings.slice(0, 8) };
}
