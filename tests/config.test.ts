import { describe, expect, it } from "vitest";
import { loadConfig, usdToMicro } from "@/lib/server/config";

const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
const liveEnv = {
  NODE_ENV: "production", VERCEL_ENV: "production", BUDGET_PHASE: "demo", LIVE_API_ENABLED: "true", MODEL_API_KEY: "k",
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

  it("goes live on a deployment only for VERCEL_ENV=production in the demo phase", () => {
    const blocked = (patch: Record<string, string>) => loadConfig(env({ ...liveEnv, ...patch }));
    expect(blocked({ VERCEL_ENV: "preview" }).mode).toBe("demo_only");
    expect(blocked({ VERCEL_ENV: "preview" }).liveBlockedReason).toContain("production deployment");
    expect(blocked({ VERCEL_ENV: "development" }).mode).toBe("demo_only");
    expect(blocked({ BUDGET_PHASE: "development" }).mode).toBe("demo_only");
    expect(blocked({ BUDGET_PHASE: "development" }).liveBlockedReason).toContain("demo");
    // NODE_ENV=production without any Vercel variable is still a deployment.
    expect(loadConfig(env({ ...liveEnv, VERCEL_ENV: "" })).mode).toBe("demo_only");
    // Locally (no deployment) development phase and no APP_ORIGIN are fine.
    const local = { ...liveEnv, NODE_ENV: "development", VERCEL_ENV: "", BUDGET_PHASE: "development", APP_ORIGIN: "" };
    expect(loadConfig(env(local)).mode).toBe("live");
    expect(loadConfig(env(local)).deployed).toBe(false);
  });

  it("clamps caps to the SPEC defaults and keeps visitor and ticket caps within the daily cap", () => {
    const c = loadConfig(env({ ...liveEnv, PROJECT_HARD_CAP_USD: "500", DAILY_CAP_USD: "50",
      DEVELOPMENT_STOP_USD: "75", VISITOR_DAILY_CAP_USD: "20", TICKET_CAP_USD: "30" }));
    expect(c.caps.projectMicroUsd).toBe(100_000_000);
    expect(c.caps.dailyMicroUsd).toBe(5_000_000);
    expect(c.caps.developmentMicroUsd).toBe(50_000_000);
    expect(c.caps.visitorDailyMicroUsd).toBe(5_000_000);
    expect(c.caps.ticketMicroUsd).toBe(5_000_000);
    // Lowering works, and the visitor cap follows a lowered daily cap.
    const low = loadConfig(env({ ...liveEnv, DAILY_CAP_USD: "0.20", PROJECT_HARD_CAP_USD: "10" }));
    expect(low.caps.dailyMicroUsd).toBe(200_000);
    expect(low.caps.visitorDailyMicroUsd).toBe(200_000);
    expect(low.caps.ticketMicroUsd).toBe(200_000);
    expect(low.caps.projectMicroUsd).toBe(10_000_000);
  });

  it("turns an invalid phase or setting into demo_only with a reason, never a throw", () => {
    const bad = loadConfig(env({ ...liveEnv, BUDGET_PHASE: "Demo" }));
    expect(bad.mode).toBe("demo_only");
    expect(bad.liveBlockedReason).toContain("budget phase is invalid");
    const cap = loadConfig(env({ ...liveEnv, DAILY_CAP_USD: "abc" }));
    expect(cap.mode).toBe("demo_only");
    expect(cap.liveBlockedReason).toContain("DAILY_CAP_USD");
    expect(cap.caps.dailyMicroUsd).toBe(0);
    expect(cap.caps.visitorDailyMicroUsd).toBe(0);
    const limit = loadConfig(env({ ...liveEnv, VISITOR_DAILY_SAM_LIMIT: "-4" }));
    expect(limit.mode).toBe("demo_only");
    expect(limit.caps.visitorSam).toBe(0);
    expect(loadConfig(env({ NODE_ENV: "development", BUDGET_PHASE: "bogus", MOCK: "1" })).mode).toBe("mock");
  });

  it("reports the visitor secret without exposing it", () => {
    expect(loadConfig(env(liveEnv)).visitorSecretConfigured).toBe(true);
    expect(loadConfig(env({ ...liveEnv, VISITOR_HASH_SECRET: "short" })).visitorSecretConfigured).toBe(false);
    expect(JSON.stringify(loadConfig(env(liveEnv)))).not.toContain("s".repeat(32));
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

  describe("live window", () => {
    const win = { ...liveEnv, LIVE_FROM_ET: "2026-11-05", LIVE_UNTIL_ET: "2026-11-09" };
    const modeAt = (e: Record<string, string>, iso: string) => loadConfig(env(e), new Date(iso)).mode;

    it("leaves behaviour unchanged without a window", () => {
      expect(modeAt(liveEnv, "2026-10-30T12:00:00Z")).toBe("live");
      expect(modeAt({ ...liveEnv, LIVE_FROM_ET: "", LIVE_UNTIL_ET: "" }, "2030-01-01T12:00:00Z")).toBe("live");
    });

    it("is live on the first and last day and demo-only the day before and after", () => {
      expect(modeAt(win, "2026-11-05T17:00:00Z")).toBe("live");
      expect(modeAt(win, "2026-11-09T17:00:00Z")).toBe("live");
      expect(modeAt(win, "2026-11-04T17:00:00Z")).toBe("demo_only");
      expect(modeAt(win, "2026-11-10T17:00:00Z")).toBe("demo_only");
      expect(loadConfig(env(win), new Date("2026-11-10T17:00:00Z")).liveBlockedReason).toContain("outside the live window");
    });

    it("uses the Eastern day boundary after the November 1 DST change (EST)", () => {
      expect(modeAt(win, "2026-11-10T04:30:00Z")).toBe("live"); // Nov 9 23:30 ET
      expect(modeAt(win, "2026-11-10T05:00:00Z")).toBe("demo_only"); // Nov 10 00:00 ET
      expect(modeAt(win, "2026-11-05T03:59:00Z")).toBe("demo_only"); // Nov 4 23:59 ET
      expect(modeAt(win, "2026-11-05T05:00:00Z")).toBe("live"); // Nov 5 00:00 ET
    });

    it("turns live off when only one date is set or a value is malformed, without echoing it", () => {
      const at = "2026-11-06T17:00:00Z";
      expect(modeAt({ ...liveEnv, LIVE_FROM_ET: "2026-11-05" }, at)).toBe("demo_only");
      expect(modeAt({ ...liveEnv, LIVE_UNTIL_ET: "2026-11-09" }, at)).toBe("demo_only");
      for (const bad of ["2026-13-01", "2026-02-30", "11/05/2026", "2026-1-5", " 2026-11-05"]) {
        const c = loadConfig(env({ ...win, LIVE_FROM_ET: bad }), new Date(at));
        expect(c.mode, bad).toBe("demo_only");
        expect(c.liveBlockedReason).toContain("live window is invalid");
        expect(c.liveBlockedReason).not.toContain(bad);
      }
      expect(modeAt({ ...win, LIVE_FROM_ET: "2026-11-09", LIVE_UNTIL_ET: "2026-11-05" }, at)).toBe("demo_only");
    });
  });
});
