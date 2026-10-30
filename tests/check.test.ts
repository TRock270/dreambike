// POST /api/check offline: mock path, disabled paths, body limits, and the live path with a fake
// Upstash and a fake Meta (no network, no spend).
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/check/route";
import { CheckResponse, ErrorResponse } from "@/lib/contracts";
import { MOCK_LABEL } from "@/lib/mocks";
import { LEGAL_SEED } from "@/lib/server/fitPolicy";
import { withSession } from "./support/session";

// Lets one test swap the price file; every other test gets the real one.
const priceOverride: { fn: null | ((real: unknown) => unknown) } = { fn: null };
vi.mock("@/lib/server/paid", async (orig) => {
  const real = await orig<typeof import("@/lib/server/paid")>();
  return { ...real, loadPrices: () => (priceOverride.fn ? priceOverride.fn(real.loadPrices()) : real.loadPrices()) };
});

const HASH = "b".repeat(64);
const ORIGIN = "http://localhost:3000";
const bike = { make: "BMW", model: "R nineT", family: "other", engine: null, yearFrom: 2014, yearTo: 2016,
  abs: "yes", style: null, facing: "left", confidence: 0.9, limitations: [] };
const item = (slot = "handlebar") => ({
  id: crypto.randomUUID(), slot, title: "Taller bar", spec: [{ key: "rise", value: "+3 cm" }], intent: "geometry",
  product: null, costKind: "part", partPriceCents: null, taxBasis: "gross", laborMinutes: null,
  fit: null, fitInputHash: null, fitCheckedAt: null, originVersionId: crypto.randomUUID(),
  zeroLaborConfirmed: false, mechanicNotes: "", fitReviewedHash: null,
});
const body = (items = [item()], over: object = {}) => ({
  bike, bikeConfirmed: true, inputHash: HASH, items, activeBuild: [], shopRules: [], ...over,
});
const post = (b: unknown, headers: Record<string, string> = {}, raw?: string) =>
  POST(new Request(`${ORIGIN}/api/check`, { method: "POST", body: raw ?? JSON.stringify(b),
    headers: withSession({ Origin: ORIGIN, "X-Request-Id": crypto.randomUUID(), ...headers }) }));
const errorOf = async (res: Response) => [res.status, ErrorResponse.parse(await res.json()).error.code];

afterEach(() => { priceOverride.fn = null; vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("mock mode", () => {
  it("returns labeled verify results with the requested ids and the caller's hash; no network", async () => {
    vi.stubEnv("MOCK", "1");
    const spy = vi.spyOn(globalThis, "fetch");
    const items = [item(), item("exhaust")];
    const res = await post(body(items));
    expect(res.status).toBe(200);
    const out = CheckResponse.parse(await res.json());
    expect(out.inputHash).toBe(HASH);
    expect(out.results.map((r) => r.itemId)).toEqual(items.map((i) => i.id));
    for (const r of out.results) {
      expect(r.status).toBe("verify");
      expect(r.reasons.join(" ")).toContain(MOCK_LABEL);
      expect(r.sources).toHaveLength(1);
      expect(r.sources[0]!.title).toMatch(/^Mock/);
      expect(LEGAL_SEED.sources.map((s) => s.url)).toContain(r.sources[0]!.url);
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("request checks", () => {
  it("rejects 4 items, bikeConfirmed false and extra keys with 400", async () => {
    vi.stubEnv("MOCK", "1");
    expect(await errorOf(await post(body([item(), item(), item(), item()])))).toEqual([400, "INVALID_REQUEST"]);
    expect(await errorOf(await post(body([item()], { bikeConfirmed: false })))).toEqual([400, "INVALID_REQUEST"]);
    expect(await errorOf(await post(body([item()], { extra: 1 })))).toEqual([400, "INVALID_REQUEST"]);
    expect(await errorOf(await post(null, {}, "not json"))).toEqual([400, "INVALID_REQUEST"]);
  });
  it("rejects duplicate item ids with 400 in mock mode", async () => {
    vi.stubEnv("MOCK", "1");
    const a = item();
    expect(await errorOf(await post(body([a, { ...item("exhaust"), id: a.id }])))).toEqual([400, "INVALID_REQUEST"]);
  });
  it("rejects a body over 100 KB with 413", async () => {
    vi.stubEnv("MOCK", "1");
    expect(await errorOf(await post(null, {}, " ".repeat(100_001)))).toEqual([413, "TOO_LARGE"]);
  });
  it("refuses a cross-origin request and a missing request id", async () => {
    vi.stubEnv("MOCK", "1");
    expect((await post(body(), { Origin: "https://evil.example" })).status).toBe(403);
    const res = await POST(new Request(`${ORIGIN}/api/check`, { method: "POST", body: JSON.stringify(body()), headers: withSession({ Origin: ORIGIN }) }));
    expect(await errorOf(res)).toEqual([400, "INVALID_REQUEST"]);
  });
});

const REDIS = "https://redis.invalid";
const LIVE = { LIVE_API_ENABLED: "true", MODEL_API_KEY: "k", UPSTASH_REDIS_REST_URL: REDIS, UPSTASH_REDIS_REST_TOKEN: "t",
  PRICING_VERIFIED_AT: "2026-10-28", VISITOR_HASH_SECRET: "s".repeat(32), BUDGET_TICKET: "T9", MOCK: "0", VERCEL_ENV: "" };

describe("live mode gates", () => {
  it("is LIVE_DISABLED without live config and sends nothing", async () => {
    vi.stubEnv("MOCK", "0");
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await errorOf(await post(body()))).toEqual([503, "LIVE_DISABLED"]);
    expect(spy).not.toHaveBeenCalled();
  });
  it("is FEATURE_DISABLED for search off, a blank reserve and a reserve of 0", async () => {
    for (const [k, v] of Object.entries(LIVE)) vi.stubEnv(k, v);
    const spy = vi.spyOn(globalThis, "fetch");
    for (const [search, reserve] of [["false", "20"], ["true", ""], ["true", "0"]] as const) {
      vi.stubEnv("SEARCH_ENABLED", search);
      vi.stubEnv("SEARCH_QUERY_RESERVE", reserve);
      expect(await errorOf(await post(body()))).toEqual([503, "FEATURE_DISABLED"]);
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("live path (fake Upstash and Meta)", () => {
  function live() {
    for (const [k, v] of Object.entries({ ...LIVE, SEARCH_ENABLED: "true", SEARCH_QUERY_RESERVE: "20" })) vi.stubEnv(k, v);
    const settles: string[][] = []; const reserved: string[] = []; const metaBodies: Record<string, unknown>[] = [];
    let answer: unknown = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url) === REDIS) {
        const a = JSON.parse(String(init!.body)) as string[];
        const isSettle = a[1]!.includes("budget settlement");
        if (isSettle) settles.push([a[12]!, a[13]!]); else reserved.push(a[11] ?? "");
        return Response.json({ result: isSettle ? ["OK", a[12], a[13]] : ["OK", "380000"] });
      }
      if (String(url) === "https://api.meta.ai/v1/responses") {
        metaBodies.push(JSON.parse(String(init!.body)) as Record<string, unknown>);
        return Response.json(answer);
      }
      throw new Error(`unexpected fetch ${String(url)}`);
    });
    return { settles, reserved, metaBodies, answer: (a: unknown) => { answer = a; } };
  }
  const SPECIFIC = "https://example-parts.de/bar/1";
  const modelResult = (itemId: string, sources: object[] = [{ url: SPECIFIC, title: "Maker", supports: "ABE listed" }]) => ({
    itemId, status: "ok", approval: "abe", documentCoverage: "covered", inspection: "none", eintragung: "not_required",
    carryDocuments: "required", reasons: ["Fits."], toMeasure: [], extraParts: [], conditions: [], sources, confidence: 0.9,
  });
  const reply = (results: object[], searched = true, annotations: object[] = []) => ({
    status: "completed", usage: { input_tokens: 2000, output_tokens: 1000 },
    output: [
      { type: "reasoning", summary: [] },
      ...(searched ? [{ type: "web_search_call", id: "ws_1", status: "completed", results: [{ url: SPECIFIC, title: "Maker", snippet: "s" }] }] : []),
      { type: "message", content: [{ type: "output_text", text: JSON.stringify({ results }), annotations }] },
    ],
  });

  it("sends a grounded body, keeps the full reservation when the query count is unknown, and never returns ok without specifics", async () => {
    const env = live();
    const it1 = item();
    env.answer(reply([modelResult(it1.id)]));
    const res = await post(body([it1]));
    expect(res.status).toBe(200);
    const out = CheckResponse.parse(await res.json());
    // handlebar: unconfirmed cable reach keeps this at verify even though the model said ok
    expect(out.results[0]!.status).toBe("verify");
    expect(out.inputHash).toBe(HASH);
    const b = env.metaBodies[0]!;
    expect(b.max_tool_calls).toBe(2);
    expect(b.include).toEqual(["web_search_call.results"]);
    expect(b.stream).toBe(false);
    expect(env.settles).toEqual([["unknown", "0"]]); // query count not reported: reservation stays
  });

  it("refuses a completed answer without a completed web_search_call, with no ok result", async () => {
    const env = live();
    const it1 = item();
    env.answer(reply([modelResult(it1.id)], false));
    const res = await post(body([it1]));
    expect(await errorOf(res)).toEqual([422, "NO_RESULT"]);
  });

  it("fails the whole batch when the answer ids do not match the request", async () => {
    const env = live();
    const [a, b] = [item(), item("exhaust")];
    env.answer(reply([modelResult(a.id), modelResult(crypto.randomUUID())]));
    expect(await errorOf(await post(body([a, b])))).toEqual([502, "SCHEMA_INVALID"]);
    env.answer(reply([modelResult(a.id)]));
    expect(await errorOf(await post(body([a, b])))).toEqual([502, "SCHEMA_INVALID"]);
  });

  it("strips a model source URL that is in neither citations nor results", async () => {
    const env = live();
    const it1 = item();
    const invented = "https://invented.example/abe";
    env.answer(reply([modelResult(it1.id, [
      { url: SPECIFIC, title: "Maker", supports: "found" }, { url: invented, title: "Made up", supports: "x" }])]));
    const out = CheckResponse.parse(await (await post(body([it1]))).json());
    expect(out.results[0]!.sources.map((s) => s.url)).toEqual([SPECIFIC]);
  });

  it("rejects duplicate ids before any Redis or Meta call", async () => {
    const env = live();
    const a = item();
    expect(await errorOf(await post(body([a, { ...item("exhaust"), id: a.id }])))).toEqual([400, "INVALID_REQUEST"]);
    expect(env.reserved).toHaveLength(0);
    expect(env.metaBodies).toHaveLength(0);
  });

  it("is LIVE_DISABLED when the search price is missing, with no Redis or Meta call", async () => {
    const env = live();
    priceOverride.fn = (real) => {
      const r = real as { prices: Record<string, Record<string, unknown> | null> };
      const prices = Object.fromEntries(Object.entries(r.prices).map(([k, v]) => {
        if (!v) return [k, v];
        const rest = { ...v }; delete rest.webSearchMicroUsdPerQuery; return [k, rest];
      }));
      return { ...r, prices };
    };
    expect(await errorOf(await post(body()))).toEqual([503, "LIVE_DISABLED"]);
    expect(env.reserved).toHaveLength(0);
    expect(env.metaBodies).toHaveLength(0);
  });

  it("maps an upstream 429 to RATE_LIMITED without a second Meta call", async () => {
    const env = live();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url) === REDIS) {
        const a = JSON.parse(String(init!.body)) as string[];
        return Response.json({ result: a[1]!.includes("budget settlement") ? ["OK", a[12], a[13]] : ["OK", "380000"] });
      }
      env.metaBodies.push({});
      return new Response("{}", { status: 429 });
    });
    expect(await errorOf(await post(body()))).toEqual([429, "RATE_LIMITED"]);
    expect(env.metaBodies).toHaveLength(1);
  });
});
