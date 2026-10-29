// POST /api/check: sourced fit and paperwork pre-check for up to three items (SPEC.md 5, 6).
// The model proposes with web search; fitPolicy.postValidate decides what may be called ok.
import { createHash } from "node:crypto";
import { CheckRequest, CheckResponse, FitModelOutput } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { mockFitFor } from "@/lib/mocks";
import { loadConfig } from "@/lib/server/config";
import { buildFitTask, postValidate } from "@/lib/server/fitPolicy";
import { assertSameOrigin, errorResponse, jsonResponse, readBodyLimited, requestIdOf, requireRequestId } from "@/lib/server/http";
import { fetchSparkJson, readSparkResponse, sparkBody, sparkChargeGrounded, usageOf } from "@/lib/server/meta";
import { loadPrices, withReservation } from "@/lib/server/paid";

export const runtime = "nodejs";
export const maxDuration = 90;

const DEADLINE_MS = 70_000;
const BODY_LIMIT = 100_000;

/**
 * Number of search queries the answer reports. Meta documents no such field (U06), so this is
 * always unknown (null) and the full reservation stays counted. Never read a guessed field.
 */
function reportedQueries(): number | null {
  return null;
}

export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now();
  const requestId = requestIdOf(req);
  try {
    const config = loadConfig();
    assertSameOrigin(req, config, process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL_ENV));
    requireRequestId(req);
    const bytes = await readBodyLimited(req, BODY_LIMIT);
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new AppError("INVALID_REQUEST");
    }
    const parsed = CheckRequest.safeParse(json);
    if (!parsed.success) throw new AppError("INVALID_REQUEST");
    const request = parsed.data;
    const ids = request.items.map((i) => i.id);
    // Duplicate ids can never succeed; refuse them for free, before any reservation.
    if (new Set(ids).size !== ids.length) throw new AppError("INVALID_REQUEST");

    if (config.mode === "mock") {
      const checkedAt = new Date().toISOString();
      return jsonResponse(CheckResponse.parse({
        inputHash: request.inputHash, checkedAt, results: ids.map((id) => mockFitFor(id, checkedAt)),
      }));
    }
    if (config.mode !== "live") throw new AppError("LIVE_DISABLED");
    // Search needs a known bound on queries per call; a blank or 0 reserve means no fresh check.
    const queries = config.searchQueryReserve;
    if (!config.features.search || queries === null || !Number.isInteger(queries) || queries < 1) {
      throw new AppError("FEATURE_DISABLED", "Fresh fit checks are switched off on this server.");
    }
    const prices = loadPrices();
    const sparkPrices = prices.prices[config.museModel] as Partial<Record<string, unknown>> | undefined;
    const base = prices.reservations["spark-grounded-base"], perQuery = prices.reservations["spark-grounded-per-query"];
    const known = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
    if (!sparkPrices || !known(sparkPrices.inputMicroUsdPerMillionTokens) || !known(sparkPrices.outputMicroUsdPerMillionTokens)
      || !known(sparkPrices.webSearchMicroUsdPerQuery) || !known(base) || !known(perQuery)) {
      throw new AppError("LIVE_DISABLED", "Pricing for this model is not verified.");
    }
    const chargePrices = { inputMicroUsdPerMillionTokens: sparkPrices.inputMicroUsdPerMillionTokens,
      outputMicroUsdPerMillionTokens: sparkPrices.outputMicroUsdPerMillionTokens,
      webSearchMicroUsdPerQuery: sparkPrices.webSearchMicroUsdPerQuery };

    const body = sparkBody(config.museModel, "fit-check.v1.md", "fit_check_v1", buildFitTask(request), null, true, true);
    // One attempt only: withReservation keys on the request id, so a retry would be a duplicate.
    const raw = await withReservation({
      route: "/api/check", model: config.museModel, amountMicroUsd: base + perQuery * queries,
      requestId, deadlineMs: Math.max(1_000, DEADLINE_MS - (Date.now() - startedAt)),
      payloadDigest: createHash("sha256").update(JSON.stringify(request)).digest("hex"),
    }, async (signal) => {
      const answer = await fetchSparkJson(body, signal);
      return { value: answer, chargedMicroUsd: sparkChargeGrounded(usageOf(answer), reportedQueries(), chargePrices) };
    });

    const output = readSparkResponse(raw);
    if (!FitModelOutput.safeParse(output.json).success) throw new AppError("SCHEMA_INVALID");
    // An answer without a completed search is not a fresh, sourced check.
    if (!output.searched) throw new AppError("NO_RESULT", "The check found no web evidence. Try again later.");
    const validated = postValidate(ids, output.json, { citations: output.citations, results: output.results },
      Date.now(), request.inputHash, {
        items: request.items.map((i) => ({ id: i.id, slot: i.slot, approvalText: i.product?.approvalText ?? null })),
        bike: request.bike,
      });
    if (!validated.ok) throw new AppError("SCHEMA_INVALID");
    return jsonResponse(CheckResponse.parse(validated.response));
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
