"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PreflightError } from "@/lib/browser/preflight";
import { requestPartSearch } from "@/lib/browser/sparkClient";
import { MOCK_LABEL } from "@/lib/mocks";
import { formatEuroCents, parseEuroInput, pickedProductFields, priceCentsText, productToSave, type ItemPatch } from "@/lib/project";
import { slotInfo } from "@/lib/slots";
import type { BikeRevision, BuildItemData, ProductData, SearchResponseData } from "@/lib/types";
import prices from "../../budget/prices.json";

/** Which part-search features this server offers (booleans from page.tsx; the shop list never reaches the browser). */
export type PartSearchFlags = { query: boolean; url: boolean; photo: boolean };
/** What BuildSheet hands down: the flags, the confirmed bike (null until confirmed) and the shop's preferred hosts. */
export type PartSearchSupport = { flags: PartSearchFlags; bike: BikeRevision | null; preferredDomains: string[] };

type Props = {
  item: BuildItemData;
  /** True while saving or while the sheet is locked; the form stays filled in. */
  disabled: boolean;
  saving: boolean;
  /** Message from the last failed save of this draft (kept so the mechanic can retry). */
  error: string | null;
  onSave: (patch: ItemPatch) => void;
  onCancel: () => void;
  /** Shop search support; null or both search flags off hides the "Find in your shops" panel. */
  partSearch?: PartSearchSupport | null;
  /** Tells the parent a part search is running (it refreshes the budget banner). */
  onPaidSearch?: (running: boolean) => void;
};

const field = "rounded-full border border-hairline bg-surface-3 px-3 py-1.5 text-[13px] disabled:opacity-50";
const area = "rounded-inner border border-hairline bg-surface-3 px-3 py-2 text-[13px] disabled:opacity-50";
const APPROVALS: { value: ProductData["approval"]; label: string }[] = [
  { value: "unknown", label: "Unknown" },
  { value: "abe", label: "ABE (general operating permit)" },
  { value: "e_mark", label: "E-mark" },
  { value: "teilegutachten", label: "Teilegutachten (parts report)" },
  { value: "none", label: "No approval" },
];
const BASES: { value: BuildItemData["taxBasis"]; label: string }[] = [
  { value: "unknown", label: "Unknown" }, { value: "gross", label: "Gross (with 19% VAT)" }, { value: "net", label: "Net (without VAT)" },
];

const centsText = priceCentsText; // cents as typed euros the parser accepts, e.g. 123456 becomes "1234,56"

/**
 * Inline form for one build item: product, price as listed, approval, labor and notes.
 * It only builds a patch; BuildSheet applies it with editItem and saves. Nothing is saved here.
 */
export function ProductFields({ item, disabled, saving, error, onSave, onCancel, partSearch, onPaidSearch }: Props) {
  const id = useId();
  const old = item.product;
  const [name, setName] = useState(old?.name ?? "");
  const [url, setUrl] = useState(old?.url ?? "");
  const [brand, setBrand] = useState(old?.brand ?? "");
  const [partNumber, setPartNumber] = useState(old?.partNumber ?? "");
  // A labor-only item has price 0 and a basis the mechanic never chose: going back to a part starts unknown.
  const wasLaborOnly = item.costKind === "labor_only";
  const [initialPrice] = useState(() => (wasLaborOnly ? "" : centsText(item.partPriceCents))); // the text the field started with
  const [priceText, setPriceText] = useState(initialPrice);
  const [taxBasis, setTaxBasis] = useState<BuildItemData["taxBasis"]>(wasLaborOnly ? "unknown" : item.taxBasis);
  const [approval, setApproval] = useState<ProductData["approval"]>(old?.approval ?? "unknown");
  const [approvalText, setApprovalText] = useState(old?.approvalText ?? "");
  const [laborText, setLaborText] = useState(item.laborMinutes === null ? "" : String(item.laborMinutes));
  const [laborOnly, setLaborOnly] = useState(item.costKind === "labor_only");
  const [zeroConfirmed, setZeroConfirmed] = useState(item.zeroLaborConfirmed);
  const [notes, setNotes] = useState(item.mechanicNotes);
  // The server product the mechanic chose with "Use this"; kept whole so an unchanged pick saves exactly as found.
  const [picked, setPicked] = useState<ProductData | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // Fixed for this form, so a retry after an error builds the very same product (and the same history step id).
  const [stamp] = useState(() => ({ id: crypto.randomUUID(), now: new Date() }));

  // Price text is checked while typing; blank means unknown.
  const priceCheck = !laborOnly && priceText.trim() !== "" ? parseEuroInput(priceText) : null;
  const priceError = priceCheck && !priceCheck.ok ? priceCheck.message : null;
  const laborTrim = laborText.trim();
  const laborMinutes = laborTrim === "" ? null : /^\d+$/.test(laborTrim) ? Number(laborTrim) : NaN;
  const laborError = Number.isNaN(laborMinutes) || (laborMinutes !== null && laborMinutes > 10080)
    ? "Enter whole minutes from 0 to 10080, or leave empty if unknown." : null;
  const zeroLabor = laborMinutes === 0;

  const hasName = name.trim() !== "", hasUrl = url.trim() !== "";
  const hasApproval = approval !== "unknown" || approvalText.trim() !== "";
  const productError = laborOnly ? null
    : hasApproval && !(hasName && hasUrl) ? "Approval needs a product. Enter both a product name and an https link."
    : hasName !== hasUrl ? "A product needs both a name and an https link."
    : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    if (priceError || laborError || productError) { setFormError("Fix the marked fields first."); return; }
    setFormError(null);
    const patch: ItemPatch = {
      laborMinutes, zeroLaborConfirmed: zeroLabor ? zeroConfirmed : false, mechanicNotes: notes.trim(),
    };
    if (laborOnly) {
      patch.costKind = "labor_only"; // editItem sets price 0 and removes the product
    } else {
      patch.costKind = "part";
      patch.partPriceCents = priceCheck && priceCheck.ok ? priceCheck.cents : null; // unknown stays null, never 0
      patch.taxBasis = taxBasis;
      // The price text counts as changed against what the form started with (or what the pick filled in).
      const baseline = picked ? pickedProductFields(picked).priceText : initialPrice;
      const out = productToSave({
        old, picked, fields: { name, url, brand, partNumber, approval, approvalText, priceText, taxBasis },
        priceTextChanged: priceText.trim() !== baseline, stamp,
      });
      if (!out.ok) { setFormError(out.message); return; }
      // Same object as before means nothing to change; null with an old product means it was removed.
      if (out.product !== old && (out.product !== null || old !== null)) patch.product = out.product;
    }
    onSave(patch);
  }

  function usePicked(product: ProductData) {
    const f = pickedProductFields(product);
    setName(f.name); setUrl(f.url); setBrand(f.brand); setPartNumber(f.partNumber);
    setApproval(f.approval); setApprovalText(f.approvalText); setPriceText(f.priceText); setTaxBasis(f.taxBasis);
    setPicked(product);
    setFormError(null);
  }

  const err = (suffix: string) => `${id}-${suffix}`;
  const errorText = (text: string | null, suffix: string) => text && (
    <span id={err(suffix)} className="text-danger-soft-text text-[12px]">
      <span aria-hidden="true" className="mr-1 font-semibold">✕</span>{text}
    </span>
  );

  const showSearch = !!partSearch && (partSearch.flags.query || partSearch.flags.url);
  return (
    <div className="flex flex-col gap-3">
    {showSearch && (
      <ShopSearchPanel item={item} support={partSearch} urlText={url} disabled={disabled || saving || laborOnly}
        onPaidSearch={onPaidSearch} onUse={usePicked} />
    )}
    <form onSubmit={submit} onChange={() => setFormError(null)} className="flex flex-col gap-3 rounded-card border border-hairline bg-surface-3 p-3">
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" role="switch" checked={laborOnly} disabled={disabled} onChange={(e) => setLaborOnly(e.target.checked)} />
        Labor only (no part cost, no product)
      </label>

      <fieldset disabled={laborOnly || disabled} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="mb-1 p-0 text-[13px] font-semibold">Product</legend>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-[13px]">
            Product name
            <input className={field} value={name} maxLength={200} onChange={(e) => setName(e.target.value)}
              aria-invalid={!!productError} aria-describedby={productError ? err("product") : undefined} />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            Product link (https)
            <input className={field} type="url" inputMode="url" value={url} maxLength={2048} placeholder="https://"
              onChange={(e) => setUrl(e.target.value)}
              aria-invalid={!!productError} aria-describedby={productError ? err("product") : undefined} />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            Brand
            <input className={field} value={brand} maxLength={200} onChange={(e) => setBrand(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            Part number
            <input className={`${field} tabular`} value={partNumber} maxLength={200} onChange={(e) => setPartNumber(e.target.value)} />
          </label>
        </div>
        {errorText(productError, "product")}
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-[13px]">
            Price as listed (EUR)
            <input className={`${field} tabular`} inputMode="decimal" value={priceText} placeholder="Unknown, e.g. 1.234,56"
              onChange={(e) => setPriceText(e.target.value)}
              aria-invalid={!!priceError} aria-describedby={priceError ? err("price") : undefined} />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            Price basis
            <select className={field} value={taxBasis} onChange={(e) => setTaxBasis(e.target.value as BuildItemData["taxBasis"])}>
              {BASES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </label>
        </div>
        {errorText(priceError, "price")}
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-[13px]">
            Approval
            <select className={field} value={approval} onChange={(e) => setApproval(e.target.value as ProductData["approval"])}>
              {APPROVALS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            Approval text (number or note)
            <input className={`${field} tabular`} value={approvalText} maxLength={2000} onChange={(e) => setApprovalText(e.target.value)} />
          </label>
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-[13px]">
          Labor minutes
          <input className={`${field} tabular w-[160px]`} inputMode="numeric" value={laborText} placeholder="Unknown" disabled={disabled}
            onChange={(e) => setLaborText(e.target.value)}
            aria-invalid={!!laborError} aria-describedby={laborError ? err("labor") : undefined} />
        </label>
        {errorText(laborError, "labor")}
        {zeroLabor && (
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={zeroConfirmed} disabled={disabled} onChange={(e) => setZeroConfirmed(e.target.checked)} />
            Yes, this part needs no labor
          </label>
        )}
        <label className="flex flex-col gap-1 text-[13px]">
          Mechanic notes
          <textarea className={area} rows={2} value={notes} maxLength={2000} disabled={disabled} onChange={(e) => setNotes(e.target.value)}
            aria-describedby={zeroLabor ? err("notes") : undefined} />
        </label>
        {zeroLabor && <span id={err("notes")} className="text-text-muted text-[12px]">Zero labor needs the box above and a note saying why.</span>}
      </div>

      {(formError ?? error) && (
        <p role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">✕</span>{formError ?? error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={disabled}
          className="rounded-full bg-primary px-4 py-1.5 text-on-fill text-[13px] disabled:opacity-50">
          {saving ? "Saving…" : "Save change"}
        </button>
        <button type="button" onClick={onCancel} disabled={saving}
          className="rounded-full border border-hairline px-4 py-1.5 text-[13px] disabled:opacity-50">
          Cancel
        </button>
      </div>
    </form>
    </div>
  );
}

// ------------------------------------------------------------ shop search

const GROUNDED_USD = prices.reservations["spark-grounded-base"] / 1_000_000;
const URL_USD = prices.reservations["spark-ungrounded"] / 1_000_000;
const REGIONS: Record<ProductData["fulfillmentRegion"], string> = {
  eu: "Ships within the EU", outside_eu: "Ships from outside the EU", unknown: "Shipping region unknown",
};
const LINK_STATES: Record<ProductData["linkState"], { icon: string; word: string }> = {
  reachable: { icon: "✓", word: "Link reachable" }, unchecked: { icon: "ⓘ", word: "Link not checked" },
  unreachable: { icon: "✕", word: "Link not reachable" },
};

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return "unknown shop"; }
}

type SearchState =
  | { kind: "idle" } | { kind: "running"; mode: "query" | "url" }
  | { kind: "done"; response: SearchResponseData } | { kind: "error"; message: string };

/** "Find in your shops": one explicit click is one search; there is no automatic retry. */
function ShopSearchPanel({ item, support, urlText, disabled, onPaidSearch, onUse }: {
  item: BuildItemData; support: PartSearchSupport; urlText: string; disabled: boolean;
  onPaidSearch?: (running: boolean) => void; onUse: (p: ProductData) => void;
}) {
  const bike = support.bike?.bike ?? null;
  const [query, setQuery] = useState(() =>
    [slotInfo(item.slot).label, bike?.make, bike?.model].filter((t) => !!t).join(" "));
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const inFlight = useRef(false); // blocks a second click before React has re-rendered the disabled buttons
  const abort = useRef<AbortController | null>(null);
  const notify = useRef(onPaidSearch);
  useEffect(() => { notify.current = onPaidSearch; }, [onPaidSearch]);
  // Leaving the form stops waiting for the answer.
  useEffect(() => () => abort.current?.abort(), []);

  const running = state.kind === "running";
  const reason = !bike ? "Confirm the bike first. A shop search needs the confirmed bike." : null;
  const blocked = disabled || running || reason !== null;
  const trimmedUrl = urlText.trim();

  async function search(mode: "query" | "url") {
    if (inFlight.current || !bike) return;
    if (mode === "url" && !/^https:\/\//i.test(trimmedUrl)) {
      setState({ kind: "error", message: "Enter the shop link (https) in the Product link field first." });
      return;
    }
    if (mode === "query" && query.trim() === "") { setState({ kind: "error", message: "Enter what to look for." }); return; }
    inFlight.current = true;
    const controller = new AbortController();
    abort.current = controller;
    setState({ kind: "running", mode });
    notify.current?.(true);
    const preferredDomains = support.preferredDomains.slice(0, 10);
    try {
      const response = await requestPartSearch(mode === "query"
        ? { mode, bike, slot: item.slot, query: query.trim(), preferredDomains }
        : { mode, bike, slot: item.slot, url: trimmedUrl, preferredDomains }, controller.signal);
      if (!controller.signal.aborted) setState({ kind: "done", response });
    } catch (e) {
      if (controller.signal.aborted) setState({ kind: "error", message: "Cancelled. Nothing was filled in." });
      else setState({ kind: "error", message: e instanceof PreflightError || e instanceof Error ? e.message : "The search failed." });
    } finally {
      abort.current = null;
      inFlight.current = false;
      notify.current?.(false);
    }
  }

  const isMock = state.kind === "done" && (state.response.warnings.some((w) => w.includes(MOCK_LABEL))
    || state.response.products.some((p) => p.name.includes(MOCK_LABEL)));

  return (
    <section aria-label="Find in your shops" className="flex flex-col gap-2 rounded-card border border-hairline bg-surface-2 p-3 text-[13px]">
      <h3 className="text-[15px] font-semibold">Find in your shops</h3>
      <p className="text-text-muted text-[12px]">
        Looks only at the shops set in your shop settings. Results are suggestions: check the price and the paperwork yourself.
      </p>
      {support.flags.query && (
        <div className="flex flex-col gap-1">
          <label className="flex flex-col gap-1">
            What to look for
            <input className={field} value={query} maxLength={500} disabled={blocked}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (!blocked) void search("query"); } }} />
          </label>
          <button type="button" disabled={blocked} onClick={() => void search("query")}
            className="self-start rounded-full bg-primary px-4 py-1.5 text-on-fill disabled:opacity-50">
            Search shops
          </button>
          <p className="text-text-muted text-[12px]">
            A web search costs money: it reserves about <span className="tabular">${GROUNDED_USD.toFixed(2)}</span> plus a search allowance; the actual cost is not known yet.
          </p>
        </div>
      )}
      {support.flags.url && (
        <div className="flex flex-col gap-1">
          <button type="button" disabled={blocked || trimmedUrl === ""} onClick={() => void search("url")}
            className="self-start rounded-full border border-hairline px-4 py-1.5 disabled:opacity-50">
            Look up a shop link
          </button>
          <p className="text-text-muted text-[12px]">
            Reads the link in the Product link field below. It reserves about <span className="tabular">${URL_USD.toFixed(2)}</span> and is settled from the real use.
          </p>
        </div>
      )}
      {reason && <p className="text-text-muted text-[12px]">{reason}</p>}
      {running && (
        <div role="status" className="flex flex-col gap-1">
          <p className="text-text-secondary">{state.mode === "query" ? "Searching your shops…" : "Reading the shop page…"}</p>
          <button type="button" onClick={() => abort.current?.abort()}
            className="self-start rounded-full border border-hairline px-3 py-1">Cancel</button>
          <p className="text-text-muted text-[12px]">Cancel stops waiting here. An AI call that was already submitted may still incur cost.</p>
        </div>
      )}
      {state.kind === "error" && (
        <p role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text">
          <span aria-hidden="true" className="mr-1 font-semibold">✕</span>{state.message} You can still fill in the form by hand.
        </p>
      )}
      {state.kind === "done" && (
        <div className="flex flex-col gap-2">
          {isMock && (
            <p className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text">
              <span aria-hidden="true" className="mr-1 font-semibold">⚠</span>{MOCK_LABEL}: these results are examples, not real shop data.
            </p>
          )}
          {state.response.warnings.map((w) => (
            <p key={w} className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text">
              <span aria-hidden="true" className="mr-1 font-semibold">⚠</span>{w}
            </p>
          ))}
          {state.response.products.length === 0 && (
            <p role="status" className="text-text-secondary">No matching product found. You can still fill in the form by hand.</p>
          )}
          <ul aria-label="Search results" className="flex flex-col gap-2">
            {state.response.products.map((p) => <ResultRow key={p.id} product={p} disabled={disabled} onUse={onUse} />)}
          </ul>
        </div>
      )}
    </section>
  );
}

function ResultRow({ product: p, disabled, onUse }: { product: ProductData; disabled: boolean; onUse: (p: ProductData) => void }) {
  const price = p.priceText ?? (p.priceEurCents !== null ? formatEuroCents(p.priceEurCents) : null);
  const link = LINK_STATES[p.linkState];
  return (
    <li className="flex flex-col gap-1 rounded-inner border border-hairline bg-surface-3 p-2">
      <p className="font-semibold">{p.name}</p>
      <p className="text-text-secondary">
        {p.brand && <span>{p.brand} · </span>}
        <span className="tabular">{hostOf(p.url)}</span>
      </p>
      <p>
        {price ? <span className="tabular">{price}</span> : (
          <span className="rounded-chip bg-warning-soft px-2 py-0.5 text-warning-soft-text"><span aria-hidden="true">? </span>Price unknown, check the shop</span>
        )}
        <span className="ml-2 text-text-muted">{BASES.find((b) => b.value === p.taxBasis)?.label}</span>
      </p>
      <p className="flex flex-wrap items-center gap-2">
        <span className="rounded-chip bg-neutral-soft px-2 py-0.5 text-neutral-soft-text">
          {APPROVALS.find((a) => a.value === p.approval)?.label}
        </span>
        <span className="text-text-muted">{REGIONS[p.fulfillmentRegion]}</span>
      </p>
      <p className="text-text-muted text-[12px]">
        <a href={p.source.url} target="_blank" rel="noopener noreferrer" className="text-primary-ink underline underline-offset-2">
          Source: {p.source.title}<span className="sr-only"> (opens in a new tab)</span>
        </a>
        {" · "}accessed <span className="tabular">{p.source.accessedAt.slice(0, 16).replace("T", " ")} UTC</span>
        {" · "}<span aria-hidden="true">{link.icon} </span>{link.word}
      </p>
      <button type="button" disabled={disabled} onClick={() => onUse(p)}
        className="self-start rounded-full bg-primary px-4 py-1 text-on-fill disabled:opacity-50">Use this</button>
    </li>
  );
}
