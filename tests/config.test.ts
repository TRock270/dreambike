import { describe, expect, it } from "vitest";
import { loadConfig, usdToMicro } from "@/lib/server/config";

const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
const liveEnv = {
  NODE_ENV: "production", LIVE_API_ENABLED: "true", MODEL_API_KEY: "k",
  UPSTASH_REDIS_REST_URL: "https://r", UPSTASH_REDIS_REST_TOKEN: "t",
  PRICING_VERIFIED_AT: "2026-10-28T09:00:00-04:00", VISITOR_HASH_SECRET: "s".repeat(32),
  APP_ORIGIN: "https://dreambike.example",
};

describe("server config", () => {
  it("refuses MOCK=1 in production", () => {
    expect(() => loadConfig(env({ NODE_ENV: "production", MOCK: "1" }))).toThrow(/MOCK=1/);
    // A Vercel preview is public too, even if NODE_ENV were misconfigured.
    expect(() => loadConfig(env({ NODE_ENV: "development", VERCEL_ENV: "preview", MOCK: "1" }))).toThrow(/MOCK=1/);
    expect(loadConfig(env({ NODE_ENV: "development", MOCK: "1" })).mode).toBe("mock");
  });

  it("defaults to demo-only with a reason and safe feature flags", () => {
    const c = loadConfig(env({ NODE_ENV: "development" }));
    expect(c.mode).toBe("demo_only");
    expect(c.liveBlockedReason).toContain("live mode is switched off");
    expect(c.features).toEqual({ composite: true, reference: true, search: false, voice: false });
    expect(c.caps.dailyMicroUsd).toBe(5_000_000);
    expect(c.caps.visitorDailyMicroUsd).toBe(500_000);
  });

  it("goes live only when every prerequisite is present", () => {
    expect(loadConfig(env(liveEnv)).mode).toBe("live");
    for (const key of Object.keys(liveEnv).filter((k) => k !== "NODE_ENV")) {
      const partial = { ...liveEnv, [key]: "" };
      expect(loadConfig(env(partial)).mode, key).toBe("demo_only");
    }
    expect(loadConfig(env({ ...liveEnv, MUSE_MODEL: "muse-spark-1.3" })).mode).toBe("demo_only");
  });

  it("keeps search off without a proven query bound", () => {
    expect(loadConfig(env({ ...liveEnv, SEARCH_ENABLED: "true" })).features.search).toBe(false);
    expect(loadConfig(env({ ...liveEnv, SEARCH_ENABLED: "true", SEARCH_QUERY_RESERVE: "4" })).features.search).toBe(true);
  });

  it("parses USD to exact microdollars without float error", () => {
    expect(usdToMicro("0.10")).toBe(100_000);
    expect(usdToMicro("0.29")).toBe(290_000);
    expect(usdToMicro("100")).toBe(100_000_000);
    expect(() => usdToMicro("1e3")).toThrow();
    expect(() => usdToMicro("-1")).toThrow();
  });
});
