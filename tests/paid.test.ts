// withReservation against a fake Upstash REST endpoint: no network, no Meta.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { withReservation } from "@/lib/server/paid";

const REDIS = "https://redis.invalid";
const call = { route: "/api/segment", model: "sam-3.1", amountMicroUsd: 2500, requestId: crypto.randomUUID(),
  payloadDigest: "abc", deadlineMs: 5000 };

type RedisReply = [string, ...string[]];
let replies: { reserve: RedisReply; settle: RedisReply | "fail" };
let commands: string[][];

beforeEach(() => {
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
    expect(await withReservation(call, dispatch)).toBe("masks");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(commands[0]![1]).toContain("budget reservation");
    expect(settled()).toEqual(["settled", "2500"]);
  });

  it("releases only a definite 429 and keeps everything else as unknown", async () => {
    await expect(withReservation(call, async () => { throw new AppError("RATE_LIMITED"); })).rejects.toThrow();
    expect(settled()).toEqual(["released", "0"]);
    for (const code of ["UPSTREAM_TIMEOUT", "UPSTREAM_REJECTED", "SCHEMA_INVALID", "UPSTREAM_UNAVAILABLE"] as const) {
      commands = [];
      await expect(withReservation(call, async () => { throw new AppError(code); })).rejects.toThrow();
      expect(settled(), code).toEqual(["unknown", "0"]);
    }
    commands = [];
    await withReservation(call, async () => ({ value: 1, chargedMicroUsd: null }));
    expect(settled()).toEqual(["unknown", "0"]);
  });

  it("never dispatches when deployed, not live, without a ticket, or on a duplicate ID", async () => {
    const dispatch = vi.fn(async () => ({ value: 1, chargedMicroUsd: 1 }));
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
    replies.reserve = ["DENIED", "ticket"];
    expect(await codeOf()).toBe("BUDGET_EXCEEDED");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("keeps a paid-for result when settlement fails (reservation stays counted)", async () => {
    replies.settle = "fail";
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await withReservation(call, async () => ({ value: "kept", chargedMicroUsd: 2500 }))).toBe("kept");
  });
});
