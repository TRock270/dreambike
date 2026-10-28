"use client";

import { useState } from "react";
import { paintRequestText } from "@/lib/editPolicy";

type Props = { partLabel: string; busy: boolean; onPrepare: (text: string) => void };

const FINISHES = ["Gloss", "Matte", "Satin", "Metallic", "Candy", "Chrome"] as const;

/** Color and finish only; the part keeps its shape (paint intent). */
export function PaintForm({ partLabel, busy, onPrepare }: Props) {
  const [color, setColor] = useState("");
  const [finish, setFinish] = useState<(typeof FINISHES)[number]>("Gloss");
  const [details, setDetails] = useState("");
  const text = [`${finish} ${color.trim()}`.trim(), details.trim()].filter(Boolean).join(", ");
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (color.trim()) onPrepare(paintRequestText(partLabel, text)); }}>
      <label className="flex flex-col gap-1 text-[13px]">
        Color
        <input value={color} onChange={(e) => setColor(e.target.value)} maxLength={100} placeholder="For example: black, deep red"
          className="rounded-full border border-hairline bg-surface-3 px-3 py-1.5" />
      </label>
      <fieldset className="flex flex-wrap gap-1 text-[13px]">
        <legend className="mb-1">Finish</legend>
        {FINISHES.map((f) => (
          <button key={f} type="button" aria-pressed={finish === f} onClick={() => setFinish(f)}
            className={`rounded-full border px-3 py-1 ${finish === f ? "border-primary bg-primary-soft text-primary-soft-text" : "border-hairline bg-surface-3"}`}>
            {f}
          </button>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1 text-[13px]">
        Graphics or details (optional)
        <input value={details} onChange={(e) => setDetails(e.target.value)} maxLength={500} placeholder="For example: thin gold pinstripe"
          className="rounded-full border border-hairline bg-surface-3 px-3 py-1.5" />
      </label>
      <button type="submit" disabled={!color.trim() || busy}
        className="self-start rounded-full bg-primary px-4 py-1.5 text-on-fill text-[13px] disabled:opacity-50">
        Prepare paint change
      </button>
    </form>
  );
}
