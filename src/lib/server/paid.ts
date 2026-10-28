// The only way a route may dispatch a paid Meta call: reserve in the shared
// Redis ledger first, dispatch exactly once, then settle (SPEC.md 13).
// Until T13 adds public visitor/IP buckets and the session cookie, live calls
// are refused on any deployment; local development uses one fixed bucket.
import "server-only";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AppError } from "../errors";
import { dayET, reserve, settle, type RedisRest } from "./budget";
import { loadConfig } from "./config";

export type Prices = { reservations: Record<string, number>; prices: Record<string, Record<string, number> | null> };

let prices: Prices | null = null;
export function loadPrices(): Prices {
  if (!prices) prices = JSON.parse(readFileSync(path.join(process.cwd(), "budget", "prices.json"), "utf8")) as Prices;
  return prices;
}

/** What a dispatch reports back: the value, plus the known charge (null = unknown). */
export type Dispatched<T> = { value: T; chargedMicroUsd: number | null };

export type PaidCall = {
  route: string; model: string; amountMicroUsd: number; requestId: string;
  /** Payload bytes or a digest of them; HMAC'd so duplicates are recognized without storing content. */
  payloadDigest: string; deadlineMs: number;
};

function deployed(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL_ENV);
}

export async function withReservation<T>(call: PaidCall, dispatch: (signal: AbortSignal) => Promise<Dispatched<T>>): Promise<T> {
  const config = loadConfig();
  if (config.mode !== "live") throw new AppError("LIVE_DISABLED");
  if (deployed()) throw new AppError("LIVE_DISABLED", "Live AI on the public site arrives with its spending protection.");
  // Local paid calls are booked to a real ticket so the $5-per-ticket cap means something.
  const ticket = process.env.BUDGET_TICKET ?? "";
  if (!/^T\d{1,2}$/.test(ticket)) throw new AppError("LIVE_DISABLED", "Set BUDGET_TICKET (for example T3) before live calls.");
  const redis: RedisRest = { url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! };
  const fingerprint = createHmac("sha256", process.env.VISITOR_HASH_SECRET!)
    .update(`${call.route}\n${call.payloadDigest}\nlocal`).digest("hex");
  const caps = config.caps;
  const reservation = await reserve(redis, {
    requestKey: call.requestId, fingerprint, amount: call.amountMicroUsd, model: call.model, route: call.route,
    buckets: { phase: config.phase, ticket, day: dayET(), visitor: "local", ip: "local" },
    caps: {
      lifetime: caps.projectMicroUsd,
      phase: config.phase === "development" ? caps.developmentMicroUsd : caps.projectMicroUsd,
      ticket: caps.ticketMicroUsd, day: caps.dailyMicroUsd, visitor: caps.ticketMicroUsd, ip: caps.ticketMicroUsd,
      visitorCount: -1, ipCount: -1,
    },
    deadlineMs: call.deadlineMs,
  });
  let result: Dispatched<T>;
  try {
    result = await dispatch(AbortSignal.timeout(call.deadlineMs));
  } catch (error) {
    // Only a definite upstream 429 was not billed; everything else keeps the reservation.
    const definite429 = error instanceof AppError && error.code === "RATE_LIMITED";
    await settle(redis, reservation, definite429 ? "released" : "unknown");
    throw error;
  }
  try {
    if (result.chargedMicroUsd === null) await settle(redis, reservation, "unknown");
    else await settle(redis, reservation, "settled", result.chargedMicroUsd);
  } catch {
    // The reservation stays counted in full (fail closed); keep the paid-for result.
    console.error(`[${call.requestId}] settle failed; reservation stays reserved`);
  }
  return result.value;
}
