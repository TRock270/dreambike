// GET /api/budget: safe budget and feature state for the browser (SPEC.md 5, 13).
// Issues the signed session cookie before any Redis call and on every error path.
// Unknown spend is null, never 0; unavailable accounting reports no live allowance.
import { BudgetResponse, EmptyRequest, type BUDGET_REASONS } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { dayET, nextMidnightET, readStatus, type BucketName, type LedgerStatus, type RedisRest } from "@/lib/server/budget";
import { loadConfig, type ServerConfig } from "@/lib/server/config";
import { ensureSession, errorResponse, jsonResponse, readSession, requestIdOf, visitorSecret } from "@/lib/server/http";
import { identityFor, loadPrices } from "@/lib/server/paid";

export const runtime = "nodejs";
export const maxDuration = 5;
export const dynamic = "force-dynamic";

type Reason = (typeof BUDGET_REASONS)[number];
type Body = ReturnType<typeof BudgetResponse.parse>;

const NEW_VISITOR = "new";
const MODELS = (config: ServerConfig) => ["sam-3.1", "muse-image-1.0", config.museModel, "muse-voice-transcribe-1.0"];

function withCookie(res: Response, setCookie: string | null): Response {
  if (setCookie) res.headers.append("Set-Cookie", setCookie);
  return res;
}

/** The fail-closed answer: no live allowance, spend unknown. */
function unavailable(config: ServerConfig, day: string, resetAt: string, reason: Reason): Body {
  return BudgetResponse.parse({
    dayET: day, resetAt, liveEnabled: false, spentTodayMicroUsd: null, reservedTodayMicroUsd: null,
    dailyCapMicroUsd: config.caps.dailyMicroUsd, visitorRemainingMicroUsd: 0, remainingEdits: 0,
    features: config.features, reason,
  });
}

const left = (cap: number, b: { spentMicroUsd: number; reservedMicroUsd: number }) =>
  Math.max(0, cap - b.spentMicroUsd - b.reservedMicroUsd);

function fromLedger(config: ServerConfig, status: Extract<LedgerStatus, { ok: true }>,
  identity: ReturnType<typeof identityFor>, day: string, resetAt: string): Body {
  const prices = loadPrices();
  // The effective caps are the smaller of the environment and the values stored in Redis.
  const caps = {
    lifetime: Math.min(identity.caps.lifetime, status.capProjectMicroUsd),
    phase: identity.caps.phase, ticket: identity.caps.ticket,
    global_day: Math.min(identity.caps.day, status.capDailyMicroUsd),
    visitor_day: identity.caps.visitor, ip_day: identity.caps.ip,
  } satisfies Record<BucketName, number>;
  const remaining = {} as Record<BucketName, number>;
  for (const name of Object.keys(caps) as BucketName[]) remaining[name] = left(caps[name], status.buckets[name]);
  // What this visitor can still spend is limited by the tightest bucket of all six.
  const visitorRemaining = Math.min(...Object.values(remaining));
  const editCost = prices.reservations["muse-image-1.0"]!;
  const byMoney = Math.floor(visitorRemaining / editCost);
  const edits = status.counts["muse-image-1.0"];
  // visitorCount is the edit limit here because the identity was built for the edit model; -1 = none.
  const limit = identity.caps.visitorCount === -1 ? null : identity.caps.visitorCount;
  const byCount = limit === null || !edits ? Infinity : Math.min(limit - edits.visitor, limit - edits.ip);
  const remainingEdits = Math.max(0, Math.min(byMoney, byCount));
  const countsUsedUp = byCount <= 0;
  const smallest = Math.min(...Object.values(prices.reservations));
  let reason: Reason | null = null;
  if (remaining.lifetime < smallest || remaining.phase < smallest || remaining.ticket < smallest) reason = "project_cap";
  else if (remaining.global_day < smallest) reason = "global_cap";
  else if (remaining.visitor_day < smallest || remaining.ip_day < smallest || countsUsedUp) reason = "visitor_cap";
  return BudgetResponse.parse({
    // Healthy accounting is a precondition of this function; any cap reason turns live off.
    dayET: day, resetAt, liveEnabled: reason === null,
    spentTodayMicroUsd: status.buckets.global_day.spentMicroUsd,
    reservedTodayMicroUsd: status.buckets.global_day.reservedMicroUsd,
    dailyCapMicroUsd: caps.global_day, visitorRemainingMicroUsd: visitorRemaining, remainingEdits,
    features: config.features, reason,
  });
}

export async function GET(req: Request): Promise<Response> {
  const requestId = requestIdOf(req);
  // The cookie comes first and never depends on config or Redis.
  const { session, setCookie } = ensureSession(req, process.env.APP_ORIGIN || "http://localhost:3000");
  try {
    if (!EmptyRequest.safeParse(Object.fromEntries(new URL(req.url).searchParams)).success) {
      throw new AppError("INVALID_REQUEST");
    }
    let config: ServerConfig;
    try {
      config = loadConfig();
    } catch {
      throw new AppError("LIVE_DISABLED");
    }
    const day = dayET();
    const resetAt = nextMidnightET().toISOString();
    if (config.mode !== "live") {
      return withCookie(jsonResponse(unavailable(config, day, resetAt, "live_disabled")), setCookie);
    }
    // Live by config: it is enabled only while the ledger answers and its totals are known.
    const secret = visitorSecret();
    let identity: ReturnType<typeof identityFor>;
    try {
      if (!secret) throw new AppError("LIVE_DISABLED");
      identity = identityFor(req, session, "muse-image-1.0", config, secret, day);
    } catch (error) {
      // BUDGET_TICKET unset locally is a configuration state (live off), not a ledger failure.
      const reason = error instanceof AppError && error.code === "LIVE_DISABLED" && secret
        ? "live_disabled" : "accounting_unavailable";
      return withCookie(jsonResponse(unavailable(config, day, resetAt, reason)), setCookie);
    }
    // A visitor whose cookie was just issued has zero spend by definition. One fixed bucket name keeps
    // cookie-less clients on one cached read per IP and day, so they cannot force a Redis read each.
    const cookieCameIn = session !== null && readSession(req) !== null;
    const redis: RedisRest = { url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! };
    const status = await readStatus(redis, {
      buckets: { phase: config.phase, ticket: identity.ticket, day, visitor: cookieCameIn ? identity.visitor : NEW_VISITOR, ip: identity.ip },
      models: MODELS(config),
    });
    if (!status.ok || status.halted) {
      return withCookie(jsonResponse(unavailable(config, day, resetAt, "accounting_unavailable")), setCookie);
    }
    return withCookie(jsonResponse(fromLedger(config, status, identity, day, resetAt)), setCookie);
  } catch (error) {
    return withCookie(errorResponse(error, requestId), setCookie);
  }
}
