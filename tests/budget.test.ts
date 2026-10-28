import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { bucketKeys, dayET, nextMidnightET, reserve } from "@/lib/server/budget";

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

describe("reserve error mapping (fake Redis REST, no network)", () => {
  const buckets = { phase: "development", ticket: "T1", day: "2026-10-28", visitor: "v", ip: "i" };
  const caps = { lifetime: 1, phase: 1, ticket: 1, day: 1, visitor: 1, ip: 1, visitorCount: -1, ipCount: -1 };
  const call = (fetchFn: typeof fetch) => reserve({ url: "https://redis.invalid", token: "t", fetchFn }, {
    requestKey: "r", fingerprint: "f", amount: 1, model: "m", route: "/x", buckets, caps, deadlineMs: 1000,
  });
  const reply = (body: unknown, status = 200) => (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  const codeOf = async (p: Promise<unknown>) => {
    try { await p; return "OK"; } catch (e) { return (e as AppError).code; }
  };

  it("maps script answers to stable error codes", async () => {
    expect(await codeOf(call(reply({ result: ["OK", "1"] })))).toBe("OK");
    expect(await codeOf(call(reply({ result: ["DENIED", "ticket"] })))).toBe("BUDGET_EXCEEDED");
    expect(await codeOf(call(reply({ result: ["DUPLICATE", "reserved"] })))).toBe("REQUEST_IN_PROGRESS");
    expect(await codeOf(call(reply({ result: ["DUPLICATE", "settled"] })))).toBe("RESULT_NOT_CACHED");
    expect(await codeOf(call(reply({ result: ["UNAVAILABLE", "halted"] })))).toBe("ACCOUNTING_UNAVAILABLE");
  });

  it("fails closed on transport errors, HTTP errors, and Redis errors", async () => {
    const boom = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
    expect(await codeOf(call(boom))).toBe("ACCOUNTING_UNAVAILABLE");
    expect(await codeOf(call(reply({ error: "NOSCRIPT" }, 400)))).toBe("ACCOUNTING_UNAVAILABLE");
    expect(await codeOf(call(reply({ error: "ERR" })))).toBe("ACCOUNTING_UNAVAILABLE");
  });

  it("builds the same bucket keys as the Python spike", () => {
    expect(bucketKeys(buckets)).toEqual([
      "{dreambike:hackathon-2026}:lifetime", "{dreambike:hackathon-2026}:phase:development",
      "{dreambike:hackathon-2026}:ticket:T1", "{dreambike:hackathon-2026}:day:2026-10-28",
      "{dreambike:hackathon-2026}:visitor:v:2026-10-28", "{dreambike:hackathon-2026}:ip:i:2026-10-28",
    ]);
  });
});
