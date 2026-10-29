"use client";

import { useEffect, useId, useRef, useState } from "react";
import { buildPdf, downloadPdf, isCompleteEstimate, warmUpPdf } from "@/lib/browser/pdfExport";
import type { DreamDb } from "@/lib/db";
import { estimateSnapshot } from "@/lib/estimate";
import type { AppMode } from "@/lib/server/config";
import type { BikeRevision, ImageRef, Project, ShopSettings, Version } from "@/lib/types";

type Props = {
  /** The open database, or null when storage is not ready. */
  db: DreamDb | null;
  project: Project | null;
  /** The saved version shown now, or null when there is none. */
  head: Version | null;
  /** The root version's image: the before photo. */
  rootImage: ImageRef | null;
  settings: ShopSettings | null;
  settingsId: string;
  bikeRevision: BikeRevision | null;
  appMode: AppMode;
  /**
   * True when the estimate on screen is complete, false when it shows an incomplete draft, null while the estimate
   * for this version is still being calculated (nothing is on screen yet, so the button waits).
   */
  shownComplete: boolean | null;
  /** A sheet save is running: the head may change any moment. */
  saving: boolean;
};

/** The PDF tools: loading, ready, or failed with a message. */
type Warm = { status: "loading" } | { status: "ready" } | { status: "failed"; message: string };

/** What the last export did. `key` is project and head, so the note disappears when another version is open. */
type Outcome =
  | { key: string; kind: "done"; fileName: string; draft: boolean; mismatch: string | null; leftOut: string[] }
  | { key: string; kind: "failed"; message: string }
  | { key: string; kind: "changed" };

const button = "rounded-full border border-hairline px-4 py-1.5 text-[13px] disabled:opacity-50";
const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** Said in words when the file is not what the screen showed (for example after the 24 h fit expiry). */
export function mismatchText(shownComplete: boolean, draft: boolean): string | null {
  if (shownComplete && draft) {
    return "The screen showed a complete estimate, but the PDF is an incomplete draft with no grand total, because something changed since the screen was calculated (for example a fit check is now older than 24 hours). Check the estimate again before you send the file.";
  }
  if (!shownComplete && !draft) {
    return "The screen showed an incomplete draft, but the PDF came out complete. Check the estimate again before you send the file.";
  }
  return null;
}

/**
 * Exports the estimate as a PDF made in this browser. The fonts and the PDF library are prepared in idle time once a
 * project is open (the workspace starts that), so the click itself makes no network request. At click the estimate
 * is calculated again with a fresh clock, so the file always matches the saved version and not an older screen.
 *
 * It stays mounted whenever a version exists, also while the estimate for a new version is being calculated, so the
 * note "The version changed while the PDF was being built" can show for the version now open.
 */
export function ExportButton({ db, project, head, rootImage, settings, settingsId, bikeRevision, appMode, shownComplete, saving }: Props) {
  const reasonId = useId();
  const [warm, setWarm] = useState<Warm>({ status: "loading" });
  const [warmTry, setWarmTry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const inFlight = useRef(false); // blocks a second click before React has re-rendered the disabled button
  const mounted = useRef(true);
  const key = project && head ? `${project.id}:${head.id}` : null;
  const latestKey = useRef<string | null>(key);
  useEffect(() => { latestKey.current = key; }, [key]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // The warm-up is memoized: this joins the attempt the panel started, or starts a fresh one after a failure.
  useEffect(() => {
    let alive = true;
    warmUpPdf().then(
      () => { if (alive) setWarm({ status: "ready" }); },
      (e: unknown) => { if (alive) setWarm({ status: "failed", message: errorText(e, "Unknown error.") }); },
    );
    return () => { alive = false; };
  }, [warmTry]);
  function retryWarmup() {
    setWarm({ status: "loading" });
    setWarmTry((n) => n + 1);
  }

  async function onExport() {
    if (inFlight.current || !db || !project || !head || !rootImage || !settings || key === null || shownComplete === null) return;
    inFlight.current = true;
    setBusy(true);
    setOutcome(null);
    try {
      const now = Date.now();
      const snapshot = await estimateSnapshot({ head, settings, settingsId, bikeRevision, now });
      const built = await buildPdf({ h: db, project, head, rootImage, settings, settingsId, bikeRevision, appMode, snapshot, now });
      if (!mounted.current) return; // the panel was closed meanwhile: nothing is downloaded
      if (latestKey.current !== key) {
        setOutcome({ key: latestKey.current ?? "", kind: "changed" });
        return;
      }
      downloadPdf(built.bytes, built.fileName);
      setOutcome({
        key, kind: "done", fileName: built.fileName, draft: built.draft,
        mismatch: mismatchText(shownComplete, !isCompleteEstimate(snapshot.quote)), leftOut: built.leftOut,
      });
    } catch (e) {
      if (mounted.current) setOutcome({ key, kind: "failed", message: errorText(e, "Unknown error.") });
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const reason = !db || !project || !head || !rootImage ? "There is no saved project to export."
    : !settings ? "The shop settings are not loaded yet."
    : saving ? "Wait until the save has finished."
    : shownComplete === null ? "Waiting for the estimate on screen…"
    : warm.status === "loading" ? "Getting the PDF fonts and tools ready…"
    : warm.status === "failed" ? "The PDF fonts and tools are not ready."
    : null;
  const shown = outcome && outcome.key === key ? outcome : null;
  const failed = shown?.kind === "failed";
  const disabled = busy || reason !== null || warm.status !== "ready";
  const label = busy ? "Building the PDF…" : failed ? "Try again" : shownComplete === false ? "Export draft PDF" : "Export PDF";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void onExport()} disabled={disabled} aria-busy={busy}
          aria-describedby={reason ? reasonId : undefined} data-pdf-ready={warm.status === "ready" ? "true" : "false"} className={button}>
          {label}
        </button>
        {reason && <span id={reasonId} className="text-text-muted text-[12px]">{reason}</span>}
      </div>

      {warm.status === "failed" && (
        <div role="alert" className="flex flex-col gap-2 rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text text-[13px]">
          <p><span aria-hidden="true" className="mr-1 font-semibold">✕</span>The PDF fonts and tools could not be prepared: {warm.message}</p>
          <button type="button" onClick={retryWarmup} className={`${button} self-start bg-surface-3 text-text`}>Prepare again</button>
        </div>
      )}
      {busy && <p role="status" className="text-text-secondary text-[13px]">Building the PDF… This takes a moment and needs no network.</p>}
      {shown?.kind === "failed" && (
        <p role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">✕</span>The PDF could not be made: {shown.message} Nothing was downloaded. Press Try again.
        </p>
      )}
      {shown?.kind === "changed" && (
        <p role="status" className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">⚠</span>The version changed while the PDF was being built, so nothing was downloaded. Export again for the version shown now.
        </p>
      )}
      {shown?.kind === "done" && (
        <div role="status" className="flex flex-col gap-1 rounded-chip bg-neutral-soft px-3 py-2 text-neutral-soft-text text-[13px]">
          <p>
            <span aria-hidden="true" className="mr-1 font-semibold">ⓘ</span>
            <span className="font-mono">{shown.fileName}</span> was sent to your browser&apos;s downloads.
            {shown.draft ? " It is an incomplete draft: costs are missing, so it has no grand total." : ""}
          </p>
          {shown.mismatch && <p className="text-warning-soft-text"><span aria-hidden="true" className="mr-1 font-semibold">⚠</span>{shown.mismatch}</p>}
          {shown.leftOut.length > 0 && (
            <ul className="list-disc pl-5">
              {shown.leftOut.map((text) => <li key={text}>{text}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
