"use client";

import { useState } from "react";
import type { Project } from "@/lib/types";
import { DemoCard } from "./DemoView";

export type ProjectListState =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; projects: Project[]; unreadable: { id: string; message: string }[]; readOnlyReason: string | null };

type Props = {
  state: ProjectListState;
  busyId: string | null;
  error: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  /** "deleteOnly": no Open button; used inline when storage is full, so nothing on screen is discarded. */
  deleteOnly?: boolean;
  /** The project that is open right now; it is not offered for deletion in deleteOnly mode. */
  excludeId?: string | null;
  /** Shown when nothing can be deleted (deleteOnly mode). */
  emptyText?: string;
  /** "Open project from folder". The parent passes it only where the browser and storage allow it. */
  onOpenFolder?: () => void;
  openFolderBusy?: boolean;
  openFolderNote?: { tone: "info" | "danger"; text: string } | null;
  /** Shows the demo card above the list. The card works even when local storage does not. */
  onViewDemo?: () => void;
};

const button = "rounded-full border border-hairline px-3 py-1 text-[13px] disabled:opacity-50";

/** The demo card, then the saved projects. The card sits outside the storage states so a storage failure never hides the demo. */
export function ProjectList(props: Props) {
  const { onViewDemo, deleteOnly = false } = props;
  return (
    <div className="flex flex-col gap-3">
      {onViewDemo && !deleteOnly && <DemoCard onView={onViewDemo} />}
      <SavedProjects {...props} />
    </div>
  );
}

/** Saved projects on this device, newest first. Delete asks first; nothing is deleted on a read error. */
function SavedProjects({ state, busyId, error, onOpen, onDelete, deleteOnly = false, excludeId = null, emptyText, onOpenFolder, openFolderBusy = false, openFolderNote = null }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);

  if (state.kind === "loading") {
    return <p role="status" className="text-text-secondary text-[13px]">Loading saved projects…</p>;
  }
  if (state.kind === "unavailable") {
    return (
      <p role="status" className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text text-[13px]">
        <span aria-hidden="true" className="mr-1 font-semibold">⚠</span>
        Local storage is not available ({state.message}). You can still work on a photo, but nothing will be saved.
      </p>
    );
  }
  const readOnlyReason = state.readOnlyReason; // copied so the nested function keeps the narrowed type
  const projects = state.projects.filter((p) => p.id !== excludeId);
  const nothing = projects.length === 0 && state.unreadable.length === 0;

  /** Two-step delete: first a question, then the real delete. Used for readable and damaged projects. */
  function deleteControls(id: string, name: string) {
    if (confirming === id) {
      return (
        <div role="group" aria-label={`Delete ${name}`} className="mt-2 flex flex-col gap-2 text-[13px]">
          <p>Delete this project and all its versions from this browser? This cannot be undone.</p>
          <div className="flex gap-2">
            <button type="button" disabled={busyId === id || !!readOnlyReason}
              onClick={() => { setConfirming(null); onDelete(id); }}
              className="rounded-full border border-hairline bg-danger-soft px-3 py-1 text-danger-soft-text disabled:opacity-50">
              Delete project
            </button>
            <button type="button" onClick={() => setConfirming(null)} className={button}>Keep it</button>
          </div>
        </div>
      );
    }
    return (
      <div className="mt-2 flex gap-2">
        {!deleteOnly && (
          <button type="button" disabled={busyId !== null} onClick={() => onOpen(id)} aria-label={`Open ${name}`}
            className="rounded-full bg-primary px-3 py-1 text-[13px] text-on-fill disabled:opacity-50">
            {busyId === id ? "Opening…" : "Open"}
          </button>
        )}
        <button type="button" disabled={busyId !== null} onClick={() => setConfirming(id)} aria-label={`Delete ${name}`} className={button}>
          Delete
        </button>
      </div>
    );
  }

  return (
    <section aria-labelledby="projects-title" className="flex flex-col gap-2">
      <h3 id="projects-title" className="text-[15px] font-semibold">{deleteOnly ? "Delete a saved project to make room" : "Saved projects"}</h3>
      {state.readOnlyReason && (
        <p role="status" className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">⚠</span>{state.readOnlyReason}
        </p>
      )}
      {onOpenFolder && !deleteOnly && !state.readOnlyReason && (
        <div className="flex flex-col gap-2">
          <button type="button" onClick={onOpenFolder} disabled={openFolderBusy || busyId !== null} className={`${button} self-start`}>
            {openFolderBusy ? "Opening folder…" : "Open project from folder"}
          </button>
          {openFolderNote && (
            <p role={openFolderNote.tone === "danger" ? "alert" : "status"}
              className={`rounded-chip px-3 py-2 text-[13px] ${openFolderNote.tone === "danger" ? "bg-danger-soft text-danger-soft-text" : "bg-neutral-soft text-neutral-soft-text"}`}>
              <span aria-hidden="true" className="mr-1 font-semibold">{openFolderNote.tone === "danger" ? "✕" : "ⓘ"}</span>{openFolderNote.text}
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">✕</span>{error}
        </p>
      )}
      {nothing && (
        <p className="text-text-muted text-[13px]">{emptyText ?? "No saved projects yet. Import a photo to start one."}</p>
      )}
      <ul className="flex flex-col gap-2">
        {projects.map((p) => (
          <li key={p.id} className="rounded-card border border-hairline bg-surface-2 p-3">
            <p className="text-[13px] font-medium">{p.name}</p>
            <p className="tabular text-text-muted text-[12px]">Updated {new Date(p.updatedAt).toLocaleString()}</p>
            {deleteControls(p.id, p.name)}
          </li>
        ))}
        {state.unreadable.map((u) => (
          <li key={u.id} className="rounded-card border border-hairline bg-danger-soft p-3 text-danger-soft-text text-[13px]">
            <p><span aria-hidden="true" className="mr-1 font-semibold">✕</span>{u.message} It was left untouched.</p>
            {deleteControls(u.id, "damaged project")}
          </li>
        ))}
      </ul>
    </section>
  );
}
