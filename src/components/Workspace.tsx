"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildPartMap, derive, emptyPartMap, selectByPoint, type PartMapState } from "@/lib/browser/partMap";
import { PreflightError } from "@/lib/browser/preflight";
import { hitTest, type ImagePoint } from "@/lib/coordinates";
import type { NormalizedPhoto } from "@/lib/types";
import { ImageCanvas } from "./ImageCanvas";
import { PartSelector, type PointTarget } from "./PartSelector";
import { UploadDropzone } from "./UploadDropzone";
import { UploadNotice } from "./UploadNotice";

/** Photo area and edit panel. Projects are not persisted until T6. */
export function Workspace() {
  const [noticeAccepted, setNoticeAccepted] = useState(false);
  const [photo, setPhoto] = useState<NormalizedPhoto | null>(null);
  const [map, setMap] = useState<PartMapState>(() => emptyPartMap());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pointMode, setPointMode] = useState<PointTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pointBusy, setPointBusy] = useState(false);
  const pointAbort = useRef<AbortController | null>(null);
  const view = useMemo(() => derive(map), [map]);

  // A new photo starts a fresh part map. Every write checks the image hash,
  // so results for an older photo can never land on the new one.
  useEffect(() => {
    if (!photo) return;
    const controller = new AbortController();
    void buildPartMap(photo, setMap, controller.signal);
    return () => controller.abort();
  }, [photo]);

  function choosePhoto(next: NormalizedPhoto | null) {
    pointAbort.current?.abort();
    setPhoto(next);
    setMap(emptyPartMap(next?.hash ?? ""));
    setSelectedId(null);
    setPointMode(null);
    setNotice(null);
  }

  async function handleClick(point: ImagePoint) {
    if (!photo) return;
    setNotice(null);
    if (!pointMode) {
      const hit = hitTest(view.parts, point, photo);
      if (hit) setSelectedId(hit.id);
      else setNotice("No detected part here. Use “Select by point” below.");
      return;
    }
    if (pointBusy) return; // one paid point request at a time; ignore double clicks
    const target = pointMode;
    const controller = new AbortController();
    pointAbort.current = controller;
    setPointBusy(true);
    try {
      const result = await selectByPoint(photo, point, target, target.kind === "bike" ? null : view.bike?.mask ?? null, controller.signal);
      setMap((m) => {
        if (m.imageHash !== photo.hash) return m; // the photo changed meanwhile
        if ("bike" in result) return { ...m, bikePoint: result.bike, bikeChoice: "point" };
        const replaced = m.pointParts.filter((p) => p.slot === "custom" || p.slot !== result.part.slot);
        return { ...m, pointParts: [...replaced, result.part] };
      });
      if ("part" in result) setSelectedId(result.part.id);
      setPointMode(null);
    } catch (error) {
      if (!controller.signal.aborted) setNotice(error instanceof PreflightError ? error.message : "Point selection failed.");
    } finally {
      setPointBusy(false);
    }
  }

  const selected = view.parts.find((p) => p.id === selectedId) ?? null;
  return (
    <main className="flex flex-1 gap-4 p-4">
      <section aria-label="Photo" className="flex flex-[2] items-center justify-center rounded-card border border-hairline bg-recess p-4">
        {photo ? (
          <ImageCanvas photo={photo} parts={view.parts} selectedId={selectedId} onImageClick={handleClick}
            cursor={pointMode ? "crosshair" : "default"} />
        ) : noticeAccepted ? <UploadDropzone onPhoto={choosePhoto} />
          : <UploadNotice onAccept={() => setNoticeAccepted(true)} />}
      </section>
      <aside aria-label="Edit panel" className="flex w-[360px] shrink-0 flex-col gap-4 overflow-y-auto rounded-card border border-hairline bg-surface-1 p-4">
        <h2 className="text-[20px] leading-[1.35]">Edit</h2>
        {!photo && <p className="text-text-muted text-[13px]">Import a photo of your own bike to start.</p>}
        {photo && (
          <>
            {!map.done && <p role="status" className="text-text-secondary text-[13px]">Finding the bike and its parts…</p>}
            {map.warnings.map((w) => (
              <p key={w} className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text text-[13px]">
                <span aria-hidden="true" className="mr-1 font-semibold">⚠</span>{w}
              </p>
            ))}
            {map.errors.length > 0 && (
              <div role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text text-[13px]">
                <span aria-hidden="true" className="mr-1 font-semibold">✕</span>
                {map.errors.length === 1 ? map.errors[0] : `${map.errors.length} detection requests failed. ${map.errors[0]}`}
              </div>
            )}
            {notice && <p role="status" className="rounded-chip bg-neutral-soft px-3 py-2 text-neutral-soft-text text-[13px]">{notice}</p>}
            <PartSelector map={map} view={view} selected={selected} pointMode={pointMode} busy={!map.done || pointBusy}
              onSelect={setSelectedId} onStartPoint={setPointMode} onCancelPoint={() => setPointMode(null)}
              onFacing={(facing) => setMap((m) => ({ ...m, facing }))}
              onSwapFacing={() => setMap((m) => ({ ...m, facing: m.facing === "left" ? "right" : m.facing === "right" ? "left" : m.facing }))}
              onNextBike={() => setMap((m) => ({ ...m, bikeChoice: ((typeof m.bikeChoice === "number" ? m.bikeChoice : 0) + 1) % m.bikeCandidates.length }))} />
            <button type="button" onClick={() => choosePhoto(null)} disabled={pointBusy}
              className="self-start rounded-full border border-hairline px-4 py-1.5 text-[13px] disabled:opacity-50">
              Use a different photo
            </button>
          </>
        )}
      </aside>
    </main>
  );
}
