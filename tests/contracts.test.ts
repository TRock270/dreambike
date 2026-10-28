import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  Bike, BikeChecked, Box, BudgetResponse, CheckRequest, ErrorResponse, FitResult, HealthResponse,
  Instruction, InstructionPayload, MODEL_FORMATS, SegmentPayload, SegmentResponse, Settings,
  modelJsonSchema,
} from "@/lib/contracts";
import { MOCKS } from "@/lib/mocks";
import { CORE_PHRASES, SLOTS } from "@/lib/slots";

const uuid = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const hash = "a".repeat(64);
const bike = MOCKS.identify.bike;

describe("representative responses validate", () => {
  it("accepts the labeled mocks", () => {
    expect(Bike.parse(MOCKS.identify.bike)).toBeTruthy();
    expect(Instruction.parse(MOCKS.instruction.instruction)).toBeTruthy();
    expect(FitResult.parse(MOCKS.fit)).toBeTruthy();
  });

  it("accepts an error, an empty segmentation, health, and an unavailable budget", () => {
    expect(ErrorResponse.safeParse({ error: { code: "BUDGET_EXCEEDED", message: "Daily budget reached.",
      retryable: false, requestId: uuid, retryAfterSeconds: null } }).success).toBe(true);
    expect(SegmentResponse.safeParse({ width: 2048, height: 1536, objects: [], complete: true,
      warnings: [] }).success).toBe(true);
    expect(HealthResponse.safeParse({ ok: true, mode: "demo_only", accountingReady: false,
      apiConfigured: false }).success).toBe(true);
    expect(BudgetResponse.safeParse({ dayET: "2026-11-01", resetAt: "2026-11-02T05:00:00.000Z",
      liveEnabled: false, spentTodayMicroUsd: null, reservedTodayMicroUsd: null,
      dailyCapMicroUsd: 5_000_000, visitorRemainingMicroUsd: 0, remainingEdits: 0,
      features: { composite: true, reference: true, search: false, voice: false },
      reason: "Live AI is off." }).success).toBe(true);
  });
});

describe("strictness and cross-field checks", () => {
  it("rejects unexpected fields at every level", () => {
    expect(Bike.safeParse({ ...bike, vin: "x" }).success).toBe(false);
    expect(ErrorResponse.safeParse({ error: { code: "FORBIDDEN", message: "No.", retryable: false,
      requestId: uuid, retryAfterSeconds: null, stack: "x" } }).success).toBe(false);
  });

  it("rejects unknown enum values, non-https URLs, and fractional cents", () => {
    expect(Bike.safeParse({ ...bike, family: "vespa" }).success).toBe(false);
    const source = { url: "http://example.com", title: "t", accessedAt: "2026-10-28T00:00:00Z", supports: "" };
    expect(FitResult.safeParse({ ...MOCKS.fit, sources: [source] }).success).toBe(false);
    const s = { shopConfirmed: false, shopName: "DreamBike workshop", logoImageId: null,
      hourlyRateNetCents: 100.5, currency: "EUR", vatBasisPoints: 1900, laborBySlot: [],
      aenderungsabnahmeNetCents: null, einzelabnahmeNetCents: null, preferredShopDomains: [],
      shopRules: [], quoteNotes: "", demoRates: false };
    expect(Settings.safeParse(s).success).toBe(false);
    expect(Settings.safeParse({ ...s, hourlyRateNetCents: 10_000 }).success).toBe(true);
    expect(Settings.safeParse({ ...s, vatBasisPoints: 700 }).success).toBe(false);
  });

  it("rejects a duplicated slot in laborBySlot", () => {
    const s = { shopConfirmed: false, shopName: "x", logoImageId: null, hourlyRateNetCents: null,
      currency: "EUR", vatBasisPoints: 1900, aenderungsabnahmeNetCents: null,
      einzelabnahmeNetCents: null, preferredShopDomains: [], shopRules: [], quoteNotes: "",
      demoRates: false, laborBySlot: [{ slot: "tank", minutes: 240 }, { slot: "tank", minutes: 60 }] };
    expect(Settings.safeParse(s).success).toBe(false);
  });

  it("rejects reversed years", () => {
    expect(BikeChecked.safeParse({ ...bike, yearFrom: 2020, yearTo: 2018 }).success).toBe(false);
    expect(BikeChecked.safeParse({ ...bike, yearFrom: 2018, yearTo: 2020 }).success).toBe(true);
  });

  it("requires boxes inside the image with positive area", () => {
    const p = { slot: "tank", bike, mode: "paint", text: "gloss black", width: 2048, height: 1536 };
    expect(InstructionPayload.safeParse({ ...p, box: [100, 100, 300, 200] }).success).toBe(true);
    expect(InstructionPayload.safeParse({ ...p, box: [100, 100, 2049, 200] }).success).toBe(false);
    expect(InstructionPayload.safeParse({ ...p, box: [300, 100, 300, 200] }).success).toBe(false);
    expect(Box.safeParse([5, 5, 5, 9]).success).toBe(false);
    expect(Box.safeParse([5, 5, 6, 9]).success).toBe(true);
  });

  it("requires point prompts inside the image and at least one positive point", () => {
    const base = { mode: "points", width: 100, height: 50 };
    const pos = { x: 99, y: 49, label: "positive" };
    expect(SegmentPayload.safeParse({ ...base, points: [pos] }).success).toBe(true);
    expect(SegmentPayload.safeParse({ ...base, points: [{ ...pos, x: 100 }] }).success).toBe(false);
    expect(SegmentPayload.safeParse({ ...base, points: [{ ...pos, label: "negative" }] }).success).toBe(false);
  });

  it("limits a fit check batch to three items and requires bike confirmation", () => {
    const item = { zeroLaborConfirmed: false, mechanicNotes: "", fitReviewedHash: null, id: uuid,
      slot: "exhaust", title: "Slip-on", spec: [], intent: "replace", product: null,
      costKind: "part", partPriceCents: null, taxBasis: "unknown", laborMinutes: 90, fit: null,
      fitInputHash: null, fitCheckedAt: null, originVersionId: uuid };
    const req = { bike, bikeConfirmed: true, inputHash: hash, items: [item], activeBuild: [], shopRules: [] };
    expect(CheckRequest.safeParse(req).success).toBe(true);
    expect(CheckRequest.safeParse({ ...req, items: [item, item, item, item] }).success).toBe(false);
    expect(CheckRequest.safeParse({ ...req, bikeConfirmed: false }).success).toBe(false);
  });
});

describe("Spark strict schemas", () => {
  const dir = path.join(process.cwd(), "prompts", "schemas");

  it("every object is closed and lists every key as required", () => {
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node === null || typeof node !== "object") return;
      const o = node as Record<string, unknown>;
      if (o.type === "object") {
        expect(o.additionalProperties).toBe(false);
        expect([...(o.required as string[])].sort()).toEqual(Object.keys(o.properties as object).sort());
      }
      Object.values(o).forEach(walk);
    };
    for (const name of Object.keys(MODEL_FORMATS) as (keyof typeof MODEL_FORMATS)[]) {
      walk(modelJsonSchema(name));
    }
  });

  it("committed schema files equal the Zod-generated schemas (UPDATE_SCHEMAS=1 rewrites)", () => {
    for (const name of Object.keys(MODEL_FORMATS) as (keyof typeof MODEL_FORMATS)[]) {
      const file = path.join(dir, `${name}.json`);
      const generated = JSON.stringify(modelJsonSchema(name), null, 2) + "\n";
      if (process.env.UPDATE_SCHEMAS === "1") writeFileSync(file, generated);
      expect(readFileSync(file, "utf8")).toBe(generated);
    }
  });
});

describe("slots", () => {
  it("has 14 distinct core SAM phrases and fixed series by group", () => {
    expect(CORE_PHRASES).toHaveLength(14);
    const series = Object.fromEntries(SLOTS.map((s) => [s.id, s.series]));
    expect([series.wheel_front, series.wheel_rear, series.fork, series.tank, series.fender_rear,
      series.handlebar, series.exhaust, series.engine, series.seat, series.frame, series.custom])
      .toEqual([1, 1, 2, 3, 3, 4, 5, 6, 7, 8, 8]);
    expect(SLOTS.filter((s) => s.paintOnly).map((s) => s.id).sort()).toEqual(["engine", "frame"]);
  });
});
