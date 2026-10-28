"use client";

export type RenderStage = "generating" | "segmenting" | "compositing";

const STEPS: { stage: RenderStage; label: string }[] = [
  { stage: "generating", label: "Rendering the change" },
  { stage: "segmenting", label: "Finding the changed part" },
  { stage: "compositing", label: "Blending into the photo" },
];

/** Named steps of one render, so the mechanic never watches an endless spinner. */
export function ProgressStatus({ stage, onCancel }: { stage: RenderStage; onCancel: () => void }) {
  const current = STEPS.findIndex((s) => s.stage === stage);
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-1 text-[13px]">
      <ol className="flex flex-col gap-1">
        {STEPS.map((s, i) => (
          <li key={s.stage} className={i === current ? "font-semibold" : i < current ? "text-text-muted" : "text-text-muted opacity-70"}>
            <span aria-hidden="true" className="mr-2">{i < current ? "✓" : i === current ? "…" : "○"}</span>{s.label}
          </li>
        ))}
      </ol>
      {stage === "generating" && (
        <p className="text-text-muted text-[12px]">An AI render can take up to a minute. A started render may be billed even if you cancel or leave.</p>
      )}
      <button type="button" onClick={onCancel} className="self-start rounded-full border border-hairline px-3 py-1">Cancel</button>
    </div>
  );
}
