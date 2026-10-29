"use client";

import { useId, useState } from "react";
import { manualProduct, parseEuroInput, type ItemPatch } from "@/lib/project";
import type { BuildItemData, ProductData } from "@/lib/types";

type Props = {
  item: BuildItemData;
  /** True while saving or while the sheet is locked; the form stays filled in. */
  disabled: boolean;
  saving: boolean;
  /** Message from the last failed save of this draft (kept so the mechanic can retry). */
  error: string | null;
  onSave: (patch: ItemPatch) => void;
  onCancel: () => void;
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

/** Cents as typed euros the parser accepts, e.g. 123456 becomes "1234,56". */
const centsText = (c: number | null) => (c === null ? "" : `${Math.floor(c / 100)},${String(c % 100).padStart(2, "0")}`);
const orNull = (t: string) => (t.trim() === "" ? null : t.trim());

/**
 * Inline form for one build item: product, price as listed, approval, labor and notes.
 * It only builds a patch; BuildSheet applies it with editItem and saves. Nothing is saved here.
 */
export function ProductFields({ item, disabled, saving, error, onSave, onCancel }: Props) {
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
      if (hasName && hasUrl) {
        const sameProduct = old !== null && old.name === name.trim() && old.url === url.trim() &&
          old.brand === orNull(brand) && old.partNumber === orNull(partNumber) &&
          old.approval === approval && old.approvalText === orNull(approvalText);
        if (sameProduct) {
          // Keep the saved product (its source and link state); only the typed price text may change.
          if (priceText.trim() !== initialPrice) patch.product = { ...old, priceText: orNull(priceText) };
        } else {
          const made = manualProduct({ name, brand, partNumber, url, priceText, approval, approvalText }, stamp);
          if (!made.ok) { setFormError(made.message); return; }
          patch.product = made.product;
        }
      } else if (old !== null) {
        patch.product = null; // both fields cleared: the mechanic removed the product
      }
    }
    onSave(patch);
  }

  const err = (suffix: string) => `${id}-${suffix}`;
  const errorText = (text: string | null, suffix: string) => text && (
    <span id={err(suffix)} className="text-danger-soft-text text-[12px]">
      <span aria-hidden="true" className="mr-1 font-semibold">✕</span>{text}
    </span>
  );

  return (
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
  );
}
