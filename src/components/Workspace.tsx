"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { applySuggestion, editField, emptyBikeForm, type BikeFormState } from "@/lib/bikeForm";
import {
  buildPartMap, derive, emptyPartMap, partMapAfterEdit, recutBike, refreshedPart, selectByPoint, type PartMapState,
} from "@/lib/browser/partMap";
import { PreflightError } from "@/lib/browser/preflight";
import { requestEdit, type Composited, type Generated } from "@/lib/browser/renderClient";
import { blend } from "@/lib/browser/renderFlow";
import { requestIdentify, requestInstruction } from "@/lib/browser/sparkClient";
import { hitTest, type ImagePoint } from "@/lib/coordinates";
import { modeAllowed } from "@/lib/editPolicy";
import { slotInfo } from "@/lib/slots";
import type { BinaryMask, InstructionData, NormalizedPhoto } from "@/lib/types";
import { BikeConfirm } from "./BikeConfirm";
import { DescribeForm } from "./DescribeForm";
import { EditReview, type RenderState } from "./EditReview";
import { ImageCanvas } from "./ImageCanvas";
import { InstructionPreview } from "./InstructionPreview";
import { PaintForm } from "./PaintForm";
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
  const [bikeForm, setBikeForm] = useState<BikeFormState>(emptyBikeForm);
  const [identify, setIdentify] = useState<{ status: "pending" | "done" | "error" | "off"; message: string | null }>({ status: "off", message: null });
  const [editMode, setEditMode] = useState<"text" | "paint">("text");
  // A prepared instruction belongs to one part of one photo; anything else is stale.
  const [prepared, setPrepared] = useState<{ key: string; state: "busy" } | { key: string; state: "error"; message: string }
    | { key: string; state: "done"; instruction: InstructionData } | null>(null);

  // One render belongs to one prepared instruction; the cached generation is the resume point.
  const [render, setRender] = useState<{ key: string; state: RenderState; newMask: BinaryMask | null } | null>(null);
  const renderBusy = useRef(false);
  const [renderRunning, setRenderRunning] = useState(false);
  const renderAbort = useRef<AbortController | null>(null);
  // Full detection and identification run only for a newly imported photo, never after an accepted edit.
  const autoDetect = useRef<string | null>(null);
  const runAbort = useRef<AbortController | null>(null);

  // A new photo starts a fresh part map. Every write checks the image hash,
  // so results for an older photo can never land on the new one.
  useEffect(() => {
    if (!photo || autoDetect.current !== photo.hash) return;
    const controller = new AbortController();
    runAbort.current = controller;
    void buildPartMap(photo, setMap, controller.signal);
    // Identification runs in parallel; its suggestion fills only untouched fields.
    void requestIdentify(photo, controller.signal).then(
      (bike) => { if (!controller.signal.aborted) { setBikeForm((f) => applySuggestion(f, bike)); setIdentify({ status: "done", message: null }); } },
      (error) => { if (!controller.signal.aborted) setIdentify({ status: "error", message: error instanceof PreflightError ? error.message : null }); },
    );
    return () => controller.abort();
  }, [photo]);

  // The bike's facing also answers the part map's front/rear question.
  const bikeFacing = bikeForm.bike.facing;
  useEffect(() => {
    if (bikeFacing !== "unknown") setMap((m) => (m.facing === bikeFacing ? m : { ...m, facing: bikeFacing }));
  }, [bikeFacing]);

  function choosePhoto(next: NormalizedPhoto | null) {
    pointAbort.current?.abort();
    renderAbort.current?.abort();
    runAbort.current?.abort();
    autoDetect.current = next?.hash ?? null;
    setRender(null);
    setPhoto(next);
    setBikeForm(emptyBikeForm());
    setIdentify({ status: next ? "pending" : "off", message: null });
    setPrepared(null);
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
  const selectionKey = photo && selected ? `${photo.hash}:${selected.id}` : null;
  const paintOnly = selected ? !modeAllowed(selected.slot, "text") : false;
  const mode = paintOnly ? "paint" : editMode;
  // The key includes the bike as sent, so editing the bike makes an older preview stale.
  const prepKey = `${selectionKey}:${mode}:${JSON.stringify(bikeForm.bike)}`;
  const current = prepared && prepared.key === prepKey ? prepared : null;

  const renderEntry = render && render.key === prepKey ? render : null;

  /** One explicit click = one paid render; `reuse` blends the cached render again without paying. */
  async function runRender(reuse: boolean) {
    if (!photo || !selected || current?.state !== "done" || renderBusy.current) return;
    const cached = renderEntry && renderEntry.state.kind !== "review" ? renderEntry.state.generated : null;
    if (reuse && !cached) return; // "Retry blend" never turns into a paid render
    renderBusy.current = true;
    setRenderRunning(true);
    const controller = new AbortController();
    renderAbort.current = controller;
    const key = prepKey, base = photo, part = selected, instruction = current.instruction;
    const bikeBox = view.bike?.box ?? null;
    let generated: Generated | null = reuse ? cached : null;
    const put = (state: RenderState, newMask: BinaryMask | null = null) => {
      if (!controller.signal.aborted) setRender({ key, state, newMask });
    };
    try {
      if (!generated) {
        put({ kind: "running", stage: "generating", generated: null });
        generated = await requestEdit(base, { slot: part.slot, prompt: instruction.editPrompt, mode,
          intent: instruction.intent, quality: "high" }, crypto.randomUUID(), controller.signal);
      }
      const g = generated;
      const { result, newMask } = await blend(base, g, part, bikeBox, instruction.intent,
        (stage) => put({ kind: "running", stage, generated: g }), controller.signal);
      put({ kind: "review", generated: g, result }, newMask);
    } catch (error) {
      const known = error instanceof PreflightError;
      put({ kind: "error", message: known ? error.message : "The render failed.", retryable: known ? error.retryable : true, generated });
    } finally {
      renderBusy.current = false;
      setRenderRunning(false);
    }
  }

  /** Cancel. A render that is already paid for is kept, so "Retry blend" can use it without paying again. */
  function cancelRender() {
    const entry = renderEntry;
    const generated = entry?.state.kind === "running" ? entry.state.generated : null;
    renderAbort.current?.abort();
    if (entry && generated) {
      setRender({ key: entry.key, newMask: null, state: { kind: "error", generated, retryable: true,
        message: "Blending cancelled. The render is kept: “Retry blend” uses it without a new render." } });
    } else {
      setRender(null);
    }
  }

  /** Accept: the result becomes the working photo. History and undo arrive with T6. */
  function acceptRender() {
    if (!photo || !selected || renderEntry?.state.kind !== "review") return;
    const result: Composited = renderEntry.state.result;
    const next: NormalizedPhoto = { blob: result.blob, width: result.width, height: result.height, hash: result.hash, warnings: [] };
    const sameSize = result.width === photo.width && result.height === photo.height;
    const part = sameSize && renderEntry.newMask ? refreshedPart(selected.slot, selected.label, renderEntry.newMask, next.hash) : null;
    runAbort.current?.abort();
    autoDetect.current = null; // the confirmed bike stays; only the outline and the edited part refresh
    setPhoto(next);
    setMap((m) => partMapAfterEdit(m, next.hash, part, sameSize));
    setSelectedId(part?.id ?? null);
    setPrepared(null);
    setRender(null);
    const controller = new AbortController();
    runAbort.current = controller;
    void recutBike(next, setMap, controller.signal);
  }

  function redetect() {
    if (!photo) return;
    runAbort.current?.abort();
    const controller = new AbortController();
    runAbort.current = controller;
    setMap((m) => ({ ...m, done: false, raw: {}, errors: [], requests: Object.fromEntries(Object.keys(m.requests).map((p) => [p, "pending"])) }));
    void buildPartMap(photo, setMap, controller.signal);
  }

  async function prepare(text: string) {
    if (!photo || !selected || !selectionKey) return;
    const key = prepKey;
    setPrepared({ key, state: "busy" });
    try {
      const instruction = await requestInstruction({ slot: selected.slot, box: selected.box, bike: bikeForm.bike,
        mode, text, width: photo.width, height: photo.height });
      setPrepared((p) => (p?.key === key ? { key, state: "done", instruction } : p));
    } catch (error) {
      setPrepared((p) => (p?.key === key ? { key, state: "error",
        message: error instanceof PreflightError ? error.message : "Preparing the change failed." } : p));
    }
  }
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
            <BikeConfirm key={photo.hash} form={bikeForm} identifyStatus={identify.status} identifyMessage={identify.message} onChange={setBikeForm} />
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
              onFacing={(facing) => { setMap((m) => ({ ...m, facing })); setBikeForm((f) => editField(f, "facing", facing)); }}
              onRedetect={redetect}
              onSwapFacing={() => {
                const next = map.facing === "left" ? "right" : "left";
                setMap((m) => ({ ...m, facing: next }));
                setBikeForm((f) => editField(f, "facing", next));
              }}
              onNextBike={() => setMap((m) => ({ ...m, bikeChoice: ((typeof m.bikeChoice === "number" ? m.bikeChoice : 0) + 1) % m.bikeCandidates.length }))} />
            {selected && (
              <section aria-label="Change the selected part" className="flex flex-col gap-3 border-t border-hairline pt-3">
                <h3 className="text-[15px] font-semibold">Change: {selected.label}</h3>
                {paintOnly ? (
                  <p className="text-text-muted text-[12px]">{slotInfo(selected.slot).label} allows paint changes only.</p>
                ) : (
                  <div role="tablist" aria-label="Kind of change" className="flex gap-1">
                    {(["text", "paint"] as const).map((m) => (
                      <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setEditMode(m)}
                        className={`rounded-full px-3 py-1 text-[13px] ${mode === m ? "bg-primary text-on-fill" : "border border-hairline"}`}>
                        {m === "text" ? "Describe" : "Paint"}
                      </button>
                    ))}
                  </div>
                )}
                {mode === "text"
                  ? <DescribeForm key={`d-${selectionKey}`} partLabel={selected.label} busy={current?.state === "busy"} onPrepare={prepare} />
                  : <PaintForm key={`p-${selectionKey}`} partLabel={selected.label} busy={current?.state === "busy"} onPrepare={prepare} />}
                {current?.state === "busy" && <p role="status" className="text-text-secondary text-[13px]">Preparing the change…</p>}
                {current?.state === "error" && (
                  <p role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text text-[13px]">
                    <span aria-hidden="true" className="mr-1 font-semibold">✕</span>{current.message}
                  </p>
                )}
                {current?.state === "done" && (
                  <InstructionPreview instruction={current.instruction} slotLabel={selected.label}
                    rendering={renderRunning} onRender={() => void runRender(false)} />
                )}
                {current?.state === "done" && renderEntry && (
                  <EditReview base={photo} state={renderEntry.state} onAccept={acceptRender} onReject={() => setRender(null)}
                    onRetryBlend={() => void runRender(true)} onRenderAgain={() => void runRender(false)} onCancel={cancelRender} />
                )}
              </section>
            )}
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
