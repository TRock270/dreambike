// POST /api/search-parts: find shop products by text (query) or read one shop link (url) (SPEC 5, 6.3, 8).
// Query mode is a grounded Spark search and runs only off a deployment (owner decision 2026-10-30: U06 has no
// proven search cost bound). URL mode fetches the allowlisted page itself and makes ONE ungrounded Spark call
// on its text (lead decision; SPEC 5 says "with search"). Both modes post-validate: hosts, links, prices.
// Order: origin, request id, body (20 KB), JSON + Zod, then the gates, so the 403/413 probes work with features off.
import { createHash } from "node:crypto";
import { SearchModelOutput, SearchRequest, SearchResponse } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { mockSearchResponse } from "@/lib/mocks";
import { loadConfig } from "@/lib/server/config";
import { checkShopUrl, FetchError, fetchPage, toAppError } from "@/lib/server/fetch-product";
import { assertSameOrigin, errorResponse, jsonResponse, readBodyLimited, requestIdOf, requireRequestId } from "@/lib/server/http";
import { fetchSparkJson, readSparkResponse, sparkBody, sparkCharge, sparkChargeGrounded, usageOf } from "@/lib/server/meta";
import { freeFetchDenied, loadPrices, withReservation } from "@/lib/server/paid";
import { buildSearchTask, failureWords, normalizeSearchUrl, postValidateSearch, verifiableUrls, type PageCheck, type SearchContext } from "@/lib/server/searchPolicy";

export const runtime = "nodejs";
export const maxDuration = 90;

const DEADLINE_MS = 70_000;
// The Spark leg ends early so the (at most five, parallel, 5 s each) price checks finish before 70 s.
const SPARK_LEG_MS = 60_000;
const BODY_LIMIT = 20_000;
const MAX_VERIFY = 5;

const known = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** One bounded page fetch for price checking; a failure becomes a record, never an error. */
async function checkPage(url: string, shopDomains: ReadonlySet<string>): Promise<PageCheck> {
  try {
    const page = await fetchPage(url, shopDomains);
    return { ok: true, accessedAt: new Date().toISOString(), page };
  } catch (error) {
    return { ok: false, accessedAt: new Date().toISOString(), error: error instanceof FetchError ? error : new FetchError("network") };
  }
}

export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now();
  const requestId = requestIdOf(req);
  try {
    const config = loadConfig();
    const deployed = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL_ENV);
    assertSameOrigin(req, config, deployed);
    requireRequestId(req);
    const bytes = await readBodyLimited(req, BODY_LIMIT);
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new AppError("INVALID_REQUEST");
    }
    const parsed = SearchRequest.safeParse(json);
    if (!parsed.success) throw new AppError("INVALID_REQUEST");
    const request = parsed.data;

    if (config.mode === "mock") {
      return jsonResponse(SearchResponse.parse(mockSearchResponse(request, new Date().toISOString())));
    }
    if (config.mode !== "live") throw new AppError("LIVE_DISABLED");
    const shopDomains = config.shopDomains;
    if (shopDomains === null) {
      throw new AppError("FEATURE_DISABLED", "Shop search is switched off on this server. Enter the product by hand.");
    }
    if (request.mode === "query") {
      // Hard gate: no deployment runs a grounded search until U06 proves a cost bound.
      if (deployed) throw new AppError("FEATURE_DISABLED", "Text search runs only on the shop's own machine; paste a shop link instead.");
      const queries = config.searchQueryReserve;
      if (!config.features.search || queries === null || !Number.isInteger(queries) || queries < 1) {
        throw new AppError("FEATURE_DISABLED", "Text search is switched off on this server. Paste a shop link instead.");
      }
    }

    // A blocked url is refused the same way whatever the pricing state is.
    let checkedUrl: URL | null = null;
    if (request.mode === "url") {
      try {
        checkedUrl = checkShopUrl(request.url, shopDomains);
      } catch (error) {
        throw error instanceof FetchError ? toAppError(error) : error;
      }
    }

    const prices = loadPrices();
    const sparkPrices = prices.prices[config.museModel] as Partial<Record<string, unknown>> | undefined;
    const input = sparkPrices?.inputMicroUsdPerMillionTokens, output = sparkPrices?.outputMicroUsdPerMillionTokens;
    if (!sparkPrices || !known(input) || !known(output)) throw new AppError("LIVE_DISABLED", "Pricing for this model is not verified.");
    const tokenPrices = { inputMicroUsdPerMillionTokens: input, outputMicroUsdPerMillionTokens: output };

    if (request.mode === "url") {
      const url = checkedUrl!;
      const wait = freeFetchDenied(req, config);
      if (wait !== null) {
        throw new AppError("RATE_LIMITED", `Too many product lookups from your network. ${wait > 60 ? "Try again later." : "Try again in a minute."}`, wait);
      }
      const searchedAt = new Date().toISOString();
      let page;
      try {
        page = await fetchPage(url.href, shopDomains);
      } catch (error) {
        if (!(error instanceof FetchError)) throw error;
        // A page we cannot read costs nothing: tell the visitor which host and why, and stop.
        const host = /^[a-z0-9.-]{1,100}$/.test(error.host ?? "") ? error.host : url.hostname;
        return jsonResponse(SearchResponse.parse({
          products: [], searchedAt,
          warnings: [`${host}: ${failureWords(error)}.`, "Enter the product by hand."],
        }));
      }
      const accessedAt = new Date().toISOString();
      if (page.text === "") {
        return jsonResponse(SearchResponse.parse({ products: [], searchedAt, warnings: ["The page had no readable text. Enter the product by hand."] }));
      }
      const reserve = prices.reservations["spark-ungrounded"];
      if (!known(reserve)) throw new AppError("LIVE_DISABLED", "Pricing for this model is not verified.");
      const task = buildSearchTask(request, shopDomains, { finalUrl: page.finalUrl, text: page.text });
      const body = sparkBody(config.museModel, "search-parts.v1.md", "parts_search_v1", task, null, true, false);
      const raw = await withReservation({
        req, route: "/api/search-parts", model: config.museModel, amountMicroUsd: reserve,
        requestId, deadlineMs: Math.max(1_000, DEADLINE_MS - (Date.now() - startedAt)),
        payloadDigest: createHash("sha256").update(JSON.stringify(task)).digest("hex"),
      }, async (signal) => {
        const answer = await fetchSparkJson(body, signal);
        return { value: answer, chargedMicroUsd: sparkCharge(usageOf(answer), tokenPrices) };
      });
      const modelOutput = SearchModelOutput.safeParse(readSparkResponse(raw).json);
      if (!modelOutput.success) throw new AppError("SCHEMA_INVALID");
      const ctx: SearchContext = { mode: "url", shopDomains, searchedAt, requestedUrl: request.url, finalUrl: page.finalUrl };
      const pages = new Map<string, PageCheck>([[normalizeSearchUrl(page.finalUrl) ?? page.finalUrl, { ok: true, accessedAt, page }]]);
      return jsonResponse(SearchResponse.parse({ ...postValidateSearch(modelOutput.data, ctx, pages), searchedAt }));
    }

    // Query mode (never deployed): grounded search, same pricing rules as the fit check.
    const webSearch = sparkPrices.webSearchMicroUsdPerQuery;
    const base = prices.reservations["spark-grounded-base"], perQuery = prices.reservations["spark-grounded-per-query"];
    if (!known(webSearch) || !known(base) || !known(perQuery)) throw new AppError("LIVE_DISABLED", "Pricing for this model is not verified.");
    const queries = config.searchQueryReserve!;
    const task = buildSearchTask(request, shopDomains, null);
    const body = sparkBody(config.museModel, "search-parts.v1.md", "parts_search_v1", task, null, true, true);
    const searchedAt = new Date().toISOString();
    const raw = await withReservation({
      req, route: "/api/search-parts", model: config.museModel, amountMicroUsd: base + perQuery * queries,
      requestId, deadlineMs: Math.max(1_000, SPARK_LEG_MS - (Date.now() - startedAt)),
      payloadDigest: createHash("sha256").update(JSON.stringify(task)).digest("hex"),
    }, async (signal) => {
      const answer = await fetchSparkJson(body, signal);
      // Meta documents no query count (U06): always unknown, so the full reservation stays counted.
      return { value: answer, chargedMicroUsd: sparkChargeGrounded(usageOf(answer), null, { ...tokenPrices, webSearchMicroUsdPerQuery: webSearch }) };
    });
    const read = readSparkResponse(raw);
    const modelOutput = SearchModelOutput.safeParse(read.json);
    if (!modelOutput.success) throw new AppError("SCHEMA_INVALID");
    if (!read.searched) throw new AppError("NO_RESULT", "The search found no web results. Try again later.");
    const ctx: SearchContext = { mode: "query", shopDomains, searchedAt, evidence: { citations: read.citations, results: read.results } };
    const urls = verifiableUrls(modelOutput.data, ctx).slice(0, MAX_VERIFY);
    const checks = await Promise.all(urls.map((u) => checkPage(u, shopDomains)));
    const pages = new Map<string, PageCheck>();
    urls.forEach((u, i) => pages.set(normalizeSearchUrl(u) ?? u, checks[i]!));
    return jsonResponse(SearchResponse.parse({ ...postValidateSearch(modelOutput.data, ctx, pages), searchedAt }));
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
