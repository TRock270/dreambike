// POST /api/edit: one Muse Image render per explicit click (SPEC.md 5, 6.2).
// No mask field and no automatic second render. Composition is a separate,
// unpaid request (/api/composite), so a failed blend never repeats generation.
import { createHash } from "node:crypto";
import sharp from "sharp";
import { EditPayload, EditResponse, ImageFile } from "@/lib/contracts";
import { modeAllowed } from "@/lib/editPolicy";
import { AppError } from "@/lib/errors";
import { MOCK_LABEL } from "@/lib/mocks";
import { loadConfig } from "@/lib/server/config";
import {
  assertSameOrigin, errorResponse, jsonResponse, parseMultipart, payloadAndFiles, readBodyLimited, requestIdOf,
  requireRequestId,
} from "@/lib/server/http";
import { assertWebpSize, normalize, toDataUrl } from "@/lib/server/images";
import { fetchImageEdit, firstImageBytes, imageEditBody, renderTemplate, returnedImages, templateFor } from "@/lib/server/meta";
import { loadPrices, withReservation } from "@/lib/server/paid";
import { slotInfo } from "@/lib/slots";

export const runtime = "nodejs";
export const maxDuration = 120;

const DEADLINE_MS = 100_000;
/** Time kept back after the model answers: settle, decode, and bounded encoding. */
const POST_PROCESS_MS = 12_000;
const REFERENCE_OFF = "Reference photos are switched off on this server. Describe the part in text instead.";
const BODY_LIMIT = 2 * 1_250_000 + 50_000;

export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now();
  const requestId = requestIdOf(req);
  try {
    const config = loadConfig();
    assertSameOrigin(req, config, process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL_ENV));
    requireRequestId(req);
    const { payload: rawPayload, files } = payloadAndFiles(await parseMultipart(req, await readBodyLimited(req, BODY_LIMIT)), ["base"], ["reference"]);
    const parsed = EditPayload.safeParse(rawPayload);
    const base = ImageFile.safeParse(files.base);
    if (!parsed.success || !base.success) throw new AppError("INVALID_REQUEST");
    const p = parsed.data;
    if ((p.mode === "reference") !== Boolean(files.reference)) throw new AppError("INVALID_REQUEST");
    if (!modeAllowed(p.slot, p.mode)) throw new AppError("INVALID_REQUEST", `${slotInfo(p.slot).label}: paint changes only.`);
    if (p.mode === "reference" && !config.features.reference) throw new AppError("FEATURE_DISABLED", REFERENCE_OFF);
    const bytes = new Uint8Array(await base.data.arrayBuffer());
    await assertWebpSize(bytes, p.width, p.height);
    // The reference photo is validated and normalized here; it is never stored or returned.
    let reference: { bytes: Uint8Array; dataUrl: string } | null = null;
    if (p.mode === "reference") {
      const file = ImageFile.safeParse(files.reference);
      if (!file.success) throw new AppError("INVALID_REQUEST");
      const normalized = await normalize(new Uint8Array(await file.data.arrayBuffer()));
      reference = { bytes: normalized.bytes, dataUrl: toDataUrl("image/webp", normalized.bytes) };
    }

    let generated: Uint8Array;
    const warnings: string[] = [];
    if (config.mode === "mock") {
      // A labeled stand-in: the whole photo hue-shifted. Grayscale drift barely sees a hue shift,
      // so this usually composites (drift is a heuristic: see U04 notes).
      generated = new Uint8Array(await sharp(bytes).modulate({ hue: 35, saturation: 1.3 }).webp({ quality: 90 }).toBuffer());
      warnings.push(reference
        ? `${MOCK_LABEL}: reference mode; the whole photo is tinted and the reference photo was not used.`
        : `${MOCK_LABEL}: the whole photo is tinted; no real edit was made.`);
    } else {
      if (config.mode !== "live") throw new AppError("LIVE_DISABLED");
      const prices = loadPrices();
      const perImage = prices.prices["muse-image-1.0"]?.perReturnedImageMicroUsd;
      if (perImage === undefined) throw new AppError("LIVE_DISABLED", "Pricing for the image model is not verified.");
      // Template chosen by the server from the mode; the approved prompt is untrusted text inside it.
      const prompt = renderTemplate(templateFor(p.mode), p.prompt);
      // Compose: base first, reference second, one request, tools off.
      const imageUrls = [toDataUrl("image/webp", bytes), ...(reference ? [reference.dataUrl] : [])];
      const body = imageEditBody(prompt, imageUrls, p.width, p.height, p.quality);
      const raw = await withReservation({
        route: "/api/edit", model: "muse-image-1.0", amountMicroUsd: prices.reservations["muse-image-1.0"]!,
        requestId, deadlineMs: Math.max(1_000, DEADLINE_MS - POST_PROCESS_MS - (Date.now() - startedAt)),
        payloadDigest: createHash("sha256").update(JSON.stringify(p)).update(bytes).update(reference?.bytes ?? "").digest("hex"),
      }, async (signal) => {
        const answer = await fetchImageEdit(body, signal);
        const count = returnedImages(answer);
        // Billed per returned image; an answer without a data array is an unknown charge.
        return { value: answer, chargedMicroUsd: count === null ? null : count * perImage };
      });
      generated = firstImageBytes(raw);
    }

    // The raw output size is recorded before bounded encoding (composition rules use it).
    const meta = await sharp(generated).metadata().catch(() => null);
    if (!meta?.width || !meta.height) throw new AppError("INVALID_IMAGE", "The generated image could not be read.");
    // Any problem with the model's own output is an invalid image, not a "photo" upload error.
    const bounded = await normalize(generated).catch(() => { throw new AppError("INVALID_IMAGE", "The generated image could not be used."); });
    if (meta.width !== p.width || meta.height !== p.height) {
      warnings.push(`The model returned ${meta.width} × ${meta.height} px instead of ${p.width} × ${p.height} px.`);
    }
    return jsonResponse(EditResponse.parse({
      image: { mime: "image/webp", dataUrl: toDataUrl("image/webp", bounded.bytes), width: bounded.width, height: bounded.height, hash: bounded.hash },
      generatedWidth: meta.width, generatedHeight: meta.height, warnings: warnings.slice(0, 8),
    }));
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
