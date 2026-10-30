// Real-Redis proof of the atomic budget scripts (SPEC 13: "one integration
// exercise of the real atomic script without any Meta calls").
//
// Skipped unless BUDGET_REDIS_IT=1. It needs UPSTASH_REDIS_REST_URL/TOKEN from
// .env.local (or .env), read only inside the gated block. Every key lives in a
// throwaway namespace {dreambike:it-<8hex>} and is deleted afterwards (SCAN
// check). No Meta call is possible: any fetch to a host other than the Upstash
// URL is refused. This file prints no env values and no tokens.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import {
  accountingHealth, dayET, readStatus, reserve, settle, type Buckets, type Caps, type RedisRest, type Reservation,
} from "@/lib/server/budget";

const enabled = process.env.BUDGET_REDIS_IT === "1";
const HIGH = 100_000_000;
const AMOUNT = 100_000;
const DAY = dayET();

let redis: RedisRest;
let allowedHost = "";
let realFetch: typeof fetch;
const namespaces: string[] = [];

/** fetch that only talks to the Upstash host; anything else (Meta included) throws. */
function guardedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const host = new URL(typeof input === "string" || input instanceof URL ? input : input.url).host;
  if (host !== allowedHost) throw new Error("budget-redis test refuses fetch to a non-Upstash host");
  return realFetch(input, init);
}

/** Direct Redis command for seeding and inspection (test only, 5 s timeout). */
async function rest(...args: (string | number)[]): Promise<unknown> {
  const res = await guardedFetch(redis.url, {
    method: "POST", headers: { Authorization: `Bearer ${redis.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args.map(String)), signal: AbortSignal.timeout(5000),
  });
  const body = (await res.json()) as { result?: unknown; error?: string };
  if (!res.ok || body.error !== undefined) throw new Error(`redis command ${String(args[0])} failed (HTTP ${res.status})`);
  return body.result;
}

function freshNamespace(): string {
  const ns = `{dreambike:it-${randomBytes(4).toString("hex")}}`;
  namespaces.push(ns);
  return ns;
}

type Seed = { project?: number; daily?: number; spent?: number };
async function seed(ns: string, opts: Seed = {}): Promise<void> {
  await rest("HSET", `${ns}:lifetime`, "spent", opts.spent ?? 0, "reserved", 0,
    "capProjectMicroUsd", opts.project ?? HIGH, "capDailyMicroUsd", opts.daily ?? HIGH);
}

const baseBuckets: Buckets = { phase: "development", ticket: "T0", day: DAY, visitor: "v1", ip: "i1" };
const baseCaps: Caps = {
  lifetime: HIGH, phase: HIGH, ticket: HIGH, day: HIGH, visitor: HIGH, ip: HIGH, visitorCount: -1, ipCount: -1,
};

let counter = 0;
type Attempt = { ns: string; buckets?: Partial<Buckets>; caps?: Partial<Caps>; amount?: number; model?: string;
  requestKey?: string; fingerprint?: string };
function attempt(a: Attempt): Promise<Reservation> {
  counter += 1;
  return reserve(redis, {
    requestKey: a.requestKey ?? `req-${counter}-${randomBytes(3).toString("hex")}`,
    fingerprint: a.fingerprint ?? "fp", amount: a.amount ?? AMOUNT, model: a.model ?? "m", route: "/it",
    buckets: { ...baseBuckets, ...a.buckets }, caps: { ...baseCaps, ...a.caps }, deadlineMs: 5000,
    namespace: a.ns,
  });
}

type Outcome = { ok: true; reservation: Reservation } | { ok: false; error: AppError };
const settled = async (p: Promise<Reservation>): Promise<Outcome> => {
  try { return { ok: true, reservation: await p }; } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e };
    throw e;
  }
};

/** Reads hashes in a separate node process over REST (not through budget.ts). URL and token go in env, never argv. */
function totalsViaChild(keys: string[]): Record<string, Record<string, string> | null> {
  const script = `
    const url = process.env.IT_REDIS_URL;
    const token = process.env.IT_REDIS_TOKEN;
    const keys = JSON.parse(process.env.IT_KEYS);
    (async () => {
      const out = {};
      for (const key of keys) {
        const res = await fetch(url, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify(["HGETALL", key]), signal: AbortSignal.timeout(5000) });
        const body = await res.json();
        if (!res.ok || body.error !== undefined) { process.stderr.write("redis read failed\\n"); process.exit(2); }
        const flat = body.result || [];
        const fields = {};
        for (let i = 0; i < flat.length; i += 2) fields[flat[i]] = flat[i + 1];
        out[key] = flat.length ? fields : null;
      }
      process.stdout.write(JSON.stringify(out));
    })().catch(() => { process.stderr.write("child failed\\n"); process.exit(3); });
  `;
  let stdout: string;
  try {
    stdout = execFileSync(process.execPath, ["-e", script], {
      env: { IT_REDIS_URL: redis.url, IT_REDIS_TOKEN: redis.token, IT_KEYS: JSON.stringify(keys) } as unknown as NodeJS.ProcessEnv,
      encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    // Never rethrow the original error: it could echo the environment.
    throw new Error("child process could not read totals");
  }
  return JSON.parse(stdout) as Record<string, Record<string, string> | null>;
}

const total = (fields: Record<string, string> | null | undefined, name: string) => Number(fields?.[name] ?? 0);
const spentPlusReserved = (fields: Record<string, string> | null | undefined) =>
  total(fields, "spent") + total(fields, "reserved");

async function scanKeys(ns: string): Promise<string[]> {
  const found: string[] = [];
  let cursor = "0";
  do {
    const [next, keys] = (await rest("SCAN", cursor, "MATCH", `${ns}*`, "COUNT", 200)) as [string, string[]];
    found.push(...keys);
    cursor = next;
  } while (cursor !== "0");
  return found;
}

describe.skipIf(!enabled)("budget scripts against real Redis (throwaway namespaces)", () => {
  beforeAll(() => {
    // Gated: loading the file at import time would put secrets into every test run.
    for (const file of [".env.local", ".env"]) {
      try { process.loadEnvFile(file); break; } catch { /* try the next file */ }
    }
    const url = (process.env.UPSTASH_REDIS_REST_URL ?? "").replace(/\/$/, "");
    const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
    if (!url || !token) throw new Error("UPSTASH_REDIS_REST_URL/TOKEN are not configured");
    allowedHost = new URL(url).host;
    realFetch = globalThis.fetch;
    // Everything in this file, including budget.ts's default fetch, goes through the guard.
    vi.stubGlobal("fetch", guardedFetch);
    redis = { url, token, fetchFn: guardedFetch as typeof fetch };
  });

  afterAll(async () => {
    if (!redis) return;
    const leftovers: string[] = [];
    for (const ns of namespaces) {
      let keys = await scanKeys(ns);
      while (keys.length > 0) {
        await rest("DEL", ...keys);
        keys = await scanKeys(ns);
      }
      leftovers.push(...(await scanKeys(ns)));
    }
    vi.unstubAllGlobals();
    expect(leftovers).toEqual([]);
  });

  // ------------------------------------------------------------ races
  // Twenty concurrent reservations of 100,000 against a cap that fits exactly
  // seven. Each case makes a different bucket the binding one.
  const RACE_CAP = 7 * AMOUNT + 50_000;
  const raceCases: { name: string; seed?: Seed; caps?: Partial<Caps>; bucket: string; denied: string }[] = [
    { name: "lifetime cap in ARGV", caps: { lifetime: RACE_CAP }, bucket: "lifetime", denied: "LIVE_DISABLED" },
    { name: "lifetime cap stored in the hash (ARGV is higher)", seed: { project: RACE_CAP }, bucket: "lifetime", denied: "LIVE_DISABLED" },
    { name: "phase cap", caps: { phase: RACE_CAP }, bucket: "phase", denied: "LIVE_DISABLED" },
    { name: "ticket cap", caps: { ticket: RACE_CAP }, bucket: "ticket", denied: "LIVE_DISABLED" },
    { name: "global day cap in ARGV", caps: { day: RACE_CAP }, bucket: "global_day", denied: "BUDGET_EXCEEDED" },
    { name: "global day cap stored in the hash (ARGV is higher)", seed: { daily: RACE_CAP }, bucket: "global_day", denied: "BUDGET_EXCEEDED" },
    { name: "visitor day cap", caps: { visitor: RACE_CAP }, bucket: "visitor_day", denied: "BUDGET_EXCEEDED" },
    { name: "ip day cap", caps: { ip: RACE_CAP }, bucket: "ip_day", denied: "BUDGET_EXCEEDED" },
  ];

  for (const c of raceCases) {
    it(`race: exactly 7 of 20 concurrent reservations fit the ${c.name}`, async () => {
      const ns = freshNamespace();
      await seed(ns, c.seed);
      const results = await Promise.all(Array.from({ length: 20 }, () => settled(attempt({ ns, caps: c.caps }))));
      const granted = results.filter((r) => r.ok);
      expect(granted).toHaveLength(7);
      for (const r of results) if (!r.ok) expect(r.error.code).toBe(c.denied);
      const keys = [`${ns}:lifetime`, `${ns}:phase:development`, `${ns}:ticket:T0`, `${ns}:day:${DAY}`,
        `${ns}:visitor:v1:${DAY}`, `${ns}:ip:i1:${DAY}`];
      const totals = totalsViaChild(keys);
      // Every bucket saw exactly the seven winners, none of the losers.
      for (const key of keys) expect(spentPlusReserved(totals[key]), key).toBe(7 * AMOUNT);
    });
  }

  it("race: 20 concurrent attempts against a count limit of 5 grant exactly 5 (visitor and ip)", async () => {
    for (const which of ["visitorCount", "ipCount"] as const) {
      const ns = freshNamespace();
      await seed(ns);
      const results = await Promise.all(Array.from({ length: 20 }, () =>
        settled(attempt({ ns, amount: 1, caps: { [which]: 5 } }))));
      expect(results.filter((r) => r.ok), which).toHaveLength(5);
      for (const r of results) if (!r.ok) {
        expect(r.error.code).toBe("BUDGET_EXCEEDED");
        expect(r.error.message).toContain("live allowance for today");
      }
      const totals = totalsViaChild([`${ns}:visitor:v1:${DAY}`, `${ns}:ip:i1:${DAY}`]);
      expect(total(totals[`${ns}:visitor:v1:${DAY}`], "count:m")).toBe(5);
      expect(total(totals[`${ns}:ip:i1:${DAY}`], "count:m")).toBe(5);
    }
  });

  it("an ip cap denies a fresh visitor bucket behind the same ip", async () => {
    const ns = freshNamespace();
    await seed(ns);
    const caps = { visitor: HIGH, ip: 150_000 };
    await attempt({ ns, caps, buckets: { visitor: "va", ip: "shared" } });
    const second = await settled(attempt({ ns, caps, buckets: { visitor: "vb", ip: "shared" } }));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.message).toContain("live allowance for today");
    const other = await settled(attempt({ ns, caps, buckets: { visitor: "vc", ip: "elsewhere" } }));
    expect(other.ok).toBe(true);
  });

  // ------------------------------------------------------- duplicates
  it("duplicate request IDs: one dispatch slot, pending then not cached, conflict on different payload", async () => {
    const ns = freshNamespace();
    await seed(ns);
    const requestKey = "dup-" + randomBytes(4).toString("hex");
    const results = await Promise.all(Array.from({ length: 5 }, () => settled(attempt({ ns, requestKey }))));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const r of results) if (!r.ok) expect(r.error.code).toBe("REQUEST_IN_PROGRESS");
    const first = results.find((r) => r.ok) as { ok: true; reservation: Reservation };
    const other = await settled(attempt({ ns, requestKey, fingerprint: "different" }));
    expect(!other.ok && other.error.code).toBe("INVALID_REQUEST");
    await settle(redis, first.reservation, "settled", AMOUNT);
    const again = await settled(attempt({ ns, requestKey }));
    expect(!again.ok && again.error.code).toBe("RESULT_NOT_CACHED");
    const totals = totalsViaChild([`${ns}:lifetime`]);
    expect(spentPlusReserved(totals[`${ns}:lifetime`])).toBe(AMOUNT); // charged once
  });

  // ---------------------------------------------------------- settle
  it("settle charges the known cost and refunds only the difference; unknown keeps the whole reservation", async () => {
    const ns = freshNamespace();
    await seed(ns);
    const known = await attempt({ ns });
    const unknown = await attempt({ ns });
    await settle(redis, known, "settled", 40_000);
    await settle(redis, unknown, "unknown");
    const key = `${ns}:lifetime`;
    const fields = totalsViaChild([key])[key];
    expect(total(fields, "spent")).toBe(40_000 + AMOUNT);
    expect(total(fields, "reserved")).toBe(0);
  });

  it("a released 429 gives the money back but still consumes the attempt", async () => {
    const ns = freshNamespace();
    await seed(ns);
    const r = await attempt({ ns, caps: { visitorCount: 3 } });
    await settle(redis, r, "released");
    const keys = [`${ns}:lifetime`, `${ns}:visitor:v1:${DAY}`];
    const totals = totalsViaChild(keys);
    expect(spentPlusReserved(totals[keys[0]!])).toBe(0);
    expect(total(totals[keys[1]!], "count:m")).toBe(1);
    // Two more attempts use the limit of 3; the fourth is denied even though no money is outstanding.
    await attempt({ ns, caps: { visitorCount: 3 } });
    await attempt({ ns, caps: { visitorCount: 3 } });
    const fourth = await settled(attempt({ ns, caps: { visitorCount: 3 } }));
    expect(fourth.ok).toBe(false);
  });

  it("double settle: concurrent settles give one OK and one NOOP, charged once", async () => {
    const ns = freshNamespace();
    await seed(ns);
    const r = await attempt({ ns });
    const answers = await Promise.all([settle(redis, r, "settled", 30_000), settle(redis, r, "settled", 30_000)]);
    expect([...answers].sort()).toEqual(["NOOP", "OK"]);
    const key = `${ns}:lifetime`;
    const fields = totalsViaChild([key])[key];
    expect(total(fields, "spent")).toBe(30_000);
    expect(total(fields, "reserved")).toBe(0);
    expect(await settle(redis, r, "unknown")).toBe("NOOP"); // a later settle cannot change it either
  });

  it("a charge above the reservation sets the halt flag and stops further reservations", async () => {
    const ns = freshNamespace();
    await seed(ns);
    const r = await attempt({ ns });
    await settle(redis, r, "settled", AMOUNT + 1);
    expect(await rest("GET", `${ns}:halt`)).toBe("over_reservation");
    const next = await settled(attempt({ ns }));
    expect(!next.ok && next.error.code).toBe("ACCOUNTING_UNAVAILABLE");
    const health = await accountingHealth(redis, { namespace: ns, cache: false });
    expect(health).toEqual({ healthy: false, reason: "halted" });
  });

  // ----------------------------------------------- failing closed
  it("a missing lifetime key is an accounting failure and writes nothing", async () => {
    const ns = freshNamespace();
    const outcome = await settled(attempt({ ns }));
    expect(!outcome.ok && outcome.error.code).toBe("ACCOUNTING_UNAVAILABLE");
    expect(await scanKeys(ns)).toEqual([]);
    const status = await readStatus(redis, { buckets: baseBuckets, namespace: ns , cache: false });
    expect(status).toEqual({ ok: false, reason: "lifetime_uninitialized" });
    expect(await scanKeys(ns)).toEqual([]); // status is read-only
  });

  it("missing or incomplete stored caps are an accounting failure", async () => {
    const ns = freshNamespace();
    await rest("HSET", `${ns}:lifetime`, "spent", 0, "reserved", 0);
    expect((await settled(attempt({ ns }))).ok).toBe(false);
    expect(await readStatus(redis, { buckets: baseBuckets, namespace: ns , cache: false })).toEqual({ ok: false, reason: "caps_uninitialized" });
    await rest("HSET", `${ns}:lifetime`, "capProjectMicroUsd", HIGH);
    const half = await settled(attempt({ ns }));
    expect(!half.ok && half.error.code).toBe("ACCOUNTING_UNAVAILABLE");
    await rest("HSET", `${ns}:lifetime`, "capDailyMicroUsd", "not-a-number");
    expect((await settled(attempt({ ns }))).ok).toBe(false);
    await rest("HSET", `${ns}:lifetime`, "capDailyMicroUsd", HIGH);
    expect((await settled(attempt({ ns }))).ok).toBe(true);
  });

  it("reserve.lua refuses a nil, NaN, infinite or fractional cap itself, writing nothing", async () => {
    const ns = freshNamespace();
    await seed(ns);
    const before = await scanKeys(ns);
    const day = DAY;
    const keys = [`${ns}:lifetime`, `${ns}:phase:development`, `${ns}:ticket:T0`, `${ns}:day:${day}`,
      `${ns}:visitor:v1:${day}`, `${ns}:ip:i1:${day}`, `${ns}:req:raw`, `${ns}:ledger`, `${ns}:halt`];
    const good = ["raw", "fp", "1000", "m", "/it", "T0", day, "1", "2", "172800", "10368000",
      "100000000", "100000000", "100000000", "100000000", "100000000", "100000000", "-1", "-1"];
    const raw = async (argv: string[]) => rest("EVAL", readFileSync("budget/reserve.lua", "utf8"), keys.length, ...keys, ...argv);
    for (const [index, bad] of [[11, "nan"], [12, "inf"], [13, "1.5"], [14, "-1"], [15, "abc"], [16, ""], [17, "-2"], [18, "0.5"]] as const) {
      const argv = [...good];
      argv[index] = bad;
      expect(await raw(argv), `ARGV ${index + 1}=${bad}`).toEqual(["UNAVAILABLE", "invalid_cap"]);
    }
    expect(await scanKeys(ns)).toEqual(before);
    expect(await raw(good)).toEqual(["OK", "1000"]);
  });

  it("status.lua gives bad_total for a malformed total and invalid stored caps, never zero", async () => {
    const ns = freshNamespace();
    await seed(ns);
    await rest("HSET", `${ns}:day:${DAY}`, "spent", "oops");
    expect(await readStatus(redis, { buckets: baseBuckets, namespace: ns , cache: false }))
      .toEqual({ ok: false, reason: "bad_total" });
    await rest("HSET", `${ns}:day:${DAY}`, "spent", "-5");
    expect(await readStatus(redis, { buckets: baseBuckets, namespace: ns , cache: false })).toEqual({ ok: false, reason: "bad_total" });
    await rest("HSET", `${ns}:day:${DAY}`, "spent", "1.5");
    expect(await readStatus(redis, { buckets: baseBuckets, namespace: ns , cache: false })).toEqual({ ok: false, reason: "bad_total" });
    await rest("HSET", `${ns}:day:${DAY}`, "spent", 0);
    await rest("HSET", `${ns}:visitor:v1:${DAY}`, "count:sam-3.1", "x");
    expect(await readStatus(redis, { buckets: baseBuckets, namespace: ns, models: ["sam-3.1"] , cache: false }))
      .toEqual({ ok: false, reason: "bad_total" });
    await rest("DEL", `${ns}:visitor:v1:${DAY}`);
    await rest("HSET", `${ns}:lifetime`, "capDailyMicroUsd", "-1");
    expect(await readStatus(redis, { buckets: baseBuckets, namespace: ns , cache: false })).toEqual({ ok: false, reason: "caps_uninitialized" });
    await rest("HSET", `${ns}:lifetime`, "capDailyMicroUsd", "2.5");
    expect(await readStatus(redis, { buckets: baseBuckets, namespace: ns , cache: false })).toEqual({ ok: false, reason: "caps_uninitialized" });
  });

  it("settle of a request with no marker is an accounting failure", async () => {
    const ns = freshNamespace();
    await seed(ns);
    const r = await attempt({ ns });
    await rest("DEL", `${ns}:req:${r.requestKey}`);
    await expect(settle(redis, r, "unknown")).rejects.toMatchObject({ code: "ACCOUNTING_UNAVAILABLE" });
  });

  // ------------------------------------------------------ TTL, status
  it("visitor and ip keys expire after 48 h, the day aggregate and lifetime do not", async () => {
    const ns = freshNamespace();
    await seed(ns);
    const r = await attempt({ ns });
    const ttl = async (key: string) => Number(await rest("TTL", key));
    for (const key of [`${ns}:visitor:v1:${DAY}`, `${ns}:ip:i1:${DAY}`, `${ns}:req:${r.requestKey}`]) {
      const t = await ttl(key);
      expect(t, key).toBeGreaterThan(47 * 3600);
      expect(t, key).toBeLessThanOrEqual(48 * 3600);
    }
    expect(await ttl(`${ns}:day:${DAY}`)).toBeGreaterThan(100 * 24 * 3600);
    expect(await ttl(`${ns}:lifetime`)).toBe(-1);
  });

  it("status.lua reads totals, counts and health without writing", async () => {
    const ns = freshNamespace();
    await seed(ns, { spent: 5 });
    const r = await attempt({ ns, model: "sam-3.1" });
    await settle(redis, r, "settled", 40_000);
    await attempt({ ns, model: "sam-3.1" });
    const before = await scanKeys(ns);
    const status = await readStatus(redis, { buckets: baseBuckets, namespace: ns, models: ["sam-3.1", "spark"] , cache: false });
    expect(status).toMatchObject({ ok: true, halted: false, capProjectMicroUsd: HIGH, capDailyMicroUsd: HIGH });
    if (!status.ok) throw new Error("status not ok");
    expect(status.buckets.lifetime).toEqual({ spentMicroUsd: 40_005, reservedMicroUsd: AMOUNT });
    expect(status.buckets.visitor_day.spentMicroUsd).toBe(40_000);
    expect(status.counts).toEqual({ "sam-3.1": { visitor: 2, ip: 2 }, spark: { visitor: 0, ip: 0 } });
    expect(await accountingHealth(redis, { namespace: ns, cache: false })).toEqual({ healthy: true, reason: null });
    expect(await scanKeys(ns)).toEqual(before);
  });
});
