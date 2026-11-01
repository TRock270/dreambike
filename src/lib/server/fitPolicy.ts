// Server fit policy (SPEC 6 checkFit, SPEC 8 "Fit post-validation"). The model proposes; this
// file decides what may be called ok. Conservative by design: missing evidence means verify,
// a problem is never upgraded, and a model's confidence is never evidence.
import "server-only";
import { z } from "zod";
import { CheckResponse, FitModelOutput, type CheckRequest } from "../contracts";
import { bikeLimitations } from "../editPolicy";
import { FIT_PRECHECK_NOTE, LEGAL_SEED } from "../project";
import type { BikeData, FitData, SlotId } from "../types";
import { dayET } from "./budget";

export { FIT_PRECHECK_NOTE, LEGAL_SEED };

type Request = z.infer<typeof CheckRequest>;
type Response = z.infer<typeof CheckResponse>;

/** The server's ET calendar date, sent to the model as legalAsOf. */
export function legalAsOf(now: Date = new Date()): string {
  return dayET(now);
}

// ------------------------------------------------------------------ task

/**
 * The prompt input for one batch. Per item only identity and physical data are kept: fit,
 * review, mechanic notes, hashes, timestamps, prices, labor and tax data are dropped. No consent,
 * logo, personal data or request/budget ids are included (SPEC 6).
 */
export function buildFitTask(request: Request, now: Date = new Date()) {
  return {
    // Limitations come from the bike fields, never from the client's free text (it is model input).
    bike: { ...request.bike, limitations: bikeLimitations(request.bike) },
    items: request.items.map((it) => ({
      id: it.id, slot: it.slot, title: it.title, spec: it.spec.map((s) => ({ key: s.key, value: s.value })),
      intent: it.intent,
      product: it.product === null ? null : {
        name: it.product.name, partNumber: it.product.partNumber, url: it.product.url,
        approvalText: it.product.approvalText,
      },
    })),
    activeBuild: request.activeBuild,
    shopRules: request.shopRules,
    legalAsOf: legalAsOf(now),
    legalSources: LEGAL_SEED.sources.map((s) => ({ title: s.title, url: s.url })),
  };
}

// ------------------------------------------------------------ validation

export type FitEvidence = {
  /** url_citation annotations from the answer. */
  citations: { url: string; title?: string | null }[];
  /** web_search_call results. */
  results: { url: string; title?: string | null }[];
};
export type FitContextItem = {
  id: string; slot: SlotId; approvalText?: string | null;
  /** The product's own approval claim and URL (page data, not evidence). Absent for no product. */
  productApproval?: FitData["approval"] | null; productUrl?: string | null;
};
export type FitContext = {
  /** Slot of every requested item id, for the slot-specific limitations. */
  items: FitContextItem[];
  bike: BikeData;
};
export type PostValidation =
  | { ok: true; response: Response }
  | { ok: false; code: "INVALID_OUTPUT" | "ID_MISMATCH"; message: string };

/** Lowercase scheme/host, no fragment. Null for text that is not an absolute URL. */
export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    u.hash = "";
    return u.href; // the URL parser already lowercases scheme and host
  } catch {
    return null;
  }
}

// Law and authority sites prove no product fit: any page on these hosts counts as general.
const GENERAL_HOSTS = ["gesetze-im-internet.de", "tuv.com", "dekra.de", "kba.de", "bmv.de", "bmdv.bund.de", "tuvsud.com", "tuev-nord.de",
  "europa.eu", "unece.org"];
const GENERAL_URLS = new Set(LEGAL_SEED.sources.map((s) => normalizeUrl(s.url)));
function isGeneralSource(url: string): boolean {
  const n = normalizeUrl(url);
  if (n === null) return true;
  if (GENERAL_URLS.has(n)) return true;
  const host = new URL(n).hostname;
  return GENERAL_HOSTS.some((g) => host === g || host.endsWith("." + g));
}

/** Hostname, lowercase, without a leading "www.". Null for text that is not an absolute URL. */
export function hostOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Second-level labels under a two-letter country code that are not the shop's own name ("shop.co.uk").
const SHARED_SLD = new Set(["co", "com", "org", "net", "gov", "ac", "or", "ne"]);

/**
 * The site a host belongs to, without a public-suffix list: its last two labels, or three under co.uk-style
 * suffixes. "blog.shop.de" and "shop.de" are one site. When unsure it lumps hosts together, which only makes a
 * source count as the shop's own (verify instead of ok), never the other way round.
 */
export function siteOf(host: string): string {
  const labels = host.split(".");
  const tld = labels[labels.length - 1] ?? "";
  const take = tld.length === 2 && SHARED_SLD.has(labels[labels.length - 2] ?? "") ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** Keep only sources whose exact URL (normalized) was a citation or search result. */
function groundedSources(
  sources: { url: string; title: string; supports: string }[], evidence: FitEvidence, accessedAt: string,
): FitData["sources"] {
  const allowed = new Set<string>();
  for (const e of [...evidence.citations, ...evidence.results]) {
    const n = normalizeUrl(e.url);
    if (n !== null) allowed.add(n);
  }
  const seen = new Set<string>();
  const kept: FitData["sources"] = [];
  for (const s of sources) {
    const n = normalizeUrl(s.url);
    if (n === null || !allowed.has(n) || seen.has(n)) continue;
    seen.add(n);
    kept.push({ url: s.url, title: s.title, supports: s.supports, accessedAt });
  }
  return kept;
}

const has = (list: readonly string[], re: RegExp) => list.some((t) => re.test(t));

/**
 * Slot rules the model may have left out. `measure` entries block ok. An open measurement counts
 * only when it is in toMeasure: a claim in the reasons ("1 inch bars fit") is not a measurement.
 */
function slotAdditions(slot: SlotId, bike: BikeData, r: FitData): { measure: string[]; conditions: string[] } {
  const measure: string[] = [];
  const conditions: string[] = [];
  // Measurements count only from toMeasure. Conditions are always added from the server's fixed
  // text: a model sentence that denies the need ("no inspection needed") must not remove them.
  const cableRe = /cable|hose|wir/i;
  if (slot === "handlebar") {
    if ((bike.model === null || bike.yearFrom === null) && !has(r.toMeasure, /clamp/i)) {
      measure.push("Measure the handlebar clamp diameter on the bike; the model and year are not confirmed.");
    }
    if (!has(r.toMeasure, cableRe)) {
      measure.push("Check throttle/clutch cable, brake hose and wiring reach with the new bar; routing and length are not confirmed.");
    }
  } else if (slot === "wheel_front" || slot === "wheel_rear") {
    if (bike.abs === "unknown" && !has(r.toMeasure, /\babs\b|sensor|tone ring|pulse/i)) {
      measure.push("The ABS equipment is unknown; confirm that the ABS ring and sensor fit the new wheel.");
    }
    if (bike.abs === "yes") conditions.push("Check that the ABS ring and sensor fit the new wheel.");
    conditions.push("Check tire and fender clearance and the brake and drive fit after the wheel swap.");
  } else if (slot === "exhaust") {
    conditions.push("Exhaust papers (ABE, EC type approval or Teilegutachten) for this vehicle must be seen.");
    conditions.push("An inspector must review the exhaust; approval is not guaranteed.");
    conditions.push("Exhaust and intake changes interact; check intake and engine mapping together.");
  } else if (slot === "headlight" || slot === "turn_signals") {
    conditions.push("Lighting parts need an approval mark (E-mark) and correct aim and wiring.");
  }
  return { measure, conditions };
}

/** Add at most `max` total entries; keep existing ones first, shrink them only if the cap forces it. */
function withAdded(existing: readonly string[], addedAll: readonly string[], max: number): string[] {
  const added = addedAll.filter((a) => !existing.includes(a)); // dedupe against the exact server text only
  const room = Math.max(0, max - added.length);
  return [...existing.slice(0, room), ...added].slice(0, max);
}

/** Apply the downgrade rules to one model result. */
function validateResult(
  model: z.infer<typeof FitModelOutput>["results"][number], slot: SlotId | undefined, bike: BikeData,
  item: FitContextItem | undefined, evidence: FitEvidence, accessedAt: string,
): FitData {
  const approvalText = item?.approvalText;
  const sources = groundedSources(model.sources, evidence, accessedAt);
  const r: FitData = { ...model, sources };
  const notes: string[] = [];

  // Inspection "none" next to no approval is unsupported; never read it as approval either way.
  if (r.inspection === "none" && (r.approval === "none" || r.approval === "unknown")) {
    r.inspection = "unknown";
    notes.push('Inspection "none" was not accepted: no approval document is established for this part.');
  }

  if (slot) {
    const add = slotAdditions(slot, bike, r);
    r.toMeasure = withAdded(r.toMeasure, add.measure, 12);
    r.conditions = withAdded(r.conditions, add.conditions, 12);
  }

  // Inspection "none" next to any inspection or registration wording (the model's own conditions
  // and reasons, the server's added conditions, or the product's approval text) cannot be trusted:
  // an ABE with an Auflage is not "none". Runs after slotAdditions so the server's text counts.
  if (r.inspection === "none") {
    const wording = /abnahme|eintrag|inspect|tüv|tuev|dekra|gutachten|auflage|§\s?(19|21)/i;
    if (has([...r.conditions, ...r.reasons, approvalText ?? ""], wording)) {
      r.inspection = "unknown";
      notes.push('Inspection "none" was not accepted: an inspection or registration condition is mentioned.');
    }
  }

  // A source is specific if it is grounded, not a law/authority page, and not on the product's own
  // shop host: the product page only repeats what the shop claims (P3).
  const productHost = hostOf(item?.productUrl);
  const productSite = productHost === null ? null : siteOf(productHost);
  const sourceSite = (url: string) => { const h = hostOf(url); return h === null ? null : siteOf(h); };
  const specific = sources.filter((s) => !isGeneralSource(s.url) && (productSite === null || sourceSite(s.url) !== productSite));

  // All server notes are collected and written with one withAdded call, so a model that sends the
  // maximum number of reasons cannot push the server's explanation out.
  const serverNotes: string[] = [];
  if (r.status === "ok") {
    if (slot === "exhaust") notes.push("An exhaust always needs an inspector review; this is not a plain ok.");
    if (r.toMeasure.length > 0) notes.push("Measurements are still open.");
    if (r.documentCoverage !== "covered") notes.push("Document coverage for this vehicle and part is not confirmed.");
    if (r.inspection === "unknown") notes.push("Whether an inspection is needed is unknown.");
    if (r.inspection === "aenderungsabnahme" || r.inspection === "einzelabnahme") {
      notes.push("An inspection is required; this is not a plain ok.");
    }
    if (r.eintragung === "unknown") notes.push("Whether an Eintragung is needed is unknown.");
    if (r.approval === "unknown" || r.approval === "none") notes.push("No approval document is established.");
    if (specific.length === 0) notes.push("No source specific to this part or vehicle was found; a general StVZO or TÜV link or the product's own shop page does not prove fit.");
    if (notes.length > 0) {
      r.status = "verify";
      serverNotes.push(`Downgraded from ok to verify: ${notes.join(" ")}`);
    }
  } else {
    serverNotes.push(...notes);
  }

  // Without a specific source the model's positive claims are unsupported (P4): clear them to
  // unknown. Negative values (none, required) stay, they only make the result more careful.
  if (specific.length === 0) {
    const cleared: string[] = [];
    const productApproval = item?.productApproval ?? null;
    if ((r.approval === "abe" || r.approval === "e_mark" || r.approval === "teilegutachten") && r.approval !== productApproval) {
      r.approval = "unknown"; cleared.push("approval");
    }
    if (r.documentCoverage === "covered") { r.documentCoverage = "unknown"; cleared.push("documentCoverage"); }
    if (r.inspection === "none") { r.inspection = "unknown"; cleared.push("inspection"); }
    if (r.eintragung === "not_required") { r.eintragung = "unknown"; cleared.push("eintragung"); }
    if (r.carryDocuments === "not_required") { r.carryDocuments = "unknown"; cleared.push("carryDocuments"); }
    if (cleared.length > 0) {
      serverNotes.push(`No source specific to this part or vehicle backs these claims, so they were reset to unknown: ${cleared.join(", ")}.`);
    }
  }
  if (serverNotes.length > 0) r.reasons = withAdded(r.reasons, serverNotes, 12);
  return r;
}

/**
 * Validate a model fit answer against the request. The ids must match exactly: a duplicate,
 * missing or extra id fails the whole batch. `now` is ms since epoch.
 */
export function postValidate(
  requestIds: readonly string[], modelOutput: unknown, evidence: FitEvidence,
  now: number, inputHash: string, context: FitContext,
): PostValidation {
  const parsed = FitModelOutput.safeParse(modelOutput);
  if (!parsed.success) return { ok: false, code: "INVALID_OUTPUT", message: "Fit answer does not match the schema." };
  const want = new Set(requestIds);
  if (want.size !== requestIds.length) return { ok: false, code: "ID_MISMATCH", message: "Request ids are not unique." };
  const got = parsed.data.results.map((r) => r.itemId);
  if (new Set(got).size !== got.length) return { ok: false, code: "ID_MISMATCH", message: "The answer repeats an item id." };
  if (got.length !== want.size || got.some((id) => !want.has(id))) {
    return { ok: false, code: "ID_MISMATCH", message: "The answer ids do not match the request." };
  }

  const checkedAt = new Date(now).toISOString();
  const slots = new Map(context.items.map((i) => [i.id, i]));
  const byId = new Map(parsed.data.results.map((r) => [r.itemId, r]));
  const results = requestIds.map((id) => validateResult(byId.get(id)!, slots.get(id)?.slot, context.bike, slots.get(id), evidence, checkedAt));
  return { ok: true, response: { inputHash, checkedAt, results } };
}
