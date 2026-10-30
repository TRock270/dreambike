// The only way a route may dispatch a paid Meta call: reserve in the shared
// Redis ledger first, dispatch exactly once, then settle (SPEC.md 13).
// Public (demo phase) calls are counted per signed-cookie visitor and per trusted
// platform IP bucket; local development uses one fixed bucket and a real ticket.
import "server-only";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { AppError, SESSION_RELOAD_MESSAGE } from "../errors";
import { dayET, reserve, settleSafely, type Buckets, type Caps, type RedisRest } from "./budget";
import { loadConfig, type ServerConfig } from "./config";
import { labeledHmac, readSession, visitorSecret, type Session } from "./http";

export type Prices = { reservations: Record<string, number>; prices: Record<string, Record<string, number> | null> };

let prices: Prices | null = null;
export function loadPrices(): Prices {
  if (!prices) prices = JSON.parse(readFileSync(path.join(process.cwd(), "budget", "prices.json"), "utf8")) as Prices;
  return prices;
}

/** What a dispatch reports back: the value, plus the known charge (null = unknown). */
export type Dispatched<T> = { value: T; chargedMicroUsd: number | null };

export type PaidCall = {
  /** The incoming request: its session cookie and platform IP header identify the visitor. */
  req: Request;
  route: string; model: string; amountMicroUsd: number; requestId: string;
  /** Payload bytes or a digest of them; HMAC'd so duplicates are recognized without storing content. */
  payloadDigest: string; deadlineMs: number;
};

/** Hextets of an IPv6 text address, or null when it is not a plain valid one. */
function hextets(address: string): number[] | null {
  let text = address;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const octets = dotted[1]!.split(".").map(Number);
    if (octets.some((o) => o > 255)) return null;
    text = text.slice(0, -dotted[1]!.length)
      + `${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const out = part.split(":").map((g) => (/^[0-9a-fA-F]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
    return out.some(Number.isNaN) ? null : out;
  };
  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  return fill < 1 ? null : [...head, ...new Array<number>(fill).fill(0), ...tail];
}

/**
 * Canonical text of the client address for bucketing, or null when the header is not
 * exactly one valid address. IPv6 addresses collapse to their /64 (one household or
 * host can use many addresses inside a /64); IPv4-mapped IPv6 is treated as IPv4.
 * The result is only ever fed to an HMAC, never stored or logged.
 */
export function normalizeClientIp(header: string | null): string | null {
  if (header === null) return null;
  const value = header.trim();
  if (value === "" || /[,\s%]/.test(value)) return null;
  const kind = isIP(value);
  if (kind === 4) return value;
  if (kind !== 6) return null;
  const h = hextets(value);
  if (!h) return null;
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
    return `${h[6]! >> 8}.${h[6]! & 255}.${h[7]! >> 8}.${h[7]! & 255}`;
  }
  return `${h.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
}

/** Attempt-count limit per model for one visitor or IP day; an unknown model gets 0. */
export function countLimitFor(model: string, config: ServerConfig): number {
  if (model === "sam-3.1") return config.caps.visitorSam;
  if (model === "muse-image-1.0") return config.caps.visitorEdits;
  if (model === config.museModel) return config.caps.visitorSpark;
  if (model === "muse-voice-transcribe-1.0") return config.caps.visitorAsr;
  return 0;
}

export type Identity = { visitor: string; ip: string; ticket: string; caps: Caps };

/**
 * Buckets and caps one request is counted against; `session` is the visitor's verified
 * cookie session (the budget route passes a freshly issued one). Throws before any Redis call when no
 * trustworthy identity exists (no session, or no platform IP header on a deployment).
 */
export function identityFor(req: Request, session: Session | null, model: string, config: ServerConfig, secret: Buffer, day: string): Identity {
  const c = config.caps;
  if (config.phase !== "demo") {
    // Local development: one fixed bucket, booked to a real ticket so the $5-per-ticket cap means something.
    const ticket = process.env.BUDGET_TICKET ?? "";
    if (!/^T\d{1,2}$/.test(ticket)) throw new AppError("LIVE_DISABLED", "Set BUDGET_TICKET (for example T3) before live calls.");
    return {
      visitor: "local", ip: "local", ticket,
      caps: {
        lifetime: c.projectMicroUsd, phase: c.developmentMicroUsd, ticket: c.ticketMicroUsd, day: c.dailyMicroUsd,
        visitor: c.ticketMicroUsd, ip: c.ticketMicroUsd, visitorCount: -1, ipCount: -1,
      },
    };
  }
  if (!session) throw new AppError("FORBIDDEN", SESSION_RELOAD_MESSAGE);
  let ip = "local";
  if (config.deployed) {
    // Only the platform header is trusted; X-Forwarded-For and friends are client-controlled.
    const address = normalizeClientIp(req.headers.get("x-vercel-forwarded-for"));
    if (!address) throw new AppError("ACCOUNTING_UNAVAILABLE");
    ip = labeledHmac(secret, "ip", `${address}\n${day}`);
  }
  const limit = countLimitFor(model, config);
  return {
    visitor: labeledHmac(secret, "visitor", session.id), ip, ticket: "public",
    caps: {
      lifetime: c.projectMicroUsd, phase: c.projectMicroUsd, ticket: c.projectMicroUsd, day: c.dailyMicroUsd,
      visitor: c.visitorDailyMicroUsd, ip: c.visitorDailyMicroUsd, visitorCount: limit, ipCount: limit,
    },
  };
}

export async function withReservation<T>(call: PaidCall, dispatch: (signal: AbortSignal) => Promise<Dispatched<T>>): Promise<T> {
  const config = loadConfig();
  if (config.mode !== "live") throw new AppError("LIVE_DISABLED");
  const secret = visitorSecret();
  if (!secret) throw new AppError("LIVE_DISABLED");
  const day = dayET();
  const who = identityFor(call.req, readSession(call.req), call.model, config, secret, day);
  const redis: RedisRest = { url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! };
  // Duplicate detection: payload and visitor, never the content itself.
  const fingerprint = labeledHmac(secret, "fp", `${call.route}\n${call.payloadDigest}\n${who.visitor}`);
  const buckets: Buckets = { phase: config.phase, ticket: who.ticket, day, visitor: who.visitor, ip: who.ip };
  const reservation = await reserve(redis, {
    requestKey: call.requestId, fingerprint, amount: call.amountMicroUsd, model: call.model, route: call.route,
    buckets, caps: who.caps, deadlineMs: call.deadlineMs,
  });
  let result: Dispatched<T>;
  try {
    result = await dispatch(AbortSignal.timeout(call.deadlineMs));
  } catch (error) {
    // Only a definite upstream 429 was not billed; everything else keeps the reservation.
    // settleSafely never throws, so an accounting failure cannot replace the upstream error.
    const definite429 = error instanceof AppError && error.code === "RATE_LIMITED";
    await settleSafely(redis, reservation, definite429 ? "released" : "unknown");
    throw error;
  }
  // A failed settle leaves the reservation counted in full (fail closed); keep the paid-for result.
  if (result.chargedMicroUsd === null) await settleSafely(redis, reservation, "unknown");
  else await settleSafely(redis, reservation, "settled", result.chargedMicroUsd);
  return result.value;
}
