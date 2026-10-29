// Server fit post-validation: model outputs that claim "ok" must not survive without evidence.
import { describe, expect, it } from "vitest";
import { FIT_PRECHECK_NOTE, LEGAL_SEED, buildFitTask, legalAsOf, normalizeUrl, postValidate, type FitContext } from "@/lib/server/fitPolicy";
import type { BikeData, BuildItemData } from "@/lib/types";

const id = () => crypto.randomUUID();
const HASH = "a".repeat(64);
const NOW = Date.parse("2026-10-29T12:00:00.000Z");
const bike = (over: Partial<BikeData> = {}): BikeData => ({
  make: null, model: null, family: "unknown", engine: null, yearFrom: null, yearTo: null,
  abs: "unknown", style: null, facing: "left", confidence: 0.5, limitations: [], ...over,
});
const known = bike({ make: "BMW", model: "R nineT", yearFrom: 2014, yearTo: 2016, abs: "yes" });
const SPECIFIC = "https://example-parts.de/exhaust/abc";

/** A model answer that claims ok with strong confidence and everything resolved. */
const claimsOk = (itemId: string, over: Record<string, unknown> = {}) => ({
  itemId, status: "ok", approval: "abe", documentCoverage: "covered", inspection: "none",
  eintragung: "not_required", carryDocuments: "required", reasons: ["Looks fine."], toMeasure: [],
  extraParts: [], conditions: [], confidence: 0.99,
  sources: [{ url: SPECIFIC, title: "Maker page", supports: "ABE listed" }], ...over,
});
const evidenceFor = (...urls: string[]) => ({ citations: urls.map((url) => ({ url })), results: [] });
const ctx = (itemId: string, slot: FitContext["items"][number]["slot"], b = bike(), approvalText: string | null = null): FitContext =>
  ({ items: [{ id: itemId, slot, approvalText }], bike: b });

function run(itemId: string, slot: FitContext["items"][number]["slot"], output: Record<string, unknown>, b = bike(), urls = [SPECIFIC], approvalText: string | null = null) {
  const r = postValidate([itemId], { results: [output] }, evidenceFor(...urls), NOW, HASH, ctx(itemId, slot, b, approvalText));
  if (!r.ok) throw new Error(r.message);
  return r.response.results[0]!;
}

describe("legal seed and note", () => {
  it("carries the three verified sources and not section 19", () => {
    expect(LEGAL_SEED.sources).toHaveLength(3);
    expect(LEGAL_SEED.sources[0].url).toContain("tuv.com");
    expect(LEGAL_SEED.sources[1].url.endsWith("__72.html")).toBe(true);
    expect(LEGAL_SEED.sources[2].url.endsWith("__21.html")).toBe(true);
    expect(LEGAL_SEED.sources.some((s) => s.url.includes("__19"))).toBe(false);
    expect(FIT_PRECHECK_NOTE).toBe("Pre-check only. The shop and inspection authority must verify fit and road-use requirements.");
    expect(legalAsOf(new Date("2026-10-29T02:00:00Z"))).toBe("2026-10-28"); // ET date
  });
});

describe("postValidate downgrades", () => {
  it("handlebar with unknown model/year asks for clamp and cable/hose/wiring measurements", () => {
    const itemId = id();
    const r = run(itemId, "handlebar", claimsOk(itemId, { approval: "abe" }));
    expect(r.status).toBe("verify");
    expect(r.toMeasure.join(" ")).toMatch(/clamp/i);
    expect(r.toMeasure.join(" ")).toMatch(/cable.*hose.*wiring/i);
  });

  it("a claim about clamp size in the reasons does not replace the measurement", () => {
    const itemId = id();
    const r = run(itemId, "handlebar", claimsOk(itemId, { reasons: ["Standard 1 inch clamp and cable length fit."] }));
    expect(r.status).toBe("verify");
    expect(r.toMeasure.length).toBe(2);
  });

  it("US exhaust without papers is verify or problem with inspector review, never ok", () => {
    const itemId = id();
    const r = run(itemId, "exhaust", claimsOk(itemId, { approval: "none", inspection: "none", documentCoverage: "not_covered" }), known);
    expect(["verify", "problem"]).toContain(r.status);
    expect(r.status).not.toBe("ok");
    expect(r.inspection).toBe("unknown"); // inspection none is not accepted without approval
    expect(r.conditions.join(" ")).toMatch(/inspector/i);
  });

  it("ABE with an inspection condition is not plain ok and not inspection none", () => {
    const itemId = id();
    const r = run(itemId, "seat", claimsOk(itemId, { approval: "abe", inspection: "aenderungsabnahme" }), known);
    expect(r.status).toBe("verify");
    expect(r.inspection).toBe("aenderungsabnahme");
    expect(r.approval).toBe("abe");
  });

  it("ok with inspection none is refused when the model's own condition names an inspection", () => {
    const itemId = id();
    const r = run(itemId, "seat", claimsOk(itemId, { conditions: ["ABE only valid with Änderungsabnahme for this frame"] }), known);
    expect(r.status).toBe("verify");
    expect(r.inspection).not.toBe("none");
  });

  it("ok with inspection none is refused when the product's approval text carries an Auflage", () => {
    const itemId = id();
    const r = run(itemId, "seat", claimsOk(itemId), known, [SPECIFIC], "ABE KBA 12345; Auflage: Abnahme nach §19(3) erforderlich");
    expect(r.status).toBe("verify");
    expect(r.inspection).toBe("unknown");
  });

  it("a model text that denies the need does not remove the exhaust limitations", () => {
    const itemId = id();
    const r = run(itemId, "exhaust", claimsOk(itemId, { approval: "none", documentCoverage: "not_covered", reasons: ["No TÜV inspection or documents are needed; no ECU mapping change."] }), known);
    const text = r.conditions.join(" ");
    expect(text).toMatch(/inspector must review/i);
    expect(text).toMatch(/papers/i);
    expect(text).toMatch(/intake/i);
  });

  it("a wheel's fender clearance condition stays when the model denies it", () => {
    const itemId = id();
    const r = run(itemId, "wheel_rear", claimsOk(itemId, { reasons: ["Fender clearance is not an issue"] }), known);
    expect(r.conditions.join(" ")).toMatch(/fender/i);
  });

  it("a handlebar on a known bike still needs a cable reach measurement when only the reasons claim it", () => {
    const itemId = id();
    const r = run(itemId, "handlebar", claimsOk(itemId, { reasons: ["Stock cables and wiring reach with this rise."] }), known);
    expect(r.status).toBe("verify");
    expect(r.toMeasure.join(" ")).toMatch(/cable.*hose.*wiring/i);
    expect(r.toMeasure.join(" ")).not.toMatch(/clamp/i);
  });

  it("a wheel swap with unknown ABS is verify", () => {
    const itemId = id();
    const r = run(itemId, "wheel_front", claimsOk(itemId), bike({ model: "R nineT", yearFrom: 2014, yearTo: 2016 }));
    expect(r.status).toBe("verify");
    expect(r.toMeasure.join(" ")).toMatch(/ABS/);
    expect(r.conditions.join(" ")).toMatch(/fender/i);
  });

  it("unsupported URLs are removed and cannot keep ok", () => {
    const itemId = id();
    const r = run(itemId, "seat", claimsOk(itemId), known, ["https://example-parts.de/other"]);
    expect(r.sources).toEqual([]);
    expect(r.status).toBe("verify");
  });

  it("same host with another path is stripped; fragment and host case do not matter", () => {
    expect(normalizeUrl("HTTPS://Example-Parts.DE/exhaust/abc#top")).toBe(SPECIFIC);
    const itemId = id();
    const r = run(itemId, "seat", claimsOk(itemId, {
      sources: [
        { url: "https://example-parts.de/exhaust/abc#spec", title: "Page", supports: "x" },
        { url: "https://example-parts.de/exhaust/zzz", title: "Other path", supports: "x" },
      ],
    }), known);
    expect(r.sources.map((s) => s.url)).toEqual(["https://example-parts.de/exhaust/abc#spec"]);
    expect(r.sources[0]!.accessedAt).toBe("2026-10-29T12:00:00.000Z");
    expect(r.status).toBe("ok");
  });

  it("a general StVZO link alone cannot keep ok", () => {
    const itemId = id();
    const general = LEGAL_SEED.sources[1].url;
    const r = run(itemId, "seat", claimsOk(itemId, { sources: [{ url: general, title: "StVZO", supports: "law" }] }), known, [general]);
    expect(r.sources).toHaveLength(1);
    expect(r.status).toBe("verify");
  });

  it("any grounded page on a law or authority host is general and cannot keep ok", () => {
    for (const url of ["https://www.gesetze-im-internet.de/stvzo_2012/__19.html", "https://www.gesetze-im-internet.de/stvzo_2012/__72.html?x=1", "https://www.tuv.com/landingpage/de/other"]) {
      const itemId = id();
      const r = run(itemId, "seat", claimsOk(itemId, { sources: [{ url, title: "Law", supports: "law" }] }), known, [url]);
      expect(r.sources).toHaveLength(1);
      expect(r.status, url).toBe("verify");
    }
  });

  it("a fully grounded, resolved answer stays ok; problem is never upgraded", () => {
    const itemId = id();
    expect(run(itemId, "seat", claimsOk(itemId), known).status).toBe("ok");
    expect(run(itemId, "seat", claimsOk(itemId, { status: "problem", approval: "abe" }), known).status).toBe("problem");
  });

  it("every unresolved trigger downgrades ok", () => {
    const itemId = id();
    for (const over of [
      { toMeasure: ["Fork length"] }, { documentCoverage: "unknown" }, { inspection: "unknown" },
      { eintragung: "unknown" }, { approval: "unknown" },
    ]) {
      expect(run(itemId, "seat", claimsOk(itemId, over), known).status, JSON.stringify(over)).toBe("verify");
    }
  });
});

describe("postValidate ids", () => {
  const a = id(), b = id();
  const call = (ids: string[], results: unknown[]) =>
    postValidate(ids, { results }, evidenceFor(SPECIFIC), NOW, HASH, { items: [], bike: known });
  it("accepts the exact set in request order and attaches checkedAt and the caller's hash", () => {
    const r = call([a, b], [claimsOk(b), claimsOk(a)]);
    expect(r.ok && r.response.results.map((x) => x.itemId)).toEqual([a, b]);
    expect(r.ok && r.response.inputHash).toBe(HASH);
    expect(r.ok && r.response.checkedAt).toBe("2026-10-29T12:00:00.000Z");
  });
  it("fails the batch on a duplicate, a missing or an extra id", () => {
    expect(call([a, b], [claimsOk(a), claimsOk(a)]).ok).toBe(false);
    expect(call([a, b], [claimsOk(a)]).ok).toBe(false);
    expect(call([a], [claimsOk(a), claimsOk(b)]).ok).toBe(false);
    expect(call([a], [claimsOk(b)]).ok).toBe(false);
    expect(call([a, a], [claimsOk(a)]).ok).toBe(false);
  });
  it("rejects output that does not match the schema", () => {
    expect(postValidate([a], { results: [{ itemId: a }] }, evidenceFor(), NOW, HASH, { items: [], bike: known }).ok).toBe(false);
  });
});

describe("buildFitTask", () => {
  it("keeps physical fields only", () => {
    const item = {
      id: id(), slot: "seat", title: "Seat", spec: [{ key: "k", value: "v" }], intent: "replace",
      product: { id: id(), name: "P", brand: "B", partNumber: "N1", url: "https://x.de/p", imageUrl: "https://x.de/i.jpg",
        priceText: "1", priceEurCents: 100, taxBasis: "gross", approval: "abe", approvalText: "ABE 123",
        fulfillmentRegion: "eu", source: { url: "https://x.de/p", title: "t", accessedAt: "2026-10-29T00:00:00.000Z", supports: "s" },
        linkState: "reachable" },
      costKind: "part", partPriceCents: 100, taxBasis: "gross", laborMinutes: 30, fit: null, fitInputHash: HASH,
      fitCheckedAt: "2026-10-29T00:00:00.000Z", originVersionId: id(), zeroLaborConfirmed: true,
      mechanicNotes: "private note", fitReviewedHash: HASH,
    } as BuildItemData;
    const task = buildFitTask({
      bike: known, bikeConfirmed: true, inputHash: HASH, items: [item],
      activeBuild: [{ itemId: item.id, slot: "seat", title: "Seat", spec: [] }], shopRules: ["rule"],
    }, new Date("2026-10-29T16:00:00Z"));
    const text = JSON.stringify(task);
    for (const secret of ["private note", "priceEurCents", "laborMinutes", "fitInputHash", "fitCheckedAt", "imageUrl", "inputHash", HASH]) {
      expect(text).not.toContain(secret);
    }
    expect(task.items[0]!.product).toEqual({ name: "P", partNumber: "N1", url: "https://x.de/p", approvalText: "ABE 123" });
    expect(task.legalAsOf).toBe("2026-10-29");
    expect(task.legalSources.length).toBe(3);
  });
});
