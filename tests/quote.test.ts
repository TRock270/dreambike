// Integer EUR estimate math with literal expected numbers (SPEC 11), plus its invalidation rules.
import { describe, expect, it } from "vitest";
import { MOCK_LABEL } from "@/lib/mocks";
import { newRootVersion, visualChild, activeItems, fitReviewHash, sha256OfText } from "@/lib/project";
import {
  EXAMPLE_LABEL, EXAMPLE_SETTINGS, REAL_SETTINGS_DEFAULT, computeQuote, divRoundHalfUp, grossToNet, laborNet,
  quoteCanonical, suggestFees, vatOf, type QuoteInput,
} from "@/lib/quote";
import { Settings } from "@/lib/contracts";
import type { BuildItemData, FeeData, FitData } from "@/lib/types";

const id = () => crypto.randomUUID();
const H = "a".repeat(64);
const CHECKED = "2026-10-29T10:00:00.000Z";
const NOW = Date.parse(CHECKED) + 3_600_000;
const settings = { ...REAL_SETTINGS_DEFAULT, shopConfirmed: true, hourlyRateNetCents: 10000 };

const fit = (itemId: string, over: Partial<FitData> = {}): FitData => ({
  itemId, status: "ok", approval: "abe", documentCoverage: "covered", inspection: "none",
  eintragung: "not_required", carryDocuments: "not_required", reasons: ["fine"], toMeasure: [],
  extraParts: [], conditions: [], sources: [], confidence: 0.5, ...over,
});
const item = (slot: BuildItemData["slot"], over: Partial<BuildItemData> = {}): BuildItemData => {
  const itemId = id();
  return {
    id: itemId, slot, title: `${slot} item`, spec: [], intent: "paint", product: null, costKind: "part",
    partPriceCents: 11900, taxBasis: "gross", laborMinutes: 90, fit: fit(itemId), fitInputHash: H,
    fitCheckedAt: CHECKED, zeroLaborConfirmed: false, mechanicNotes: "", fitReviewedHash: null,
    originVersionId: id(), ...over,
  };
};
const fee = (over: Partial<FeeData> = {}): FeeData => ({
  id: id(), label: "Allowance", kind: "other", netCents: 10000, itemIds: [], confirmed: true, ...over,
});
const review = (over: Partial<NonNullable<QuoteInput["inspectionReview"]>> = {}) => ({
  fitInputHash: H, decision: "fees_added" as const, notes: "", reviewedAt: CHECKED, ...over,
});

/** Items get their review hash set, so the fixture is fully reviewed. */
async function reviewed(items: BuildItemData[]): Promise<BuildItemData[]> {
  return Promise.all(items.map(async (i) => ({ ...i, fitReviewedHash: await fitReviewHash(i) })));
}
async function inputFor(items: BuildItemData[], over: Partial<QuoteInput> = {}): Promise<QuoteInput> {
  return {
    items, fees: [fee()], inspectionReview: review(), settings, currentFitInputHash: H,
    now: NOW, ...over,
  };
}
async function baseInput(over: Partial<QuoteInput> = {}): Promise<QuoteInput> {
  return inputFor(await reviewed([item("tank")]), over);
}

describe("rounding helpers", () => {
  it("rounds half up on integers", () => {
    expect(divRoundHalfUp(1, 2)).toBe(1);
    expect(divRoundHalfUp(5, 10)).toBe(1);
    expect(divRoundHalfUp(4, 10)).toBe(0);
    expect(grossToNet(11900)).toBe(10000);
    expect(grossToNet(1)).toBe(1);
    expect(grossToNet(59)).toBe(50);
    expect(grossToNet(60)).toBe(50);
    expect(grossToNet(179)).toBe(150);
    expect(laborNet(10000, 90)).toBe(15000);
    expect(laborNet(10001, 1)).toBe(167);
    // exactly .5 rounds up, just below stays down
    expect(laborNet(1, 30)).toBe(1);
    expect(laborNet(3, 10)).toBe(1);
    expect(laborNet(1, 29)).toBe(0);
    expect(laborNet(3, 9)).toBe(0);
    expect(vatOf(50)).toBe(10);
    expect(vatOf(1)).toBe(0);
    expect(vatOf(35000)).toBe(6650);
  });
});

describe("computeQuote", () => {
  it("required fixture: 119.00 gross part, 90 min at 100.00/h, one 100.00 allowance", async () => {
    const q = await computeQuote(await baseInput());
    expect(q.lines[0]).toMatchObject({ partNetCents: 10000, laborNetCents: 15000, netCents: 25000, defaultMinutes: false });
    expect(q).toMatchObject({
      incomplete: false, exclusions: [], netCents: 35000, vatCents: 6650, grossCents: 41650,
      taxableNetCents: 35000, officialFeeCents: 0, feeNetCents: 10000, knownSubtotalNetCents: 35000,
    });
    expect(q.inputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("a second part with unknown price or basis keeps the known subtotal and nulls the totals", async () => {
    for (const bad of [{ partPriceCents: null }, { taxBasis: "unknown" as const }]) {
      const items = await reviewed([item("tank"), item("seat", bad)]);
      const q = await computeQuote(await inputFor(items));
      expect(q.incomplete).toBe(true);
      expect(q.knownSubtotalNetCents).toBe(35000); // a line with an unknown part has no known net
      expect(q).toMatchObject({ netCents: null, vatCents: null, grossCents: null, taxableNetCents: null });
      expect(q.exclusions.join()).toMatch(/seat item/);
    }
    // The spec fixture: the unknown part has no labor either, so the subtotal stays 35000.
    const items = await reviewed([item("tank"), item("seat", { partPriceCents: null, laborMinutes: null })]);
    const q = await computeQuote(await inputFor(items));
    expect(q).toMatchObject({ knownSubtotalNetCents: 35000, netCents: null, grossCents: null, incomplete: true });
  });

  it("net price is used as entered; labor_only needs its confirmed zero", async () => {
    const net = await computeQuote(await inputFor(await reviewed([item("tank", { taxBasis: "net", partPriceCents: 7777 })])));
    expect(net.lines[0]!.partNetCents).toBe(7777);
    const lo = await computeQuote(await inputFor(await reviewed([item("tank", { costKind: "labor_only", partPriceCents: 0, taxBasis: "net" })])));
    expect(lo.lines[0]).toMatchObject({ partNetCents: 0, netCents: 15000 });
    const unconfirmed = await computeQuote(await inputFor(await reviewed([item("tank", { costKind: "labor_only", partPriceCents: null })])));
    expect(unconfirmed.incomplete).toBe(true);
    expect(unconfirmed.lines[0]!.partNetCents).toBeNull();
  });

  it("zero labor needs the confirmation and a note", async () => {
    const zero = (over: Partial<BuildItemData>) => reviewed([item("tank", { laborMinutes: 0, ...over })]);
    const no = await computeQuote(await inputFor(await zero({})));
    expect(no.incomplete).toBe(true);
    expect(no.lines[0]!.laborNetCents).toBeNull();
    const onlyBox = await computeQuote(await inputFor(await zero({ zeroLaborConfirmed: true, mechanicNotes: "  " })));
    expect(onlyBox.incomplete).toBe(true);
    const ok = await computeQuote(await inputFor(await zero({ zeroLaborConfirmed: true, mechanicNotes: "Customer fits it" })));
    expect(ok.lines[0]).toMatchObject({ laborNetCents: 0, netCents: 10000 });
    expect(ok).toMatchObject({ incomplete: false, netCents: 20000, vatCents: 3800, grossCents: 23800 });
  });

  it("null minutes use the slot default and are flagged; no default or no rate is unresolved", async () => {
    const withDefault = { ...settings, laborBySlot: [{ slot: "tank" as const, minutes: 120 }] };
    const items = await reviewed([item("tank", { laborMinutes: null })]);
    const q = await computeQuote(await inputFor(items, { settings: withDefault }));
    expect(q.lines[0]).toMatchObject({ laborNetCents: 20000, defaultMinutes: true });
    expect(q.incomplete).toBe(false);
    const none = await computeQuote(await inputFor(items));
    expect(none.incomplete).toBe(true);
    expect(none.lines[0]).toMatchObject({ laborNetCents: null, defaultMinutes: false });
    const noRate = await computeQuote(await baseInput({ settings: { ...settings, hourlyRateNetCents: null } }));
    expect(noRate.incomplete).toBe(true);
    expect(noRate.lines[0]!.laborNetCents).toBeNull();
  });

  it("an unconfirmed shop or an empty sheet is incomplete", async () => {
    const q = await computeQuote(await baseInput({ settings: { ...settings, shopConfirmed: false } }));
    expect(q).toMatchObject({ incomplete: true, netCents: null });
    const empty = await computeQuote(await inputFor([], { fees: [] }));
    expect(empty).toMatchObject({ incomplete: true, grossCents: null });
  });

  it("official_fee counts in net but not in VAT", async () => {
    const q = await computeQuote(await baseInput({ fees: [fee(), fee({ kind: "official_fee", netCents: 1500, label: "Zulassungsstelle" })] }));
    expect(q).toMatchObject({
      incomplete: false, netCents: 36500, taxableNetCents: 35000, vatCents: 6650, grossCents: 43150,
      officialFeeCents: 1500, feeNetCents: 11500,
    });
  });

  it("one confirmed inspection fee listing two items is counted once", async () => {
    const mk = (slot: BuildItemData["slot"]) => {
      const t = item(slot);
      return { ...t, fit: fit(t.id, { inspection: "aenderungsabnahme" }) };
    };
    const a = mk("tank"); const b = mk("seat");
    const input = await inputFor(await reviewed([a, b]), {
      fees: [fee({ kind: "aenderungsabnahme", netCents: 5042, itemIds: [a.id, b.id] })],
    });
    const q = await computeQuote(input);
    // 2 x (100.00 part + 150.00 labor) + 50.42 once
    expect(q).toMatchObject({ incomplete: false, feeNetCents: 5042, netCents: 55042, vatCents: 10458, grossCents: 65500 });
  });

  it("unconfirmed or null-amount fees are unresolved and never counted as 0", async () => {
    const un = await computeQuote(await baseInput({ fees: [fee(), fee({ confirmed: false })] }));
    expect(un).toMatchObject({ incomplete: true, netCents: null, feeNetCents: null, knownSubtotalNetCents: 35000 });
    const nul = await computeQuote(await baseInput({ fees: [fee(), fee({ netCents: null })] }));
    expect(nul).toMatchObject({ incomplete: true, grossCents: null, knownSubtotalNetCents: 35000 });
  });

  it("duplicate-slot replacement counts only the new item", async () => {
    const root = newRootVersion({ id: id(), projectId: id(), image: { id: id(), hash: H, width: 10, height: 10, bytes: 1, rights: "owner" }, createdAt: 0 });
    const step = (title: string, createdAt: number) => ({
      versionId: id(), itemId: id(), createdAt, slot: "tank" as const, mode: "text" as const,
      instruction: { title, editPrompt: "p", spec: [], intent: "paint" as const, warnings: [] },
      image: root.image, composite: { composed: true, aligned: true, drift: 0, reason: "composited" as const }, refreshedPart: null,
    });
    const v1 = visualChild(root, step("Red tank", 1));
    const v2 = visualChild(v1, step("Blue tank", 2));
    const priced = activeItems(v2).map((i) => ({ ...i, partPriceCents: 11900, taxBasis: "gross" as const, laborMinutes: 90 }));
    const q = await computeQuote(await inputFor(priced, { fees: [], inspectionReview: review({ decision: "none" }) }));
    expect(q.lines).toHaveLength(1);
    expect(q.lines[0]!.label).toBe("Blue tank");
    // fits were never checked on a fresh item, so the quote is incomplete but counts one line only
    expect(q.knownSubtotalNetCents).toBe(25000);
  });
});

describe("invalidation (SPEC 9, 11)", () => {
  it("a changed current fit hash makes it incomplete and lists the stale item", async () => {
    const input = await baseInput();
    const q = await computeQuote({ ...input, currentFitInputHash: "b".repeat(64) });
    expect(q.incomplete).toBe(true);
    expect(q.staleFitItemIds).toEqual([input.items[0]!.id]);
    expect(q.netCents).toBeNull();
  });

  it("a mock fit is incomplete even when reviewed", async () => {
    const t = item("tank");
    const mock = { ...t, fit: fit(t.id, { reasons: [`${MOCK_LABEL}. No research.`] }) };
    const q = await computeQuote(await inputFor(await reviewed([mock])));
    expect(q.incomplete).toBe(true);
    expect(q.exclusions.join()).toMatch(/mock/);
  });

  it("an unreviewed fit is incomplete", async () => {
    const q = await computeQuote(await inputFor([item("tank")]));
    expect(q.incomplete).toBe(true);
    expect(q.exclusions.join()).toMatch(/not reviewed/);
  });

  it("a recheck clears the acknowledgment", async () => {
    const [t] = await reviewed([item("tank")]);
    const rechecked = { ...t!, fitCheckedAt: "2026-10-29T10:30:00.000Z" };
    const q = await computeQuote(await inputFor([rechecked]));
    expect(q.incomplete).toBe(true);
    expect(q.exclusions.join()).toMatch(/not reviewed/);
  });

  it("a stale inspection review is incomplete; so are missing and unresolved ones", async () => {
    const stale = await computeQuote(await baseInput({ inspectionReview: review({ fitInputHash: "c".repeat(64) }) }));
    expect(stale.incomplete).toBe(true);
    expect((await computeQuote(await baseInput({ inspectionReview: null }))).incomplete).toBe(true);
    expect((await computeQuote(await baseInput({ inspectionReview: review({ decision: "unresolved" }) }))).incomplete).toBe(true);
    const none = await computeQuote(await baseInput({ inspectionReview: review({ decision: "none" }), fees: [] }));
    expect(none).toMatchObject({ incomplete: false, netCents: 25000, vatCents: 4750, grossCents: 29750 });
  });

  it("fees_added needs a confirmed fee line", async () => {
    const q = await computeQuote(await baseInput({ fees: [] }));
    expect(q.incomplete).toBe(true);
    const unconfirmedOnly = await computeQuote(await baseInput({ fees: [fee({ confirmed: false })] }));
    expect(unconfirmedOnly.incomplete).toBe(true);
  });

  it("a fit that needs an inspection also needs a confirmed fee of that kind listing the item", async () => {
    const t = item("tank");
    const needs = { ...t, fit: fit(t.id, { inspection: "aenderungsabnahme" as const }) };
    const items = await reviewed([needs]);
    const withoutKind = await computeQuote(await inputFor(items));
    expect(withoutKind.incomplete).toBe(true);
    const covered = await computeQuote(await inputFor(items, {
      fees: [fee({ kind: "aenderungsabnahme", itemIds: [needs.id], netCents: 5042 })],
    }));
    expect(covered).toMatchObject({ incomplete: false, netCents: 30042, vatCents: 5708, grossCents: 35750 });
    const otherItem = await computeQuote(await inputFor(items, {
      fees: [fee({ kind: "aenderungsabnahme", itemIds: [id()], netCents: 5042 })],
    }));
    expect(otherItem.incomplete).toBe(true);
  });

  it("a price edit keeps the fit valid; an expired check needs a new review and then counts but is listed", async () => {
    const input = await baseInput();
    const edited = [{ ...input.items[0]!, partPriceCents: 23800 }];
    const q = await computeQuote({ ...input, items: edited });
    expect(q).toMatchObject({ incomplete: false, netCents: 45000, staleFitItemIds: [] });
    const lateNow = Date.parse(CHECKED) + 25 * 3_600_000;
    // A review given before expiry does not review the expired check.
    const late = await computeQuote({ ...input, now: lateNow });
    expect(late.incomplete).toBe(true);
    expect(late.staleFitItemIds).toEqual([input.items[0]!.id]);
    // Acknowledging again on the stale fit counts, and the item stays listed as stale.
    const again = [{ ...input.items[0]!, fitReviewedHash: await fitReviewHash(input.items[0]!, true) }];
    const ok = await computeQuote({ ...input, items: again, now: lateNow });
    expect(ok.incomplete).toBe(false);
    expect(ok.staleFitItemIds).toEqual([input.items[0]!.id]);
  });
});

describe("suggestFees", () => {
  const needing = (kind: "aenderungsabnahme" | "einzelabnahme", slot: BuildItemData["slot"], over: Partial<FitData> = {}) => {
    const t = item(slot);
    return { ...t, fit: fit(t.id, { inspection: kind, ...over }) };
  };
  const s = { ...settings, aenderungsabnahmeNetCents: 5042, einzelabnahmeNetCents: 15126, officialFeeCents: 1500 };

  it("two items needing Änderungsabnahme give one line with both ids, plus the official fee", () => {
    const a = needing("aenderungsabnahme", "tank"); const b = needing("aenderungsabnahme", "seat");
    const out = suggestFees([a, b], [], s, id);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: "aenderungsabnahme", netCents: 5042, confirmed: false, itemIds: [a.id, b.id] });
    expect(out[1]).toMatchObject({ kind: "official_fee", netCents: 1500, confirmed: false });
    expect(out.every((f) => /^[0-9a-f-]{36}$/.test(f.id))).toBe(true);
  });

  it("example-rate suggestions carry an example label that fits Short", () => {
    const a = needing("aenderungsabnahme", "tank");
    const out = suggestFees([a], [], { ...s, demoRates: true }, id);
    expect(out.map((f) => f.label.endsWith(" \u2014 example rate"))).toEqual([true, true]);
    expect(out.every((f) => f.label.length <= 200)).toBe(true);
    expect(suggestFees([a], [], s, id).some((f) => f.label.includes("example"))).toBe(false);
  });

  it("gives nothing for a kind that already exists, and no second official fee", () => {
    const a = needing("aenderungsabnahme", "tank");
    const existing = [fee({ kind: "aenderungsabnahme" }), fee({ kind: "official_fee" })];
    expect(suggestFees([a], existing, s, id)).toEqual([]);
  });

  it("einzelabnahme gets its own line; null amounts stay null; eintragung alone asks for the official fee", () => {
    const e = needing("einzelabnahme", "tank");
    const out = suggestFees([e], [], { ...s, einzelabnahmeNetCents: null, officialFeeCents: null }, id);
    expect(out.map((f) => [f.kind, f.netCents])).toEqual([["einzelabnahme", null], ["official_fee", null]]);
    const reg = item("seat"); const regItem = { ...reg, fit: fit(reg.id, { eintragung: "required" }) };
    expect(suggestFees([regItem], [], s, id).map((f) => f.kind)).toEqual(["official_fee"]);
    expect(suggestFees([item("seat")], [], s, id)).toEqual([]);
  });
});

describe("settings records", () => {
  it("real default carries none of the example values", () => {
    expect(Settings.safeParse(REAL_SETTINGS_DEFAULT).success).toBe(true);
    expect(Settings.safeParse(EXAMPLE_SETTINGS).success).toBe(true);
    expect(REAL_SETTINGS_DEFAULT).toMatchObject({
      shopConfirmed: false, shopName: "DreamBike workshop", hourlyRateNetCents: null, officialFeeCents: null,
      aenderungsabnahmeNetCents: null, einzelabnahmeNetCents: null, laborBySlot: [], demoRates: false,
    });
    expect(REAL_SETTINGS_DEFAULT.shopName).not.toBe(EXAMPLE_SETTINGS.shopName);
  });

  it("example record has the owner's values and a visible label", () => {
    expect(EXAMPLE_LABEL).toBe("Example shop — illustrative rates");
    expect(EXAMPLE_SETTINGS).toMatchObject({
      shopName: "Nordwerk Customs", demoRates: true, shopConfirmed: true, hourlyRateNetCents: 10000,
      aenderungsabnahmeNetCents: 5042, einzelabnahmeNetCents: 15126, officialFeeCents: 1500, shopRules: [],
    });
    const min = Object.fromEntries(EXAMPLE_SETTINGS.laborBySlot.map((l) => [l.slot, l.minutes]));
    expect(min).toMatchObject({
      tank: 120, wheel_front: 180, wheel_rear: 180, sissy_bar: 300, handlebar: 60, grips: 150,
      fender_front: 180, fender_rear: 180, exhaust: 480, fork: 240, seat: 30, frame: 720,
    });
    expect("custom" in min).toBe(false);
  });
});

describe("quote hash", () => {
  const hashOf = async (i: QuoteInput) => sha256OfText(quoteCanonical(i));

  it("changes on price, basis, minutes, rate, fee and fit-status changes", async () => {
    const input = await baseInput();
    const base = await hashOf(input);
    const one = input.items[0]!;
    const variants: QuoteInput[] = [
      { ...input, items: [{ ...one, partPriceCents: 12000 }] },
      { ...input, items: [{ ...one, taxBasis: "net" }] },
      { ...input, items: [{ ...one, laborMinutes: 91 }] },
      { ...input, settings: { ...settings, hourlyRateNetCents: 10100 } },
      { ...input, fees: [fee({ netCents: 10100 })] },
      { ...input, fees: [] },
      { ...input, now: Date.parse(CHECKED) + 25 * 3_600_000 },           // fit expired
      { ...input, currentFitInputHash: "b".repeat(64) },
      { ...input, settings: { ...settings, shopConfirmed: false } },
      { ...input, settings: { ...settings, officialFeeCents: 1500 } },
      { ...input, settingsId: "example" },
      { ...input, inspectionReview: review({ decision: "none" }) },
    ];
    for (const v of variants) expect(await hashOf(v)).not.toBe(base);
  });

  it("ignores mechanic notes on a non-zero-labor item and item order", async () => {
    const items = await reviewed([item("tank"), item("seat")]);
    const input = await inputFor(items);
    const base = await hashOf(input);
    const noted = { ...input, items: items.map((i) => ({ ...i, mechanicNotes: "just a note" })) };
    expect(await hashOf(noted)).toBe(base);
    expect(await hashOf({ ...input, items: [...items].reverse() })).toBe(base);
  });

  it("changes with the notes of a zero-labor item", async () => {
    const z = (n: string) => item("tank", { laborMinutes: 0, zeroLaborConfirmed: true, mechanicNotes: n });
    const a = z("one"); const b = { ...a, mechanicNotes: "two" };
    expect(await hashOf(await inputFor([a]))).not.toBe(await hashOf(await inputFor([b])));
  });
});
