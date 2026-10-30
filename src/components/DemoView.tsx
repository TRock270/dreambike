"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DreamDb } from "@/lib/db";
import { DEMO_BASE, DemoError, decodeMaskInBrowser, importDemo, loadDemo, loadDemoPreview, type LoadedDemo } from "@/lib/demo";
import { EXAMPLE_SETTINGS } from "@/lib/quote";
import { saveErrorText } from "@/lib/browser/projectSession";
import { LEGAL_SEED, activeItems, fitInputHash, fitStatusOf, laborDisplay, pathFromRoot, priceDisplay, type FitStatus } from "@/lib/project";
import { slotInfo } from "@/lib/slots";
import type { BuildItemData, DemoManifest, Version } from "@/lib/types";
import { BeforeAfter } from "./BeforeAfter";
import { DemoBanner } from "./DemoBanner";
import { FitBadge } from "./FitBadge";
import { PaperworkSummary } from "./PaperworkSummary";

const FETCH_TIMEOUT_MS = 20_000;

/** Same-origin fetch with a time limit, so a stuck request ends in an error message instead of a spinner. */
function demoFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

const APPROVAL_WORD = {
  abe: "ABE", e_mark: "E-mark", teilegutachten: "Teilegutachten", none: "No approval", unknown: "Approval unknown",
} as const;

// One copy at a time, even if the view is closed and opened again while an import still runs.
let importInFlight = false;

const button = "rounded-full border border-hairline px-4 py-1.5 text-[13px] disabled:opacity-50";

// ------------------------------------------------------------------ the card

type Preview = { manifest: DemoManifest; thumb: Blob };
// One load per page visit: the list can mount again (after closing a project) without a new request.
let previewPromise: Promise<Preview> | null = null;

/** Size-capped manifest plus the verified original photo (v0) only. Masks and other steps load when the demo opens. */
function loadPreview(): Promise<Preview> {
  if (!previewPromise) {
    previewPromise = loadDemoPreview(demoFetch).then(({ manifest, thumbnail }) => ({ manifest, thumb: thumbnail }));
    // A failed load is not cached, so the next mount tries again.
    previewPromise.catch(() => { previewPromise = null; });
  }
  return previewPromise;
}

/** Object URL for a blob, revoked when the blob changes or the component goes away. */
function useBlobUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const made = URL.createObjectURL(blob);
    // An object URL is an external resource made and revoked here, so state is set in the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(made);
    return () => { URL.revokeObjectURL(made); setUrl(null); };
  }, [blob]);
  return blob ? url : null;
}

/** The demo entry in the project list. It never depends on local storage. */
export function DemoCard({ onView }: { onView: () => void }) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error" } | { kind: "ready"; preview: Preview }>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    loadPreview().then(
      (preview) => { if (!cancelled) setState({ kind: "ready", preview }); },
      () => { if (!cancelled) setState({ kind: "error" }); },
    );
    return () => { cancelled = true; };
  }, []);
  const thumbUrl = useBlobUrl(state.kind === "ready" ? state.preview.thumb : null);

  return (
    <section aria-label="Demo project" data-testid="demo-card" className="flex gap-3 rounded-card border border-hairline bg-surface-2 p-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
      {thumbUrl && <img src={thumbUrl} alt="Start photo of the demo bike" className="h-16 w-24 shrink-0 rounded-inner object-cover" />}
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-[13px] font-medium">Demo project</p>
        {state.kind === "loading" && <p role="status" className="text-text-secondary text-[12px]">Loading the demo…</p>}
        {state.kind === "error" && (
          <p role="status" className="text-text-secondary text-[12px]"><span aria-hidden="true" className="mr-1 font-semibold">ⓘ</span>The cached demo is not available right now.</p>
        )}
        {state.kind === "ready" && (
          <>
            <p className="text-text-muted text-[12px]">Precomputed results, no AI calls. Cached <span className="tabular">{new Date(state.preview.manifest.cachedAt).toLocaleDateString()}</span>.</p>
            <button type="button" onClick={onView} className="self-start rounded-full bg-primary px-3 py-1 text-[13px] text-on-fill">View demo</button>
          </>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ the view

/** One image from a blob (the first step has nothing to compare with). */
function SingleImage({ blob, width, height }: { blob: Blob; width: number; height: number }) {
  const url = useBlobUrl(blob);
  return (
    <div className="relative w-full overflow-hidden rounded-inner bg-recess" style={{ aspectRatio: `${width} / ${height}`, maxHeight: "60vh" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
      {url && <img src={url} alt="Start photo, before any change" className="absolute inset-0 h-full w-full object-contain" />}
    </div>
  );
}

type Step = { visual: Version; sheet: Version; label: string };

/** Image steps (root and visual versions); each step's sheet is the last sheet version before the next image step. */
function stepsOf(manifest: DemoManifest): Step[] {
  const path = pathFromRoot(manifest.snapshot.versions, manifest.snapshot.project.headVersionId);
  const steps: Step[] = [];
  path.forEach((v, i) => {
    if (v.kind === "sheet") {
      const last = steps[steps.length - 1];
      if (last) last.sheet = v;
      return;
    }
    const label = v.kind === "root" || !v.change ? "Start photo" : slotInfo(v.change.slot).label;
    steps.push({ visual: v, sheet: path[i] ?? v, label });
  });
  return steps;
}

/**
 * Fit status of each item through the project's own rule (fitStatusOf), evaluated at the time the check was made:
 * the 24-hour limit cannot expire for the cached demo, but a changed input hash still reads "stale".
 * The hash is recomputed with the example shop settings the demo was made with. Null until it is computed.
 */
function useDemoFitStatuses(manifest: DemoManifest | null, items: readonly BuildItemData[]): Map<string, FitStatus> | null {
  const [result, setResult] = useState<{ items: readonly BuildItemData[]; statuses: Map<string, FitStatus> } | null>(null);
  useEffect(() => {
    if (!manifest) return;
    let cancelled = false;
    fitInputHash(manifest.snapshot.project.bikeRevision, items, EXAMPLE_SETTINGS.shopRules, LEGAL_SEED.version).then(
      (current) => {
        if (cancelled) return;
        const statuses = new Map(items.map((it) => [it.id, fitStatusOf(it, current, it.fitCheckedAt ? Date.parse(it.fitCheckedAt) : 0)] as const));
        setResult({ items, statuses });
      },
      // No hash, no claim: every checked item reads stale.
      () => { if (!cancelled) setResult({ items, statuses: new Map(items.map((it) => [it.id, it.fit ? "stale" : "not_checked"] as const)) }); },
    );
    return () => { cancelled = true; };
  }, [manifest, items]);
  // Results of an earlier step are not shown for the new one.
  return result && result.items === items ? result.statuses : null;
}

/** One build item with its cached fit result and its status from fitStatusOf. */
function ItemRow({ item, status }: { item: BuildItemData; status: FitStatus | null }) {
  const fit = item.fit;
  return (
    <li className="rounded-card border border-hairline bg-surface-2 p-3 text-[13px]" data-testid="demo-item">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{slotInfo(item.slot).label}</span>
        {status ? <FitBadge status={status} /> : <span className="text-text-muted text-[12px]">Checking fit status…</span>}
        {fit && <span className="rounded-chip bg-neutral-soft px-2 py-0.5 text-neutral-soft-text text-[12px]">{APPROVAL_WORD[fit.approval]}</span>}
      </div>
      <p className="mt-1">{item.title}</p>
      <p className="tabular text-text-secondary text-[12px]">{priceDisplay(item)} · {laborDisplay(item)} <span className="rounded-chip bg-warning-soft px-1.5 py-0.5 text-warning-soft-text">Demo rates</span></p>
      {fit && (
        <div className="mt-2 flex flex-col gap-1">
          <p className="tabular text-text-muted text-[12px]">
            Cached result{item.fitCheckedAt ? <>, checked <span>{new Date(item.fitCheckedAt).toLocaleString()}</span></> : ""}. It is not re-checked here, so the 24-hour limit for live checks does not apply.
          </p>
          <PaperworkSummary fit={fit} />
        </div>
      )}
    </li>
  );
}

type Props = {
  /** A writable, open database, or null when editing a copy is not possible. */
  db: DreamDb | null;
  /** Why `db` is null; shown next to the disabled button. */
  editBlockedReason: string | null;
  onClose: () => void;
  /** Called with the id of the new project after "Try editing" stored the copy. */
  onOpened: (projectId: string) => void;
};

/**
 * Read-only demo: steps v0 to v3 with before/after, build items with their cached fit results, the cached estimate PDF.
 * It reads only same-origin /demo/ files and needs no IndexedDB. "Try editing" makes an independent copy.
 */
export function DemoView({ db, editBlockedReason, onClose, onOpened }: Props) {
  const [loaded, setLoaded] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; demo: LoadedDemo; steps: Step[] }>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0); // "Try again" bumps it to load again
  const [index, setIndex] = useState(0);
  const [trying, setTrying] = useState(false);
  const [tryError, setTryError] = useState<string | null>(null);
  // Set while this view is on screen. A refs value survives renders; the cleanup marks the view as closed,
  // so an import that finishes late never opens the copy over whatever the visitor does next.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // The effect starts a new load; resetting the state first is the intended "Try again" behavior.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoaded({ kind: "loading" });
    loadDemo(demoFetch).then(
      (demo) => {
        if (cancelled) return;
        try {
          const steps = stepsOf(demo.manifest);
          if (steps.length === 0) throw new DemoError("The demo has no steps.");
          setLoaded({ kind: "ready", demo, steps });
        } catch (e) {
          setLoaded({ kind: "error", message: e instanceof Error ? e.message : "The demo is not valid." });
        }
      },
      (e) => { if (!cancelled) setLoaded({ kind: "error", message: e instanceof DemoError ? e.message : "The demo could not be loaded. Check your connection and try again." }); },
    );
    return () => { cancelled = true; };
  }, [attempt]);

  const items = useMemo(() => (loaded.kind === "ready" ? activeItems(loaded.steps[Math.min(index, loaded.steps.length - 1)]!.sheet) : []), [loaded, index]);

  const readyManifest = loaded.kind === "ready" ? loaded.demo.manifest : null;
  const statuses = useDemoFitStatuses(readyManifest, items);

  async function tryEditing() {
    if (!db || trying) return;
    if (importInFlight) { setTryError("A copy is still being made. Wait a moment and try again."); return; }
    importInFlight = true;
    setTrying(true);
    setTryError(null);
    try {
      const result = await importDemo(db, demoFetch, decodeMaskInBrowser);
      // The copy stays stored when the view was closed; it is just not opened automatically.
      if (result.status === "imported") { if (mounted.current) onOpened(result.project.id); }
      else if (mounted.current) setTryError(`The demo copy was not stored: ${result.message} Nothing was changed.`);
    } catch (e) {
      if (mounted.current) setTryError(`The demo copy was not stored: ${e instanceof DemoError ? e.message : saveErrorText(e)} Nothing was changed.`);
    } finally {
      importInFlight = false;
      if (mounted.current) setTrying(false);
    }
  }

  const header = (
    <div className="flex items-center gap-3">
      <h2 className="text-[20px] leading-[1.35]">Demo project</h2>
      <button type="button" onClick={onClose} disabled={trying} className={`${button} ml-auto`}>Back to start</button>
    </div>
  );

  if (loaded.kind === "loading") {
    return (
      <div className="flex flex-col gap-3">{header}<DemoBanner />
        <p role="status" className="text-text-secondary text-[13px]">Loading the demo…</p>
      </div>
    );
  }
  if (loaded.kind === "error") {
    return (
      <div className="flex flex-col gap-3">{header}<DemoBanner />
        <p role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">✕</span>{loaded.message}
        </p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)} className={`${button} self-start`}>Try again</button>
      </div>
    );
  }

  const { demo, steps } = loaded;
  const at = Math.min(index, steps.length - 1);
  const step = steps[at]!;
  const prev = at > 0 ? steps[at - 1]! : null;
  const blobOf = (v: Version) => demo.blobsById.get(v.image.id) ?? null;
  const after = blobOf(step.visual);
  const before = prev ? blobOf(prev.visual) : null;

  return (
    <div className="flex flex-col gap-3" data-testid="demo-view">
      {header}
      <DemoBanner />
      <p className="tabular text-text-muted text-[12px]">Cached {new Date(demo.manifest.cachedAt).toLocaleString()}. Fit results are a pre-check, not an approval.</p>
      <div role="group" aria-label="Demo steps" className="flex flex-wrap gap-2">
        {steps.map((s, i) => (
          <button key={s.visual.id} type="button" aria-pressed={i === at} onClick={() => setIndex(i)}
            className={`rounded-full px-4 py-1.5 text-[13px] ${i === at ? "bg-primary text-on-fill" : "border border-hairline"}`}>
            <span className="tabular">v{i}</span> {s.label}
          </button>
        ))}
      </div>
      {!after ? (
        <p role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text text-[13px]"><span aria-hidden="true" className="mr-1 font-semibold">✕</span>This demo image is missing.</p>
      ) : prev && before ? (
        // key: a new pair starts with a fresh slider position
        <BeforeAfter key={step.visual.id} before={{ blob: before, width: prev.visual.image.width, height: prev.visual.image.height }}
          after={{ blob: after, width: step.visual.image.width, height: step.visual.image.height }} aligned={step.visual.aligned} />
      ) : (
        <SingleImage blob={after} width={step.visual.image.width} height={step.visual.image.height} />
      )}
      {step.visual.change && <p className="text-text-secondary text-[13px]">{step.visual.change.instruction}</p>}

      <section aria-label="Build items" className="flex flex-col gap-2">
        <h3 className="text-[15px] font-semibold">Build items</h3>
        <p className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">⚠</span><strong>Demo rates.</strong> Prices and labor are illustrative. This is not a real quote.
        </p>
        {items.length === 0 ? <p className="text-text-muted text-[13px]">No build items at this step.</p> : (
          <ul className="flex flex-col gap-2">{items.map((it) => <ItemRow key={it.id} item={it} status={statuses?.get(it.id) ?? null} />)}</ul>
        )}
      </section>

      <a href={`${DEMO_BASE}${demo.manifest.quote.path}`} target="_blank" rel="noopener noreferrer" className="self-start text-[13px] text-primary-ink underline underline-offset-2">
        Open the demo estimate (PDF)<span className="sr-only"> (opens in a new tab)</span>
      </a>

      <div className="flex flex-col gap-2 rounded-card border border-hairline bg-surface-1 p-3">
        <button type="button" disabled={!db || trying} onClick={() => void tryEditing()}
          className="self-start rounded-full bg-primary px-4 py-1.5 text-[13px] text-on-fill disabled:opacity-50">
          {trying ? "Copying…" : "Try editing"}
        </button>
        <p className="text-text-secondary text-[13px]">Try editing makes your own copy of this project in this browser. The demo itself stays unchanged.</p>
        {!db && editBlockedReason && (
          <p role="status" className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text text-[13px]">
            <span aria-hidden="true" className="mr-1 font-semibold">⚠</span>{editBlockedReason} You can still look at the demo.
          </p>
        )}
        {tryError && (
          <p role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text text-[13px]"><span aria-hidden="true" className="mr-1 font-semibold">✕</span>{tryError}</p>
        )}
      </div>
    </div>
  );
}
