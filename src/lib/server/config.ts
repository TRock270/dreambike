// Server environment validation and feature flags (SPEC.md 3). Server only.
// Read lazily per request (not at import), so `next build` never needs secrets.
import "server-only";

export type AppMode = "mock" | "live" | "demo_only";

/** SPEC 13 default caps are also the maximum: an environment value can only lower them. */
export const MAX_CAPS_MICRO_USD = { project: 100_000_000, daily: 5_000_000, development: 50_000_000 } as const;

export type ServerConfig = {
  mode: AppMode;
  /** NODE_ENV=production or any Vercel deployment (preview included). */
  deployed: boolean;
  /** VISITOR_HASH_SECRET is set and at least 32 bytes. */
  visitorSecretConfigured: boolean;
  /** Why live mode is off, as safe text; null when live. */
  liveBlockedReason: string | null;
  apiConfigured: boolean;
  accountingConfigured: boolean;
  museModel: string;
  appOrigin: string;
  features: { composite: boolean; reference: boolean; search: boolean; voice: boolean };
  caps: {
    dailyMicroUsd: number; visitorDailyMicroUsd: number; projectMicroUsd: number;
    developmentMicroUsd: number; ticketMicroUsd: number;
    visitorEdits: number; visitorSam: number; visitorSpark: number; visitorAsr: number;
  };
  phase: "development" | "demo";
  searchQueryReserve: number | null;
};

/** Parse a decimal USD string into exact integer microdollars (no float math). */
export function usdToMicro(text: string): number {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text.trim());
  if (!m) throw new Error(`invalid USD amount: ${JSON.stringify(text)}`);
  return Number(m[1]) * 1_000_000 + Number(((m[2] ?? "") + "000000").slice(0, 6));
}

function flag(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const v = env[name];
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1";
}

/**
 * Count limit from the environment. A malformed value never throws and never
 * raises a limit: it becomes 0 (no live calls of that kind) and is reported.
 */
function int(env: NodeJS.ProcessEnv, name: string, fallback: number, problems: string[]): number {
  const v = env[name];
  if (v === undefined || v === "") return fallback;
  if (!/^\d{1,9}$/.test(v)) {
    problems.push(`${name} is not a valid limit`);
    return 0;
  }
  return Number(v);
}

/** USD cap, never above `max`. A malformed value becomes 0 and is reported, not thrown. */
function capMicro(env: NodeJS.ProcessEnv, name: string, fallback: string, max: number, problems: string[]): number {
  try {
    return Math.min(usdToMicro(env[name] || fallback), max);
  } catch {
    problems.push(`${name} is not a valid amount`);
    return 0;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const mockRequested = env.MOCK === "1";
  // VERCEL_ENV is set on every Vercel deployment, including public previews.
  const deployed = env.NODE_ENV === "production" || Boolean(env.VERCEL_ENV);
  if (mockRequested && deployed) {
    // Never deploy a mocked API as a live service (CLAUDE.md).
    throw new Error("MOCK=1 is not allowed in production");
  }
  const museModel = env.MUSE_MODEL || "muse-spark-1.3-contributor";
  const apiConfigured = Boolean(env.MODEL_API_KEY);
  const accountingConfigured = Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
  const secret = env.VISITOR_HASH_SECRET ?? "";
  const reserve = env.SEARCH_QUERY_RESERVE ?? "";

  const missing: string[] = [];
  const problems: string[] = [];
  const budgetPhase = env.BUDGET_PHASE || "development";
  const phaseValid = budgetPhase === "development" || budgetPhase === "demo";
  if (!phaseValid) missing.push("budget phase is invalid");
  if (!flag(env, "LIVE_API_ENABLED", false)) missing.push("live mode is switched off");
  if (!apiConfigured) missing.push("API key missing");
  if (!accountingConfigured) missing.push("budget ledger not configured");
  if (!env.PRICING_VERIFIED_AT) missing.push("pricing not verified");
  if (Buffer.byteLength(secret) < 32) missing.push("visitor secret missing");
  if (museModel !== "muse-spark-1.3-contributor") missing.push("unreviewed Spark model");
  if (deployed && !env.APP_ORIGIN) missing.push("APP_ORIGIN not set");
  if (deployed) {
    // Only the production deployment may spend, and only in the demo phase.
    if (env.VERCEL_ENV !== "production") missing.push("live AI only runs on the production deployment");
    if (budgetPhase !== "demo") missing.push("budget phase must be demo on a deployment");
  }
  const dailyMicroUsd = capMicro(env, "DAILY_CAP_USD", "5", MAX_CAPS_MICRO_USD.daily, problems);
  const caps = {
    dailyMicroUsd,
    // Visitor and ticket caps can never exceed the global day cap.
    visitorDailyMicroUsd: capMicro(env, "VISITOR_DAILY_CAP_USD", "0.50", dailyMicroUsd, problems),
    projectMicroUsd: capMicro(env, "PROJECT_HARD_CAP_USD", "100", MAX_CAPS_MICRO_USD.project, problems),
    developmentMicroUsd: capMicro(env, "DEVELOPMENT_STOP_USD", "50", MAX_CAPS_MICRO_USD.development, problems),
    ticketMicroUsd: capMicro(env, "TICKET_CAP_USD", "5", dailyMicroUsd, problems),
    visitorEdits: int(env, "VISITOR_DAILY_EDIT_LIMIT", 5, problems),
    visitorSam: int(env, "VISITOR_DAILY_SAM_LIMIT", 80, problems),
    visitorSpark: int(env, "VISITOR_DAILY_SPARK_LIMIT", 12, problems),
    visitorAsr: int(env, "VISITOR_DAILY_ASR_LIMIT", 3, problems),
  };
  missing.push(...problems);

  const mode: AppMode = mockRequested ? "mock" : missing.length === 0 ? "live" : "demo_only";
  return {
    mode,
    deployed,
    visitorSecretConfigured: Buffer.byteLength(secret) >= 32,
    liveBlockedReason: mode === "live" ? null : mockRequested ? "mock mode" : missing.join("; "),
    apiConfigured,
    accountingConfigured,
    museModel,
    appOrigin: env.APP_ORIGIN || "http://localhost:3000",
    features: {
      composite: flag(env, "COMPOSITE_ENABLED", true),
      reference: flag(env, "REFERENCE_MODE_ENABLED", true),
      search: flag(env, "SEARCH_ENABLED", false) && /^\d+$/.test(reserve),
      voice: flag(env, "VOICE_ENABLED", false),
    },
    caps,
    // An invalid phase keeps "development" here but blocks live mode above (demo_only).
    phase: budgetPhase === "demo" ? "demo" : "development",
    searchQueryReserve: /^\d+$/.test(reserve) ? Number(reserve) : null,
  };
}
