"use client";

import { activeItems, children, pathFromRoot } from "@/lib/project";
import { slotInfo } from "@/lib/slots";
import type { Version } from "@/lib/types";

type Props = {
  versions: Version[];
  headId: string;
  /** Children of the head when Redo found several; the mechanic picks one. */
  branchChoices: Version[] | null;
  disabled: boolean;
  onJump: (versionId: string) => void;
  onChooseBranch: (versionId: string) => void;
  onCancelChoice: () => void;
};

/** Short text for one step, e.g. "Fork: Matte black fork". */
function stepLabel(v: Version): string {
  if (v.kind === "root" || !v.change) return "Start photo";
  return `${slotInfo(v.change.slot).label}: ${v.change.instruction}`;
}

/**
 * The accepted changes from the first photo to the one shown now, plus the sheet of that version.
 * Steps are labeled text (thumbnails would load every image); the current step is marked with
 * words and a symbol, not color alone.
 */
export function VersionStrip({ versions, headId, branchChoices, disabled, onJump, onChooseBranch, onCancelChoice }: Props) {
  const path = pathFromRoot(versions, headId);
  const head = path[path.length - 1]!; // pathFromRoot ends at the head and is never empty
  const later = children(versions, headId);
  const items = activeItems(head);

  return (
    <section aria-label="Version history" className="flex flex-col gap-3 rounded-card border border-hairline bg-surface-1 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">History</h2>
        {later.length > 0 && (
          <span className="text-text-muted text-[12px]">
            {later.length === 1 ? "1 later step (Redo)" : `${later.length} branches after this step (Redo asks which)`}
          </span>
        )}
      </div>
      {path.length === 1 && <p className="text-text-muted text-[13px]">No accepted changes yet. Accept a preview to add the first step.</p>}
      <ol aria-label="Steps from the first photo" className="flex flex-wrap gap-2">
        {path.map((v, i) => {
          const current = v.id === headId;
          const branches = children(versions, v.id).length;
          return (
            <li key={v.id}>
              <button type="button" disabled={disabled || current} aria-current={current ? "step" : undefined}
                onClick={() => onJump(v.id)}
                aria-label={`${current ? "Current step" : "Go to step"} ${i}: ${stepLabel(v)}`}
                className={`flex max-w-[220px] flex-col items-start rounded-chip border px-3 py-1.5 text-left text-[12px] ${current ? "border-hairline bg-primary-soft text-primary-soft-text" : "border-hairline bg-surface-2"}`}>
                <span className="font-semibold">
                  <span aria-hidden="true" className="mr-1">{current ? "●" : "○"}</span>
                  {i === 0 ? "Start" : `Step ${i}`}{current ? " (shown now)" : ""}
                </span>
                <span className="max-w-full truncate">{stepLabel(v)}</span>
                {v.kind === "visual" && !v.composed && (
                  <span className="text-warning-soft-text"><span aria-hidden="true">⚠</span> Full image, not blended</span>
                )}
                {branches > 1 && <span className="tabular text-text-muted">{branches} branches</span>}
              </button>
            </li>
          );
        })}
      </ol>

      {branchChoices && (
        <div role="group" aria-label="Choose a branch" className="rounded-chip bg-warning-soft p-3 text-warning-soft-text text-[13px]">
          <p><span aria-hidden="true" className="mr-1 font-semibold">⚠</span>Several changes follow this step. Which one do you want to see?</p>
          <ul className="mt-2 flex flex-col gap-1">
            {branchChoices.map((c) => (
              <li key={c.id}>
                <button type="button" disabled={disabled} onClick={() => onChooseBranch(c.id)}
                  className="rounded-full border border-hairline bg-surface-3 px-3 py-1 text-left text-text">
                  {stepLabel(c)}
                  {/* Two variants can share a title; the time tells them apart. */}
                  <span className="tabular ml-2 text-text-muted text-[12px]">accepted {new Date(c.createdAt).toLocaleTimeString()}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={onCancelChoice} className="mt-2 underline underline-offset-2">Cancel</button>
        </div>
      )}

      <div>
        <h3 className="text-[13px] font-semibold">Sheet for the version shown</h3>
        {items.length === 0 ? (
          <p className="text-text-muted text-[13px]">No parts on the sheet yet.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1 text-[13px]">
            {items.map((item) => (
              <li key={item.id}><span className="font-medium">{slotInfo(item.slot).label}:</span> {item.title}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
