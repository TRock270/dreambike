"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { MOCK_LABEL } from "@/lib/mocks";
import {
  acknowledgeFit, activeItems, FIT_PRECHECK_NOTE, fitInputHash, fitReviewHash, fitStatusOf, formatEuroCents, LEGAL_SEED,
  type FitStatus,
} from "@/lib/project";
import { computeQuote, EXAMPLE_LABEL } from "@/lib/quote";
import { slotInfo } from "@/lib/slots";
import type { BikeRevision, BuildItemData, FeeData, InspectionReviewData, Quote, ShopSettings, Version } from "@/lib/types";
import type { SheetChange, SheetSaveResult } from "./BuildSheet";
import { FitBadge } from "./FitBadge";
import { InspectionFees, type FeeSave } from "./InspectionFees";
import { MissingCosts } from "./MissingCosts";

type Props = {
  /** The version shown now, or null when there is no saved project. */
  head: Version | null;
  /** Permanent reason the sheet cannot be changed, else null. */
  readOnlyReason: string | null;
  /** Temporary reason (a preview is waiting, a step change is running), else null. */
  blockedReason: string | null;
  saving: boolean;
  /** The shop settings of the project's record; null while they load. */
  settings: ShopSettings | null;
  /** Why the settings could not be loaded, else null. Shown in words so the panel never waits for good. */
  settingsError?: string | null;
  /** "default" or "example"; only feeds the quote hash. */
  settingsId: string;
  /** The saved bike, or null when none is saved. Without it no fit hash exists. */
  bikeRevision: BikeRevision | null;
  /** Same save path as the Build sheet (one sheet version per call). */
  onSave: (change: SheetChange) => Promise<SheetSaveResult>;
  onOpenSettings: () => void;
  onClose: () => void;
};

/** Everything computed for one head, settings object and bike revision. */
type Computed = {
  head: Version; settings: ShopSettings; rev: BikeRevision | null;
  hash: string | null; quote: Quote; rows: FitRow[];
};
type FitRow = {
  item: BuildItemData; status: FitStatus; mock: boolean; hashMatches: boolean; expired: boolean;
  reviewHash: string | null; reviewed: boolean;
};

const button = "rounded-full border border-hairline px-4 py-1.5 text-[13px] disabled:opacity-50";

/** Question-mark circle: marks an unknown amount with a shape as well as words. */
function UnknownCell({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-chip bg-warning-soft px-2 py-0.5 text-warning-soft-text text-[12px]">
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 shrink-0">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6.2 6.3a1.9 1.9 0 1 1 2.7 1.7c-.6.3-.9.7-.9 1.3M8 11.4v.1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {children}
    </span>
  );
}

const money = (cents: number | null, unknown = "Unknown") =>
  cents === null ? <UnknownCell>{unknown}</UnknownCell> : <span className="tabular">{formatEuroCents(cents)}</span>;

/** Works out the fit rows (status, review hash) for the estimate. Pure of React state. */
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

/**
 * The estimate: a line table, the known subtotal, and either net / VAT / gross or an incomplete draft.
 * It only reads. Saves (fit review, fee lines, inspection review) go through onSave, one sheet version each.
 */
export function EstimatePreview({
  head, readOnlyReason, blockedReason, saving, settings, settingsError, settingsId, bikeRevision, onSave, onOpenSettings, onClose,
}: Props) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []); // keyboard users land on the panel when it opens

  const [computed, setComputed] = useState<Computed | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // An older answer must not overwrite a newer one, so each run checks `alive` before it sets state.
  useEffect(() => {
    let alive = true;
    if (!head || !settings) return;
    (async () => {
      const items = activeItems(head);
      const hash = bikeRevision?.confirmed ? await fitInputHash(bikeRevision, head.items, settings.shopRules, LEGAL_SEED.version) : null;
      const now = Date.now();
      const quote = await computeQuote({
        items, fees: head.fees, inspectionReview: head.inspectionReview, settings, currentFitInputHash: hash, now, settingsId,
      });
      const rows = await buildRows(items, hash, now);
      if (alive) { setComputed({ head, settings, rev: bikeRevision, hash, quote, rows }); setFailure(null); }
    })().catch((e) => { if (alive) setFailure(e instanceof Error ? e.message : "The estimate could not be calculated."); });
    return () => { alive = false; };
  }, [head, settings, settingsId, bikeRevision]);
  // Results for an older head, settings object or bike revision are ignored until the new ones arrive.
  const now = computed && computed.head === head && computed.settings === settings && computed.rev === bikeRevision ? computed : null;

  // ---- saving: one click, one sheet version, and never two at once
  const [busy, setBusy] = useState(false);
  // The failed draft belongs to one step and one place on screen, so Undo or a jump hides it.
  const [failed, setFailed] = useState<{ headId: string; where: "fit" | "fees"; text: string } | null>(null);
  const [note, setNote] = useState<{ versionId: string; text: string } | null>(null);
  const inFlight = useRef(false); // blocks a second click before React has re-rendered the disabled buttons
  // One id per draft: a retry of the same draft reuses it, so it can never be saved twice.
  const draft = useRef<{ key: string; id: string } | null>(null);
  const locked = readOnlyReason !== null || blockedReason !== null || saving || busy;
  const lockReason = readOnlyReason ?? blockedReason ?? (saving || busy ? "Wait until the save has finished." : null);

  async function save(change: { items: BuildItemData[]; fees: FeeData[]; inspectionReview?: InspectionReviewData | null }, text: string, where: "fit" | "fees"): Promise<boolean> {
    if (!head || inFlight.current || locked) return false;
    inFlight.current = true;
    setBusy(true);
    const key = JSON.stringify([head.id, change.items, change.fees, change.inspectionReview ?? null]);
    if (draft.current?.key !== key) draft.current = { key, id: crypto.randomUUID() };
    const versionId = draft.current.id;
    try {
      const out = await onSave({ headId: head.id, versionId, ...change });
      if (!out.ok) { setFailed({ headId: head.id, where, text: out.message }); return false; } // the draft stays, so the mechanic can retry
      draft.current = null;
      setFailed(null);
      setNote({ versionId, text: out.unchanged ? "Nothing changed, so no new step was saved." : `${text} Undo goes back.` });
      return true;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const saveFees: FeeSave = (c) => head ? save({ items: head.items, fees: c.fees, inspectionReview: c.review }, "Saved as a new step.", "fees") : Promise.resolve(false);
  function markReviewed(row: FitRow) {
    if (!head || row.reviewHash === null) return;
    void save({ items: acknowledgeFit(head.items, row.item.id, row.reviewHash), fees: head.fees }, `Fit marked as reviewed for ${slotInfo(row.item.slot).label}.`, "fit");
  }

  // ---- what to show
  const quote = now?.quote ?? null;
  const problemAt = (where: "fit" | "fees") => (failed && head && failed.headId === head.id && failed.where === where ? failed.text : null);
  const itemById = new Map((head?.items ?? []).map((i) => [i.id, i]));
  const noItems = head !== null && head.items.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 ref={titleRef} tabIndex={-1} className="text-[20px] leading-[1.35]">Estimate</h2>
        <button type="button" onClick={onClose} disabled={saving || busy} className={button}>Back to editor</button>
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

      {settings?.demoRates && (
        <p role="note" className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">⚠</span><strong>Demo rates.</strong> {EXAMPLE_LABEL}. The hourly rate, labor minutes and fee allowances are illustrative. This is not a real quote.
        </p>
      )}
      {settings && !settings.shopConfirmed && (
        <div role="status" className="flex flex-col gap-2 rounded-chip bg-neutral-soft px-3 py-2 text-neutral-soft-text text-[13px]">
          <p><span aria-hidden="true" className="mr-1 font-semibold">ⓘ</span>The shop setup is not finished: the shop identity is not confirmed, so the estimate stays an incomplete draft.</p>
          <button type="button" onClick={onOpenSettings} className={`${button} self-start bg-surface-3 text-text`}>Open settings</button>
        </div>
      )}

      {!head && <p className="text-text-muted text-[13px]">Open or save a project first. Its estimate shows here.</p>}
      {noItems && <p className="text-text-muted text-[13px]">No parts on the sheet yet, so there is nothing to estimate.</p>}
      {head && !settings && settingsError && (
        <p role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">✕</span>The shop settings could not be read, so no estimate is shown: {settingsError} Open settings to replace them.
        </p>
      )}
      {head && !now && !failure && !(settingsError && !settings) && <p role="status" className="text-text-muted text-[13px]">Calculating the estimate…</p>}
      {failure && (
        <p role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">✕</span>The estimate could not be calculated: {failure}
        </p>
      )}

      {head && now && quote && (
        <>
          {quote.staleFitItemIds.length > 0 && (
            <p role="status" className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text text-[13px]">
              <span aria-hidden="true" className="mr-1 font-semibold">⚠</span>
              {quote.staleFitItemIds.length} fit {quote.staleFitItemIds.length === 1 ? "check is" : "checks are"} out of date or older than 24 hours
              ({quote.staleFitItemIds.map((id) => { const it = itemById.get(id); return it ? slotInfo(it.slot).label : id; }).join(", ")}).
              Check fit again in the Build sheet.
            </p>
          )}

          <section aria-label="Estimate lines" className="flex flex-col gap-2">
            <table className="w-full border-collapse text-[13px]">
              <caption className="sr-only">Estimate lines in euros, net of VAT</caption>
              <thead>
                <tr className="border-b border-hairline text-left text-text-secondary">
                  <th scope="col" className="py-1 pr-2 font-medium">Line</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">Part net</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">Labor net</th>
                  <th scope="col" className="py-1 pl-2 text-right font-medium">Line net</th>
                </tr>
              </thead>
              <tbody>
                {quote.lines.map((line) => (
                  <tr key={line.itemId} className="border-b border-hairline align-top">
                    <th scope="row" className="py-2 pr-2 text-left font-normal">{line.label}</th>
                    <td className="px-2 py-2 text-right">{money(line.partNetCents)}</td>
                    <td className="px-2 py-2 text-right">
                      {money(line.laborNetCents)}
                      {line.defaultMinutes && line.laborNetCents !== null && <span className="block text-text-muted text-[12px]">(shop default minutes)</span>}
                    </td>
                    <td className="py-2 pl-2 text-right">{money(line.netCents)}</td>
                  </tr>
                ))}
                {head.fees.map((fee) => (
                  <tr key={fee.id} className="border-b border-hairline align-top">
                    <th scope="row" className="py-2 pr-2 text-left font-normal">
                      {fee.label}
                      <span className="block text-text-muted text-[12px]">
                        {fee.kind === "official_fee" ? "official fee, no VAT" : "estimated"}{fee.confirmed ? "" : ", not confirmed"}
                      </span>
                    </th>
                    <td className="px-2 py-2 text-right text-text-muted">–</td>
                    <td className="px-2 py-2 text-right text-text-muted">–</td>
                    <td className="py-2 pl-2 text-right">
                      {fee.netCents === null ? <UnknownCell>Amount unknown</UnknownCell>
                        : fee.confirmed ? <span className="tabular">{formatEuroCents(fee.netCents)}</span>
                        : <span className="tabular text-text-muted">{formatEuroCents(fee.netCents)} <span className="text-[12px]">(not counted)</span></span>}
                    </td>
                  </tr>
                ))}
                {quote.lines.length === 0 && head.fees.length === 0 && (
                  <tr><td colSpan={4} className="py-2 text-text-muted">No lines.</td></tr>
                )}
              </tbody>
            </table>

            <dl className="ml-auto grid w-full max-w-[360px] grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[13px]">
              <dt className="text-text-secondary">Known subtotal (net, only the costs known so far)</dt>
              <dd className="text-right"><span className="tabular">{formatEuroCents(quote.knownSubtotalNetCents)}</span></dd>
              {quote.incomplete || quote.netCents === null || quote.vatCents === null || quote.grossCents === null ? (
                <>
                  <dt className="col-span-2 mt-1">
                    <span role="status" className="inline-flex items-center gap-1 rounded-chip bg-warning-soft px-2 py-1 text-warning-soft-text font-semibold">
                      <span aria-hidden="true">⚠</span>Incomplete draft — costs missing
                    </span>
                  </dt>
                  <dd className="col-span-2 text-text-muted text-[12px]">No net, VAT or gross total is shown, because an unknown cost is never counted as 0.</dd>
                </>
              ) : (
                <>
                  <dt className="text-text-secondary">Net total</dt>
                  <dd className="text-right"><span className="tabular">{formatEuroCents(quote.netCents)}</span></dd>
                  <dt className="text-text-secondary">VAT 19 %{quote.officialFeeCents ? " (not on the official fee)" : ""}</dt>
                  <dd className="text-right"><span className="tabular">{formatEuroCents(quote.vatCents)}</span></dd>
                  <dt className="font-semibold">Gross total</dt>
                  <dd className="text-right font-semibold"><span className="tabular">{formatEuroCents(quote.grossCents)}</span></dd>
                </>
              )}
            </dl>
          </section>

          <section aria-label="Fit review" className="flex flex-col gap-2 rounded-card border border-hairline bg-surface-2 p-3">
            <h3 className="text-[15px] font-semibold">Fit review by the mechanic</h3>
            {now.rows.length === 0 && <p className="text-text-muted text-[13px]">No parts to review.</p>}
            <ul className="flex flex-col gap-2">
              {now.rows.map((row) => {
                const label = slotInfo(row.item.slot).label;
                const canReview = row.item.fit !== null && !row.mock && row.hashMatches;
                const why = row.item.fit === null ? "Run Check fit in the Build sheet first."
                  : row.mock ? "A mock result cannot be reviewed. Run a real check."
                  : !row.hashMatches ? "The check is out of date. Check fit again in the Build sheet."
                  : null;
                return (
                  <li key={row.item.id} className="flex flex-col gap-1 text-[13px]">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{label}</span>
                      <FitBadge status={row.status} />
                      {row.mock && <span className="rounded-chip bg-warning-soft px-2 py-0.5 text-warning-soft-text text-[12px]"><span aria-hidden="true">⚠ </span>Mock result</span>}
                      {row.item.fitCheckedAt && <span className="text-text-muted text-[12px]">checked <span className="tabular">{row.item.fitCheckedAt.slice(0, 10)}</span></span>}
                      {row.reviewed && (
                        <span className="rounded-chip bg-success-soft px-2 py-0.5 text-success-soft-text text-[12px]"><span aria-hidden="true">✓ </span>Reviewed by the mechanic</span>
                      )}
                    </p>
                    {row.expired && (
                      <p className="text-warning-soft-text text-[12px]"><span aria-hidden="true">⚠ </span>This check is older than 24 hours. Reviewing it still leaves the stale notice in the estimate.</p>
                    )}
                    {row.reviewed && (row.status === "verify" || row.status === "problem") && (
                      <p className="text-text-muted text-[12px]">The finding stays on the estimate even though you reviewed it.</p>
                    )}
                    {!row.reviewed && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" disabled={!canReview || locked} onClick={() => markReviewed(row)}
                          aria-label={`Mark fit reviewed: ${label}`} className={button}>Mark fit reviewed</button>
                        {why && <span className="text-text-muted text-[12px]">{why}</span>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {problemAt("fit") && <p role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text text-[13px]"><span aria-hidden="true" className="mr-1 font-semibold">✕</span>{problemAt("fit")}</p>}
          </section>

          <InspectionFees key={head.id} items={head.items} fees={head.fees} review={head.inspectionReview} currentHash={now.hash} settings={settings}
            disabled={locked} disabledReason={lockReason} problem={problemAt("fees")} onSave={saveFees} />
          <MissingCosts exclusions={quote.exclusions} />
        </>
      )}

      {head && <p role="note" className="text-text-muted text-[13px]">{FIT_PRECHECK_NOTE}</p>}
    </div>
  );
}
