"use client";

import { useId, useState } from "react";
import { formatEuroCents, parseEuroInput } from "@/lib/project";
import { suggestFees } from "@/lib/quote";
import { slotInfo } from "@/lib/slots";
import type { BuildItemData, FeeData, InspectionReviewData, ShopSettings } from "@/lib/types";

/** One save = one new sheet version. `review` undefined keeps the saved review. Resolves true when saved. */
export type FeeSave = (change: { fees: FeeData[]; review?: InspectionReviewData | null }) => Promise<boolean>;

type Props = {
  items: readonly BuildItemData[];
  fees: readonly FeeData[];
  review: InspectionReviewData | null;
  /** fitInputHash of the current build; null when it cannot be computed (no confirmed bike). */
  currentHash: string | null;
  /** The shop's settings, or null while they load. */
  settings: ShopSettings | null;
  /** True while a save runs or the sheet cannot be changed. */
  disabled: boolean;
  /** Plain words for why saving is not possible now, or null. */
  disabledReason: string | null;
  /** Message of the last failed save, kept so the mechanic can retry. */
  problem: string | null;
  onSave: FeeSave;
};

const field = "rounded-full border border-hairline bg-surface-3 px-3 py-1.5 text-[13px] disabled:opacity-50";
const area = "rounded-inner border border-hairline bg-surface-3 px-3 py-2 text-[13px] disabled:opacity-50";
const buttonLine = "rounded-full border border-hairline px-4 py-1.5 text-[13px] disabled:opacity-50";
const buttonPrimary = "rounded-full bg-primary px-4 py-1.5 text-on-fill text-[13px] disabled:opacity-50";

const KINDS: { value: FeeData["kind"]; label: string }[] = [
  { value: "aenderungsabnahme", label: "Änderungsabnahme (estimated)" },
  { value: "einzelabnahme", label: "Einzelabnahme (estimated)" },
  { value: "official_fee", label: "Official fee, no VAT" },
  { value: "other", label: "Other allowance (estimated)" },
];
const kindWord = (k: FeeData["kind"]) => KINDS.find((x) => x.value === k)?.label ?? k;

const DECISIONS: { value: InspectionReviewData["decision"]; label: string; help: string }[] = [
  { value: "none", label: "No inspection fee is needed", help: "The build needs no Änderungsabnahme or Einzelabnahme." },
  { value: "fees_added", label: "Inspection fees were added", help: "Needs at least one confirmed fee line below." },
  { value: "unresolved", label: "Not decided yet", help: "The estimate stays an incomplete draft." },
];

const centsText = (c: number | null) => (c === null ? "" : `${Math.floor(c / 100)},${String(c % 100).padStart(2, "0")}`);

const itemLabel = (i: BuildItemData) => `${slotInfo(i.slot).label}: ${i.title}`;

/** Add or edit one fee line. Builds a FeeData; the parent saves it. The id stays the same on retry. */
function FeeForm({ initial, items, disabled, onSubmit, onCancel }: {
  initial: FeeData | null; items: readonly BuildItemData[]; disabled: boolean;
  onSubmit: (fee: FeeData) => void; onCancel: () => void;
}) {
  const id = useId();
  const [feeId] = useState(() => initial?.id ?? crypto.randomUUID()); // fixed for this form
  const [label, setLabel] = useState(initial?.label ?? "");
  const [kind, setKind] = useState<FeeData["kind"]>(initial?.kind ?? "aenderungsabnahme");
  const [amount, setAmount] = useState(centsText(initial?.netCents ?? null));
  const [covered, setCovered] = useState<string[]>(initial?.itemIds ?? []);
  const [confirmed, setConfirmed] = useState(initial?.confirmed ?? false);
  const [error, setError] = useState<string | null>(null);

  const amountCheck = amount.trim() === "" ? null : parseEuroInput(amount);
  const amountError = amountCheck && !amountCheck.ok ? amountCheck.message : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const name = label.trim();
    if (name === "" || name.length > 200) { setError("Enter a label of 1 to 200 characters."); return; }
    if (amountError) { setError("Fix the amount first."); return; }
    const cents = amountCheck && amountCheck.ok ? amountCheck.cents : null; // blank stays unknown, never 0
    if (confirmed && cents === null) { setError("Enter the amount before you confirm the fee."); return; }
    setError(null);
    onSubmit({ id: feeId, label: name, kind, netCents: cents, itemIds: covered, confirmed });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-card border border-hairline bg-surface-3 p-3">
      <label className="flex flex-col gap-1 text-[13px]">
        Label
        <input className={field} value={label} maxLength={200} disabled={disabled} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[13px]">
          Kind
          <select className={field} value={kind} disabled={disabled} onChange={(e) => setKind(e.target.value as FeeData["kind"])}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          Amount (EUR net)
          <input className={`${field} tabular`} inputMode="decimal" value={amount} disabled={disabled} placeholder="Unknown, e.g. 50,42"
            aria-invalid={!!amountError} aria-describedby={amountError ? `${id}-amount` : undefined} onChange={(e) => setAmount(e.target.value)} />
        </label>
      </div>
      {amountError && (
        <span id={`${id}-amount`} className="text-danger-soft-text text-[12px]"><span aria-hidden="true" className="mr-1 font-semibold">✕</span>{amountError}</span>
      )}
      <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0" disabled={disabled}>
        <legend className="mb-1 p-0 text-[13px]">Parts this fee covers (one fee for all of them, never one per part)</legend>
        {items.length === 0 && <span className="text-text-muted text-[12px]">There are no parts on the sheet.</span>}
        {items.map((it) => (
          <label key={it.id} className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={covered.includes(it.id)}
              onChange={(e) => setCovered((c) => (e.target.checked ? [...c, it.id] : c.filter((x) => x !== it.id)))} />
            {itemLabel(it)}
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={confirmed} disabled={disabled} onChange={(e) => setConfirmed(e.target.checked)} />
        I confirm this fee and its amount
      </label>
      {error && (
        <p role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">✕</span>{error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={disabled} className={buttonPrimary}>{initial ? "Save fee line" : "Add fee line"}</button>
        <button type="button" disabled={disabled} onClick={onCancel} className={buttonLine}>Cancel</button>
      </div>
    </form>
  );
}

/** The inspection review decision for the current build. Starts from the saved review when there is one. */
function ReviewForm({ review, currentHash, disabled, disabledReason, onSave }: {
  review: InspectionReviewData | null; currentHash: string | null; disabled: boolean; disabledReason: string | null;
  onSave: (r: InspectionReviewData) => void;
}) {
  const id = useId();
  const [decision, setDecision] = useState<InspectionReviewData["decision"]>(review?.decision ?? "unresolved");
  const [notes, setNotes] = useState(review?.notes ?? "");
  const state = review === null ? "No review saved yet."
    : currentHash !== null && review.fitInputHash === currentHash ? `Review saved on ${review.reviewedAt.slice(0, 10)} for this build.`
    : "The saved review belongs to an older build and no longer counts. Review again.";
  const cannot = disabled || currentHash === null;
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => {
      e.preventDefault();
      if (cannot || currentHash === null) return;
      onSave({ fitInputHash: currentHash, decision, notes: notes.trim(), reviewedAt: new Date().toISOString() });
    }}>
      <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0" disabled={disabled}>
        <legend className="mb-1 p-0 text-[13px] font-semibold">Inspection review</legend>
        {DECISIONS.map((d) => (
          <label key={d.value} className="flex items-start gap-2 text-[13px]">
            <input type="radio" name={`${id}-decision`} checked={decision === d.value} onChange={() => setDecision(d.value)} className="mt-1" />
            <span>{d.label}<span className="block text-text-muted text-[12px]">{d.help}</span></span>
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1 text-[13px]">
        Notes
        <textarea className={area} rows={2} value={notes} maxLength={2000} disabled={disabled} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <p role="status" className="text-text-muted text-[12px]">
        <span aria-hidden="true" className="mr-1">ⓘ</span>{state}
        {currentHash === null && " Confirm the bike first: the review is tied to the confirmed build."}
      </p>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={cannot} className={buttonLine}>Save inspection review</button>
        {disabledReason && <span className="text-text-muted text-[12px]">{disabledReason}</span>}
      </div>
    </form>
  );
}

type Editing = { kind: "add" } | { kind: "edit"; id: string } | null;

/**
 * Build-level inspection fees and the review decision. Each button saves once as one sheet version
 * (the parent does the saving and refuses while another save runs). Amounts are integer cents.
 */
export function InspectionFees({ items, fees, review, currentHash, settings, disabled, disabledReason, problem, onSave }: Props) {
  const [editing, setEditing] = useState<Editing>(null);
  // Suggestions are recomputed from the sheet each render; ids are only made when the button is pressed.
  const preview = settings ? suggestFees(items, fees, settings, () => "preview") : [];
  const byId = new Map(items.map((i) => [i.id, i]));

  function addSuggested() {
    if (!settings || disabled) return;
    const made = suggestFees(items, fees, settings, () => crypto.randomUUID());
    if (made.length > 0) void onSave({ fees: [...fees, ...made] });
  }

  async function submitFee(fee: FeeData) {
    const exists = fees.some((f) => f.id === fee.id);
    const next = exists ? fees.map((f) => (f.id === fee.id ? fee : f)) : [...fees, fee];
    if (await onSave({ fees: next })) setEditing(null); // a failed save keeps the form open
  }

  return (
    <section aria-label="Inspection fees" className="flex flex-col gap-3 rounded-card border border-hairline bg-surface-2 p-3">
      <h3 className="text-[15px] font-semibold">Inspection fees</h3>
      <p className="text-text-muted text-[12px]">
        One fee line can cover several parts; the same inspection is never charged once per part. Amounts are estimates until you confirm them.
      </p>

      {preview.length > 0 && (
        <div className="flex flex-col gap-2 rounded-chip bg-neutral-soft p-3 text-neutral-soft-text text-[13px]">
          <p className="font-semibold"><span aria-hidden="true" className="mr-1">ⓘ</span>Suggested fees from the fit checks (not added yet)</p>
          <ul className="flex flex-col gap-1">
            {preview.map((f) => (
              <li key={f.id + f.kind}>
                {f.label}: <span className="tabular">{f.netCents === null ? "amount not set in settings" : formatEuroCents(f.netCents)}</span>
                <span className="text-text-muted"> covers {f.itemIds.map((id) => { const it = byId.get(id); return it ? slotInfo(it.slot).label : id; }).join(", ")}</span>
              </li>
            ))}
          </ul>
          <button type="button" disabled={disabled} onClick={addSuggested} className={`${buttonLine} self-start bg-surface-3 text-text`}>Add suggested fees</button>
          <p className="text-[12px]">They are added as not confirmed. Confirm each amount afterwards.</p>
        </div>
      )}

      {fees.length === 0 && editing === null && <p className="text-text-muted text-[13px]">No fee lines yet.</p>}
      <ul aria-label="Fee lines" className="flex flex-col gap-2">
        {fees.map((f) => {
          const open = editing?.kind === "edit" && editing.id === f.id;
          if (open) {
            return <li key={f.id}><FeeForm initial={f} items={items} disabled={disabled} onSubmit={(fee) => void submitFee(fee)} onCancel={() => setEditing(null)} /></li>;
          }
          return (
            <li key={f.id} className="flex flex-col gap-1 rounded-chip border border-hairline bg-surface-3 p-2 text-[13px]">
              <p className="font-semibold">{f.label}</p>
              <p className="flex flex-wrap items-center gap-2">
                <span>{kindWord(f.kind)}</span>
                <span className="tabular">{f.netCents === null ? "Amount unknown" : formatEuroCents(f.netCents)}</span>
                {f.confirmed
                  ? <span className="rounded-chip bg-success-soft px-2 py-0.5 text-success-soft-text text-[12px]"><span aria-hidden="true">✓ </span>Confirmed</span>
                  : <span className="rounded-chip bg-warning-soft px-2 py-0.5 text-warning-soft-text text-[12px]"><span aria-hidden="true">⚠ </span>Not confirmed</span>}
              </p>
              <p className="text-text-muted text-[12px]">
                Covers: {f.itemIds.length === 0 ? "no part selected" : f.itemIds.map((id) => { const it = byId.get(id); return it ? slotInfo(it.slot).label : "a removed part"; }).join(", ")}
              </p>
              <div className="flex gap-2">
                <button type="button" disabled={disabled} onClick={() => setEditing({ kind: "edit", id: f.id })} aria-label={`Edit fee ${f.label}`} className={buttonLine}>Edit</button>
                <button type="button" disabled={disabled} aria-label={`Remove fee ${f.label}`} className={buttonLine}
                  onClick={() => void onSave({ fees: fees.filter((x) => x.id !== f.id) })}>Remove</button>
              </div>
            </li>
          );
        })}
      </ul>
      {editing?.kind === "add" ? (
        <FeeForm initial={null} items={items} disabled={disabled} onSubmit={(fee) => void submitFee(fee)} onCancel={() => setEditing(null)} />
      ) : (
        <button type="button" disabled={disabled || editing !== null} onClick={() => setEditing({ kind: "add" })} className={`${buttonLine} self-start`}>Add fee line</button>
      )}

      {/* The key restarts the form for another saved review, so its fields show what is saved. */}
      <ReviewForm key={review ? review.reviewedAt : "none"} review={review} currentHash={currentHash} disabled={disabled} disabledReason={disabledReason}
        onSave={(r) => void onSave({ fees: [...fees], review: r })} />

      {problem && (
        <p role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">✕</span>{problem}
        </p>
      )}
    </section>
  );
}
