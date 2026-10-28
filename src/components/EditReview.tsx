"use client";

import { FALLBACK_TEXT } from "@/lib/browser/renderFlow";
import type { Composited, Generated } from "@/lib/browser/renderClient";
import type { PhotoRef } from "@/lib/types";
import { BeforeAfter } from "./BeforeAfter";
import { ProgressStatus, type RenderStage } from "./ProgressStatus";

export type RenderState =
  | { kind: "running"; stage: RenderStage; generated: Generated | null }
  | { kind: "error"; message: string; retryable: boolean; generated: Generated | null }
  | { kind: "review"; generated: Generated; result: Composited };

type Props = {
  base: PhotoRef;
  state: RenderState;
  onAccept: () => void;
  onReject: () => void;
  onRetryBlend: () => void;
  onRenderAgain: () => void;
  onCancel: () => void;
};

/** One render's progress and preview. Nothing changes until Accept (persistence arrives with T6). */
export function EditReview({ base, state, onAccept, onReject, onRetryBlend, onRenderAgain, onCancel }: Props) {
  if (state.kind === "running") return <ProgressStatus stage={state.stage} onCancel={onCancel} />;
  if (state.kind === "error") {
    return (
      <div role="alert" className="flex flex-col gap-2 rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text text-[13px]">
        <p><span aria-hidden="true" className="mr-1 font-semibold">✕</span>{state.message}</p>
        <div className="flex flex-wrap gap-2">
          {state.generated && (
            <button type="button" onClick={onRetryBlend} className="rounded-full border border-hairline bg-surface-3 px-3 py-1 text-text">
              Retry blend (no new render; part detection about $0.003)
            </button>
          )}
          {state.retryable && (
            <button type="button" onClick={onRenderAgain} className="rounded-full border border-hairline bg-surface-3 px-3 py-1 text-text">
              Render again (about $0.01)
            </button>
          )}
          <button type="button" onClick={onReject} className="rounded-full px-3 py-1 underline underline-offset-2">Discard</button>
        </div>
      </div>
    );
  }
  const { result, generated } = state;
  const fallback = result.reason === "composited" ? null : FALLBACK_TEXT[result.reason];
  return (
    <section aria-label="Preview" className="flex flex-col gap-2 text-[13px]">
      <p className="text-text-muted text-[12px]">Preview: nothing changes until you accept it</p>
      <BeforeAfter before={base} after={result} aligned={result.aligned} />
      {fallback && (
        <p className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text">
          <span aria-hidden="true" className="mr-1 font-semibold">⚠</span>{fallback}
        </p>
      )}
      {result.composed && (
        <p className="rounded-chip bg-success-soft px-3 py-2 text-success-soft-text">
          <span aria-hidden="true" className="mr-1 font-semibold">✓</span>Blended: everything outside the part is kept from your photo.
        </p>
      )}
      {generated.warnings.map((w) => (
        <p key={w} className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text"><span aria-hidden="true" className="mr-1 font-semibold">⚠</span>{w}</p>
      ))}
      <p className="text-text-muted text-[12px]">The image is a visualization, not a guarantee of the finished bike.</p>
      <div className="flex gap-2">
        <button type="button" onClick={onAccept} className="rounded-full bg-primary px-4 py-1.5 text-on-fill">Accept</button>
        <button type="button" onClick={onReject} className="rounded-full border border-hairline px-4 py-1.5">Reject</button>
      </div>
    </section>
  );
}
