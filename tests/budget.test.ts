import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError, ERRORS, VISITOR_BUDGET_MESSAGE } from "@/lib/errors";
import {
  accountingHealth, bucketKeys, clearStatusCache, statusCacheSize, STATUS_CACHE_MAX, STATUS_CACHE_TTL_MS, dayET, nextMidnightET, readStatus, reserve, settle, settleSafely, type Reservation,
} from "@/lib/server/budget";

describe("ET day boundaries", () => {
  it("uses the ET calendar date, not UTC", () => {
    expect(dayET(new Date("2026-10-28T03:30:00Z"))).toBe("2026-10-27"); // 23:30 EDT
    expect(dayET(new Date("2026-10-28T04:30:00Z"))).toBe("2026-10-28");
  });

  it("finds the next midnight across the November 1 DST change", () => {
    // Oct 31 noon EDT -> Nov 1 00:00 EDT = 04:00Z
    expect(nextMidnightET(new Date("2026-10-31T16:00:00Z")).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    // Nov 1 00:30 EDT (a 25-hour day) -> Nov 2 00:00 EST = 05:00Z
    expect(nextMidnightET(new Date("2026-11-01T04:30:00Z")).toISOString()).toBe("2026-11-02T05:00:00.000Z");
    // Nov 1 noon EST -> Nov 2 00:00 EST
    expect(nextMidnightET(new Date("2026-11-01T17:00:00Z")).toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });
});

const NS = "{dreambike:hackathon-2026}";
const buckets = { phase: "development", ticket: "T1", day: "2026-10-28", visitor: "v", ip: "i" };
const caps = { lifetime: 1, phase: 2, ticket: 3, day: 4, visitor: 5, ip: 6, visitorCount: 7, ipCount: 8 };
const redisCfg = (fetchFn: typeof fetch) => ({ url: "https://redis.invalid", token: "t", fetchFn });
const reply = (body: unknown, status = 200) => (async () =>
  new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const reserveWith = (fetchFn: typeof fetch, extra: { namespace?: string } = {}) =>
  reserve(redisCfg(fetchFn), {
    requestKey: "r", fingerprint: "f", amount: 1, model: "m", route: "/x", buckets, caps, deadlineMs: 1000, now: 1_000_000, ...extra,
  });
const codeOf = async (p: Promise<unknown>) => {
  try { await p; return "OK"; } catch (e) { return (e as AppError).code; }
};

/** Records every Upstash command and answers with one canned result. */
function recorder(result: unknown) {
  const sent: string[][] = [];
  const fetchFn = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)) as string[]);
    return new Response(JSON.stringify({ result }));
  }) as unknown as typeof fetch;
  return { sent, fetchFn };
}

afterEach(() => { vi.restoreAllMocks(); clearStatusCache(); });

describe("reserve wire format (fake Redis REST, no network)", () => {
  it("sends exactly one EVAL with the script file, nine keys and the documented ARGV order", async () => {
    const { sent, fetchFn } = recorder(["OK", "1"]);
    await reserveWith(fetchFn);
    expect(sent).toHaveLength(1);
    const [verb, text, numKeys, ...rest] = sent[0]!;
    expect(verb).toBe("EVAL");
    expect(text).toBe(readFileSync("budget/reserve.lua", "utf8"));
    expect(numKeys).toBe("9");
    const keys = rest.slice(0, 9);
    expect(keys).toEqual([
      `${NS}:lifetime`, `${NS}:phase:development`, `${NS}:ticket:T1`, `${NS}:day:2026-10-28`,
      `${NS}:visitor:v:2026-10-28`, `${NS}:ip:i:2026-10-28`,
      `${NS}:req:r`, `${NS}:ledger`, `${NS}:halt`,
    ]);
    // ARGV 1..19: requestKey, fingerprint, amount, model, route, ticket, dayET, nowMs,
    // pendingUntilMs, markerTtl, aggregateTtl, six caps, visitor and ip count limits.
    expect(rest.slice(9)).toEqual([
      "r", "f", "1", "m", "/x", "T1", "2026-10-28", "1000000", String(1_000_000 + 1000 + 30_000),
      String(48 * 3600), String(120 * 24 * 3600), "1", "2", "3", "4", "5", "6", "7", "8",
    ]);
  });

  it("puts the namespace prefix on all nine keys, for reserve and settle", async () => {
    const ns = "{dreambike:it-abcd1234}";
    const first = recorder(["OK", "1"]);
    const reservation = await reserveWith(first.fetchFn, { namespace: ns });
    const reserveKeys = first.sent[0]!.slice(3, 12);
    expect(reserveKeys.every((k) => k.startsWith(`${ns}:`))).toBe(true);
    expect(new Set(reserveKeys).size).toBe(9);
    expect(reservation.namespace).toBe(ns);
    const second = recorder(["OK", "settled", "1"]);
    await settle(redisCfg(second.fetchFn), reservation, "settled", 1);
    const settleKeys = second.sent[0]!.slice(3, 12);
    expect(settleKeys).toEqual(reserveKeys);
    expect(second.sent[0]!.slice(12)).toEqual(["settled", "1", expect.stringMatching(/^\d+$/)]);
  });

  it("builds the same bucket keys as the Python spike", () => {
    expect(bucketKeys(buckets)).toEqual([
      `${NS}:lifetime`, `${NS}:phase:development`, `${NS}:ticket:T1`, `${NS}:day:2026-10-28`,
      `${NS}:visitor:v:2026-10-28`, `${NS}:ip:i:2026-10-28`,
    ]);
  });

  it("uses the ledger script text of each Lua file as shipped (shared with Python)", () => {
    const reserveLua = readFileSync("budget/reserve.lua", "utf8");
    // Structure guards: the real behavior is proven by tests/budget-redis.test.ts.
    expect(reserveLua).toContain("caps_uninitialized");
    expect(reserveLua).toMatch(/storedProject < cap/);
    expect(reserveLua).toMatch(/storedDaily < cap/);
    expect(reserveLua).toMatch(/EXPIRE", KEYS\[i\], tonumber\(ARGV\[10\]\)/);
    expect(reserveLua).toContain("invalid_cap");
    expect(readFileSync("budget/status.lua", "utf8")).toContain("bad_total");
    expect(readFileSync("budget/status.lua", "utf8")).not.toMatch(/HSET|HINCRBY|\bSET\b|EXPIRE|RPUSH|DEL/);
  });
});

describe("reserve error mapping", () => {
  it("maps script answers to stable error codes", async () => {
    expect(await codeOf(reserveWith(reply({ result: ["OK", "1"] })))).toBe("OK");
    expect(await codeOf(reserveWith(reply({ result: ["DUPLICATE", "reserved"] })))).toBe("REQUEST_IN_PROGRESS");
    expect(await codeOf(reserveWith(reply({ result: ["DUPLICATE", "settled"] })))).toBe("RESULT_NOT_CACHED");
    expect(await codeOf(reserveWith(reply({ result: ["DUPLICATE", "conflict"] })))).toBe("INVALID_REQUEST");
    expect(await codeOf(reserveWith(reply({ result: ["UNAVAILABLE", "halted"] })))).toBe("ACCOUNTING_UNAVAILABLE");
    expect(await codeOf(reserveWith(reply({ result: ["UNAVAILABLE", "caps_uninitialized"] })))).toBe("ACCOUNTING_UNAVAILABLE");
  });

  it("denies visitor and IP limits with the visitor text (429)", async () => {
    for (const bucket of ["visitor_day", "ip_day", "visitor_count", "ip_count"]) {
      const error = await reserveWith(reply({ result: ["DENIED", bucket] })).catch((e: unknown) => e) as AppError;
      expect(error.code, bucket).toBe("BUDGET_EXCEEDED");
      expect(error.message, bucket).toBe("Your live allowance for today is used up. You can keep exploring the cached demo.");
      expect(error.message).toBe(VISITOR_BUDGET_MESSAGE);
      expect(ERRORS.BUDGET_EXCEEDED.status).toBe(429);
    }
  });

  it("denies the global day with the daily-budget text (429)", async () => {
    const error = await reserveWith(reply({ result: ["DENIED", "global_day"] })).catch((e: unknown) => e) as AppError;
    expect(error.code).toBe("BUDGET_EXCEEDED");
    expect(error.message).toBe(
      "Daily budget reached. Try again tomorrow, or explore the demo project. The demo uses cached results and makes no AI calls.");
  });

  it("turns lifetime, phase and ticket denials into 503 LIVE_DISABLED", async () => {
    for (const bucket of ["lifetime", "phase", "ticket"]) {
      const error = await reserveWith(reply({ result: ["DENIED", bucket] })).catch((e: unknown) => e) as AppError;
      expect(error.code, bucket).toBe("LIVE_DISABLED");
      expect(error.message).toBe("Live AI is off. The cached demo still works.");
      expect(ERRORS.LIVE_DISABLED.status).toBe(503);
    }
    // An unknown bucket is not a denial we understand: fail closed as an outage.
    expect(await codeOf(reserveWith(reply({ result: ["DENIED", "surprise"] })))).toBe("ACCOUNTING_UNAVAILABLE");
  });

  it("fails closed on transport errors, HTTP errors, Redis errors and odd replies, with zero other fetches", async () => {
    const globalFetch = vi.spyOn(globalThis, "fetch");
    const boom = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
    const timeout = (async () => { throw new DOMException("timed out", "TimeoutError"); }) as unknown as typeof fetch;
    expect(await codeOf(reserveWith(boom))).toBe("ACCOUNTING_UNAVAILABLE");
    expect(await codeOf(reserveWith(timeout))).toBe("ACCOUNTING_UNAVAILABLE");
    expect(await codeOf(reserveWith(reply({ error: "NOSCRIPT" }, 400)))).toBe("ACCOUNTING_UNAVAILABLE");
    expect(await codeOf(reserveWith(reply({ error: "ERR" })))).toBe("ACCOUNTING_UNAVAILABLE");
    for (const result of [null, "OK", [], [1], ["OK"], ["OK", "2"], { 0: "OK" }, ["NOPE", "1"]]) {
      expect(await codeOf(reserveWith(reply({ result }))), JSON.stringify(result)).toBe("ACCOUNTING_UNAVAILABLE");
    }
    expect(globalFetch).not.toHaveBeenCalled(); // nothing but the injected fake was called
  });

  it("refuses an invalid amount or cap before any network call", async () => {
    const { sent, fetchFn } = recorder(["OK", "1"]);
    const attempt = (over: Partial<typeof caps>, amount = 1) => codeOf(reserve(redisCfg(fetchFn), {
      requestKey: "r", fingerprint: "f", amount, model: "m", route: "/x", buckets, caps: { ...caps, ...over },
      deadlineMs: 1000, now: 1_000_000,
    }));
    for (const field of ["lifetime", "phase", "ticket", "day", "visitor", "ip"] as const) {
      for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) {
        expect(await attempt({ [field]: bad }), `${field}=${bad}`).toBe("ACCOUNTING_UNAVAILABLE");
      }
    }
    for (const field of ["visitorCount", "ipCount"] as const) {
      for (const bad of [-2, 0.5, Number.NaN, Number.NEGATIVE_INFINITY]) {
        expect(await attempt({ [field]: bad }), `${field}=${bad}`).toBe("ACCOUNTING_UNAVAILABLE");
      }
    }
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await attempt({}, bad), `amount=${bad}`).toBe("ACCOUNTING_UNAVAILABLE");
    }
    expect(sent).toEqual([]);
    // -1 (no count limit) and 0 are valid.
    expect(await attempt({ visitorCount: -1, ipCount: 0, lifetime: 0 })).toBe("OK");
    expect(sent).toHaveLength(1);
  });

  it("maps the script's invalid_cap answer to an outage", async () => {
    expect(await codeOf(reserveWith(reply({ result: ["UNAVAILABLE", "invalid_cap"] })))).toBe("ACCOUNTING_UNAVAILABLE");
  });

  it("sets a 2 second timeout signal and refuses redirects", async () => {
    let seen: RequestInit | undefined;
    const fetchFn = (async (_u: string, init: RequestInit) => {
      seen = init;
      return new Response(JSON.stringify({ result: ["OK", "1"] }));
    }) as unknown as typeof fetch;
    await reserveWith(fetchFn);
    expect(seen?.redirect).toBe("error");
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("settle", () => {
  const reservation: Reservation = {
    requestKey: "r", amount: 10, namespace: NS, keys: bucketKeys(buckets),
  };
  const settleWith = (fetchFn: typeof fetch, outcome: "settled" | "unknown" | "released" = "settled", charged = 5) =>
    settle(redisCfg(fetchFn), reservation, outcome, charged);

  it("reports OK, NOOP for an already settled request, and fails closed on anything else", async () => {
    expect(await settleWith(reply({ result: ["OK", "settled", "5"] }))).toBe("OK");
    expect(await settleWith(reply({ result: ["NOOP", "settled"] }))).toBe("NOOP");
    expect(await codeOf(settleWith(reply({ result: ["ERROR", "key_mismatch"] })))).toBe("ACCOUNTING_UNAVAILABLE");
    expect(await codeOf(settleWith(reply({ result: ["OK", "unknown", "5"] })))).toBe("ACCOUNTING_UNAVAILABLE"); // wrong outcome
    expect(await codeOf(settleWith(reply({ result: ["OK", "settled"] })))).toBe("ACCOUNTING_UNAVAILABLE"); // short reply
    expect(await codeOf(settleWith(reply({ result: "OK" })))).toBe("ACCOUNTING_UNAVAILABLE");
    expect(await codeOf(settleWith(reply({ result: null })))).toBe("ACCOUNTING_UNAVAILABLE");
    expect(await codeOf(settleWith((async () => { throw new TypeError("x"); }) as unknown as typeof fetch)))
      .toBe("ACCOUNTING_UNAVAILABLE");
  });

  it("a missing marker is an accounting failure, not a harmless double settle", async () => {
    expect(await codeOf(settleWith(reply({ result: ["NOOP", "missing"] })))).toBe("ACCOUNTING_UNAVAILABLE");
    expect(await codeOf(settleWith(reply({ result: ["NOOP", "unexpected"] })))).toBe("ACCOUNTING_UNAVAILABLE");
    for (const state of ["settled", "unknown", "released"]) {
      expect(await settleWith(reply({ result: ["NOOP", state] })), state).toBe("NOOP");
    }
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await settleSafely(redisCfg(reply({ result: ["NOOP", "missing"] })), reservation, "unknown")).toBe(false);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("always settles in the reservation's own namespace (no override)", async () => {
    const ns = "{dreambike:it-feedbeef}";
    const { sent, fetchFn } = recorder(["OK", "unknown", "10"]);
    await settle(redisCfg(fetchFn), { ...reservation, namespace: ns, keys: bucketKeys(buckets, ns) }, "unknown");
    expect(sent[0]!.slice(3, 12).every((k) => k.startsWith(`${ns}:`))).toBe(true);
  });

  it("never sends a charge that is not a non-negative integer (the reservation stays counted)", async () => {
    const { sent, fetchFn } = recorder(["OK", "settled", "1"]);
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await codeOf(settleWith(fetchFn, "settled", bad)), String(bad)).toBe("ACCOUNTING_UNAVAILABLE");
    }
    expect(sent).toEqual([]);
  });

  it("settleSafely never throws, so a settle failure cannot replace the upstream error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
    expect(await settleSafely(redisCfg(failing), reservation, "unknown")).toBe(false);
    expect(await settleSafely(redisCfg(reply({ result: ["OK", "unknown", "10"] })), reservation, "unknown")).toBe(true);
  });
});

describe("status and health", () => {
  const okReply = (halted = "0", counts: string[] = []) =>
    ["OK", halted, "100000000", "5000000", "40", "10", "0", "0", "0", "0", "7", "3", "5", "0", "4", "0", ...counts];
  const statusWith = (result: unknown, models: string[] = []) =>
    readStatus(redisCfg(reply({ result })), { buckets, models, cache: false });

  it("parses totals and per-model counts from one read-only EVAL", async () => {
    const { sent, fetchFn } = recorder(okReply("0", ["2", "1", "9", "8"]));
    const status = await readStatus(redisCfg(fetchFn), { buckets, models: ["sam-3.1", "spark"] });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.slice(0, 3)).toEqual(["EVAL", readFileSync("budget/status.lua", "utf8"), "7"]);
    expect(sent[0]!.slice(3, 10)).toEqual([...bucketKeys(buckets), `${NS}:halt`]);
    expect(sent[0]!.slice(10)).toEqual(["sam-3.1", "spark"]);
    expect(status).toEqual({
      ok: true, halted: false, capProjectMicroUsd: 100_000_000, capDailyMicroUsd: 5_000_000,
      buckets: {
        lifetime: { spentMicroUsd: 40, reservedMicroUsd: 10 }, phase: { spentMicroUsd: 0, reservedMicroUsd: 0 },
        ticket: { spentMicroUsd: 0, reservedMicroUsd: 0 }, global_day: { spentMicroUsd: 7, reservedMicroUsd: 3 },
        visitor_day: { spentMicroUsd: 5, reservedMicroUsd: 0 }, ip_day: { spentMicroUsd: 4, reservedMicroUsd: 0 },
      },
      counts: { "sam-3.1": { visitor: 2, ip: 1 }, spark: { visitor: 9, ip: 8 } },
    });
  });

  it("reports unknown, never zero, when the ledger is missing, uncapped, malformed or unreachable", async () => {
    expect(await statusWith(["UNAVAILABLE", "lifetime_uninitialized"])).toEqual({ ok: false, reason: "lifetime_uninitialized" });
    expect(await statusWith(["UNAVAILABLE", "caps_uninitialized"])).toEqual({ ok: false, reason: "caps_uninitialized" });
    expect((await statusWith(okReply().slice(0, 10))).ok).toBe(false);
    expect((await statusWith(okReply().map((x, i) => (i === 4 ? "-3" : x)))).ok).toBe(false);
    expect((await statusWith(okReply("2"))).ok).toBe(false);
    expect((await statusWith("OK")).ok).toBe(false);
    const down = await readStatus(redisCfg((async () => { throw new TypeError("x"); }) as unknown as typeof fetch), { buckets, cache: false });
    expect(down).toEqual({ ok: false, reason: "unreachable" });
  });

  it("separates transport failures (unreachable) from unreadable replies (bad_reply)", async () => {
    const http500 = await readStatus(redisCfg(reply({ error: "x" }, 500)), { buckets, cache: false });
    expect(http500).toEqual({ ok: false, reason: "unreachable" });
    const timeout = (async () => { throw new DOMException("t", "TimeoutError"); }) as unknown as typeof fetch;
    expect(await readStatus(redisCfg(timeout), { buckets, cache: false })).toEqual({ ok: false, reason: "unreachable" });
    expect(await statusWith("OK")).toEqual({ ok: false, reason: "bad_reply" });
    expect(await statusWith(null)).toEqual({ ok: false, reason: "bad_reply" });
    expect(await statusWith(okReply().slice(0, 10))).toEqual({ ok: false, reason: "bad_reply" });
    expect(await statusWith(okReply().map((x, i) => (i === 4 ? "-3" : x)))).toEqual({ ok: false, reason: "bad_reply" });
    expect(await statusWith(["UNAVAILABLE", "bad_total"])).toEqual({ ok: false, reason: "bad_total" });
  });

  it("is healthy only with a reachable ledger, stored caps and no halt flag", async () => {
    const health = (result: unknown) => accountingHealth(redisCfg(reply({ result })), { cache: false });
    expect(await health(okReply())).toEqual({ healthy: true, reason: null });
    expect(await health(okReply("1"))).toEqual({ healthy: false, reason: "halted" });
    expect(await health(["UNAVAILABLE", "lifetime_uninitialized"])).toEqual({ healthy: false, reason: "lifetime_uninitialized" });
    expect((await accountingHealth(redisCfg(reply({ error: "x" }, 500)), { cache: false })).healthy).toBe(false);
  });
});

describe("status.lua command shape (script text only; real semantics in budget-redis.test.ts)", () => {
  const lua = readFileSync("budget/status.lua", "utf8");
  it("reads each bucket with one HMGET plus two EXISTS, never per-field HGET", () => {
    const calls = [...lua.matchAll(/redis\.call\("(\w+)"/g)].map((m) => m[1]);
    expect(calls.filter((c) => c === "EXISTS")).toHaveLength(2);
    expect(calls.filter((c) => c === "HMGET")).toHaveLength(3); // lifetime, phase/ticket/day loop, visitor/ip loop
    expect(calls.every((c) => c === "EXISTS" || c === "HMGET")).toBe(true);
    expect(lua).toMatch(/8 per call/);
  });
});

describe("status display cache (display only; enforcement stays in Redis)", () => {
  const reply = (extra: string[] = []) =>
    ["OK", "0", "100000000", "5000000", "40", "10", "0", "0", "0", "0", "7", "3", "5", "0", "4", "0", ...extra];
  const t0 = 1_000_000;

  it("shares one EVAL for 10 s per key list and models, then reads again", async () => {
    const { sent, fetchFn } = recorder(reply());
    const redis = redisCfg(fetchFn);
    for (let i = 0; i < 20; i++) await readStatus(redis, { buckets, now: t0 + i * 400 });
    expect(sent).toHaveLength(1);
    await readStatus(redis, { buckets, now: t0 + STATUS_CACHE_TTL_MS - 1 });
    expect(sent).toHaveLength(1);
    await readStatus(redis, { buckets, now: t0 + STATUS_CACHE_TTL_MS });
    expect(sent).toHaveLength(2);
    // Another bucket name or model list is another entry; cache: false always reads.
    await readStatus(redis, { buckets: { ...buckets, visitor: "other" }, now: t0 + STATUS_CACHE_TTL_MS });
    await readStatus(redis, { buckets, models: ["sam-3.1"], now: t0 + STATUS_CACHE_TTL_MS });
    expect(sent).toHaveLength(4);
    await readStatus(redis, { buckets, cache: false });
    await readStatus(redis, { buckets, cache: false });
    expect(sent).toHaveLength(6);
  });

  it("concurrent callers share one in-flight read", async () => {
    const { sent, fetchFn } = recorder(reply());
    const redis = redisCfg(fetchFn);
    await Promise.all(Array.from({ length: 10 }, () => readStatus(redis, { buckets, now: t0 })));
    expect(sent).toHaveLength(1);
  });

  it("caches an outage for 10 s: no retry per request", async () => {
    let calls = 0;
    const down = (async () => { calls += 1; throw new TypeError("network"); }) as unknown as typeof fetch;
    const redis = redisCfg(down);
    for (let i = 0; i < 10; i++) expect(await readStatus(redis, { buckets, now: t0 + i })).toEqual({ ok: false, reason: "unreachable" });
    expect(calls).toBe(1);
    await readStatus(redis, { buckets, now: t0 + STATUS_CACHE_TTL_MS });
    expect(calls).toBe(2);
  });

  it("accountingHealth uses the same cache", async () => {
    const { sent, fetchFn } = recorder(reply());
    const redis = redisCfg(fetchFn);
    await accountingHealth(redis);
    await accountingHealth(redis);
    expect(sent).toHaveLength(1);
    await accountingHealth(redis, { cache: false });
    expect(sent).toHaveLength(2);
  });

  it("reserve() and settle() never read or fill the cache", async () => {
    const warm = recorder(reply());
    const redis = redisCfg(warm.fetchFn);
    await readStatus(redis, { buckets });
    expect(statusCacheSize()).toBe(1);
    const sentBefore = warm.sent.length;
    const r = recorder(["OK", "2500"]);
    const reservation = await reserve(redisCfg(r.fetchFn), {
      requestKey: "k", fingerprint: "f", amount: 2500, model: "sam-3.1", route: "/api/segment",
      buckets, caps: { lifetime: 1e8, phase: 1e8, ticket: 5e6, day: 5e6, visitor: 5e5, ip: 5e5, visitorCount: -1, ipCount: -1 },
      deadlineMs: 1000,
    });
    // Every reserve and settle is its own EVAL, whatever the display cache holds.
    await reserve(redisCfg(r.fetchFn), {
      requestKey: "k2", fingerprint: "f", amount: 2500, model: "sam-3.1", route: "/api/segment",
      buckets, caps: { lifetime: 1e8, phase: 1e8, ticket: 5e6, day: 5e6, visitor: 5e5, ip: 5e5, visitorCount: -1, ipCount: -1 },
      deadlineMs: 1000,
    });
    const s = recorder(["OK", "settled", "1"]);
    await settle(redisCfg(s.fetchFn), reservation, "settled", 1);
    expect(r.sent.map((c) => c[0])).toEqual(["EVAL", "EVAL"]);
    expect(s.sent).toHaveLength(1);
    expect(warm.sent).toHaveLength(sentBefore);
    expect(statusCacheSize()).toBe(1);
  });

  it("stays bounded, evicting the oldest", async () => {
    const { sent, fetchFn } = recorder(reply());
    const redis = redisCfg(fetchFn);
    for (let i = 0; i < STATUS_CACHE_MAX + 50; i++) {
      await readStatus(redis, { buckets: { ...buckets, visitor: `v${i}` }, now: t0 });
    }
    expect(statusCacheSize()).toBe(STATUS_CACHE_MAX);
    const reads = sent.length;
    await readStatus(redis, { buckets: { ...buckets, visitor: `v${STATUS_CACHE_MAX + 49}` }, now: t0 }); // newest: hit
    expect(sent.length).toBe(reads);
    await readStatus(redis, { buckets: { ...buckets, visitor: "v0" }, now: t0 }); // oldest: evicted
    expect(sent.length).toBe(reads + 1);
  });
});
