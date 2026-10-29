"use client";

import { useEffect, useRef, useState } from "react";
import { editItem, laborDisplay, priceDisplay, removeItem, type ItemPatch } from "@/lib/project";
import { slotInfo } from "@/lib/slots";
import type { BuildItemData, FeeData, Version } from "@/lib/types";
import { ProductFields } from "./ProductFields";

/** What BuildSheet hands to Workspace to save: the new items for a child of `headId`. */
export type SheetChange = { headId: string; versionId: string; items: BuildItemData[]; fees: FeeData[] };
export type SheetSaveResult = { ok: true; unchanged: boolean } | { ok: false; message: string };

type Props = {
  /** The version shown now, or null when there is no saved project. */
  head: Version | null;
  /** Permanent reason the sheet cannot be changed (no saved project, read-only storage). */
  readOnlyReason: string | null;
  /** Temporary reason (a preview is waiting, a step change is running). */
  blockedReason: string | null;
  saving: boolean;
  onSave: (change: SheetChange) => Promise<SheetSaveResult>;
  onClose: () => void;
};

const button = "rounded-full border border-hairline px-4 py-1.5 text-[13px] disabled:opacity-50";

/** Small question-mark circle: marks an unknown price with a shape as well as words. */
function UnknownIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 shrink-0">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.2 6.3a1.9 1.9 0 1 1 2.7 1.7c-.6.3-.9.7-.9 1.3M8 11.4v.1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

type RowState = { headId: string; itemId: string; mode: "edit" | "remove" } | null;

/**
 * The sheet of the version shown: one row per part, each with Edit and Remove.
 * Every save makes a new "sheet" step in the history; Undo goes back. The photo never changes.
 */
export function BuildSheet({ head, readOnlyReason, blockedReason, saving, onSave, onClose }: Props) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [row, setRow] = useState<RowState>(null);
  const [problem, setProblem] = useState<{ itemId: string; text: string } | null>(null);
  // The note belongs to the step it describes, so Undo or a jump hides it.
  const [note, setNote] = useState<{ versionId: string; text: string } | null>(null);
  // One id per draft: a retry of the same draft reuses it (so it can never be saved twice);
  // any change to the draft gets a new one.
  const draft = useRef<{ key: string; id: string } | null>(null);
  const inFlight = useRef(false); // blocks a second click before React has re-rendered the disabled button

  // Keyboard users land on the panel when it opens.
  useEffect(() => { titleRef.current?.focus(); }, []);

  const locked = readOnlyReason !== null || blockedReason !== null || saving;
  // A row state from an older version is ignored (Undo, Redo or a jump changed the sheet under it).
  const open = row && head && row.headId === head.id ? row : null;
  const items = head ? head.items : [];

  async function commit(itemId: string, change: { items: BuildItemData[]; fees: FeeData[]; fitsCleared: boolean }) {
    if (!head || inFlight.current) return;
    inFlight.current = true;
    const key = JSON.stringify([head.id, change.items, change.fees]);
    if (draft.current?.key !== key) draft.current = { key, id: crypto.randomUUID() };
    const versionId = draft.current.id;
    try {
      const out = await onSave({ headId: head.id, versionId, items: change.items, fees: change.fees });
      if (!out.ok) { setProblem({ itemId, text: out.message }); return; } // the draft stays open
      // The draft is done: a later identical change (for example after Undo) must get a new id.
      draft.current = null;
      setProblem(null);
      setRow(null);
      setNote({
        versionId,
        text: out.unchanged ? "Nothing changed, so no new step was saved."
          : change.fitsCleared ? "Fit checks were reset by this change." : "Saved as a new step. Undo goes back.",
      });
    } finally {
      inFlight.current = false;
    }
  }

  function openRow(item: BuildItemData, mode: "edit" | "remove") {
    if (!head) return;
    setProblem(null);
    setNote(null);
    setRow({ headId: head.id, itemId: item.id, mode });
  }

  function saveEdit(item: BuildItemData, patch: ItemPatch) {
    if (!head) return;
    const result = editItem(head.items, item.id, patch);
    if (!result.ok) { setProblem({ itemId: item.id, text: result.message }); return; }
    void commit(item.id, { items: result.items, fees: head.fees, fitsCleared: result.fitsCleared });
  }

  function remove(item: BuildItemData) {
    if (!head) return;
    const result = removeItem(head.items, head.fees, item.id);
    if (!result.ok) { setProblem({ itemId: item.id, text: result.message }); return; }
    void commit(item.id, { items: result.items, fees: result.fees, fitsCleared: result.fitsCleared });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 ref={titleRef} tabIndex={-1} className="text-[20px] leading-[1.35]">Build sheet</h2>
        <button type="button" onClick={onClose} disabled={saving} className={button}>Back to editor</button>
      </div>
      {readOnlyReason && (
        <p role="status" className="rounded-chip bg-neutral-soft px-3 py-2 text-neutral-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">ⓘ</span>{readOnlyReason}
        </p>
      )}
      {!readOnlyReason && blockedReason && (
        <p role="status" className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">⚠</span>{blockedReason}
        </p>
      )}
      {note && head && note.versionId === head.id && (
        <p role="status" className="rounded-chip bg-neutral-soft px-3 py-2 text-neutral-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">ⓘ</span>{note.text}
        </p>
      )}
      {head && items.length === 0 && (
        <p className="text-text-muted text-[13px]">No parts on the sheet yet. Accept a change to add one.</p>
      )}
      <ul aria-label="Parts on the sheet" className="flex flex-col gap-3">
        {items.map((item) => {
          const mode = open && open.itemId === item.id ? open.mode : null;
          const product = item.product;
          const unknownPrice = item.costKind === "part" && item.partPriceCents === null;
          const rowProblem = problem && problem.itemId === item.id ? problem.text : null;
          return (
            <li key={item.id} className="flex flex-col gap-2 rounded-card border border-hairline bg-surface-2 p-3">
              <p className="text-[15px]">
                <span className="font-semibold">{slotInfo(item.slot).label}:</span> {item.title}
              </p>
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[13px]">
                <dt className="text-text-secondary">Product</dt>
                <dd>
                  {product ? (
                    <>
                      <a href={product.url} target="_blank" rel="noopener noreferrer" className="text-primary-ink underline underline-offset-2">
                        {product.name}<span className="sr-only"> (opens in a new tab)</span>
                      </a>
                      {(product.brand || product.partNumber) && (
                        <span className="ml-2 text-text-muted">
                          {product.brand}{product.brand && product.partNumber ? " " : ""}
                          {product.partNumber && <span className="tabular">{product.partNumber}</span>}
                        </span>
                      )}
                    </>
                  ) : <span className="text-text-muted">No product yet</span>}
                </dd>
                <dt className="text-text-secondary">Part price</dt>
                <dd>
                  {unknownPrice ? (
                    <span className="inline-flex items-center gap-1 rounded-chip bg-warning-soft px-2 py-0.5 text-warning-soft-text">
                      <UnknownIcon />{priceDisplay(item)}
                    </span>
                  ) : <span className="tabular">{priceDisplay(item)}</span>}
                </dd>
                <dt className="text-text-secondary">Labor</dt>
                <dd className="tabular">{laborDisplay(item)}</dd>
              </dl>
              {!readOnlyReason && mode === null && (
                <div className="flex gap-2">
                  <button type="button" disabled={locked} onClick={() => openRow(item, "edit")}
                    aria-label={`Edit ${slotInfo(item.slot).label}`} className={button}>Edit</button>
                  <button type="button" disabled={locked} onClick={() => openRow(item, "remove")}
                    aria-label={`Remove ${slotInfo(item.slot).label}`} className={button}>Remove</button>
                </div>
              )}
              {mode === "edit" && head && (
                <ProductFields key={`${head.id}:${item.id}`} item={item} disabled={locked} saving={saving} error={rowProblem}
                  onSave={(patch) => saveEdit(item, patch)} onCancel={() => { setProblem(null); setRow(null); }} />
              )}
              {mode === "remove" && (
                <div role="group" aria-label={`Confirm removing ${slotInfo(item.slot).label}`} className="flex flex-col gap-2 rounded-chip bg-warning-soft p-3 text-warning-soft-text text-[13px]">
                  <p><span aria-hidden="true" className="mr-1 font-semibold">⚠</span>Remove this part from the sheet? The photo does not change. Undo brings it back.</p>
                  <div className="flex gap-2">
                    <button type="button" disabled={locked} onClick={() => remove(item)}
                      className="rounded-full bg-primary px-4 py-1.5 text-on-fill text-[13px] disabled:opacity-50">
                      {saving ? "Removing…" : "Yes, remove"}
                    </button>
                    <button type="button" disabled={saving} onClick={() => { setProblem(null); setRow(null); }}
                      className="rounded-full border border-hairline bg-surface-3 px-4 py-1.5 text-text text-[13px] disabled:opacity-50">Keep it</button>
                  </div>
                </div>
              )}
              {mode !== "edit" && rowProblem && (
                <p role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text text-[13px]">
                  <span aria-hidden="true" className="mr-1 font-semibold">✕</span>{rowProblem}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
