"use client";

import { useState } from "react";
import type { DerivedMap, PartMapState } from "@/lib/browser/partMap";
import { SLOTS, slotColorVar } from "@/lib/slots";
import type { MapPart, PhraseStatus, SlotId } from "@/lib/types";

export type PointTarget = { kind: "bike" } | { kind: "part"; slot: SlotId; label: string };

type Props = {
  map: PartMapState;
  view: DerivedMap;
  selected: MapPart | null;
  pointMode: PointTarget | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onStartPoint: (target: PointTarget) => void;
  onCancelPoint: () => void;
  onFacing: (facing: "left" | "right") => void;
  onSwapFacing: () => void;
  onRedetect: () => void;
  onNextBike: () => void;
};

const STATUS_TEXT: Record<PhraseStatus, string> = {
  pending: "Looking…", found: "Found", none: "Not found", needs_point: "Select by point",
  needs_facing: "Needs front/rear", error: "Failed", stale: "Not checked on this version",
};

/** Edit-panel list of detected parts, bike choice, front/rear, and point selection. */
export function PartSelector({ map, view, selected, pointMode, busy, onSelect, onStartPoint, onCancelPoint, onFacing, onSwapFacing, onRedetect, onNextBike }: Props) {
  const [target, setTarget] = useState<SlotId | "bike">("custom");
  const [customName, setCustomName] = useState("");
  const needsFacing = Object.values(view.phrases).includes("needs_facing");
  const label = target === "bike" ? "Motorcycle outline" : target === "custom" ? customName.trim()
    : SLOTS.find((s) => s.id === target)!.label;

  return (
    <div className="flex flex-col gap-4">
      {map.bikeStatus === "none" && map.bikeChoice !== "point" && (
        <p role="status" className="rounded-chip bg-neutral-soft px-3 py-2 text-neutral-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">ⓘ</span>
          No motorcycle outline was found. Choose “Motorcycle outline” below and click on the bike.
        </p>
      )}
      {map.bikeCandidates.length > 1 && map.bikeChoice !== "point" && (
        <div role="status" className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">⚠</span>
          {map.bikeCandidates.length} motorcycles found. Using bike {(map.bikeChoice ?? 0) + 1}, the largest by default.
          <button type="button" onClick={onNextBike} className="ml-2 underline underline-offset-2">Use the next one</button>
        </div>
      )}

      {selected ? (
        <p className="rounded-chip bg-primary-soft px-3 py-2 text-primary-soft-text">
          <span aria-hidden="true" className="mr-2 inline-block size-3 rounded-full align-middle" style={{ background: slotColorVar(selected.slot) }} />
          Selected: <span className="font-semibold">{selected.label}</span>
          {selected.source === "point" && <span className="ml-1 text-[13px]">(point selection)</span>}
        </p>
      ) : (
        <p className="text-text-muted text-[13px]">Click a highlighted part on the photo, or pick one below.</p>
      )}

      {needsFacing && (
        <div role="group" aria-label="Front of the bike" className="rounded-chip bg-warning-soft p-3 text-warning-soft-text text-[13px]">
          <p><span aria-hidden="true" className="mr-1 font-semibold">⚠</span>Which side is the front wheel on?</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => onFacing("left")} className="rounded-full border border-hairline bg-surface-3 px-3 py-1">Left</button>
            <button type="button" onClick={() => onFacing("right")} className="rounded-full border border-hairline bg-surface-3 px-3 py-1">Right</button>
          </div>
        </div>
      )}

      {map.facing !== "unknown" && view.parts.some((p) => p.slot.endsWith("_front") || p.slot.endsWith("_rear")) && (
        <p className="text-[13px] text-text-secondary">
          Front wheel on the {map.facing}.
          <button type="button" onClick={onSwapFacing} className="ml-2 underline underline-offset-2">Swap front and rear</button>
        </p>
      )}

      <ul className="flex flex-col gap-1" aria-label="Detected parts">
        {view.parts.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onSelect(p.id)} aria-pressed={selected?.id === p.id}
              className={`flex w-full items-center gap-2 rounded-chip px-3 py-1.5 text-left text-[13px] ${selected?.id === p.id ? "bg-surface-3 font-semibold" : "hover:bg-surface-2"}`}>
              <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ background: slotColorVar(p.slot) }} />
              {p.label}
            </button>
          </li>
        ))}
      </ul>

      {Object.values(view.phrases).includes("stale") && (
        <p className="rounded-chip bg-neutral-soft px-3 py-2 text-neutral-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-1 font-semibold">ⓘ</span>Other parts are not checked on this version yet.
          <button type="button" onClick={onRedetect} disabled={busy} className="ml-2 underline underline-offset-2 disabled:opacity-50">Detect parts again</button>
        </p>
      )}

      <details className="text-[13px]">
        <summary className="cursor-pointer text-text-secondary">Detection status</summary>
        <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          {Object.entries(view.phrases).map(([phrase, status]) => (
            <li key={phrase} className="flex justify-between gap-2"><span>{phrase}</span><span className="text-text-muted">{STATUS_TEXT[status]}</span></li>
          ))}
        </ul>
      </details>

      <fieldset className="flex flex-col gap-2 border-t border-hairline pt-3" disabled={busy && !pointMode}>
        <legend className="font-medium">Part not found?</legend>
        {pointMode ? (
          <>
            <p className="text-[13px]" role="status">
              Click on the {pointMode.kind === "bike" ? "motorcycle" : pointMode.label.toLowerCase()} in the photo.
            </p>
            <button type="button" onClick={onCancelPoint} className="self-start rounded-full border border-hairline px-4 py-1.5 text-[13px]">Cancel</button>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-[13px]">
              Select by point
              <select value={target} onChange={(e) => setTarget(e.target.value as SlotId | "bike")}
                className="rounded-full border border-hairline bg-surface-3 px-3 py-1.5">
                <option value="bike">Motorcycle outline</option>
                {SLOTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            {target === "custom" && (
              <label className="flex flex-col gap-1 text-[13px]">
                Name of the part
                <input value={customName} onChange={(e) => setCustomName(e.target.value)} maxLength={200}
                  className="rounded-full border border-hairline bg-surface-3 px-3 py-1.5" placeholder="For example: oil cooler" />
              </label>
            )}
            <button type="button" disabled={!label || busy}
              onClick={() => onStartPoint(target === "bike" ? { kind: "bike" } : { kind: "part", slot: target, label })}
              className="self-start rounded-full bg-primary px-4 py-1.5 text-on-fill text-[13px] disabled:opacity-50">
              Select by point
            </button>
            {busy && <p className="text-text-muted text-[12px]">Available when part detection has finished.</p>}
          </>
        )}
      </fieldset>
    </div>
  );
}
