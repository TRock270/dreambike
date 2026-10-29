"use client";

import type { ReactNode } from "react";

/** What the wide right panel shows. "edit" is the normal 360 px edit panel. */
export type PanelMode = "edit" | "sheet" | "estimate" | "settings";

type Props = {
  projectName: string | null;
  /** "Saved on this device", "Unsaved", or similar; always words, never color alone. */
  saveStatus: string | null;
  canUndo: boolean;
  canRedo: boolean;
  undoHint?: string;
  redoHint?: string;
  busy: boolean;
  /** Workspace owns the panel state. Pressing the active tab again returns to the editor. */
  panel: PanelMode;
  onPanel: (next: PanelMode) => void;
  /** True while a fit check or a sheet save runs: the panel cannot be swapped under it. */
  panelLocked: boolean;
  onUndo: () => void;
  onRedo: () => void;
  children: ReactNode;
};

const button = "rounded-full border border-hairline px-4 py-1.5 text-[13px] disabled:opacity-50";

/** Header (project name, Undo, Redo, Settings), the page content, and the Build sheet / Estimate tabs. */
export function AppShell({ projectName, saveStatus, canUndo, canRedo, undoHint, redoHint, busy, panel, onPanel, panelLocked, onUndo, onRedo, children }: Props) {
  return (
    <>
      <header className="flex shrink-0 items-center gap-4 border-b border-hairline bg-surface-1 px-6 py-3">
        <h1 className="text-[20px] leading-[1.35] font-semibold">DreamBike</h1>
        <span className="text-text-secondary text-[13px]" data-testid="project-name">{projectName ?? "No project open"}</span>
        {saveStatus && <span className="rounded-chip bg-neutral-soft px-2 py-0.5 text-neutral-soft-text text-[12px]">{saveStatus}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" disabled={!canUndo || busy} onClick={onUndo} title={undoHint} aria-label="Undo the last accepted change" className={button}>Undo</button>
          <button type="button" disabled={!canRedo || busy} onClick={onRedo} title={redoHint} aria-label="Redo the next change" className={button}>Redo</button>
          <button type="button" aria-pressed={panel === "settings"} disabled={panelLocked}
            onClick={() => onPanel(panel === "settings" ? "edit" : "settings")}
            className={`${button} ${panel === "settings" ? "bg-primary text-on-fill" : "bg-surface-2"}`}>Settings</button>
        </div>
      </header>
      {children}
      <nav aria-label="Sheet and estimate" className="flex shrink-0 gap-2 border-t border-hairline bg-surface-1 px-6 py-3">
        {(["sheet", "estimate"] as const).map((mode) => (
          <button key={mode} type="button" aria-pressed={panel === mode} disabled={panelLocked}
            onClick={() => onPanel(panel === mode ? "edit" : mode)}
            className={`rounded-full px-4 py-1.5 text-[13px] disabled:opacity-50 ${panel === mode ? "bg-primary text-on-fill" : "border border-hairline"}`}>
            {mode === "sheet" ? "Build sheet" : "Estimate"}
          </button>
        ))}
      </nav>
    </>
  );
}
