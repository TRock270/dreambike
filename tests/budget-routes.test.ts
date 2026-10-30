// Session cookie enforcement, the page proxy, GET /api/budget and GET /api/health.
// Offline: a fake Upstash REST endpoint; any other fetch (Meta included) fails the test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as budgetGET } from "@/app/api/budget/route";
import { GET as healthGET } from "@/app/api/health/route";
import { POST as compositePOST } from "@/app/api/composite/route";
import { POST as editPOST } from "@/app/api/edit/route";
import { POST as checkPOST } from "@/app/api/check/route";
import { POST as identifyPOST } from "@/app/api/identify/route";
import { POST as instructionPOST } from "@/app/api/instruction/route";
import { POST as normalizePOST } from "@/app/api/normalize/route";
import { POST as segmentPOST } from "@/app/api/segment/route";
import { BudgetResponse, ErrorResponse, HealthResponse } from "@/lib/contracts";
import { SESSION_COOKIE, SESSION_MAX_AGE_S, issueSession, readSession } from "@/lib/server/http";
import { clearStatusCache } from "@/lib/server/budget";
import { mayUseOwnStatusBucket, quotaLimiterSizesForTests, resetQuotaLimitersForTests, VISITORS_PER_IP_LIMIT, VISITORS_PER_IP_WINDOW_MS } from "@/lib/server/paid";
import { config as proxyConfig, proxy } from "@/proxy";
import { sessionCookie } from "./support/session";

const REDIS = "https://redis.invalid";
const ORIGIN = "http://localhost:3000";
const SECRET = "s".repeat(32);
const DAY_MS = 24 * 3600 * 1000;

let redisReply: (() => unknown) | "down";
let fetched: string[];
let redisEvals: number;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("MOCK", "0");
  clearStatusCache();
  resetQuotaLimitersForTests();
  fetched = [];
  redisEvals = 0;
  redisReply = "down";
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    fetched.push(String(url));
    if (String(url) !== REDIS) throw new Error(`unexpected fetch to ${String(url)}`);
    redisEvals += 1;
    if (redisReply === "down") throw new TypeError("network");
    return Response.json({ result: redisReply() });
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function liveEnv(extra: Record<string, string> = {}) {
  for (const [k, v] of Object.entries({ LIVE_API_ENABLED: "true", MODEL_API_KEY: "k", UPSTASH_REDIS_REST_URL: REDIS,
    UPSTASH_REDIS_REST_TOKEN: "t", PRICING_VERIFIED_AT: "2026-10-28", VISITOR_HASH_SECRET: SECRET, BUDGET_TICKET: "T13",
    ...extra })) vi.stubEnv(k, v);
}
function demoEnv() {
  liveEnv({ VERCEL_ENV: "production", NODE_ENV: "production", BUDGET_PHASE: "demo", APP_ORIGIN: "https://dreambike.example" });
}

const get = (path: string, headers: Record<string, string> = {}) => new Request(`${ORIGIN}${path}`, { headers });
const setCookieOf = (res: Response) => res.headers.get("set-cookie");
const cookieValueOf = (res: Response) => /db_session=([^;]+)/.exec(setCookieOf(res) ?? "")?.[1] ?? null;

describe("POSTs need a valid session cookie", () => {
  const routes = { normalizePOST, compositePOST, segmentPOST, identifyPOST, instructionPOST, editPOST, checkPOST };
  const cookies: Record<string, () => string | null> = {
    missing: () => null,
    forged: () => `${SESSION_COOKIE}=v1.${"A".repeat(22)}.${Math.floor(Date.now() / 1000)}.${"B".repeat(43)}`,
    garbage: () => `${SESSION_COOKIE}=nonsense`,
    expired: () => `${SESSION_COOKIE}=${issueSession(process.env, Date.now() - 3 * DAY_MS)!.value}`,
    "other secret": () => {
      vi.stubEnv("VISITOR_HASH_SECRET", "t".repeat(32));
      const value = issueSession(process.env)!.value;
      vi.stubEnv("VISITOR_HASH_SECRET", SECRET);
      return `${SESSION_COOKIE}=${value}`;
    },
  };

  for (const [kind, cookie] of Object.entries(cookies)) {
    it(`${kind} cookie: 403 'Reload the page to continue.' on every POST route, zero fetches`, async () => {
      vi.stubEnv("VISITOR_HASH_SECRET", SECRET);
      liveEnv();
      for (const [name, handler] of Object.entries(routes)) {
        const headers: Record<string, string> = { Origin: ORIGIN, "X-Request-Id": crypto.randomUUID() };
        const c = cookie();
        if (c) headers.Cookie = c;
        const res = await handler(new Request(`${ORIGIN}/api/x`, { method: "POST", body: "x", headers }));
        const body = ErrorResponse.parse(await res.json());
        expect([name, res.status, body.error.code, body.error.message])
          .toEqual([name, 403, "FORBIDDEN", "Reload the page to continue."]);
      }
      expect(fetched).toEqual([]);
    });
  }

  it("a cross-origin request keeps the plain forbidden text", async () => {
    const res = await segmentPOST(new Request(`${ORIGIN}/api/segment`, { method: "POST", body: "x",
      headers: { Origin: "https://evil.example", Cookie: sessionCookie() } }));
    expect(ErrorResponse.parse(await res.json()).error.message).toBe("This request is not allowed.");
  });

  it("deployed without VISITOR_HASH_SECRET every POST is 403, even with a cookie signed elsewhere", async () => {
    vi.stubEnv("VISITOR_HASH_SECRET", SECRET);
    const foreign = `${SESSION_COOKIE}=${issueSession(process.env)!.value}`;
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "https://dreambike.example");
    vi.stubEnv("VISITOR_HASH_SECRET", "");
    for (const handler of Object.values(routes)) {
      const res = await handler(new Request("https://dreambike.example/api/x", { method: "POST", body: "x",
        headers: { Origin: "https://dreambike.example", Cookie: foreign, "X-Request-Id": crypto.randomUUID() } }));
      expect(res.status).toBe(403);
    }
    expect(fetched).toEqual([]);
  });

  it("deployed without VISITOR_HASH_SECRET the refusal is the plain text; with a secret a bad cookie says reload", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "https://dreambike.example");
    vi.stubEnv("VISITOR_HASH_SECRET", "");
    const post = () => new Request("https://dreambike.example/api/x", { method: "POST", body: "x",
      headers: { Origin: "https://dreambike.example", "X-Request-Id": crypto.randomUUID() } });
    const plain = ErrorResponse.parse(await (await segmentPOST(post())).json());
    expect(plain.error.code).toBe("FORBIDDEN");
    expect(plain.error.message).toBe("This request is not allowed.");
    vi.stubEnv("VISITOR_HASH_SECRET", SECRET);
    const reload = ErrorResponse.parse(await (await segmentPOST(post())).json());
    expect(reload.error.message).toBe("Reload the page to continue.");
  });

  it("a valid cookie passes the guard (the route then validates the body)", async () => {
    const res = await normalizePOST(new Request(`${ORIGIN}/api/normalize`, { method: "POST", body: "x",
      headers: { Origin: ORIGIN, Cookie: sessionCookie() } }));
    expect(res.status).not.toBe(403);
  });
});

describe("page proxy", () => {
  const page = (headers: Record<string, string> = {}, method = "GET") =>
    new Request(`${ORIGIN}/`, { method, headers });

  it("sets a signed HttpOnly SameSite=Lax cookie on a page request that has none", () => {
    const res = proxy(page());
    const header = res.headers.get("set-cookie")!;
    expect(header).toContain(`${SESSION_COOKIE}=`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain(`Max-Age=${SESSION_MAX_AGE_S}`);
    expect(header).not.toContain("Secure"); // http origin
    expect(readSession(new Request(ORIGIN, { headers: { Cookie: header.split(";")[0]! } }))).not.toBeNull();
  });

  it("marks the cookie Secure when APP_ORIGIN is https", () => {
    vi.stubEnv("APP_ORIGIN", "https://dreambike.example");
    expect(proxy(page()).headers.get("set-cookie")).toContain("Secure");
  });

  it("keeps a valid cookie: no new Set-Cookie, so the visitor id never rotates", () => {
    expect(proxy(page({ Cookie: sessionCookie() })).headers.get("set-cookie")).toBeNull();
  });

  it("reissues for a forged or expired cookie", () => {
    const expired = `${SESSION_COOKIE}=${issueSession(process.env, Date.now() - 3 * DAY_MS)!.value}`;
    expect(proxy(page({ Cookie: expired })).headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
    expect(proxy(page({ Cookie: `${SESSION_COOKIE}=bad` })).headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
  });

  it("does nothing for non-page methods", () => {
    expect(proxy(page({}, "POST")).headers.get("set-cookie")).toBeNull();
  });

  it("issues no cookie when deployed without a secret", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VISITOR_HASH_SECRET", "");
    expect(proxy(page()).headers.get("set-cookie")).toBeNull();
  });

  it("matcher covers pages and skips /_next, /api, /demo, fonts and files with an extension", () => {
    expect(proxyConfig.matcher).toHaveLength(1);
    const re = new RegExp(`^${proxyConfig.matcher[0]!}$`);
    for (const yes of ["/", "/projects", "/some/page"]) expect(re.test(yes), yes).toBe(true);
    for (const no of ["/_next/static/chunk.js", "/_next/image", "/api/budget", "/api/health", "/demo/project.json",
      "/demo/v0.webp", "/fonts/plex.woff2", "/favicon.ico", "/robots.txt"]) expect(re.test(no), no).toBe(false);
  });
});

/** The Upstash reply of budget/status.lua for given totals. */
function statusReply(o: { capProject?: number; capDaily?: number; halted?: boolean;
  buckets?: Partial<Record<"lifetime" | "phase" | "ticket" | "global_day" | "visitor_day" | "ip_day", [number, number]>>;
  counts?: [number, number][] } = {}) {
  const order = ["lifetime", "phase", "ticket", "global_day", "visitor_day", "ip_day"] as const;
  const out: string[] = ["OK", o.halted ? "1" : "0", String(o.capProject ?? 100_000_000), String(o.capDaily ?? 5_000_000)];
  for (const name of order) out.push(...(o.buckets?.[name] ?? [0, 0]).map(String));
  for (const [v, i] of o.counts ?? [[0, 0], [0, 0], [0, 0], [0, 0]]) out.push(String(v), String(i));
  return out;
}
/** The health check asks for no model counts. */
const healthReply = (o: Parameters<typeof statusReply>[0] = {}) => statusReply({ ...o, counts: [] });
const parseBudget = async (res: Response) => BudgetResponse.parse(await res.json());

describe("GET /api/budget", () => {
  it("unavailable accounting: liveEnabled false, spend unknown (null), remaining zero, and the cookie is still set", async () => {
    liveEnv();
    redisReply = "down";
    clearStatusCache(); // a changed fake reply must not be hidden by the 10 s display cache
    const res = await budgetGET(get("/api/budget"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(cookieValueOf(res)).not.toBeNull();
    const body = await parseBudget(res);
    expect(body).toMatchObject({ liveEnabled: false, spentTodayMicroUsd: null, reservedTodayMicroUsd: null,
      visitorRemainingMicroUsd: 0, remainingEdits: 0, reason: "accounting_unavailable" });
    expect(body.dailyCapMicroUsd).toBe(5_000_000);
    expect(fetched.every((u) => u === REDIS)).toBe(true);
  });

  it("a missing lifetime key or missing stored caps is an accounting failure, not zero spend", async () => {
    liveEnv();
    for (const reply of [["UNAVAILABLE", "lifetime_uninitialized"], ["UNAVAILABLE", "caps_uninitialized"], ["garbage"], statusReply({ halted: true })]) {
      redisReply = () => reply;
      clearStatusCache(); // a changed fake reply must not be hidden by the 10 s display cache
      const body = await parseBudget(await budgetGET(get("/api/budget")));
      expect(body).toMatchObject({ liveEnabled: false, spentTodayMicroUsd: null, reservedTodayMicroUsd: null,
        visitorRemainingMicroUsd: 0, remainingEdits: 0, reason: "accounting_unavailable" });
    }
  });

  it("reads the ledger once, read-only, and reports totals when healthy", async () => {
    liveEnv();
    redisReply = () => statusReply({ buckets: { global_day: [1_200_000, 300_000] } });
    clearStatusCache(); // a changed fake reply must not be hidden by the 10 s display cache
    const res = await budgetGET(get("/api/budget"));
    const body = await parseBudget(res);
    expect(redisEvals).toBe(1);
    expect(body).toMatchObject({ liveEnabled: true, spentTodayMicroUsd: 1_200_000, reservedTodayMicroUsd: 300_000,
      dailyCapMicroUsd: 5_000_000, reason: null });
    // Local development phase has no count limits; the money minimum decides.
    expect(body.visitorRemainingMicroUsd).toBe(3_500_000); // the global day: 5,000,000 - 1,200,000 - 300,000
    expect(body.remainingEdits).toBe(350);
  });

  it("uses the smaller of the environment and the stored cap, and minima across every bucket and count", async () => {
    demoEnv();
    redisReply = () => statusReply({
      capDaily: 2_000_000,
      buckets: { global_day: [100_000, 0], visitor_day: [30_000, 10_000], ip_day: [60_000, 0] },
      counts: [[1, 1], [2, 3], [0, 0], [0, 0]], // edits: visitor 2, ip 3 of 5
    });
    const body = await parseBudget(await budgetGET(get("/api/budget", { "x-vercel-forwarded-for": "203.0.113.5" })));
    expect(body.dailyCapMicroUsd).toBe(2_000_000);
    expect(body.visitorRemainingMicroUsd).toBe(440_000); // ip bucket: 500_000 - 60_000 is the tightest
    expect(body.remainingEdits).toBe(2); // 5 - 3 on the IP count beats 44 by money
    expect(body.reason).toBeNull();
  });

  it("names the cap that is used up", async () => {
    demoEnv();
    const reasonFor = async (o: Parameters<typeof statusReply>[0]) => {
      redisReply = () => statusReply(o);
      clearStatusCache(); // a changed fake reply must not be hidden by the 10 s display cache
      return (await parseBudget(await budgetGET(get("/api/budget", { "x-vercel-forwarded-for": "203.0.113.5" })))).reason;
    };
    expect(await reasonFor({ buckets: { visitor_day: [499_000, 0] } })).toBe("visitor_cap");
    expect(await reasonFor({ buckets: { ip_day: [0, 499_000] } })).toBe("visitor_cap");
    expect(await reasonFor({ buckets: { global_day: [4_999_000, 0] } })).toBe("global_cap");
    expect(await reasonFor({ buckets: { lifetime: [99_999_000, 0] } })).toBe("project_cap");
  });

  it("a used-up visitor or IP edit count gives visitor_cap and turns live off", async () => {
    demoEnv();
    const headers = { "x-vercel-forwarded-for": "203.0.113.5" };
    const run = async (counts: [number, number][]) => {
      redisReply = () => statusReply({ counts });
      clearStatusCache(); // a changed fake reply must not be hidden by the 10 s display cache
      return parseBudget(await budgetGET(get("/api/budget", headers)));
    };
    const limit = (await run([[0, 0], [0, 0], [0, 0], [0, 0]])).remainingEdits; // money-limited here
    expect(limit).toBeGreaterThan(0);
    // The edit model is the second entry; the limit is 5 (see the test above).
    for (const edits of [[5, 0], [0, 5], [6, 2]] as [number, number][]) {
      const body = await run([[0, 0], edits, [0, 0], [0, 0]]);
      expect(body).toMatchObject({ remainingEdits: 0, reason: "visitor_cap", liveEnabled: false });
    }
    // A stronger reason wins.
    redisReply = () => statusReply({ buckets: { global_day: [4_999_000, 0] }, counts: [[0, 0], [5, 5], [0, 0], [0, 0]] });
    clearStatusCache(); // a changed fake reply must not be hidden by the 10 s display cache
    expect((await parseBudget(await budgetGET(get("/api/budget", headers)))).reason).toBe("global_cap");
    // One edit left: still live.
    const left = await run([[0, 0], [4, 0], [0, 0], [0, 0]]);
    expect(left).toMatchObject({ remainingEdits: 1, reason: null, liveEnabled: true });
  });

  it("any cap reason makes liveEnabled false", async () => {
    demoEnv();
    for (const buckets of [{ visitor_day: [499_000, 0] }, { global_day: [4_999_000, 0] }, { lifetime: [99_999_000, 0] }] as Parameters<typeof statusReply>[0] extends infer O ? NonNullable<O extends { buckets?: infer B } ? B : never>[] : never) {
      redisReply = () => statusReply({ buckets });
      clearStatusCache(); // a changed fake reply must not be hidden by the 10 s display cache
      const body = await parseBudget(await budgetGET(get("/api/budget", { "x-vercel-forwarded-for": "203.0.113.5" })));
      expect(body.reason).not.toBeNull();
      expect(body.liveEnabled).toBe(false);
    }
  });

  it("BUDGET_TICKET unset locally is live_disabled, not an accounting failure, and makes no Redis call", async () => {
    liveEnv({ BUDGET_TICKET: "" });
    redisReply = () => statusReply();
    clearStatusCache(); // a changed fake reply must not be hidden by the 10 s display cache
    const res = await budgetGET(get("/api/budget"));
    expect(await parseBudget(res)).toMatchObject({ liveEnabled: false, spentTodayMicroUsd: null, reason: "live_disabled" });
    expect(redisEvals).toBe(0);
    expect(cookieValueOf(res)).not.toBeNull();
  });

  it("a long session cookie is renewed with the same id once it is older than 24 h", async () => {
    demoEnv();
    redisReply = () => statusReply();
    clearStatusCache(); // a changed fake reply must not be hidden by the 10 s display cache
    const headers = { "x-vercel-forwarded-for": "203.0.113.5" };
    const old = issueSession(process.env, Date.now() - 30 * 3600 * 1000)!;
    const res = await budgetGET(get("/api/budget", { ...headers, Cookie: `${SESSION_COOKIE}=${old.value}` }));
    const renewed = cookieValueOf(res);
    expect(renewed).not.toBeNull();
    expect(readSession(new Request(ORIGIN, { headers: { Cookie: `${SESSION_COOKIE}=${renewed}` } }))?.id).toBe(old.session.id);
  });

  it("demo deployment without the platform IP header: no live allowance, no Redis call, cookie still set", async () => {
    demoEnv();
    redisReply = () => statusReply();
    clearStatusCache(); // a changed fake reply must not be hidden by the 10 s display cache
    const res = await budgetGET(get("/api/budget"));
    expect((await parseBudget(res)).reason).toBe("accounting_unavailable");
    expect(redisEvals).toBe(0);
    expect(cookieValueOf(res)).not.toBeNull();
  });

  it("a first visitor gets a cookie and counts against that very session; a returning one keeps theirs", async () => {
    demoEnv();
    redisReply = () => statusReply();
    clearStatusCache(); // a changed fake reply must not be hidden by the 10 s display cache
    const headers = { "x-vercel-forwarded-for": "203.0.113.5" };
    const first = await budgetGET(get("/api/budget", headers));
    expect((await parseBudget(first)).liveEnabled).toBe(true);
    const value = cookieValueOf(first)!;
    const cookie = setCookieOf(first)!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure"); // https APP_ORIGIN
    const again = await budgetGET(get("/api/budget", { ...headers, Cookie: `${SESSION_COOKIE}=${value}` }));
    expect(setCookieOf(again)).toBeNull();
  });

  it("rejects any query parameter, with the cookie still set and no Redis call", async () => {
    liveEnv();
    redisReply = () => statusReply();
    clearStatusCache(); // a changed fake reply must not be hidden by the 10 s display cache
    for (const q of ["?x=1", "?live=true&x", "?debug"]) {
      const res = await budgetGET(get(`/api/budget${q}`));
      expect(res.status).toBe(400);
      expect(ErrorResponse.parse(await res.json()).error.code).toBe("INVALID_REQUEST");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(cookieValueOf(res)).not.toBeNull();
    }
    expect(redisEvals).toBe(0);
  });

  it("mock and demo-only modes report live off without touching Redis", async () => {
    vi.stubEnv("MOCK", "1");
    const mock = await parseBudget(await budgetGET(get("/api/budget")));
    expect(mock).toMatchObject({ liveEnabled: false, spentTodayMicroUsd: null, visitorRemainingMicroUsd: 0, reason: "live_disabled" });
    vi.stubEnv("MOCK", "0");
    vi.stubEnv("LIVE_API_ENABLED", "false");
    const off = await parseBudget(await budgetGET(get("/api/budget")));
    expect(off.reason).toBe("live_disabled");
    expect(fetched).toEqual([]);
  });

  it("a misconfigured deployment still answers with a safe error and a cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MOCK", "1");
    vi.stubEnv("VISITOR_HASH_SECRET", SECRET);
    const res = await budgetGET(get("/api/budget"));
    expect(res.status).toBe(503);
    expect(cookieValueOf(res)).not.toBeNull();
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("MOCK");
  });

  it("never leaks secrets or connection details", async () => {
    liveEnv();
    redisReply = "down";
    clearStatusCache(); // a changed fake reply must not be hidden by the 10 s display cache
    const text = await (await budgetGET(get("/api/budget"))).text();
    for (const secret of [SECRET, "redis.invalid", "network"]) expect(text).not.toContain(secret);
  });
});

describe("Redis quota protection (10 s display cache)", () => {
  afterEach(() => { vi.useRealTimers(); });
  const fakeClock = () => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-30T15:00:00Z") });
  const cookieOf = (res: Response) => /db_session=[^;]+/.exec(setCookieOf(res) ?? "")![0];

  it("same cookie: one EVAL for many requests within 10 s, a new one after the TTL", async () => {
    fakeClock();
    liveEnv();
    redisReply = () => statusReply();
    const cookie = sessionCookie();
    for (let i = 0; i < 25; i++) {
      expect((await budgetGET(get("/api/budget", { cookie }))).status).toBe(200);
    }
    expect(redisEvals).toBe(1);
    vi.setSystemTime(Date.now() + 9_000);
    await budgetGET(get("/api/budget", { cookie }));
    expect(redisEvals).toBe(1);
    vi.setSystemTime(Date.now() + 1_500);
    await budgetGET(get("/api/budget", { cookie }));
    expect(redisEvals).toBe(2);
  });

  it("no cookie from one IP: every request gets a fresh cookie but only one EVAL; the placeholder bucket is used", async () => {
    fakeClock();
    demoEnv();
    redisReply = () => statusReply();
    const ip = { "x-vercel-forwarded-for": "203.0.113.5" };
    const cookies = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const res = await budgetGET(get("/api/budget", ip));
      expect(res.status).toBe(200);
      cookies.add(cookieOf(res));
    }
    expect(cookies.size).toBe(25);
    expect(redisEvals).toBe(1);
    vi.setSystemTime(Date.now() + 10_001);
    await budgetGET(get("/api/budget", ip));
    expect(redisEvals).toBe(2);
    // A visitor who keeps a cookie reads their own bucket, not the placeholder.
    const own = await budgetGET(get("/api/budget", { ...ip, cookie: sessionCookie() }));
    expect(own.status).toBe(200);
    expect(redisEvals).toBe(3);
  });

  it("many cookies from one IP: at most limit + 1 EVALs; own buckets stay; the window expiring restores them", async () => {
    fakeClock();
    demoEnv();
    redisReply = () => statusReply();
    const ip = { "x-vercel-forwarded-for": "203.0.113.5" };
    const first = sessionCookie();
    for (let i = 0; i < 25; i++) {
      const cookie = i === 0 ? first : sessionCookie();
      expect((await budgetGET(get("/api/budget", { ...ip, cookie }))).status).toBe(200);
    }
    expect(redisEvals).toBeLessThanOrEqual(VISITORS_PER_IP_LIMIT + 1);
    const before = redisEvals;
    // After the window a new cookie reads its own bucket again.
    vi.setSystemTime(Date.now() + VISITORS_PER_IP_WINDOW_MS + 1);
    const cookies = Array.from({ length: 3 }, () => sessionCookie());
    for (const cookie of cookies) await budgetGET(get("/api/budget", { ...ip, cookie }));
    expect(redisEvals).toBe(before + 3);
  });

  it("mayUseOwnStatusBucket: counted visitors keep their bucket even when the IP is full; the window restores new ones", () => {
    const t = 1_000_000;
    const visitors = Array.from({ length: VISITORS_PER_IP_LIMIT }, (_, i) => `v${i}`);
    for (const v of visitors) expect(mayUseOwnStatusBucket("ipA", v, t)).toBe(true);
    expect(mayUseOwnStatusBucket("ipA", "extra", t + 1)).toBe(false);
    expect(mayUseOwnStatusBucket("ipA", "v0", t + 2)).toBe(true);
    expect(mayUseOwnStatusBucket("ipB", "extra", t + 2)).toBe(true);
    expect(mayUseOwnStatusBucket("ipA", "extra", t + VISITORS_PER_IP_WINDOW_MS)).toBe(true);
  });

  it("a normal single visitor and a different IP keep their own buckets", async () => {
    fakeClock();
    demoEnv();
    redisReply = () => statusReply();
    for (let i = 0; i < VISITORS_PER_IP_LIMIT + 2; i++) {
      await budgetGET(get("/api/budget", { "x-vercel-forwarded-for": "203.0.113.5", cookie: sessionCookie() }));
    }
    const before = redisEvals;
    await budgetGET(get("/api/budget", { "x-vercel-forwarded-for": "203.0.113.9", cookie: sessionCookie() }));
    expect(redisEvals).toBe(before + 1);
  });

  it("local development is never limited and the limiter maps stay bounded", async () => {
    fakeClock();
    liveEnv();
    redisReply = () => statusReply();
    for (let i = 0; i < 10; i++) await budgetGET(get("/api/budget", { cookie: sessionCookie() }));
    expect(quotaLimiterSizesForTests().visitorWindows).toBe(0);
    demoEnv();
    for (let i = 0; i < 2100; i++) {
      await budgetGET(get("/api/budget", { "x-vercel-forwarded-for": `10.${i >> 8}.${i & 255}.1`, cookie: sessionCookie() }));
    }
    expect(quotaLimiterSizesForTests().visitorWindows).toBeLessThanOrEqual(2000);
  });

  it("an outage is cached: no Redis retry per request", async () => {
    fakeClock();
    liveEnv();
    redisReply = "down";
    const cookie = sessionCookie();
    for (let i = 0; i < 15; i++) {
      const body = await parseBudget(await budgetGET(get("/api/budget", { cookie })));
      expect(body).toMatchObject({ liveEnabled: false, spentTodayMicroUsd: null, reason: "accounting_unavailable" });
    }
    expect(redisEvals).toBe(1);
    vi.setSystemTime(Date.now() + 10_001);
    await budgetGET(get("/api/budget", { cookie }));
    expect(redisEvals).toBe(2);
  });

  it("health reads the ledger once per 10 s, outage included", async () => {
    fakeClock();
    liveEnv();
    redisReply = () => healthReply();
    for (let i = 0; i < 20; i++) await healthGET(get("/api/health"));
    expect(redisEvals).toBe(1);
    vi.setSystemTime(Date.now() + 10_001);
    await healthGET(get("/api/health"));
    expect(redisEvals).toBe(2);
    clearStatusCache();
    redisReply = "down";
    for (let i = 0; i < 20; i++) {
      expect(HealthResponse.parse(await (await healthGET(get("/api/health"))).json()).accountingReady).toBe(false);
    }
    expect(redisEvals).toBe(3);
  });
});

describe("GET /api/health", () => {
  it("never calls Meta or any host except the ledger, and reports live only with a healthy ledger", async () => {
    liveEnv();
    redisReply = () => healthReply();
    clearStatusCache(); // a changed fake reply must not be hidden by the 10 s display cache
    const live = HealthResponse.parse(await (await healthGET(get("/api/health"))).json());
    expect(live).toEqual({ ok: true, mode: "live", accountingReady: true, apiConfigured: true });
    redisReply = "down";
    clearStatusCache(); // a changed fake reply must not be hidden by the 10 s display cache
    const down = await healthGET(get("/api/health"));
    expect(down.status).toBe(200); // the cached demo is still usable
    expect(HealthResponse.parse(await down.json())).toEqual({ ok: true, mode: "demo_only", accountingReady: false, apiConfigured: true });
    redisReply = () => ["UNAVAILABLE", "lifetime_uninitialized"];
    clearStatusCache(); // a changed fake reply must not be hidden by the 10 s display cache
    expect(HealthResponse.parse(await (await healthGET(get("/api/health"))).json()).accountingReady).toBe(false);
    redisReply = () => healthReply({ halted: true });
    clearStatusCache(); // a changed fake reply must not be hidden by the 10 s display cache
    expect(HealthResponse.parse(await (await healthGET(get("/api/health"))).json()).mode).toBe("demo_only");
    expect(fetched.length).toBeGreaterThan(0);
    expect(fetched.every((u) => u === REDIS)).toBe(true);
    expect(fetched.some((u) => u.includes("meta.ai"))).toBe(false);
  });

  it("a misconfigured deployment (MOCK=1 in production) is 200 demo_only and never echoes the error", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MOCK", "1");
    const res = await healthGET(get("/api/health"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(HealthResponse.parse(JSON.parse(text))).toEqual({ ok: true, mode: "demo_only", accountingReady: false, apiConfigured: false });
    expect(text).not.toContain("MOCK");
    expect(fetched).toEqual([]);
  });

  it("mock mode and an unconfigured ledger make no network call at all", async () => {
    vi.stubEnv("MOCK", "1");
    expect(HealthResponse.parse(await (await healthGET(get("/api/health"))).json()))
      .toEqual({ ok: true, mode: "mock", accountingReady: false, apiConfigured: false });
    vi.stubEnv("MOCK", "0");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    expect(HealthResponse.parse(await (await healthGET(get("/api/health"))).json()).mode).toBe("demo_only");
    expect(fetched).toEqual([]);
  });

  it("a preview deployment is never live", async () => {
    liveEnv({ VERCEL_ENV: "preview", NODE_ENV: "production", BUDGET_PHASE: "demo", APP_ORIGIN: "https://p.example" });
    redisReply = () => healthReply();
    clearStatusCache(); // a changed fake reply must not be hidden by the 10 s display cache
    const body = HealthResponse.parse(await (await healthGET(get("/api/health"))).json());
    expect(body.mode).toBe("demo_only");
  });

  it("rejects query parameters and sends no-store", async () => {
    const res = await healthGET(get("/api/health?probe=1"));
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await healthGET(get("/api/health"))).headers.get("cache-control")).toBe("no-store");
    expect(fetched).toEqual([]);
  });
});
