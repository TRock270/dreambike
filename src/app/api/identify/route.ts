// POST /api/identify: suggest the bike's identity from one normalized photo
// (SPEC.md 5, 6.3). A suggestion only; the mechanic confirms every field.
import { createHash } from "node:crypto";
import { IdentifyModelOutput, IdentifyPayload, IdentifyResponse, ImageFile } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { MOCKS } from "@/lib/mocks";
import { loadConfig } from "@/lib/server/config";
import {
  assertSameOrigin, errorResponse, jsonResponse, parseMultipart, payloadAndFiles, readBodyLimited, requestIdOf,
  requireRequestId,
} from "@/lib/server/http";
import { assertWebpSize, toDataUrl } from "@/lib/server/images";
import { fetchSparkJson, readSparkResponse, sparkBody, sparkCharge, usageOf } from "@/lib/server/meta";
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
    requireRequestId(req);
    const { payload: rawPayload, files } = payloadAndFiles(await parseMultipart(req, await readBodyLimited(req, BODY_LIMIT)), ["image"]);
    const payload = IdentifyPayload.safeParse(rawPayload);
    const image = ImageFile.safeParse(files.image);
    if (!payload.success || !image.success) throw new AppError("INVALID_REQUEST");
    const bytes = new Uint8Array(await image.data.arrayBuffer());
    await assertWebpSize(bytes, payload.data.width, payload.data.height);

    if (config.mode === "mock") return jsonResponse(IdentifyResponse.parse(MOCKS.identify));
    if (config.mode !== "live") throw new AppError("LIVE_DISABLED");

    const prices = loadPrices();
    const sparkPrices = prices.prices[config.museModel] as { inputMicroUsdPerMillionTokens: number; outputMicroUsdPerMillionTokens: number } | undefined;
    if (!sparkPrices) throw new AppError("LIVE_DISABLED", "Pricing for this model is not verified.");
    const body = sparkBody(config.museModel, "identify.v1.md", "bike_identification_v1",
      { width: payload.data.width, height: payload.data.height }, toDataUrl("image/webp", bytes));
    const raw = await withReservation({
      req, route: "/api/identify", model: config.museModel, amountMicroUsd: prices.reservations["spark-ungrounded"]!,
      requestId, deadlineMs: Math.max(1_000, DEADLINE_MS - (Date.now() - startedAt)),
      payloadDigest: createHash("sha256").update(JSON.stringify(payload.data)).update(bytes).digest("hex"),
    }, async (signal) => {
      const answer = await fetchSparkJson(body, signal);
      return { value: answer, chargedMicroUsd: sparkCharge(usageOf(answer), sparkPrices) };
    });
    const output = readSparkResponse(raw);
    // Validate after paying: an invalid answer is still a safe error, never shown as a result.
    const parsed = IdentifyModelOutput.safeParse(output.json);
    if (!parsed.success) throw new AppError("SCHEMA_INVALID");
    const checked = IdentifyResponse.safeParse(parsed.data);
    if (!checked.success) throw new AppError("SCHEMA_INVALID");
    return jsonResponse(checked.data);
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
