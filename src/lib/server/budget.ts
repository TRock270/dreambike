// Node wrapper over the shared atomic budget scripts budget/reserve.lua and
// budget/settle.lua (SPEC.md 13). The Python spike uses the same files.
// budget/status.lua is a read-only extra used by /api/budget and the health check.
// Redis REST calls time out after 2 seconds and fail closed; there is no
// in-memory fallback.
import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AppError, VISITOR_BUDGET_MESSAGE } from "../errors";

export const NAMESPACE = "{dreambike:hackathon-2026}";
const MARKER_TTL_S = 48 * 3600;
const AGGREGATE_TTL_S = 120 * 24 * 3600;

const scripts = new Map<string, string>();
function script(name: "reserve.lua" | "settle.lua" | "status.lua"): string {
  let text = scripts.get(name);
  if (!text) {
    text = readFileSync(path.join(process.cwd(), "budget", name), "utf8");
    scripts.set(name, text);
  }
  return text;
}

/** Calendar day in America/New_York as YYYY-MM-DD. */
export function dayET(now: Date = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

/** Minutes ET is ahead of UTC at an instant (negative: -240 in EDT, -300 in EST). */
function etOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "numeric",
    day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((wall - at.getTime()) / 60000);
}

/** Next ET midnight as an instant; correct across DST changes (no fixed 24 h). */
export function nextMidnightET(now: Date = new Date()): Date {
  const [y, m, d] = dayET(now).split("-").map(Number) as [number, number, number];
  const wallMidnight = Date.UTC(y, m - 1, d + 1); // next day 00:00 as if it were UTC
  let guess = wallMidnight - etOffsetMinutes(new Date(wallMidnight)) * 60000;
  guess = wallMidnight - etOffsetMinutes(new Date(guess)) * 60000;
  return new Date(guess);
}

export type Buckets = {
  phase: string; ticket: string; day: string; visitor: string; ip: string;
};

export function bucketKeys(b: Buckets, ns = NAMESPACE): string[] {
  return [
    `${ns}:lifetime`, `${ns}:phase:${b.phase}`, `${ns}:ticket:${b.ticket}`, `${ns}:day:${b.day}`,
    `${ns}:visitor:${b.visitor}:${b.day}`, `${ns}:ip:${b.ip}:${b.day}`,
  ];
}

export type Caps = {
  lifetime: number; phase: number; ticket: number; day: number; visitor: number; ip: number;
  /** Attempt-count limits for this model; -1 means no count limit. */
  visitorCount: number; ipCount: number;
};

export type RedisRest = { url: string; token: string; fetchFn?: typeof fetch };

async function command(redis: RedisRest, args: (string | number)[]): Promise<unknown> {
  const fetchFn = redis.fetchFn ?? fetch;
  let res: Response;
  let body: { result?: unknown; error?: string };
  try {
    res = await fetchFn(redis.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${redis.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args.map(String)),
      signal: AbortSignal.timeout(2000), redirect: "error",
    });
    body = (await res.json()) as typeof body;
  } catch {
    throw new AppError("ACCOUNTING_UNAVAILABLE");
  }
  if (!res.ok || body.error !== undefined) throw new AppError("ACCOUNTING_UNAVAILABLE");
  return body.result;
}

export type Reservation = { requestKey: string; keys: string[]; amount: number; namespace: string };

/** Marker, ledger and halt keys that come after the six bucket keys. */
function extraKeys(ns: string, requestKey: string): string[] {
  return [`${ns}:req:${requestKey}`, `${ns}:ledger`, `${ns}:halt`];
}

/** Check the reply is an array whose first item is a string; anything else fails closed. */
function replyArray(result: unknown): string[] {
  if (!Array.isArray(result) || result.length === 0 || !result.every((x) => typeof x === "string")) {
    throw new AppError("ACCOUNTING_UNAVAILABLE");
  }
  return result as string[];
}

/**
 * Turn a DENIED bucket into the visitor-facing error (SPEC 13):
 * - visitor/IP money or attempt limits: the visitor-only text, 429
 * - the global ET day: the existing daily-budget text, 429
 * - lifetime, phase and ticket caps are not the visitor's doing: 503 LIVE_DISABLED
 */
export function deniedError(bucket: string | undefined): AppError {
  switch (bucket) {
    case "visitor_day": case "ip_day": case "visitor_count": case "ip_count":
      return new AppError("BUDGET_EXCEEDED", VISITOR_BUDGET_MESSAGE);
    case "global_day":
      return new AppError("BUDGET_EXCEEDED");
    case "lifetime": case "phase": case "ticket":
      return new AppError("LIVE_DISABLED");
    default:
      return new AppError("ACCOUNTING_UNAVAILABLE");
  }
}

export async function reserve(redis: RedisRest, opts: {
  requestKey: string; fingerprint: string; amount: number; model: string; route: string;
  buckets: Buckets; caps: Caps; deadlineMs: number; now?: number;
  /** Key prefix for all nine keys; only tests use a throwaway one. */
  namespace?: string;
}): Promise<Reservation> {
  const ns = opts.namespace ?? NAMESPACE;
  const now = opts.now ?? Date.now();
  const keys = bucketKeys(opts.buckets, ns);
  const all = [...keys, ...extraKeys(ns, opts.requestKey)];
  const c = opts.caps;
  // Refuse before any network call: the script also checks, but a bad number must never be sent.
  const money = [opts.amount, c.lifetime, c.phase, c.ticket, c.day, c.visitor, c.ip];
  if (!money.every((v) => Number.isSafeInteger(v) && v >= 0)
    || ![c.visitorCount, c.ipCount].every((v) => Number.isSafeInteger(v) && v >= -1)) {
    throw new AppError("ACCOUNTING_UNAVAILABLE");
  }
  const args = [opts.requestKey, opts.fingerprint, opts.amount, opts.model, opts.route,
    opts.buckets.ticket, opts.buckets.day, now, now + opts.deadlineMs + 30_000, MARKER_TTL_S,
    AGGREGATE_TTL_S, c.lifetime, c.phase, c.ticket, c.day, c.visitor, c.ip, c.visitorCount, c.ipCount];
  const result = replyArray(await command(redis, ["EVAL", script("reserve.lua"), all.length, ...all, ...args]));
  const [status, detail] = result;
  if (status === "OK" && detail === String(opts.amount)) {
    return { requestKey: opts.requestKey, keys, amount: opts.amount, namespace: ns };
  }
  if (status === "DENIED") throw deniedError(detail);
  if (status === "DUPLICATE") {
    // Same request ID with a different payload is a client error, not a finished duplicate.
    if (detail === "conflict") throw new AppError("INVALID_REQUEST", "This request ID was already used for different input.");
    throw new AppError(detail === "reserved" ? "REQUEST_IN_PROGRESS" : "RESULT_NOT_CACHED");
  }
  throw new AppError("ACCOUNTING_UNAVAILABLE");
}

/**
 * settled: known charge; unknown: keep the full reservation; released: definite 429 only.
 * Returns "NOOP" when the reservation was already settled (a second settle never double-charges).
 * A missing marker ({"NOOP","missing"}) is an accounting failure: the reservation was never
 * recorded or its marker is gone, so nothing may be assumed settled. The namespace is always
 * the reservation's own.
 */
export async function settle(redis: RedisRest, res: Reservation,
  outcome: "settled" | "unknown" | "released", chargedMicroUsd = 0): Promise<"OK" | "NOOP"> {
  const ns = res.namespace;
  if (outcome === "settled" && !(Number.isSafeInteger(chargedMicroUsd) && chargedMicroUsd >= 0)) {
    // Never guess a charge: the reservation stays reserved and counted.
    throw new AppError("ACCOUNTING_UNAVAILABLE");
  }
  const all = [...res.keys, ...extraKeys(ns, res.requestKey)];
  const result = replyArray(await command(redis, ["EVAL", script("settle.lua"), all.length, ...all,
    outcome, chargedMicroUsd, Date.now()]));
  if (result[0] === "NOOP") {
    if (result[1] === "settled" || result[1] === "unknown" || result[1] === "released") return "NOOP";
    throw new AppError("ACCOUNTING_UNAVAILABLE");
  }
  if (result[0] === "OK" && result[1] === outcome && result.length === 3) return "OK";
  throw new AppError("ACCOUNTING_UNAVAILABLE");
}

/**
 * Settle without ever throwing, for use inside error paths: an accounting
 * failure must not replace the original upstream error. The reservation stays
 * counted in full when this returns false. Logs only the request ID.
 */
export async function settleSafely(redis: RedisRest, res: Reservation,
  outcome: "settled" | "unknown" | "released", chargedMicroUsd = 0): Promise<boolean> {
  try {
    await settle(redis, res, outcome, chargedMicroUsd);
    return true;
  } catch {
    console.error(`[${res.requestKey}] settle failed; reservation stays reserved`);
    return false;
  }
}

// ------------------------------------------------------------------ status

export type BucketName = "lifetime" | "phase" | "ticket" | "global_day" | "visitor_day" | "ip_day";
const BUCKET_ORDER: BucketName[] = ["lifetime", "phase", "ticket", "global_day", "visitor_day", "ip_day"];

export type BucketTotals = Record<BucketName, { spentMicroUsd: number; reservedMicroUsd: number }>;

export type LedgerStatus =
  | {
    ok: true;
    /** The over-reservation halt flag is set: paid calls stop until reconciled. */
    halted: boolean;
    capProjectMicroUsd: number;
    capDailyMicroUsd: number;
    buckets: BucketTotals;
    /** Attempt counts per model for the visitor and IP day buckets. */
    counts: Record<string, { visitor: number; ip: number }>;
  }
  | { ok: false; reason: string };

function integerText(text: string | undefined): number {
  if (text === undefined || !/^\d{1,15}$/.test(text)) throw new AppError("ACCOUNTING_UNAVAILABLE");
  return Number(text);
}

// Display cache for readStatus. It exists to protect the Redis command quota (Upstash bills
// every command inside a script) from polling and looping clients. It is display-only and
// is NOT an in-memory counter: reserve() and settle() never touch it, and every spend check
// still happens atomically in Redis. Per server instance; a stale view is at most 10 s old.
export const STATUS_CACHE_TTL_MS = 10_000;
export const STATUS_CACHE_MAX = 500;
const statusCache = new Map<string, { at: number; value: Promise<LedgerStatus> }>();

/** Drop all cached displays (tests, or a caller that needs the next read fresh). */
export function clearStatusCache(): void {
  statusCache.clear();
}
export function statusCacheSize(): number {
  return statusCache.size;
}

/**
 * Read-only ledger totals. Never throws: an outage, a missing lifetime key, missing
 * stored caps, or a malformed reply give {ok: false}; callers show unknown spend as null.
 * Results, failures included, are shared for 10 s per namespace, key list and model list;
 * pass cache: false for a fresh read. `now` is only for tests.
 */
export async function readStatus(redis: RedisRest, opts: {
  buckets: Buckets; models?: readonly string[]; namespace?: string; cache?: boolean; now?: number;
}): Promise<LedgerStatus> {
  const ns = opts.namespace ?? NAMESPACE;
  const models = opts.models ?? [];
  const all = [...bucketKeys(opts.buckets, ns), `${ns}:halt`];
  if (opts.cache === false) return fetchStatus(redis, all, models);
  const now = opts.now ?? Date.now();
  const key = JSON.stringify([redis.url, ns, all, models]);
  const hit = statusCache.get(key);
  if (hit && now - hit.at >= 0 && now - hit.at < STATUS_CACHE_TTL_MS) return hit.value;
  statusCache.delete(key);
  // Drop expired entries first, then the oldest, so the map stays bounded.
  for (const [k, v] of statusCache) if (now - v.at >= STATUS_CACHE_TTL_MS) statusCache.delete(k);
  while (statusCache.size >= STATUS_CACHE_MAX) statusCache.delete(statusCache.keys().next().value as string);
  // The promise is stored at once, so concurrent requests share one Redis call.
  const value = fetchStatus(redis, all, models);
  statusCache.set(key, { at: now, value });
  return value;
}

async function fetchStatus(redis: RedisRest, all: string[], models: readonly string[]): Promise<LedgerStatus> {
  let raw: unknown;
  try {
    raw = await command(redis, ["EVAL", script("status.lua"), all.length, ...all, ...models]);
  } catch {
    return { ok: false, reason: "unreachable" }; // transport, timeout or HTTP/Redis error
  }
  try {
    const r = replyArray(raw);
    if (r[0] === "UNAVAILABLE") return { ok: false, reason: r[1] ?? "unavailable" };
    if (r[0] !== "OK" || r.length !== 4 + 12 + 2 * models.length || (r[1] !== "0" && r[1] !== "1")) {
      return { ok: false, reason: "bad_reply" };
    }
    const buckets = {} as BucketTotals;
    BUCKET_ORDER.forEach((name, i) => {
      buckets[name] = { spentMicroUsd: integerText(r[4 + 2 * i]), reservedMicroUsd: integerText(r[5 + 2 * i]) };
    });
    const counts: Record<string, { visitor: number; ip: number }> = {};
    models.forEach((model, i) => {
      counts[model] = { visitor: integerText(r[16 + 2 * i]), ip: integerText(r[17 + 2 * i]) };
    });
    return {
      ok: true, halted: r[1] === "1", capProjectMicroUsd: integerText(r[2]), capDailyMicroUsd: integerText(r[3]),
      buckets, counts,
    };
  } catch {
    return { ok: false, reason: "bad_reply" };
  }
}

/** Healthy means: Redis answers, the lifetime key and stored caps exist, and no halt flag is set. */
export async function accountingHealth(redis: RedisRest, opts: { namespace?: string; now?: Date; cache?: boolean } = {}):
  Promise<{ healthy: boolean; reason: string | null }> {
  const status = await readStatus(redis, {
    // Placeholder bucket names: the health check only needs the lifetime hash and halt flag.
    buckets: { phase: "development", ticket: "health", day: dayET(opts.now), visitor: "health", ip: "health" },
    namespace: opts.namespace, cache: opts.cache,
  });
  if (!status.ok) return { healthy: false, reason: status.reason };
  if (status.halted) return { healthy: false, reason: "halted" };
  return { healthy: true, reason: null };
}
