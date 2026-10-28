// Server environment validation and feature flags (SPEC.md 3). Server only.
// Read lazily per request (not at import), so `next build` never needs secrets.
import "server-only";

export type AppMode = "mock" | "live" | "demo_only";

export type ServerConfig = {
  mode: AppMode;
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

function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const v = env[name];
  if (v === undefined || v === "") return fallback;
  if (!/^\d+$/.test(v)) throw new Error(`${name} must be a non-negative integer`);
  return Number(v);
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
  if (!flag(env, "LIVE_API_ENABLED", false)) missing.push("live mode is switched off");
  if (!apiConfigured) missing.push("API key missing");
  if (!accountingConfigured) missing.push("budget ledger not configured");
  if (!env.PRICING_VERIFIED_AT) missing.push("pricing not verified");
  if (Buffer.byteLength(secret) < 32) missing.push("visitor secret missing");
  if (museModel !== "muse-spark-1.3-contributor") missing.push("unreviewed Spark model");
  if (deployed && !env.APP_ORIGIN) missing.push("APP_ORIGIN not set");

  const mode: AppMode = mockRequested ? "mock" : missing.length === 0 ? "live" : "demo_only";
  return {
    mode,
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
    caps: {
      dailyMicroUsd: usdToMicro(env.DAILY_CAP_USD || "5"),
      visitorDailyMicroUsd: usdToMicro(env.VISITOR_DAILY_CAP_USD || "0.50"),
      projectMicroUsd: usdToMicro(env.PROJECT_HARD_CAP_USD || "100"),
      developmentMicroUsd: usdToMicro(env.DEVELOPMENT_STOP_USD || "50"),
      ticketMicroUsd: usdToMicro(env.TICKET_CAP_USD || "5"),
      visitorEdits: int(env, "VISITOR_DAILY_EDIT_LIMIT", 5),
      visitorSam: int(env, "VISITOR_DAILY_SAM_LIMIT", 80),
      visitorSpark: int(env, "VISITOR_DAILY_SPARK_LIMIT", 12),
      visitorAsr: int(env, "VISITOR_DAILY_ASR_LIMIT", 3),
    },
    phase: env.BUDGET_PHASE === "demo" ? "demo" : "development",
    searchQueryReserve: /^\d+$/.test(reserve) ? Number(reserve) : null,
  };
}
