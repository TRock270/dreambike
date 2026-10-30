// withReservation against a fake Upstash REST endpoint: no network, no Meta.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { countLimitFor, normalizeClientIp, POST_ATTEMPTS_DAILY_LIMIT, POST_ATTEMPTS_LIMIT, POST_ATTEMPTS_WINDOW_MS, quotaLimiterSizesForTests, resetQuotaLimitersForTests, withReservation, type PaidCall } from "@/lib/server/paid";
import { loadConfig } from "@/lib/server/config";
import { labeledHmac } from "@/lib/server/http";
import { sessionCookie } from "./support/session";

const REDIS = "https://redis.invalid";
/** A paid call whose request carries a valid session cookie (call after the env is stubbed). */
const makeCall = (headers: Record<string, string> = {}, over: Partial<PaidCall> = {}): PaidCall => ({
  req: new Request("http://localhost:3000/api/segment", { method: "POST", headers: { Cookie: sessionCookie(), ...headers } }),
  route: "/api/segment", model: "sam-3.1", amountMicroUsd: 2500, requestId: crypto.randomUUID(),
  payloadDigest: "abc", deadlineMs: 5000, ...over,
});

type RedisReply = [string, ...string[]];
let replies: { reserve: RedisReply; settle: RedisReply | "fail" };
let commands: string[][];

beforeEach(() => {
  resetQuotaLimitersForTests();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERCEL_ENV", "");
  for (const [k, v] of Object.entries({ LIVE_API_ENABLED: "true", MODEL_API_KEY: "k", UPSTASH_REDIS_REST_URL: REDIS,
    UPSTASH_REDIS_REST_TOKEN: "t", PRICING_VERIFIED_AT: "2026-10-28", VISITOR_HASH_SECRET: "s".repeat(32),
    BUDGET_TICKET: "T3", MOCK: "0" })) vi.stubEnv(k, v);
  replies = { reserve: ["OK", "2500"], settle: ["OK", "settled", "2500"] };
  commands = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url) !== REDIS) throw new Error(`unexpected fetch to ${String(url)}`);
    const args = JSON.parse(String(init!.body)) as string[];
    commands.push(args);
    const isSettle = args[1]!.includes("budget settlement");
    if (isSettle && replies.settle === "fail") throw new TypeError("network");
    return Response.json({ result: isSettle ? replies.settle : replies.reserve });
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

/** The settle outcome and charge from the recorded EVAL (args after the 9 keys). */
const settled = () => {
  const s = commands.find((c) => c[1]!.includes("budget settlement"));
  return s ? [s[3 + 9], s[4 + 9]] : null;
};

describe("withReservation", () => {
  it("reserves, dispatches once, and settles the known charge", async () => {
    const dispatch = vi.fn(async () => ({ value: "masks", chargedMicroUsd: 2500 }));
    expect(await withReservation(makeCall(), dispatch)).toBe("masks");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(commands[0]![1]).toContain("budget reservation");
    expect(settled()).toEqual(["settled", "2500"]);
  });

  it("releases only a definite 429 and keeps everything else as unknown", async () => {
    await expect(withReservation(makeCall(), async () => { throw new AppError("RATE_LIMITED"); })).rejects.toThrow();
    expect(settled()).toEqual(["released", "0"]);
    for (const code of ["UPSTREAM_TIMEOUT", "UPSTREAM_REJECTED", "SCHEMA_INVALID", "UPSTREAM_UNAVAILABLE"] as const) {
      commands = [];
      await expect(withReservation(makeCall(), async () => { throw new AppError(code); })).rejects.toThrow();
      expect(settled(), code).toEqual(["unknown", "0"]);
    }
    commands = [];
    await withReservation(makeCall(), async () => ({ value: 1, chargedMicroUsd: null }));
    expect(settled()).toEqual(["unknown", "0"]);
  });

  it("never dispatches when deployed, not live, without a ticket, or on a duplicate ID", async () => {
    const dispatch = vi.fn(async () => ({ value: 1, chargedMicroUsd: 1 }));
    const call = makeCall();
    const codeOf = async () => { try { await withReservation(call, dispatch); return "OK"; } catch (e) { return (e as AppError).code; } };
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await codeOf()).toBe("LIVE_DISABLED");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("LIVE_API_ENABLED", "false");
    expect(await codeOf()).toBe("LIVE_DISABLED");
    vi.stubEnv("LIVE_API_ENABLED", "true");
    vi.stubEnv("BUDGET_TICKET", "app-dev");
    expect(await codeOf()).toBe("LIVE_DISABLED");
    expect(commands).toEqual([]); // no Redis call either
    vi.stubEnv("BUDGET_TICKET", "T3");
    replies.reserve = ["DUPLICATE", "reserved"];
    expect(await codeOf()).toBe("REQUEST_IN_PROGRESS");
    replies.reserve = ["DUPLICATE", "conflict"];
    expect(await codeOf()).toBe("INVALID_REQUEST");
    // A ticket/lifetime/phase cap is not the visitor's doing: live is off (503), not a 429.
    replies.reserve = ["DENIED", "ticket"];
    expect(await codeOf()).toBe("LIVE_DISABLED");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("keeps a paid-for result when settlement fails (reservation stays counted)", async () => {
    replies.settle = "fail";
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await withReservation(makeCall(), async () => ({ value: "kept", chargedMicroUsd: 2500 }))).toBe("kept");
  });
});

describe("an upstream error is never replaced by a settle failure", () => {
  it("rethrows the upstream error when settling after it also fails", async () => {
    replies.settle = "fail";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const upstream = new AppError("UPSTREAM_TIMEOUT");
    const caught = await withReservation(makeCall(), async () => { throw upstream; }).catch((e: unknown) => e);
    expect(caught).toBe(upstream);
    // The settle was attempted once (unknown keeps the full reservation) and failed quietly.
    expect(commands.filter((c) => c[1]!.includes("budget settlement"))).toHaveLength(1);
  });

  it("rethrows a definite 429 as RATE_LIMITED even when the release cannot be recorded", async () => {
    replies.settle = "fail";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const caught = await withReservation(makeCall(), async () => { throw new AppError("RATE_LIMITED"); }).catch((e: unknown) => e);
    expect((caught as AppError).code).toBe("RATE_LIMITED");
  });
});

describe("public identity and caps (demo phase on the production deployment)", () => {
  const SECRET = "s".repeat(32);
  const IP4 = "203.0.113.77";
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BUDGET_PHASE", "demo");
    vi.stubEnv("APP_ORIGIN", "https://dreambike.example");
    vi.stubEnv("BUDGET_TICKET", "");
  });
  const reserveArgs = () => commands.find((c) => c[1]!.includes("budget reservation"))!;
  const dispatch = async () => ({ value: "ok", chargedMicroUsd: 2500 });

  it("builds visitor and IP keys from the cookie and the platform header only", async () => {
    const call = makeCall({ "x-vercel-forwarded-for": IP4 });
    await withReservation(call, dispatch);
    const a = reserveArgs();
    const keys = a.slice(3, 12);
    expect(keys[2]).toMatch(/:ticket:public$/);
    expect(keys[1]).toMatch(/:phase:demo$/);
    const visitorKey = keys[4]!, ipKey = keys[5]!;
    expect(visitorKey).toMatch(/:visitor:[A-Za-z0-9_-]{43}:\d{4}-\d{2}-\d{2}$/);
    expect(visitorKey).not.toContain(":local:");
    expect(ipKey).not.toContain(":local:");
    // Caps: lifetime/phase/ticket = project cap, day = daily cap, visitor and ip = visitor cap.
    const caps = a.slice(12 + 11, 12 + 17).map(Number);
    expect(caps).toEqual([100_000_000, 100_000_000, 100_000_000, 5_000_000, 500_000, 500_000]);
    expect(a.slice(12 + 17, 12 + 19).map(Number)).toEqual([80, 80]); // SAM count limit for visitor and IP
  });

  it("never sends a raw IP, and logs none, even on failures", async () => {
    const logs: string[] = [];
    for (const m of ["log", "warn", "error", "info"] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
    }
    replies.settle = "fail";
    await withReservation(makeCall({ "x-vercel-forwarded-for": IP4 }), dispatch);
    await withReservation(makeCall({ "x-vercel-forwarded-for": IP4 }), async () => { throw new AppError("UPSTREAM_TIMEOUT"); }).catch(() => {});
    const everything = JSON.stringify(commands) + logs.join("\n");
    expect(everything).not.toContain(IP4);
    expect(everything).not.toContain("203.0.113");
    expect(everything).toContain("budget reservation");
  });

  it("ignores spoofed X-Forwarded-For and other client headers", async () => {
    await withReservation(makeCall({ "x-vercel-forwarded-for": IP4 }), dispatch);
    const honest = reserveArgs().slice(3, 12)[5];
    commands = [];
    const spoof = { "x-vercel-forwarded-for": IP4, "x-forwarded-for": "198.51.100.1", "x-real-ip": "198.51.100.2",
      forwarded: "for=198.51.100.3", "cf-connecting-ip": "198.51.100.4", "true-client-ip": "198.51.100.5" };
    await withReservation(makeCall(spoof), dispatch);
    expect(reserveArgs().slice(3, 12)[5]).toBe(honest);
    // The expected value is HMAC('ip\n' + ip + '\n' + day) under the visitor secret.
    const day = honest!.split(":").slice(-1)[0]!;
    const expected = labeledHmac(Buffer.from(SECRET), "ip", `${IP4}\n${day}`);
    expect(honest).toBe(`{dreambike:hackathon-2026}:ip:${expected}:${day}`);
  });

  it("fails closed without x-vercel-forwarded-for, with a spoofed header only, or with several values", async () => {
    const dispatchSpy = vi.fn(dispatch);
    const cases: Record<string, string>[] = [{}, { "x-forwarded-for": IP4 }, { "x-vercel-forwarded-for": `${IP4}, 198.51.100.9` },
      { "x-vercel-forwarded-for": "not-an-ip" }, { "x-vercel-forwarded-for": "" }];
    for (const headers of cases) {
      const err = await withReservation(makeCall(headers), dispatchSpy).catch((e: unknown) => e) as AppError;
      expect(err.code).toBe("ACCOUNTING_UNAVAILABLE");
    }
    expect(commands).toEqual([]);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("refuses a call without a valid session cookie before any Redis call", async () => {
    const dispatchSpy = vi.fn(dispatch);
    const noCookie = { ...makeCall(), req: new Request("http://localhost:3000/api/segment", { method: "POST", headers: { "x-vercel-forwarded-for": IP4 } }) };
    const err = await withReservation(noCookie, dispatchSpy).catch((e: unknown) => e) as AppError;
    expect([err.code, err.message]).toEqual(["FORBIDDEN", "Reload the page to continue."]);
    expect(commands).toEqual([]);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("groups IPv6 by /64, maps IPv4-mapped to IPv4, and separates different networks", async () => {
    const ipKeyOf = async (address: string) => {
      commands = [];
      await withReservation(makeCall({ "x-vercel-forwarded-for": address }), dispatch);
      return reserveArgs().slice(3, 12)[5]!;
    };
    const a = await ipKeyOf("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    expect(await ipKeyOf("2001:db8:1:2::1")).toBe(a);
    expect(await ipKeyOf("2001:0DB8:0001:0002:0:0:0:ffff")).toBe(a);
    expect(await ipKeyOf("2001:db8:1:3::1")).not.toBe(a);
    expect(await ipKeyOf("::ffff:203.0.113.77")).toBe(await ipKeyOf(IP4));
  });

  it("counts attempts per model, and an unknown model gets zero", async () => {
    const cfg = loadConfig();
    expect([countLimitFor("sam-3.1", cfg), countLimitFor("muse-image-1.0", cfg), countLimitFor(cfg.museModel, cfg),
      countLimitFor("muse-voice-transcribe-1.0", cfg), countLimitFor("other-model", cfg)]).toEqual([80, 5, 12, 3, 0]);
    await withReservation(makeCall({ "x-vercel-forwarded-for": IP4 }, { model: "unlisted" }), dispatch);
    expect(reserveArgs().slice(12 + 17, 12 + 19).map(Number)).toEqual([0, 0]);
  });

  it("is never live on a preview deployment or without the demo phase", async () => {
    const dispatchSpy = vi.fn(dispatch);
    const codeOf = async () => ((await withReservation(makeCall({ "x-vercel-forwarded-for": IP4 }), dispatchSpy).catch((e: unknown) => e)) as AppError).code;
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await codeOf()).toBe("LIVE_DISABLED");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("BUDGET_PHASE", "development");
    expect(await codeOf()).toBe("LIVE_DISABLED");
    expect(commands).toEqual([]);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("keeps the same visitor key across calls with one cookie and gives another cookie another key", async () => {
    const headers = { "x-vercel-forwarded-for": IP4 };
    const fixed = sessionCookie();
    await withReservation(makeCall({ ...headers, Cookie: fixed }), dispatch);
    const first = reserveArgs().slice(3, 12)[4];
    commands = [];
    await withReservation(makeCall({ ...headers, Cookie: fixed }), dispatch);
    expect(reserveArgs().slice(3, 12)[4]).toBe(first);
    commands = [];
    await withReservation(makeCall(headers), dispatch);
    expect(reserveArgs().slice(3, 12)[4]).not.toBe(first);
  });
});

describe("normalizeClientIp", () => {
  it("accepts exactly one valid address and rejects everything else", () => {
    expect(normalizeClientIp("198.51.100.4")).toBe("198.51.100.4");
    expect(normalizeClientIp(" 198.51.100.4 ")).toBe("198.51.100.4");
    expect(normalizeClientIp("2001:db8::1")).toBe("2001:db8:0:0::/64");
    for (const bad of [null, "", "a, b", "1.2.3.4, 5.6.7.8", "1.2.3", "256.1.1.1", "fe80::1%eth0", "1.2.3.4 5.6.7.8", "::g"]) {
      expect(normalizeClientIp(bad), String(bad)).toBeNull();
    }
  });
});

describe("per-IP attempt limiter (Redis quota protection, not a spend cap)", () => {
  const IP = "203.0.113.7";
  const demo = () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BUDGET_PHASE", "demo");
    vi.stubEnv("APP_ORIGIN", "https://dreambike.example");
  };
  afterEach(() => { vi.useRealTimers(); });
  const ok = async (ip = IP) => withReservation(makeCall({ "x-vercel-forwarded-for": ip }), async () => ({ value: 1, chargedMicroUsd: 2500 }));

  it("answers 429 RATE_LIMITED with its own text and retryAfterSeconds, and never reaches reserve or dispatch", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-30T15:00:00Z") });
    demo();
    for (let i = 0; i < POST_ATTEMPTS_LIMIT; i++) await ok();
    commands = [];
    const dispatch = vi.fn(async () => ({ value: 1, chargedMicroUsd: 1 }));
    const error = (await withReservation(makeCall({ "x-vercel-forwarded-for": IP }), dispatch).catch((e: unknown) => e)) as AppError;
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.message).toMatch(/Too many requests/);
    expect(error.retryAfterSeconds).toBe(60);
    expect(commands).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
    // Another IP is unaffected; after the window the first IP works again.
    await ok("203.0.113.8");
    vi.setSystemTime(Date.now() + POST_ATTEMPTS_WINDOW_MS + 1);
    await ok();
  });

  it("a sustained client hits the daily ceiling: further attempts make zero Redis commands", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-30T15:00:00Z") });
    demo();
    for (let i = 0; i < POST_ATTEMPTS_DAILY_LIMIT; i++) {
      if (i > 0 && i % POST_ATTEMPTS_LIMIT === 0) vi.setSystemTime(Date.now() + POST_ATTEMPTS_WINDOW_MS + 1);
      await ok();
    }
    vi.setSystemTime(Date.now() + POST_ATTEMPTS_WINDOW_MS + 1);
    commands = [];
    const dispatch = vi.fn(async () => ({ value: 1, chargedMicroUsd: 1 }));
    const error = (await withReservation(makeCall({ "x-vercel-forwarded-for": IP }), dispatch).catch((e: unknown) => e)) as AppError;
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    expect(commands).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("never limits the local identity", async () => {
    for (let i = 0; i < POST_ATTEMPTS_LIMIT + 5; i++) await withReservation(makeCall(), async () => ({ value: 1, chargedMicroUsd: 2500 }));
    expect(quotaLimiterSizesForTests().postAttempts).toBe(0);
  });

  it("stays bounded under many IPs", async () => {
    demo();
    for (let i = 0; i < 2100; i++) await ok(`10.${i >> 8}.${i & 255}.1`);
    expect(quotaLimiterSizesForTests().postAttempts).toBeLessThanOrEqual(2000);
    expect(quotaLimiterSizesForTests().dailyAttempts).toBeLessThanOrEqual(2000);
  });
});
