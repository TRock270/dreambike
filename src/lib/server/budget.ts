// Node wrapper over the shared atomic budget scripts budget/reserve.lua and
// budget/settle.lua (SPEC.md 13). The Python spike uses the same files.
// Redis REST calls time out after 2 seconds and fail closed; there is no
// in-memory fallback. T13 adds public visitor/IP buckets on top of this.
import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AppError } from "../errors";

export const NAMESPACE = "{dreambike:hackathon-2026}";
const MARKER_TTL_S = 48 * 3600;
const AGGREGATE_TTL_S = 120 * 24 * 3600;

const scripts = new Map<string, string>();
function script(name: "reserve.lua" | "settle.lua"): string {
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
      signal: AbortSignal.timeout(2000),
    });
    body = (await res.json()) as typeof body;
  } catch {
    throw new AppError("ACCOUNTING_UNAVAILABLE");
  }
  if (!res.ok || body.error !== undefined) throw new AppError("ACCOUNTING_UNAVAILABLE");
  return body.result;
}

export type Reservation = { requestKey: string; keys: string[]; amount: number };

export async function reserve(redis: RedisRest, opts: {
  requestKey: string; fingerprint: string; amount: number; model: string; route: string;
  buckets: Buckets; caps: Caps; deadlineMs: number; now?: number;
}): Promise<Reservation> {
  const now = opts.now ?? Date.now();
  const keys = bucketKeys(opts.buckets);
  const all = [...keys, `${NAMESPACE}:req:${opts.requestKey}`, `${NAMESPACE}:ledger`, `${NAMESPACE}:halt`];
  const c = opts.caps;
  const args = [opts.requestKey, opts.fingerprint, opts.amount, opts.model, opts.route,
    opts.buckets.ticket, opts.buckets.day, now, now + opts.deadlineMs + 30_000, MARKER_TTL_S,
    AGGREGATE_TTL_S, c.lifetime, c.phase, c.ticket, c.day, c.visitor, c.ip, c.visitorCount, c.ipCount];
  const result = (await command(redis, ["EVAL", script("reserve.lua"), all.length, ...all, ...args])) as [string, string];
  const [status, detail] = result;
  if (status === "OK") return { requestKey: opts.requestKey, keys, amount: opts.amount };
  if (status === "DENIED") throw new AppError("BUDGET_EXCEEDED");
  if (status === "DUPLICATE") {
    throw new AppError(detail === "reserved" ? "REQUEST_IN_PROGRESS" : "RESULT_NOT_CACHED");
  }
  throw new AppError("ACCOUNTING_UNAVAILABLE");
}

/** settled: known charge; unknown: keep the full reservation; released: definite 429 only. */
export async function settle(redis: RedisRest, res: Reservation,
  outcome: "settled" | "unknown" | "released", chargedMicroUsd = 0): Promise<void> {
  const all = [...res.keys, `${NAMESPACE}:req:${res.requestKey}`, `${NAMESPACE}:ledger`, `${NAMESPACE}:halt`];
  const result = (await command(redis, ["EVAL", script("settle.lua"), all.length, ...all,
    outcome, chargedMicroUsd, Date.now()])) as [string, ...string[]];
  if (result[0] === "ERROR") throw new AppError("ACCOUNTING_UNAVAILABLE");
}
