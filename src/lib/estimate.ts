// One snapshot of the estimate (SPEC 11): the screen and the PDF both start from this, so they can
// never show two different answers. Pure: no React, no IndexedDB, no PDF library.
//
// Everything is computed with ONE `now`. The quote's stale-fit list and the rows' `expired` flag both
// use it, so they agree on the 24 h boundary.
import { MOCK_LABEL } from "./mocks";
import { activeItems, fitInputHash, fitReviewHash, fitStatusOf, LEGAL_SEED, type FitStatus } from "./project";
import { computeQuote } from "./quote";
import type { BikeRevision, BuildItemData, Quote, ShopSettings, Version } from "./types";

/** What the fit review needs to know about one item (status, mock, expiry, review hash). */
export type FitRow = {
  item: BuildItemData; status: FitStatus; mock: boolean; hashMatches: boolean; expired: boolean;
  reviewHash: string | null; reviewed: boolean;
};

export type EstimateSnapshot = {
  /** The current fit input hash, or null when no confirmed bike exists. */
  hash: string | null;
  quote: Quote;
  rows: FitRow[];
};

export type EstimateSnapshotInput = {
  head: Version;
  settings: ShopSettings;
  /** "default" or "example"; only feeds the quote hash. */
  settingsId: string;
  /** The saved bike, or null when none is saved. */
  bikeRevision: BikeRevision | null;
  /** Milliseconds. One value for the whole snapshot. */
  now: number;
};

/** Works out the fit rows (status, review hash) for the estimate. */
async function buildRows(items: readonly BuildItemData[], hash: string | null, now: number): Promise<FitRow[]> {
  return Promise.all(items.map(async (item) => {
    const status: FitStatus = hash === null ? (item.fit === null ? "not_checked" : "stale") : fitStatusOf(item, hash, now);
    const mock = item.fit !== null && item.fit.reasons.some((r) => r.includes(MOCK_LABEL));
    const hashMatches = hash !== null && item.fit !== null && item.fitInputHash === hash;
    // A matching hash with status "stale" means the 24 h life of the check ran out.
    const expired = hashMatches && status === "stale";
    const reviewHash = await fitReviewHash(item, expired);
    return { item, status, mock, hashMatches, expired, reviewHash, reviewed: reviewHash !== null && item.fitReviewedHash === reviewHash };
  }));
}

export async function estimateSnapshot(input: EstimateSnapshotInput): Promise<EstimateSnapshot> {
  const { head, settings, settingsId, bikeRevision, now } = input;
  const items = activeItems(head);
  // Without a confirmed bike there is no fit hash, so every fit counts as out of date.
  const hash = bikeRevision?.confirmed ? await fitInputHash(bikeRevision, head.items, settings.shopRules, LEGAL_SEED.version) : null;
  const quote = await computeQuote({
    items, fees: head.fees, inspectionReview: head.inspectionReview, settings, currentFitInputHash: hash, now, settingsId,
  });
  const rows = await buildRows(items, hash, now);
  return { hash, quote, rows };
}
