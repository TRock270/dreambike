// Server search policy (SPEC 8 search-parts, SPEC 6.3 source checks). The model proposes candidates;
// this file decides which ones survive: only allowlisted shop hosts, only links that were really found
// (search results) or really fetched (url mode), and only prices the fetched page confirms.
// Everything the model or a shop page says is untrusted: nothing here trusts a model price.
import "server-only";
import { z } from "zod";
import type { ProductCandidate, SearchModelOutput } from "../contracts";
import type { BikeData, ProductData, SearchRequestData } from "../types";
import { checkShopUrl, FetchError, linkStateOf, type FetchedPage, type LinkState } from "./fetch-product";

type Candidate = z.infer<typeof ProductCandidate>;
type ModelOutput = z.infer<typeof SearchModelOutput>;

export const MAX_WARNINGS = 8;
const MAX_URL = 2048;
const MAX_CENTS = 100_000_000;

// ------------------------------------------------------------------ task

/** What the model gets as its only variable input. Free text from the bike photo is dropped. */
export function buildSearchTask(
  request: SearchRequestData, shopDomains: ReadonlySet<string>, page: { finalUrl: string; text: string } | null,
) {
  const bike: BikeData = { ...request.bike, limitations: [] };
  if (request.mode === "url") {
    if (page === null) throw new Error("url mode needs the fetched page");
    // The task url is where the fetch ended: a shop redirect must not drop the only candidate.
    return {
      mode: "url" as const, bike, slot: request.slot, url: page.finalUrl,
      preferredDomains: [new URL(page.finalUrl).hostname], listingText: page.text.slice(0, 12_000),
    };
  }
  const wanted = request.preferredDomains.map((d) => d.trim().toLowerCase()).filter((d) => shopDomains.has(d));
  // The model must know the allowed hosts, so an empty or all-foreign list means "all of them".
  const preferred = [...new Set(wanted.length > 0 ? wanted : [...shopDomains].sort())].slice(0, 40);
  return { mode: "query" as const, bike, slot: request.slot, query: request.query, preferredDomains: preferred };
}

// ------------------------------------------------------------------ urls

const TRACKING_PARAMS = /^(utm_.*|fbclid|gclid|dclid|msclkid|yclid|mc_cid|mc_eid|igshid|_ga|_gl|srsltid|gbraid|wbraid)$/i;

/** Lowercase host (the URL parser does that), https only, no fragment, tracking params removed, params sorted. */
export function normalizeSearchUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  u.hash = "";
  const kept = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k));
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = "";
  for (const [k, v] of kept) u.searchParams.append(k, v);
  return u.href;
}

/** Hostname text that is safe to show back to the visitor. */
function shown(host: string | null | undefined): string {
  return host && /^[a-z0-9.-]{1,100}$/.test(host) ? host : "that site";
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ prices

/** Integer cents from a JSON-LD dot-decimal price ("1299.00", "1299.9", 1299). Exact string arithmetic; null otherwise. */
export function dotDecimalCents(text: string | null): number | null {
  if (text === null) return null;
  const m = /^(\d{1,9})(?:\.(\d+))?$/.exec(text.trim());
  if (!m) return null;
  const frac = m[2] ?? "";
  if (/[^0]/.test(frac.slice(2))) return null; // more than two real decimals is not a cent amount
  const cents = Number(m[1] + (frac + "00").slice(0, 2));
  return cents <= MAX_CENTS ? cents : null;
}

const GERMAN_AMOUNT = /^(?:\d{1,3}(?:\.\d{3})+|\d{1,9})(?:,\d{1,2})?$/;
const ENGLISH_AMOUNT = /^(?:\d{1,3}(?:,\d{3})+|\d{1,9})(?:\.\d{1,2})?$/;

function amountCents(text: string, decimal: "," | ".", thousands: "." | ","): number | null {
  const [whole = "", frac = ""] = text.split(decimal);
  const cents = Number(whole.split(thousands).join("") + (frac + "00").slice(0, 2));
  return cents <= MAX_CENTS ? cents : null;
}

const AMOUNT = "\\d[\\d.,]{0,14}\\d|\\d";
const EUR_MARK = "(?:€|(?<![A-Za-z])EUR(?![A-Za-z]))";
const NEAR_EUR = new RegExp(`${EUR_MARK}\\s{0,2}(${AMOUNT})|(${AMOUNT})\\s{0,2}${EUR_MARK}`, "g");

/** Every amount in the text written next to a euro sign or "EUR", in German or English notation, in cents. */
export function euroAmountsIn(text: string): Set<number> {
  const found = new Set<number>();
  for (const m of text.matchAll(NEAR_EUR)) {
    const raw = m[1] ?? m[2];
    if (raw === undefined) continue;
    if (GERMAN_AMOUNT.test(raw)) {
      const c = amountCents(raw, ",", ".");
      if (c !== null) found.add(c);
    }
    if (ENGLISH_AMOUNT.test(raw)) {
      const c = amountCents(raw, ".", ",");
      if (c !== null) found.add(c);
    }
  }
  return found;
}

/** German price text for integer cents, for example 129900 gives "1.299,00 €". */
export function formatEurGerman(cents: number): string {
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${whole},${String(cents % 100).padStart(2, "0")} €`;
}

type PriceVerdict = { priceEurCents: number | null; priceText: string | null; confirmed: boolean };
const NO_PRICE: PriceVerdict = { priceEurCents: null, priceText: null, confirmed: false };

/** Case-folded text with whitespace collapsed, for wording comparisons. */
const fold = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

/** Offers that may confirm a price: EUR, on the product itself or one of its variants. Never list items or "from" prices. */
function confirmingOffers(page: FetchedPage) {
  return page.jsonLdOffers.filter((o) => (o.kind === "product" || o.kind === "variant")
    && o.currency !== null && o.currency.trim().toUpperCase() === "EUR");
}

/** True when the shop URL passes the same check the fetcher uses (https, no port or userinfo, no IP, allowed host). */
function shopUrlOk(url: string, shopDomains: ReadonlySet<string>): boolean {
  try {
    checkShopUrl(url, shopDomains);
    return true;
  } catch {
    return false;
  }
}

const MIN_NAME = 4;
const ANCHOR_CHARS = 40;
const WINDOW_CHARS = 400;
const MAX_ANCHORS = 3;

/** The page's own product names in trust order: h1, JSON-LD product names, title. Folded, empty ones dropped. */
function pageNames(page: FetchedPage): { name: string; isH1: boolean }[] {
  const fromPage = (n: string | null, isH1: boolean) => ({ name: n === null ? "" : fold(n), isH1 });
  return [
    fromPage(page.h1, true),
    ...page.jsonLdOffers.filter((o) => o.kind === "product").map((o) => fromPage(o.name, false)),
    fromPage(page.pageTitle, false),
  ].filter((n) => n.name !== "");
}

/**
 * Visible-text confirmation, used only when no JSON-LD offer confirms. The model's name must sit inside one of the
 * page's own names (one direction only). The text is then searched in a window after where the PAGE's name starts
 * (never the model's name), so a planted "Name 19,90 EUR" far from the real title and h1 does not count.
 */
function textConfirms(modelName: string, cents: number, page: FetchedPage): boolean {
  const wanted = fold(modelName);
  if (wanted.length < MIN_NAME) return false;
  const all = pageNames(page).filter((n) => n.name.includes(wanted));
  // A matching h1 is the strongest anchor: then the title and JSON-LD windows (start of the page) are not used.
  const matching = all.some((n) => n.isH1) ? all.filter((n) => n.isH1) : all;
  // Distinct anchors; an anchor counts as the h1 when any of its names is the h1.
  const anchors = new Map<string, boolean>();
  for (const n of matching) {
    const a = n.name.slice(0, ANCHOR_CHARS);
    anchors.set(a, (anchors.get(a) ?? false) || n.isH1);
  }
  // Anchors are found in a lowercased copy; amounts are read from the cased copy ("EUR" is case-sensitive).
  // A lowercase copy of a different length (rare Unicode cases) would misalign the windows: no confirmation then.
  const cased = page.text.replace(/\s+/g, " ").trim();
  const text = cased.toLowerCase();
  if (text.length !== cased.length) return false;
  // The text usually starts with the page title, so the h1's first hit there is the title, not the heading: skip it.
  // Only for the h1, whose text is visible on the page. A JSON-LD name need not be visible, so its next hit after the
  // title could sit in a review; it keeps its first hit.
  const title = page.pageTitle === null ? "" : fold(page.pageTitle);
  const titleEnd = title !== "" && text.startsWith(title) ? title.length : 0;
  for (const [anchor, isH1] of [...anchors].slice(0, MAX_ANCHORS)) {
    let at = text.indexOf(anchor);
    if (at >= 0 && at < titleEnd && isH1) at = text.indexOf(anchor, titleEnd);
    if (at < 0) continue;
    const from = at + anchor.length;
    if (euroAmountsIn(cased.slice(from, from + WINDOW_CHARS)).has(cents)) return true;
  }
  return false;
}

/**
 * The model's price survives only if the fetched page states the same amount: a JSON-LD EUR offer of kind product or
 * variant, or, without any confirming offer, visible euro text close to the page's own product name (textConfirms).
 * Other currencies are never used. The shown text is always written from the confirmed cents.
 */
function verifyPrice(c: Candidate, page: FetchedPage | null): PriceVerdict {
  // 0 is never a price: mini-carts ("Warenkorb 0,00 €") and "price on request" placeholders show it.
  if (page === null || c.priceEurCents === null || c.priceEurCents <= 0) return NO_PRICE;
  const cents = c.priceEurCents;
  const offers = confirmingOffers(page);
  const jsonLd = offers.some((o) => dotDecimalCents(o.price) === cents);
  // A confirming-kind offer with another amount is a contradiction, not "no offer": text must not override it.
  const contradicted = offers.length > 0 && !jsonLd;
  if (!jsonLd && (contradicted || !textConfirms(c.name, cents, page))) return NO_PRICE;
  return { priceEurCents: cents, priceText: formatEurGerman(cents), confirmed: true };
}

/** Part number only when the page itself carries it (JSON-LD sku/mpn of a product or variant, or visible text). */
function verifiedPartNumber(c: Candidate, page: FetchedPage | null): string | null {
  if (page === null || c.partNumber === null) return null;
  const alnum = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const want = alnum(c.partNumber);
  if (want.length < 3) return null;
  const inLd = page.jsonLdOffers.some((o) => (o.kind === "product" || o.kind === "variant")
    && [o.sku, o.mpn].some((v) => v !== null && alnum(v) === want));
  if (inLd) return c.partNumber;
  // In the text the number must stand alone: whole token at letter/digit edges, with at most one "-", ".", "/" or
  // space between its characters ("600157" in "Art.-Nr.: 600-157"), so "123" does not match "1,23 EUR" or "M1234".
  const chars = [...want].map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${chars.join("[-./ ]?")}(?![\\p{L}\\p{N}])`, "iu");
  return re.test(page.text) ? c.partNumber : null;
}

// Approval wording that must appear inside the model's quote, which itself must be on the page at word edges.
// Word boundaries keep a short code from matching inside a word ("ABE", "ECE", "E13").
const APPROVAL_KEYWORDS: Record<"abe" | "e_mark" | "teilegutachten" | "none", RegExp> = {
  abe: /\bABE\b|Allgemeine Betriebserlaubnis/i,
  e_mark: /E-Prüfzeichen|E-Kennzeichnung|e-mark|\bECE\b|\be\d{1,2}\b(?=[\s\-*)]|$)/i,
  teilegutachten: /Teilegutachten/i,
  none: /ohne ABE|keine ABE|not road legal|nicht für den Straßenverkehr|(?:ohne|keine) Straßenzulassung|off-?road only|nur für den Rennsport/i,
};

const NL = "\n";

/** Page text with blanks collapsed but newlines kept (a newline ends a sentence), lowercased. */
const sentenceText = (t: string) => t.replace(/[^\S\n]+/g, " ").toLowerCase();

// The quote must sit on the page at word edges: a cut-off quote like "abe" (from "aber") or "E12" (from
// "E1234") would otherwise satisfy the keyword regex by itself. Edges that are not letters/digits need no check.
// Returns every [start, end) of the quote in the text; a space in the quote also matches a newline.
function quoteSpans(quote: string, text: string): [number, number][] {
  const escaped = quote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[ \\n]");
  const before = /^[\p{L}\p{N}]/u.test(quote) ? "(?<![\\p{L}\\p{N}])" : "";
  const after = /[\p{L}\p{N}]$/u.test(quote) ? "(?![\\p{L}\\p{N}])" : "";
  return [...text.matchAll(new RegExp(before + escaped + after, "gu"))].map((m) => [m.index, m.index + m[0].length]);
}

/** Sentences as [start, end): they end at . ! ? followed by whitespace, or at a newline. */
function sentenceBounds(text: string): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  for (const m of text.matchAll(/[.!?](?=\s)|\n/g)) {
    out.push([start, m.index + (m[0] === NL ? 0 : 1)]);
    start = m.index + 1;
  }
  out.push([start, text.length]);
  return out;
}

/** Does any sentence that overlaps an occurrence of the quote carry a "not road legal" wording? */
function noneNearQuote(spans: [number, number][], text: string): boolean {
  return sentenceBounds(text).some(([a, b]) =>
    spans.some(([s, e]) => a < e && s < b) && APPROVAL_KEYWORDS.none.test(text.slice(a, b)));
}

/** Approval and its quote are kept only when the non-redirected product page says the same thing. */
export function verifiedApproval(c: Candidate, page: FetchedPage | null): { approval: Candidate["approval"]; approvalText: string | null } {
  const unknown = { approval: "unknown" as const, approvalText: null };
  if (page === null || c.approval === "unknown" || c.approvalText === null) return unknown;
  const quote = fold(c.approvalText);
  if (quote === "") return unknown;
  const text = sentenceText(page.text);
  const spans = quoteSpans(quote, text);
  if (spans.length === 0) return unknown;
  const quoteText = c.approvalText.replace(/\s+/g, " ");
  if (c.approval === "none") {
    return APPROVAL_KEYWORDS.none.test(quoteText) ? { approval: c.approval, approvalText: c.approvalText } : unknown;
  }
  if (!APPROVAL_KEYWORDS[c.approval].test(quoteText)) return unknown;
  // "ohne ABE" in the quote or in a sentence around it vetoes a positive approval, so a quote like the product
  // name next to "ohne ABE" cannot turn a not-road-legal part into an approved one.
  if (APPROVAL_KEYWORDS.none.test(quoteText) || noneNearQuote(spans, text)) return unknown;
  return { approval: c.approval, approvalText: c.approvalText };
}

// Shipping statements: a shipping word followed within 80 characters (same sentence) by a region word.
const SHIP_EU = /(Versand|Lieferung|Lieferland|Liefergebiet|ships?|shipping|delivery)[^.\n]{0,80}(\bEU\b|Europ|Deutschland|Germany|Österreich|Austria)/i;
const SHIP_OUTSIDE = /(Versand|Lieferung|ships?|shipping|delivery)[^.\n]{0,80}(\bUSA\b|United States|Vereinigte Staaten|außerhalb der EU|outside (?:of )?the EU|weltweit|worldwide)/i;

/** The model's region survives only when the fetched page has a shipping statement for it; otherwise unknown. */
export function verifiedRegion(c: Candidate, page: FetchedPage | null): Candidate["fulfillmentRegion"] {
  if (page === null || c.fulfillmentRegion === "unknown") return "unknown";
  const text = page.text.replace(/[ \t]+/g, " ");
  const re = c.fulfillmentRegion === "eu" ? SHIP_EU : SHIP_OUTSIDE;
  return re.test(text) ? c.fulfillmentRegion : "unknown";
}

/** Model image only if it is one of the page's own images on an allowed host; else the page's first allowed image. */
function verifiedImage(c: Candidate, page: FetchedPage | null, shopDomains: ReadonlySet<string>): string | null {
  if (page === null) return null;
  const allowed = page.imageUrls.filter((u) => {
    return u.length <= MAX_URL && shopUrlOk(u, shopDomains);
  });
  if (c.imageUrl !== null) {
    const want = normalizeSearchUrl(c.imageUrl);
    const hit = allowed.find((u) => normalizeSearchUrl(u) === want);
    if (want !== null && hit !== undefined) return hit;
  }
  return allowed[0] ?? null;
}

const GROSS_PHRASE = /inkl\.?\s*(\d{1,2}\s*%\s*)?(MwSt|USt|Mehrwertsteuer)|incl(?:uding|\.)?\s*(\d{1,2}\s*%\s*)?VAT/i;
const NET_PHRASE = /zzgl\.?\s*(\d{1,2}\s*%\s*)?(MwSt|USt)|excl(?:uding|\.)?\s*VAT|netto/i;

/** The model's tax basis counts only for a confirmed price on a fetched page that states exactly one basis. */
export function verifiedTaxBasis(c: Candidate, verdict: PriceVerdict, page: FetchedPage | null): Candidate["taxBasis"] {
  if (page === null || !verdict.confirmed) return "unknown";
  const gross = GROSS_PHRASE.test(page.text);
  const net = NET_PHRASE.test(page.text);
  if (gross === net) return "unknown";
  const stated = gross ? "gross" : "net";
  return c.taxBasis === stated ? stated : "unknown";
}

// ------------------------------------------------------------------ validation

export type PageCheck =
  | { ok: true; accessedAt: string; page: FetchedPage }
  | { ok: false; accessedAt: string; error: FetchError };

export type SearchContext = {
  shopDomains: ReadonlySet<string>;
  /** ISO time of the whole search; used as accessedAt when no fetch completed. */
  searchedAt: string;
  newId?: () => string;
} & (
  | { mode: "query"; evidence: { citations: { url: string }[]; results: { url: string }[] } }
  | { mode: "url"; requestedUrl: string; finalUrl: string }
);

type Kept = { candidate: Candidate; url: string; key: string };
type Dropped = { host: string; why: string };

/** Split the model's candidates into the ones that may be shown and the reasons for the rest. */
function screen(output: ModelOutput, ctx: SearchContext): { kept: Kept[]; dropped: Dropped[] } {
  const found = new Set<string>();
  if (ctx.mode === "query") {
    for (const e of [...ctx.evidence.citations, ...ctx.evidence.results]) {
      const n = normalizeSearchUrl(e.url);
      if (n !== null) found.add(n);
    }
  }
  const finalKey = ctx.mode === "url" ? normalizeSearchUrl(ctx.finalUrl) : null;
  const requestedKey = ctx.mode === "url" ? normalizeSearchUrl(ctx.requestedUrl) : null;
  const kept: Kept[] = [];
  const dropped: Dropped[] = [];
  const seen = new Set<string>();
  for (const c of output.products) {
    const host = shown(hostOf(c.url));
    const key = normalizeSearchUrl(c.url);
    const hostOk = shopUrlOk(c.url, ctx.shopDomains);
    if (!hostOk || key === null) { dropped.push({ host, why: "not on the allowed shop list" }); continue; }
    if (normalizeSearchUrl(c.source.url) !== key) { dropped.push({ host, why: "the source link did not match the product link" }); continue; }
    if (ctx.mode === "query" ? !found.has(key) : key !== finalKey && key !== requestedKey) {
      dropped.push({ host, why: ctx.mode === "query" ? "link was not in the search results" : "link was not the page that was checked" });
      continue;
    }
    // In url mode the product is the page the fetch ended on.
    const url = ctx.mode === "url" ? ctx.finalUrl : c.url;
    if (url.length > MAX_URL) { dropped.push({ host, why: "the link is too long" }); continue; }
    const pageKey = ctx.mode === "url" ? finalKey! : key;
    if (seen.has(pageKey)) continue; // the same product listed twice
    seen.add(pageKey);
    kept.push({ candidate: c, url, key: pageKey });
  }
  return { kept, dropped };
}

/** Product pages worth fetching to check the price: the candidates that passed the host and evidence checks. */
export function verifiableUrls(output: ModelOutput, ctx: SearchContext): string[] {
  return screen(output, ctx).kept.map((k) => k.url);
}

/** Short reason a page check failed, naming the host. */
export function failureWords(e: FetchError): string {
  const status = e.status ?? 0;
  switch (e.reason) {
    case "http_status":
      if (status === 404 || status === 410) return `the link is dead (HTTP ${status})`;
      if (status === 401 || status === 403 || status === 429) return `refused the automatic page check (HTTP ${status})`;
      return `answered with HTTP ${status}`;
    case "timeout": return "took too long to answer";
    case "network": return "could not be reached";
    case "blocked_host": case "blocked_address": case "bad_url": case "too_many_redirects": return "could not be checked automatically";
    default: return "did not return a readable page";
  }
}

const shopKey = (host: string) => host.replace(/^www\./, "");

export type SearchValidation = { products: ProductData[]; warnings: string[] };

/**
 * Apply every rule to the model's candidates. `pages` holds the page check per normalized candidate url
 * (url mode: the one fetched page under the normalized final url). Warnings are aggregated, at most 8.
 */
export function postValidateSearch(output: ModelOutput, ctx: SearchContext, pages: ReadonlyMap<string, PageCheck>): SearchValidation {
  const { kept, dropped } = screen(output, ctx);
  const newId = ctx.newId ?? (() => crypto.randomUUID());
  const notes: string[] = [];
  const products: ProductData[] = [];

  for (const k of kept) {
    const c = k.candidate;
    const host = shown(hostOf(k.url));
    const check = pages.get(k.key);
    // A redirect means the page read is not the product the model named: nothing from it confirms details.
    const redirected = check?.ok === true && normalizeSearchUrl(check.page.finalUrl) !== k.key;
    const fetched = check?.ok && !redirected ? check.page : null;
    const verdict = verifyPrice(c, fetched);
    if (redirected) notes.push(`${host}: the link redirected to another page, details not confirmed`);
    else if (check && !check.ok) notes.push(`${host}: ${failureWords(check.error)}, price not confirmed`);
    else if (c.priceEurCents !== null && !verdict.confirmed) notes.push(`${host}: the listed price could not be confirmed on the page`);
    const linkState: LinkState = check && !redirected ? linkStateOf(check.ok ? null : check.error) : "unchecked";
    const approval = verifiedApproval(c, fetched);
    products.push({
      id: newId(), name: c.name, brand: c.brand, partNumber: verifiedPartNumber(c, fetched), url: k.url,
      imageUrl: verifiedImage(c, fetched, ctx.shopDomains),
      priceText: verdict.priceText, priceEurCents: verdict.priceEurCents,
      taxBasis: verifiedTaxBasis(c, verdict, fetched), approval: approval.approval, approvalText: approval.approvalText,
      fulfillmentRegion: verifiedRegion(c, fetched),
      source: { url: k.url, title: c.source.title, supports: c.source.supports, accessedAt: check?.accessedAt ?? ctx.searchedAt },
      linkState,
    });
  }

  const warnings: string[] = [];
  if (ctx.mode === "query") {
    const used = [...new Set(products.map((p) => hostOf(p.url) ?? ""))].filter((h) => h !== "");
    const usedShops = new Set(used.map(shopKey));
    const others = [...new Set([...ctx.shopDomains].map(shopKey))].filter((s) => !usedShops.has(s));
    if (used.length > 0 && others.length > 0) warnings.push(`Results came from ${used.map(shown).join(", ")}; nothing from the other shops.`);
    if (products.length === 0) warnings.push("No usable product was found on the allowed shops.");
  } else if (products.length === 0) {
    warnings.push("No product could be confirmed on that page. Enter the product by hand.");
  }
  warnings.push(...dropped.map((d) => `${d.host}: ${d.why}`), ...notes,
    ...output.warnings.filter((w) => w.trim() !== "").map((w) => `Model note: ${w}`));
  return { products, warnings: capWarnings(warnings) };
}

/** Dedupe, trim to 2000 chars, and keep at most 8 entries (the last one says how many were left out). */
export function capWarnings(all: readonly string[]): string[] {
  const unique = [...new Set(all.map((w) => w.trim().slice(0, 2000)).filter((w) => w !== ""))];
  if (unique.length <= MAX_WARNINGS) return unique;
  return [...unique.slice(0, MAX_WARNINGS - 1), `${unique.length - (MAX_WARNINGS - 1)} more notes were left out.`];
}
