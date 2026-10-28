// POST /api/instruction: turn the mechanic's request for one selected part
// into an English edit instruction plus build-sheet spec (SPEC.md 5, 6.3).
// The model proposes; editPolicy enforces intent and paint-only slots.
import { createHash } from "node:crypto";
import { ImageFile, InstructionModelOutput, InstructionPayload, InstructionResponse } from "@/lib/contracts";
import { modeAllowed, enforceIntent, withBikeWarnings } from "@/lib/editPolicy";
import { AppError } from "@/lib/errors";
import { MOCK_LABEL } from "@/lib/mocks";
import { loadConfig } from "@/lib/server/config";
import {
  assertSameOrigin, errorResponse, jsonResponse, parseMultipart, payloadAndFiles, readBodyLimited, requestIdOf,
  requireRequestId,
} from "@/lib/server/http";
import { normalize, toDataUrl } from "@/lib/server/images";
import { fetchSparkJson, readSparkResponse, sparkBody, sparkCharge, usageOf } from "@/lib/server/meta";
import { loadPrices, withReservation } from "@/lib/server/paid";
import { slotInfo } from "@/lib/slots";
import type { InstructionData } from "@/lib/types";

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
    requireRequestId(req);
    const { payload: rawPayload, files } = payloadAndFiles(await parseMultipart(req, await readBodyLimited(req, BODY_LIMIT)), [], ["reference"]);
    const parsed = InstructionPayload.safeParse(rawPayload);
    if (!parsed.success) throw new AppError("INVALID_REQUEST");
    const p = parsed.data;
    // Reference mode needs exactly one reference; other modes must not send one (SPEC 5).
    if ((p.mode === "reference") !== Boolean(files.reference)) throw new AppError("INVALID_REQUEST");
    if (!modeAllowed(p.slot, p.mode)) {
      throw new AppError("INVALID_REQUEST", `${slotInfo(p.slot).label}: paint changes only.`);
    }
    if (p.mode === "reference" && !config.features.reference) {
      throw new AppError("FEATURE_DISABLED", "Reference photos are switched off on this server. Describe the part in text instead.");
    }
    // Only reference mode sends an image (SPEC 6.3); it is normalized and never stored.
    let reference: { bytes: Uint8Array; dataUrl: string } | null = null;
    if (p.mode === "reference") {
      const file = ImageFile.safeParse(files.reference);
      if (!file.success) throw new AppError("INVALID_REQUEST");
      const normalized = await normalize(new Uint8Array(await file.data.arrayBuffer()));
      reference = { bytes: normalized.bytes, dataUrl: toDataUrl("image/webp", normalized.bytes) };
    }

    let instruction: InstructionData;
    if (config.mode === "mock") {
      instruction = {
        title: `Mock: ${slotInfo(p.slot).label.toLowerCase()} ${p.mode === "paint" ? "paint" : "change"}`,
        editPrompt: `Mock instruction for the ${slotInfo(p.slot).label.toLowerCase()}: ${p.text}. Keep everything else in the photo unchanged.`,
        spec: [], intent: p.mode === "paint" ? "paint" : "replace",
        warnings: [p.mode === "reference" ? `${MOCK_LABEL}: reference mode; the reference photo was not read.` : MOCK_LABEL],
      };
    } else {
      if (config.mode !== "live") throw new AppError("LIVE_DISABLED");
      const prices = loadPrices();
      const sparkPrices = prices.prices[config.museModel] as { inputMicroUsdPerMillionTokens: number; outputMicroUsdPerMillionTokens: number } | undefined;
      if (!sparkPrices) throw new AppError("LIVE_DISABLED", "Pricing for this model is not verified.");
      // The model's own limitation notes are not sent: the server adds bike limitations itself,
      // and that free text could carry instructions copied from a photo.
      const body = sparkBody(config.museModel, "instruction.v1.md", "edit_instruction_v1",
        { ...p, bike: { ...p.bike, limitations: [] } }, reference?.dataUrl ?? null);
      const raw = await withReservation({
        route: "/api/instruction", model: config.museModel, amountMicroUsd: prices.reservations["spark-ungrounded"]!,
        requestId, deadlineMs: Math.max(1_000, DEADLINE_MS - (Date.now() - startedAt)),
        payloadDigest: createHash("sha256").update(JSON.stringify(p)).update(reference?.bytes ?? "").digest("hex"),
      }, async (signal) => {
        const answer = await fetchSparkJson(body, signal);
        return { value: answer, chargedMicroUsd: sparkCharge(usageOf(answer), sparkPrices) };
      });
      const output = readSparkResponse(raw);
      const model = InstructionModelOutput.safeParse(output.json);
      if (!model.success) throw new AppError("SCHEMA_INVALID");
      instruction = model.data.instruction;
    }
    instruction = withBikeWarnings(enforceIntent(p.slot, p.mode, p.text, instruction), p.bike);
    return jsonResponse(InstructionResponse.parse({ instruction }));
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
