"use client";

import type { ReactNode } from "react";

type Props = {
  projectName: string | null;
  /** "Saved on this device", "Unsaved", or similar; always words, never color alone. */
  saveStatus: string | null;
  canUndo: boolean;
  canRedo: boolean;
  undoHint?: string;
  redoHint?: string;
  busy: boolean;
  onUndo: () => void;
  onRedo: () => void;
  children: ReactNode;
};

const button = "rounded-full border border-hairline px-4 py-1.5 text-[13px] disabled:opacity-50";

/** Header (project name, Undo, Redo, Settings), the page content, and the Build sheet / Estimate tabs. */
export function AppShell({ projectName, saveStatus, canUndo, canRedo, undoHint, redoHint, busy, onUndo, onRedo, children }: Props) {
  return (
    <>
      <header className="flex shrink-0 items-center gap-4 border-b border-hairline bg-surface-1 px-6 py-3">
        <h1 className="text-[20px] leading-[1.35] font-semibold">DreamBike</h1>
        <span className="text-text-secondary text-[13px]" data-testid="project-name">{projectName ?? "No project open"}</span>
        {saveStatus && <span className="rounded-chip bg-neutral-soft px-2 py-0.5 text-neutral-soft-text text-[12px]">{saveStatus}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" disabled={!canUndo || busy} onClick={onUndo} title={undoHint} aria-label="Undo the last accepted change" className={button}>Undo</button>
          <button type="button" disabled={!canRedo || busy} onClick={onRedo} title={redoHint} aria-label="Redo the next change" className={button}>Redo</button>
          <button type="button" className={`${button} bg-surface-2`}>Settings</button>
        </div>
      </header>
      {children}
      <nav aria-label="Sheet and estimate" className="flex shrink-0 gap-2 border-t border-hairline bg-surface-1 px-6 py-3">
        <button type="button" className="rounded-full bg-primary px-4 py-1.5 text-[13px] text-on-fill">Build sheet</button>
        <button type="button" className="rounded-full border border-hairline px-4 py-1.5 text-[13px]">Estimate</button>
      </nav>
    </>
  );
}
