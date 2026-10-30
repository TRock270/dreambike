// GET /api/health: what works right now (SPEC.md 5). No paid probe, no Meta call.
// The cached demo needs none of this, so the answer is 200 whenever the server runs.
import { EmptyRequest, HealthResponse } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { accountingHealth, type RedisRest } from "@/lib/server/budget";
import { loadConfig } from "@/lib/server/config";
import { errorResponse, jsonResponse, requestIdOf } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 5;
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const requestId = requestIdOf(req);
  try {
    if (!EmptyRequest.safeParse(Object.fromEntries(new URL(req.url).searchParams)).success) {
      throw new AppError("INVALID_REQUEST");
    }
    let config;
    try {
      config = loadConfig();
    } catch {
      // Misconfiguration (for example MOCK=1 in production) turns live off, but the static
      // demo needs no config and stays usable, so the answer is 200. The error text is never echoed.
      return jsonResponse(HealthResponse.parse({ ok: true, mode: "demo_only", accountingReady: false, apiConfigured: false }));
    }
    let accountingReady = false;
    if (config.mode !== "mock" && config.accountingConfigured) {
      // One read-only ledger EVAL; Redis only, never Meta.
      const redis: RedisRest = { url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! };
      accountingReady = (await accountingHealth(redis)).healthy;
    }
    // Live only when the config allows it and the ledger is healthy; otherwise the demo still works.
    const mode = config.mode === "live" && !accountingReady ? "demo_only" : config.mode;
    return jsonResponse(HealthResponse.parse({ ok: true, mode, accountingReady, apiConfigured: config.apiConfigured }));
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
