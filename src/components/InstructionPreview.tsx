"use client";

import type { InstructionData } from "@/lib/types";

const INTENT_TEXT: Record<InstructionData["intent"], string> = {
  paint: "Paint only: shape stays the same",
  replace: "Replace the part",
  geometry: "Shape change: shown as a full edit",
};

/** The prepared instruction: what will be rendered and what goes on the build sheet. */
export function InstructionPreview({ instruction, slotLabel }: { instruction: InstructionData; slotLabel: string }) {
  return (
    <section aria-label="Prepared change" className="flex flex-col gap-2 rounded-card border border-hairline bg-surface-2 p-3 text-[13px]">
      <p className="text-text-muted text-[12px]">Prepared change · {slotLabel}</p>
      <h3 className="text-[15px] font-semibold">{instruction.title}</h3>
      <p className="rounded-chip bg-neutral-soft px-2 py-1 text-neutral-soft-text">
        <span aria-hidden="true" className="mr-1">ⓘ</span>{INTENT_TEXT[instruction.intent]}
      </p>
      {instruction.spec.length > 0 && (
        <table className="w-full text-left">
          <caption className="sr-only">Specification</caption>
          <tbody>
            {instruction.spec.map((s) => (
              <tr key={`${s.key}-${s.value}`} className="border-t border-hairline">
                <th scope="row" className="py-1 pr-2 font-medium">{s.key}</th>
                <td className="py-1 tabular">{s.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {instruction.warnings.length > 0 && (
        <ul className="flex flex-col gap-1">
          {instruction.warnings.map((w) => (
            <li key={w} className="rounded-chip bg-warning-soft px-2 py-1 text-warning-soft-text">
              <span aria-hidden="true" className="mr-1 font-semibold">⚠</span>{w}
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary className="cursor-pointer text-text-secondary">Image instruction</summary>
        <p className="mt-1 whitespace-pre-wrap text-text-secondary">{instruction.editPrompt}</p>
      </details>
      <button type="button" disabled className="self-start rounded-full bg-accent-fill px-4 py-1.5 text-on-fill disabled:opacity-50">
        Render change
      </button>
      <p className="text-text-muted text-[12px]">Image rendering is not built yet.</p>
    </section>
  );
}
