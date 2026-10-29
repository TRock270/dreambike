"use client";

import { useEffect, useRef, useState } from "react";
import { PreflightError } from "@/lib/browser/preflight";
import { requestCheck } from "@/lib/browser/sparkClient";
import type { AttachFitInput, AttachFitResult } from "@/lib/db";
import { ERRORS } from "@/lib/errors";
import { MOCK_LABEL } from "@/lib/mocks";
import {
  activeItems, editItem, FIT_PRECHECK_NOTE, fitBatches, fitInputCanonical, fitInputHash, fitStatusOf, laborDisplay,
  LEGAL_SEED, priceDisplay, removeItem, runFitBatches, type ActiveBuildEntryData, type ItemPatch,
} from "@/lib/project";
import prices from "../../budget/prices.json";
import { slotInfo } from "@/lib/slots";
import type { BikeRevision, BuildItemData, FeeData, Version } from "@/lib/types";
import { FitBadge } from "./FitBadge";
import { PaperworkSummary } from "./PaperworkSummary";
import { ProductFields } from "./ProductFields";

/** What BuildSheet hands to Workspace to save: the new items for a child of `headId`. */
export type SheetChange = { headId: string; versionId: string; items: BuildItemData[]; fees: FeeData[] };
export type SheetSaveResult = { ok: true; unchanged: boolean } | { ok: false; message: string };

/** What Workspace gives the fit check: the saved bike and the storage calls. null when nothing is saved. */
export type FitSupport = {
  bikeRevision: BikeRevision;
  /** Shop rules from settings; [] when there are none. */
  loadShopRules: () => Promise<string[]>;
  /** attachFitResponse from db.ts: caches the result and attaches it only when its hash is still current. */
  persist: (input: AttachFitInput) => Promise<AttachFitResult>;
  /** Re-read the saved project so rows show the new results. Never moves the head. */
  onPersisted: () => Promise<void>;
};

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
  fit: FitSupport | null;
  /** Tells Workspace a fit check is running (it keeps Undo and Redo from moving the version meanwhile). */
  onFitRunning: (running: boolean) => void;
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


// ---------------------------------------------------------------- fit check

type BatchState =
  | { state: "waiting" | "running" | "done" | "current" } // "current": already checked, nothing sent
  | { state: "not_current"; message: string }
  | { state: "failed"; message: string; retryable: boolean; received?: boolean };
/** One "Check fit" run. It keeps the exact input it was started with, so a retry sends the same input. */
type Run = {
  versionId: string; hash: string; canonical: string; shopRules: string[];
  batches: BuildItemData[][]; activeBuild: ActiveBuildEntryData[]; states: BatchState[]; mock: boolean;
};

/** Reserved cost of one grounded batch in USD (budget/prices.json); the search part is not known yet (U06). */
const BATCH_RESERVE_USD = prices.reservations["spark-grounded-base"] / 1_000_000;
function costText(batches: number): string {
  const total = (BATCH_RESERVE_USD * batches).toFixed(2);
  return `reserves about $${total} for ${batches} ${batches === 1 ? "batch" : "batches"} plus a search allowance; the actual cost is not known yet`;
}

// These answers would be the same for every batch, so the run stops sending after the first one.
const RUN_WIDE = ["LIVE_DISABLED", "FEATURE_DISABLED", "BUDGET_EXCEEDED", "ACCOUNTING_UNAVAILABLE"];

/** Plain words for each disabled or error state (SPEC 10). Unknown codes show the server's own message. */
function fitErrorText(e: unknown): string {
  if (e instanceof PreflightError) {
    if (e.code === "LIVE_DISABLED") return "Live AI is off, so fit checks cannot run. The cached demo still works.";
    if (e.code === "FEATURE_DISABLED") return "Fresh fit checks are off: web search is not enabled yet and waits for the search cost check.";
    if (e.code === "NO_RESULT") return "No web search was done, so no result is shown. Retry this batch later.";
    return e.message; // BUDGET_EXCEEDED carries the budget message from SPEC 10
  }
  return e instanceof Error ? e.message : "The fit check failed.";
}

const NOT_CURRENT: Record<string, string> = {
  version_missing: "The step was removed while checking.", project_mismatch: "The project changed while checking.",
  not_head: "You moved to another step while checking.", input_changed: "The bike, a part or the shop rules changed while checking.",
  no_matching_items: "The answer matched no part on the sheet.",
};

function FitPanel({ head, fit, disabledReason, onRunningChange, currentHash, nowMs }: {
  head: Version | null; fit: FitSupport | null; disabledReason: string | null; onRunningChange: (r: boolean) => void;
  currentHash: string | null; nowMs: number;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [running, setRunning] = useState<{ index: number; total: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false); // blocks a second click before React has re-rendered the disabled button
  const abort = useRef<AbortController | null>(null);
  // An answer that arrived but could not be saved: a retry saves it again instead of paying for a new request.
  const unsaved = useRef(new Map<number, Awaited<ReturnType<typeof requestCheck>>>());
  // Leaving the sheet stops waiting for the answer (the fetch is aborted).
  useEffect(() => () => abort.current?.abort(), []);

  const confirmed = fit?.bikeRevision.confirmed === true;
  const itemCount = head ? head.items.length : 0;
  // A labeled mock result never counts as a current check, so a later live run still checks it.
  const isCurrent = (it: BuildItemData, hash: string) => {
    if (it.fit?.reasons.some((t) => t.includes(MOCK_LABEL))) return false;
    const st = fitStatusOf(it, hash, nowMs);
    return st !== "stale" && st !== "not_checked";
  };
  const allCurrent = currentHash !== null && head !== null && itemCount > 0 && activeItems(head).every((it) => isCurrent(it, currentHash));
  const reason = disabledReason ?? (!fit || !head ? "There is no saved project to check."
    : !confirmed ? "Confirm the bike first. A fit check needs the confirmed bike." : itemCount === 0 ? "Add a part to the sheet first."
    : allCurrent ? "All parts have a current check. Edit a part or the bike to check again." : null);

  function setBatch(index: number, state: BatchState) {
    setRun((r) => (r ? { ...r, states: r.states.map((s, i) => (i === index ? state : s)) } : r));
  }

  /** Send the given batches one after another; each answer is saved before the next batch starts. */
  async function sendBatches(r: Run, indices: number[], signal: AbortSignal) {
    if (!fit || !head) return;
    let wideError: PreflightError | null = null;
    await runFitBatches(
      indices.map((i) => r.batches[i] as BuildItemData[]),
      async (batch, k) => {
        const index = indices[k] as number;
        try {
          if (signal.aborted) throw new Error("Cancelled. Nothing was saved for this batch.");
          if (wideError) throw wideError;
          // Reuse an answer that was already paid for and only failed to save.
          const response = unsaved.current.get(index) ?? await requestCheck({
            bike: fit.bikeRevision.bike, bikeConfirmed: true, inputHash: r.hash, items: batch,
            activeBuild: r.activeBuild, shopRules: r.shopRules,
          }, signal);
          unsaved.current.set(index, response);
          const mock = response.results.some((x) => x.reasons.some((t) => t.includes(MOCK_LABEL)));
          if (mock) setRun((cur) => (cur ? { ...cur, mock: true } : cur));
          const out = await fit.persist({ projectId: head.projectId, versionId: r.versionId, canonical: r.canonical, response });
          unsaved.current.delete(index); // saved or judged not current: never send it again
          if (out.status === "attached") {
            setBatch(index, { state: "done" });
            await fit.onPersisted().catch(() => undefined);
          } else {
            setBatch(index, { state: "not_current", message: `${NOT_CURRENT[out.reason] ?? "The result is not current."} It is not shown as current.` });
          }
        } catch (e) {
          if (e instanceof PreflightError && RUN_WIDE.includes(e.code)) wideError = e;
          const message = signal.aborted ? "Cancelled. Nothing was saved for this batch." : fitErrorText(e);
          const retryable = signal.aborted || !(e instanceof PreflightError) || ERRORS[e.code].retryable;
          setBatch(index, { state: "failed", message, retryable, received: unsaved.current.has(index) });
          throw e;
        }
      },
      (p) => {
        if (p.state !== "running") return;
        const index = indices[p.index] as number;
        setRunning({ index, total: r.batches.length });
        setBatch(index, { state: "running" });
      },
    );
  }

  async function execute(job: (signal: AbortSignal) => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    const controller = new AbortController();
    abort.current = controller;
    onRunningChange(true);
    setBusy(true);
    setProblem(null);
    try {
      await job(controller.signal);
    } catch (e) {
      setProblem(`The fit check could not start: ${fitErrorText(e)}`);
    } finally {
      abort.current = null;
      inFlight.current = false;
      setRunning(null);
      setBusy(false);
      onRunningChange(false);
    }
  }

  function start() {
    if (reason || !fit || !head) return;
    const bikeRevision = fit.bikeRevision;
    void execute(async (signal) => {
      const items = activeItems(head);
      const shopRules = await fit.loadShopRules();
      const canonical = fitInputCanonical(bikeRevision, items, shopRules, LEGAL_SEED.version);
      const hash = await fitInputHash(bikeRevision, items, shopRules, LEGAL_SEED.version);
      const { batches, activeBuild } = fitBatches(items);
      unsaved.current.clear();
      const next: Run = {
        versionId: head.id, hash, canonical, shopRules, batches, activeBuild, mock: false,
        // A batch whose parts all carry a current result for this hash is not sent again (SPEC 9: reuse without spending).
        states: batches.map((b): BatchState => (b.every((it) => isCurrent(it, hash)) ? { state: "current" } : { state: "waiting" })),
      };
      setRun(next);
      const todo = batches.map((_, i) => i).filter((i) => next.states[i]?.state === "waiting");
      if (todo.length > 0) await sendBatches(next, todo, signal);
    });
  }

  /** Retry one failed batch with the input the run started with, but only while that input is still current. */
  function retry(index: number) {
    if (!run || reason || !fit || !head) return;
    const r = run;
    void execute(async (signal) => {
      const items = activeItems(head);
      const shopRules = await fit.loadShopRules();
      const hash = await fitInputHash(fit.bikeRevision, items, shopRules, LEGAL_SEED.version);
      if (head.id !== r.versionId || hash !== r.hash) {
        setBatch(index, { state: "failed", retryable: false, message: "The build changed since this check started. Press Check fit to run it again." });
        return;
      }
      setBatch(index, { state: "waiting" });
      await sendBatches(r, [index], signal);
    });
  }

  return (
    <section aria-label="Fit check" className="flex flex-col gap-2 rounded-card border border-hairline bg-surface-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">Fit and paperwork</h3>
        <button type="button" onClick={start} disabled={reason !== null || busy} aria-describedby="fit-reason"
          className="rounded-full bg-primary px-4 py-1.5 text-on-fill text-[13px] disabled:opacity-50">
          {busy ? "Checking fit…" : "Check fit"}
        </button>
      </div>
      <p id="fit-reason" className="text-text-muted text-[13px]">
        {reason ?? `Checks at most 3 parts per request against the confirmed bike. Each request can use web search and costs money: it ${costText(Math.max(1, Math.ceil(itemCount / 3)))}. Parts with a current check are skipped.`}
      </p>
      {run?.mock && (
        <p role="status" className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">⚠</span>{MOCK_LABEL}. These results are labeled fixtures, not research.
        </p>
      )}
      {running && (
        <div role="status" aria-live="polite" className="flex flex-col gap-1 text-[13px]">
          <p className="font-semibold">Batch {running.index + 1} of {running.total}</p>
          <p className="text-text-muted text-[12px]">Cancel stops waiting here. An AI call that was already submitted may still incur cost.</p>
          <button type="button" onClick={() => abort.current?.abort()} className="self-start rounded-full border border-hairline px-3 py-1">Cancel</button>
        </div>
      )}
      {problem && (
        <p role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">✕</span>{problem}
        </p>
      )}
      {run && (
        <ol aria-label="Fit check batches" className="flex flex-col gap-1 text-[13px]">
          {run.states.map((s, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Batch {i + 1} of {run.states.length}</span>
              <span className="text-text-muted">{run.batches[i]?.map((it) => slotInfo(it.slot).label).join(", ")}</span>
              {s.state === "waiting" && <span className="text-text-muted">waiting</span>}
              {s.state === "running" && <span>checking…</span>}
              {s.state === "done" && <span className="text-success-soft-text"><span aria-hidden="true">✓ </span>saved</span>}
              {s.state === "current" && <span className="text-text-muted"><span aria-hidden="true">✓ </span>already current, not sent again</span>}
              {s.state === "not_current" && (
                <span role="status" className="rounded-chip bg-neutral-soft px-2 py-0.5 text-neutral-soft-text"><span aria-hidden="true">ⓘ </span>{s.message}</span>
              )}
              {s.state === "failed" && (
                <>
                  <span role="alert" className="rounded-chip bg-danger-soft px-2 py-0.5 text-danger-soft-text"><span aria-hidden="true">✕ </span>{s.message}</span>
                  {s.retryable && (
                    <button type="button" onClick={() => retry(i)} disabled={reason !== null || busy}
                      className="rounded-full border border-hairline px-3 py-0.5 disabled:opacity-50">Retry batch {i + 1}</button>
                  )}
                  {s.retryable && (
                    <span className="text-text-muted text-[12px]">
                      {s.received ? "The answer was received; retry only saves it, no new cost." : `Retry ${costText(1)}.`}
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

type RowState = { headId: string; itemId: string; mode: "edit" | "remove" } | null;

/**
 * The sheet of the version shown: one row per part, each with Edit and Remove.
 * Every save makes a new "sheet" step in the history; Undo goes back. The photo never changes.
 */
export function BuildSheet({ head, readOnlyReason, blockedReason, saving, onSave, onClose, fit, onFitRunning }: Props) {
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

  const [fitRunning, setFitRunning] = useState(false);
  const locked = readOnlyReason !== null || blockedReason !== null || saving || fitRunning;
  // The hash the saved results must carry to count as current. It belongs to one head and one bike
  // revision; an answer for an older head or revision is ignored, so no reset inside the effect is needed.
  const [hashed, setHashed] = useState<{ head: Version; rev: BikeRevision; hash: string; at: number } | null>(null);
  const loadRules = useRef(fit?.loadShopRules);
  const loadShopRules = fit?.loadShopRules;
  useEffect(() => { loadRules.current = loadShopRules; }, [loadShopRules]); // runs before the effect below
  const bikeRevision = fit?.bikeRevision ?? null;
  useEffect(() => {
    let alive = true; // an older answer must not overwrite a newer one
    if (!head || !bikeRevision || !loadRules.current) return;
    loadRules.current()
      .then((rules) => fitInputHash(bikeRevision, head.items, rules, LEGAL_SEED.version))
      .then((hash) => { if (alive) setHashed({ head, rev: bikeRevision, hash, at: Date.now() }); })
      .catch(() => undefined); // without a hash every result shows as stale
    return () => { alive = false; };
  }, [head, bikeRevision]);
  const fresh = hashed && hashed.head === head && hashed.rev === bikeRevision ? hashed : null;
  const currentHash = fresh ? fresh.hash : null;
  const nowMs = fresh ? fresh.at : 0;
  // A row state from an older version is ignored (Undo, Redo or a jump changed the sheet under it).
  const open = row && head && row.headId === head.id ? row : null;
  const items = head ? head.items : [];
  const anyFit = items.some((i) => i.fit !== null);

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
        <button type="button" onClick={onClose} disabled={saving || fitRunning} className={button}>Back to editor</button>
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
      <FitPanel head={head} fit={fit} currentHash={currentHash} nowMs={nowMs} disabledReason={readOnlyReason ?? blockedReason ?? (saving ? "Wait until the sheet save has finished." : null)}
        onRunningChange={(r) => { setFitRunning(r); onFitRunning(r); }} />
      {anyFit && <p role="note" className="text-text-muted text-[13px]">{FIT_PRECHECK_NOTE}</p>}
      <ul aria-label="Parts on the sheet" className="flex flex-col gap-3">
        {items.map((item) => {
          const mode = open && open.itemId === item.id ? open.mode : null;
          const product = item.product;
          const unknownPrice = item.costKind === "part" && item.partPriceCents === null;
          const rowProblem = problem && problem.itemId === item.id ? problem.text : null;
          // Without a computed hash a saved result counts as stale, never as current.
          const status = currentHash === null ? (item.fit === null ? "not_checked" : "stale") : fitStatusOf(item, currentHash, nowMs);
          const current = item.fit !== null && status !== "stale" && status !== "not_checked";
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
                <dt className="text-text-secondary">Fit</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <FitBadge status={status} />
                  {status === "stale" && <span className="text-text-muted">Result is old or the build changed. Check fit again.</span>}
                  {current && item.fitCheckedAt && <span className="text-text-muted">checked <span className="tabular">{item.fitCheckedAt.slice(0, 10)}</span></span>}
                  {current && item.fit?.reasons.some((t) => t.includes(MOCK_LABEL)) && (
                    <span className="rounded-chip bg-warning-soft px-2 py-0.5 text-warning-soft-text text-[12px]"><span aria-hidden="true">⚠ </span>Mock result</span>
                  )}
                </dd>
              </dl>
              {current && item.fit && (
                <details className="text-[13px]">
                  <summary className="cursor-pointer text-primary-ink underline underline-offset-2">Fit details and paperwork</summary>
                  <div className="mt-2"><PaperworkSummary fit={item.fit} /></div>
                </details>
              )}
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
