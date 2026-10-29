// Settings records and the integer EUR estimate (SPEC 11). Pure: no React, no IndexedDB.
// Everything is integer cents, rounded half up. An unknown value is never counted as 0:
// it makes the quote incomplete and the totals null.
import { fitReviewHash, fitStatusOf, sha256OfText, stableJson } from "./project";
import { MOCK_LABEL } from "./mocks";
import { SLOTS } from "./slots";
import type {
  BuildItemData, FeeData, InspectionReviewData, Quote, QuoteLine, ShopSettings, SlotId,
} from "./types";

// ------------------------------------------------------------------- settings

/** SPEC 11: a new real shop record. Nothing is invented; the mechanic must enter the values. */
export const REAL_SETTINGS_DEFAULT: ShopSettings = {
  shopConfirmed: false, shopName: "DreamBike workshop", logoImageId: null,
  hourlyRateNetCents: null, currency: "EUR", vatBasisPoints: 1900, laborBySlot: [],
  aenderungsabnahmeNetCents: null, einzelabnahmeNetCents: null, officialFeeCents: null,
  preferredShopDomains: [], shopRules: [], quoteNotes: "", demoRates: false,
};

export const EXAMPLE_LABEL = "Example shop — illustrative rates";

/** Owner's own minutes (SPEC 11 note of 2026-10-29); every other slot keeps the illustrative default. */
const EXAMPLE_MINUTES: Partial<Record<SlotId, number>> = {
  tank: 120, wheel_front: 180, wheel_rear: 180, sissy_bar: 300, handlebar: 60, grips: 150,
  fender_front: 180, fender_rear: 180, exhaust: 480,
};

export const EXAMPLE_SETTINGS: ShopSettings = {
  shopConfirmed: true, shopName: "Nordwerk Customs", logoImageId: null,
  hourlyRateNetCents: 10000, currency: "EUR", vatBasisPoints: 1900,
  laborBySlot: SLOTS.flatMap((s) => {
    const minutes = EXAMPLE_MINUTES[s.id] ?? s.defaultMinutes;
    return minutes === null ? [] : [{ slot: s.id, minutes }];
  }),
  aenderungsabnahmeNetCents: 5042, einzelabnahmeNetCents: 15126, officialFeeCents: 1500,
  preferredShopDomains: [], shopRules: [], quoteNotes: "", demoRates: true,
};

// ------------------------------------------------------------- integer rounding

/** round(a / b) with halves rounding up, for nonnegative integers. No floats. */
export function divRoundHalfUp(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b));
}
export const grossToNet = (grossCents: number): number => divRoundHalfUp(grossCents * 100, 119);
export const laborNet = (rateNetCents: number, minutes: number): number => divRoundHalfUp(rateNetCents * minutes, 60);
export const vatOf = (netCents: number): number => divRoundHalfUp(netCents * 19, 100);

// ------------------------------------------------------------------- the quote

export type QuoteInput = {
  /** Active items only (one per slot). */
  items: readonly BuildItemData[];
  fees: readonly FeeData[];
  inspectionReview: InspectionReviewData | null;
  settings: ShopSettings;
  /** The fit input hash of the current build; null when it could not be computed. */
  currentFitInputHash: string | null;
  /** Milliseconds; used for the 24 h fit expiry. */
  now: number;
  /** Which settings record is in use ("default" or "example"). Only feeds the quote hash. */
  settingsId?: string;
};

const INSPECTION_KINDS = ["aenderungsabnahme", "einzelabnahme"] as const;
const INSPECTION_NAME = { aenderungsabnahme: "Änderungsabnahme", einzelabnahme: "Einzelabnahme" } as const;

const isMockFit = (item: BuildItemData) => item.fit !== null && item.fit.reasons.some((r) => r.includes(MOCK_LABEL));

/** Minutes the quote uses for an item: its own, else the shop's slot default (flagged). */
function minutesFor(item: BuildItemData, settings: ShopSettings): { minutes: number | null; isDefault: boolean } {
  if (item.laborMinutes !== null) return { minutes: item.laborMinutes, isDefault: false };
  const def = settings.laborBySlot.find((l) => l.slot === item.slot);
  return def ? { minutes: def.minutes, isDefault: true } : { minutes: null, isDefault: false };
}

function partNetOf(item: BuildItemData, why: string[]): number | null {
  if (item.costKind === "labor_only") {
    if (item.partPriceCents === 0) return 0;
    why.push("labor-only part amount is not confirmed as 0");
    return null;
  }
  if (item.partPriceCents === null) { why.push("part price unknown"); return null; }
  // Unknown basis stays unresolved even with a number.
  if (item.taxBasis === "net") return item.partPriceCents;
  if (item.taxBasis === "gross") return grossToNet(item.partPriceCents);
  why.push("tax basis of the part price unknown");
  return null;
}

function laborNetOf(item: BuildItemData, settings: ShopSettings, why: string[]): { net: number | null; isDefault: boolean } {
  const { minutes, isDefault } = minutesFor(item, settings);
  if (minutes === null) { why.push("labor minutes unknown"); return { net: null, isDefault }; }
  if (minutes === 0 && !(item.zeroLaborConfirmed && item.mechanicNotes.trim() !== "")) {
    why.push("zero labor needs the confirmation and a note");
    return { net: null, isDefault };
  }
  if (settings.hourlyRateNetCents === null) { why.push("hourly rate not set"); return { net: null, isDefault }; }
  return { net: laborNet(settings.hourlyRateNetCents, minutes), isDefault };
}

/** Fit problems that stop a complete estimate. Returns whether the fit counts as stale for the notice. */
async function fitReasons(
  item: BuildItemData, input: QuoteInput, why: string[],
): Promise<boolean> {
  if (item.fit === null) { why.push("fit not checked"); return false; }
  const hashMatches = input.currentFitInputHash !== null && item.fitInputHash === input.currentFitInputHash;
  if (!hashMatches) why.push("fit check is out of date (bike, parts or rules changed)");
  if (isMockFit(item)) why.push("fit result is mock data, not a real check");
  const expired = hashMatches && fitStatusOf(item, input.currentFitInputHash!, input.now) === "stale";
  // The review hash includes the expiry state, so only a review given on the expired check counts for it.
  const wanted = await fitReviewHash(item, expired);
  if (item.fitReviewedHash === null || wanted === null || item.fitReviewedHash !== wanted) {
    why.push("fit not reviewed by the mechanic");
  }
  return !hashMatches || expired;
}

function isConfirmed(f: FeeData): boolean {
  return f.confirmed && f.netCents !== null;
}

export async function computeQuote(input: QuoteInput): Promise<Quote> {
  const { settings } = input;
  const exclusions: string[] = [];
  const staleFitItemIds: string[] = [];
  const lines: QuoteLine[] = [];

  if (!settings.shopConfirmed) exclusions.push("Shop details are not confirmed");
  if (input.items.length === 0) exclusions.push("The build sheet has no items");

  for (const item of input.items) {
    const why: string[] = [];
    const part = partNetOf(item, why);
    const labor = laborNetOf(item, settings, why);
    const net = part !== null && labor.net !== null ? part + labor.net : null;
    if (await fitReasons(item, input, why)) staleFitItemIds.push(item.id);
    lines.push({
      itemId: item.id, label: item.title, partNetCents: part, laborNetCents: labor.net, netCents: net,
      unresolved: why, defaultMinutes: labor.isDefault,
    });
    for (const w of why) exclusions.push(`${item.title}: ${w}`);
  }

  // Fees count once each, never per item.
  let knownFees = 0; let taxableFees = 0; let official = 0; let feesResolved = true;
  for (const f of input.fees) {
    if (f.netCents === null) { feesResolved = false; exclusions.push(`${f.label}: amount unknown`); continue; }
    if (!f.confirmed) { feesResolved = false; exclusions.push(`${f.label}: not confirmed by the mechanic`); continue; }
    knownFees += f.netCents;
    if (f.kind === "official_fee") official += f.netCents; else taxableFees += f.netCents;
  }

  inspectionExclusions(input, exclusions);

  // Only lines with a known net add up; unknown ones are listed in exclusions, never counted as 0.
  let knownLines = 0;
  for (const l of lines) if (l.netCents !== null) knownLines += l.netCents;
  const knownSubtotalNetCents = knownLines + knownFees;
  const totalsKnown = exclusions.length === 0 && feesResolved && lines.every((l) => l.netCents !== null);
  const taxable = totalsKnown ? knownLines + taxableFees : null;
  const net = taxable === null ? null : taxable + official;
  const vat = taxable === null ? null : vatOf(taxable);
  const inputHash = await sha256OfText(quoteCanonical(input));
  return {
    lines, feeNetCents: feesResolved ? knownFees : null, knownSubtotalNetCents,
    taxableNetCents: taxable, officialFeeCents: feesResolved ? official : null,
    netCents: net, vatCents: vat, grossCents: net === null || vat === null ? null : net + vat,
    incomplete: !totalsKnown, exclusions, staleFitItemIds, inputHash, generatedAt: input.now,
  };
}

/** Inspection review and the fee a current fit asks for (SPEC 11). */
function inspectionExclusions(input: QuoteInput, exclusions: string[]): void {
  const review = input.inspectionReview;
  const current = input.currentFitInputHash;
  if (review === null) exclusions.push("Inspection review missing");
  else if (current === null || review.fitInputHash !== current) exclusions.push("Inspection review is out of date");
  else if (review.decision === "unresolved") exclusions.push("Inspection need is unresolved");
  else if (review.decision === "fees_added" && !input.fees.some((f) => f.kind !== "official_fee" && isConfirmed(f))) {
    exclusions.push("Inspection review says fees were added, but no confirmed fee line exists");
  }
  for (const kind of INSPECTION_KINDS) {
    for (const item of input.items) {
      if (item.fit?.inspection !== kind) continue;
      const covered = input.fees.some((f) => f.kind === kind && isConfirmed(f) && f.itemIds.includes(item.id));
      if (!covered) exclusions.push(`${item.title}: needs a confirmed ${INSPECTION_NAME[kind]} fee`);
    }
  }
}

// ------------------------------------------------------------------ fee suggestions

/**
 * Missing fee lines only, never confirmed. One line per needed inspection kind listing every item
 * that needs it, and one official fee line when any inspection or registration is needed.
 */
export function suggestFees(
  items: readonly BuildItemData[], existingFees: readonly FeeData[], settings: ShopSettings, newId: () => string,
): FeeData[] {
  const out: FeeData[] = [];
  // Example-rate lines stay recognizable if the project later switches to the real shop.
  const tag = settings.demoRates ? " \u2014 example rate" : "";
  const amounts = { aenderungsabnahme: settings.aenderungsabnahmeNetCents, einzelabnahme: settings.einzelabnahmeNetCents };
  const needsInspection = new Set<string>();
  for (const kind of INSPECTION_KINDS) {
    const ids = items.filter((i) => i.fit?.inspection === kind).map((i) => i.id);
    ids.forEach((id) => needsInspection.add(id));
    if (ids.length === 0 || existingFees.some((f) => f.kind === kind)) continue;
    out.push({
      id: newId(), label: `${INSPECTION_NAME[kind]} (estimated)${tag}`, kind, netCents: amounts[kind],
      itemIds: ids, confirmed: false,
    });
  }
  const needsRegistration = items.filter((i) => needsInspection.has(i.id) || i.fit?.eintragung === "required");
  if (needsRegistration.length > 0 && !existingFees.some((f) => f.kind === "official_fee")) {
    out.push({
      id: newId(), label: `Zulassungsstelle fee (official fee, no VAT)${tag}`, kind: "official_fee",
      netCents: settings.officialFeeCents, itemIds: needsRegistration.map((i) => i.id), confirmed: false,
    });
  }
  return out;
}

// ------------------------------------------------------------------ quote hash text

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Stable text for the quote inputHash (SPEC 9): prices, tax bases, labor, rate, fees, the
 * inspection review and each item's fit status. Notes only count where they unlock zero labor.
 * The caller hashes it with sha256OfText.
 */
export function quoteCanonical(input: QuoteInput): string {
  const { settings } = input;
  const items = [...input.items].sort((a, b) => byText(a.slot, b.slot) || byText(a.id, b.id)).map((i) => {
    const m = minutesFor(i, settings);
    return {
      id: i.id, slot: i.slot, costKind: i.costKind, price: i.partPriceCents, basis: i.taxBasis,
      minutes: m.minutes, defaultMinutes: m.isDefault, zeroLaborConfirmed: i.zeroLaborConfirmed,
      zeroNotes: m.minutes === 0 ? i.mechanicNotes.trim() : null,
      fitStatus: input.currentFitInputHash === null ? "stale" : fitStatusOf(i, input.currentFitInputHash, input.now),
      mock: isMockFit(i), fitReviewedHash: i.fitReviewedHash,
    };
  });
  const fees = [...input.fees].sort((a, b) => byText(a.id, b.id))
    .map((f) => ({ ...f, itemIds: [...f.itemIds].sort(byText) }));
  return stableJson({
    v: 1, settingsId: input.settingsId ?? "default", shopConfirmed: settings.shopConfirmed,
    demoRates: settings.demoRates, rate: settings.hourlyRateNetCents, vatBasisPoints: settings.vatBasisPoints,
    officialFeeCents: settings.officialFeeCents, currentFitInputHash: input.currentFitInputHash,
    items, fees, inspectionReview: input.inspectionReview,
  });
}
