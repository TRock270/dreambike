"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  applySuggestion, bikeFormFromRevision, bikeRevisionFromForm, editField, emptyBikeForm, type BikeFormState,
} from "@/lib/bikeForm";
import { deleteProject, listProjects, type DreamDb } from "@/lib/db";
import { children, type PendingRef } from "@/lib/project";
import {
  buildPartMap, derive, emptyPartMap, followUpPart, otherWheelSlot, partMapAfterEdit, recutBike, refreshedPart, selectByPoint, type PartMapState,
} from "@/lib/browser/partMap";
import { AppError } from "@/lib/errors";
import { PreflightError } from "@/lib/browser/preflight";
import { requestEdit, type Composited, type Generated } from "@/lib/browser/renderClient";
import { blend } from "@/lib/browser/renderFlow";
import {
  acceptEdit, cachedIdentify, closeStorage, createFromPhoto, headVersion, identifyForPhoto, jumpToVersion, newAcceptIds,
  openProject, openStorage, persistPartMap, redoHead, saveBike, saveErrorText, undoHead,
  type AcceptIds, type HeadView, type NavOutcome, type ProjectSession, type StorageState,
} from "@/lib/browser/projectSession";
import { requestInstruction } from "@/lib/browser/sparkClient";
import { hitTest, type ImagePoint } from "@/lib/coordinates";
import { modeAllowed, retargetPaintText } from "@/lib/editPolicy";
import { PAIRED_SLOTS } from "@/lib/parts";
import { slotInfo } from "@/lib/slots";
import type { BinaryMask, InstructionData, NormalizedPhoto, SlotId, Version } from "@/lib/types";
import { AppShell } from "./AppShell";
import { BikeConfirm } from "./BikeConfirm";
import { DescribeForm } from "./DescribeForm";
import { EditReview, type RenderState } from "./EditReview";
import { ImageCanvas } from "./ImageCanvas";
import { InstructionPreview } from "./InstructionPreview";
import { PaintForm } from "./PaintForm";
import { PartSelector, type PointTarget } from "./PartSelector";
import { ReferenceDropzone } from "./ReferenceDropzone";
import { ProjectList, type ProjectListState } from "./ProjectList";
import { UploadDropzone } from "./UploadDropzone";
import { UploadNotice } from "./UploadNotice";
import { VersionStrip } from "./VersionStrip";

const isStorageFull = (e: unknown) => e instanceof AppError && e.code === "STORAGE_FULL";

const PREVIEW_DISCARDED = "The preview was discarded because the version shown changed. Nothing was saved and no new render was started. Render again if you still want this change; that costs a new render.";

/** Header, photo area, edit panel and history. Projects are saved in this browser (SPEC 9). */
/** What a pending render remembers: which project and head it was made for, and the IDs an accept will use. */
type RenderEntry = { key: string; state: RenderState; newMask: BinaryMask | null; ref: PendingRef | null; ids: AcceptIds;
  /** Hash of the reference photo this render used (memory only), or null for text and paint. */ referenceHash: string | null };

/** Facing only changes the derived parts when a front/rear phrase was actually detected on this photo. */
function facingChangesParts(m: PartMapState): boolean {
  return Object.keys(PAIRED_SLOTS).some((phrase) => m.requests[phrase] === "done");
}

export function Workspace({ referenceEnabled }: { referenceEnabled: boolean }) {
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
  const [identifyCachedAt, setIdentifyCachedAt] = useState<number | null>(null);
  const [editMode, setEditMode] = useState<"text" | "paint" | "reference">("text");
  // The reference photo lives in browser memory only: never in IndexedDB, never in the project, never in an export.
  // It is tied to the part it was added for, so a front-wheel crop can never be sent for the rear wheel.
  const [refState, setRefState] = useState<{ key: string; photo: NormalizedPhoto } | null>(null);
  // Set when a route answers FEATURE_DISABLED: the server's own message, shown instead of the tab.
  const [referenceOff, setReferenceOff] = useState<string | null>(null);
  // A prepared instruction belongs to one part of one photo; anything else is stale.
  const [prepared, setPrepared] = useState<{ key: string; state: "busy" } | { key: string; state: "error"; message: string }
    | { key: string; state: "done"; instruction: InstructionData; requestText: string } | null>(null);
  // "Do the same for the other wheel?": the offer after an accepted wheel change, then the follow-up it starts.
  // fromLabel is the accepted part's label (needed to retarget a paint request); label is the other wheel's.
  const [offer, setOffer] = useState<{ slot: SlotId; label: string; fromLabel: string; mode: "text" | "paint" | "reference"; text: string } | null>(null);
  const [followUp, setFollowUp] = useState<(NonNullable<typeof offer> & { imageHash: string }) | null>(null);
  // Set before the one automatic prepare call, so a re-render or StrictMode can never send a second request.
  const followUpSent = useRef(false);
  // Slot of the wheel a started follow-up targets: accepting that wheel finishes the flow, so no new offer (no front/rear loop).
  const followUpSlot = useRef<SlotId | null>(null);
  // Text to show in the form of one selected part (key = selectionKey).
  const [prefill, setPrefill] = useState<{ selectionKey: string; text: string } | null>(null);

  // One render belongs to one prepared instruction; the cached generation is the resume point.
  const [render, setRender] = useState<RenderEntry | null>(null);
  const renderBusy = useRef(false);
  const [renderRunning, setRenderRunning] = useState(false);
  const renderAbort = useRef<AbortController | null>(null);
  // Full detection and identification run only for a newly imported photo, never after an accepted edit
  // and never when a project is opened.
  const autoDetect = useRef<string | null>(null);
  const runAbort = useRef<AbortController | null>(null);

  // ---- local storage and the open project (SPEC 9)
  // Refs hold the newest value for async callbacks; React state would be a stale copy inside them.
  const [storage, setStorage] = useState<StorageState | null>(null);
  const storageRef = useRef<StorageState | null>(null);
  const [session, setSessionState] = useState<ProjectSession | null>(null);
  const sessionRef = useRef<ProjectSession | null>(null);
  const [list, setList] = useState<ProjectListState>({ kind: "loading" });
  const [listBusy, setListBusy] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [savingProject, setSavingProject] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const [navNote, setNavNote] = useState<string | null>(null);
  const [navBusy, setNavBusy] = useState(false);
  const [branchChoices, setBranchChoices] = useState<Version[] | null>(null);
  const [accept, setAccept] = useState<{ saving: boolean; error: string | null }>({ saving: false, error: null });
  const acceptBusy = useRef(false);
  // Set when a save failed because storage is full: the delete-only list shows next to the preview or photo,
  // and nothing on screen (photo, paid render, preview, session) is cleared.
  const [storageFull, setStorageFull] = useState<"accept" | "import" | "parts" | null>(null);
  // True when the part map holds results that are not saved yet (new detection, recut, point selection).
  const partsDirty = useRef(false);
  // Saves run one after another, each on the newest session, so two saves never use an old part list.
  const persistChain = useRef<Promise<void>>(Promise.resolve());
  const importToken = useRef(0);
  // True from an accepted edit until its bike-outline recut has finished (found, none or error).
  const recutPending = useRef(false);

  function setSession(next: ProjectSession | null) {
    sessionRef.current = next;
    setSessionState(next);
  }
  const readyStorage = (): Extract<StorageState, { status: "ready" }> | null => (storageRef.current?.status === "ready" ? storageRef.current : null);

  useEffect(() => {
    let cancelled = false;
    let opened: StorageState | null = null;
    void openStorage().then((s) => {
      if (cancelled) { closeStorage(s); return; }
      opened = s;
      storageRef.current = s;
      setStorage(s);
    });
    return () => {
      cancelled = true;
      if (opened) closeStorage(opened);
      storageRef.current = null;
    };
  }, []);

  // The project list shows on the start screen, and again after a project is closed.
  async function refreshList() {
    if (!storage) { setList({ kind: "loading" }); return; }
    if (storage.status === "unavailable") { setList({ kind: "unavailable", message: storage.message }); return; }
    try {
      const found = await listProjects(storage.h);
      setList({ kind: "ready", projects: found.projects, unreadable: found.unreadable, readOnlyReason: storage.readOnlyReason });
    } catch (e) {
      setList({ kind: "unavailable", message: saveErrorText(e) });
    }
  }
  useEffect(() => {
    if (!photo) void refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshList only reads `storage`
  }, [storage, photo]);

  // A new photo starts a fresh part map. Every write checks the image hash,
  // so results for an older photo can never land on the new one.
  useEffect(() => {
    if (!photo || autoDetect.current !== photo.hash) return;
    const controller = new AbortController();
    runAbort.current = controller;
    void buildPartMap(photo, setMap, controller.signal);
    // Identification runs in parallel (cache first, so the same photo never pays twice);
    // its suggestion fills only untouched fields.
    const ready = readyStorage();
    void identifyForPhoto(ready ? ready.h : null, photo, controller.signal).then(
      (found) => {
        if (controller.signal.aborted) return;
        setBikeForm((f) => applySuggestion(f, found.bike));
        setIdentify({ status: "done", message: null });
        setIdentifyCachedAt(found.cachedAt);
      },
      (error) => { if (!controller.signal.aborted) setIdentify({ status: "error", message: error instanceof PreflightError ? error.message : null }); },
    );
    return () => controller.abort();
  }, [photo]);

  // Save detection or recut results on the shown version once they are complete.
  useEffect(() => {
    const ready = readyStorage();
    if (!ready || ready.readOnly || !photo || !session || !partsDirty.current) return;
    if (!map.done || map.imageHash !== photo.hash || headVersion(session).image.hash !== photo.hash) return;
    if (recutPending.current) return; // the recut is still running; its result triggers this effect again
    partsDirty.current = false;
    const shown = map;
    persistChain.current = persistChain.current.then(async () => {
      const cur = sessionRef.current;
      if (!cur) return;
      try {
        const saved = await persistPartMap(ready.h, cur, shown);
        const now = sessionRef.current;
        const updated = saved?.versions.find((v) => v.id === headVersion(saved).id);
        if (saved && updated && now && now.project.id === saved.project.id) {
          setSession({ ...now, versions: now.versions.map((v) => (v.id === updated.id ? updated : v)) });
        }
      } catch (e) {
        if (isStorageFull(e)) {
          // Keep them pending: "Save the parts" below retries for free after a project is deleted.
          partsDirty.current = true;
          setStorageFull((f) => f ?? "parts");
          void refreshList();
        } else {
          setSaveNote(`The detected parts could not be saved: ${saveErrorText(e)} They stay on screen.`);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshList only reads `storage`; saving must not rerun on it
  }, [map, session, photo]);

  // The bike's facing also answers the part map's front/rear question.
  const bikeFacing = bikeForm.bike.facing;
  useEffect(() => {
    if (bikeFacing === "unknown") return;
    setMap((m) => {
      if (m.facing === bikeFacing) return m;
      // A new facing re-derives detected front/rear parts, so they must be saved again. A restored
      // map has no "done" phrases, so opening a project never writes. (Setting a ref here is safe
      // to repeat if React calls this updater twice.)
      if (facingChangesParts(m)) partsDirty.current = true;
      return { ...m, facing: bikeFacing };
    });
  }, [bikeFacing]);

  /** Drop the other-wheel offer and any follow-up in progress. */
  function clearFollowUp() {
    setOffer(null);
    setFollowUp(null);
    followUpSlot.current = null;
  }

  /** A selection the mechanic made by hand ends the follow-up flow. */
  function selectByUser(id: string | null) {
    clearFollowUp();
    setSelectedId(id);
  }

  /** Stop everything that belongs to the photo shown now. */
  function resetWork() {
    pointAbort.current?.abort();
    renderAbort.current?.abort();
    runAbort.current?.abort();
    setRender(null);
    setPrepared(null);
    setRefState(null);
    clearFollowUp();
    setPrefill(null);
    setSelectedId(null);
    setPointMode(null);
    setNotice(null);
    setBranchChoices(null);
    setAccept({ saving: false, error: null });
    setStorageFull(null);
  }

  /** Show a saved version. Nothing paid starts: detection, identification and recut stay manual. */
  function showView(next: HeadView, nextSession: ProjectSession) {
    resetWork();
    autoDetect.current = null;
    partsDirty.current = false;
    recutPending.current = false;
    setSession(nextSession);
    setPhoto(next.photo);
    setMap(next.map);
  }

  async function choosePhoto(next: NormalizedPhoto | null) {
    const token = ++importToken.current;
    resetWork();
    setStaleNotice(null);
    setNavNote(null);
    setSaveNote(null);
    autoDetect.current = null;
    recutPending.current = false;
    if (!next) {
      setSession(null);
      setPhoto(null);
      setBikeForm(emptyBikeForm());
      setIdentify({ status: "off", message: null });
      setIdentifyCachedAt(null);
      setMap(emptyPartMap(""));
      return;
    }
    // A new import becomes a project right away; if saving is impossible the mechanic can still work.
    let created: ProjectSession | null = null;
    let full = false;
    const ready = readyStorage();
    if (ready && !ready.readOnly) {
      setSavingProject(true);
      try {
        created = await createFromPhoto(ready.h, next);
      } catch (e) {
        full = isStorageFull(e);
        setSaveNote(`This photo could not be saved: ${saveErrorText(e)} You can keep working, but nothing will be saved.`);
      } finally {
        setSavingProject(false);
      }
      if (token !== importToken.current) return; // another import or open started meanwhile
      if (full) { setStorageFull("import"); void refreshList(); }
    } else if (ready) {
      setSaveNote(`${ready.readOnlyReason ?? "Local storage is read-only."} You can keep working, but nothing will be saved.`);
    } else {
      setSaveNote("Local storage is not available in this browser. You can keep working, but nothing will be saved.");
    }
    autoDetect.current = next.hash;
    partsDirty.current = true;
    setSession(created);
    setPhoto(next);
    setBikeForm(emptyBikeForm());
    setIdentify({ status: "pending", message: null });
    setIdentifyCachedAt(null);
    setMap(emptyPartMap(next.hash));
  }

  /** "Save this photo" after the mechanic made room: try createFromPhoto again with the photo on screen. */
  async function saveUnsavedPhoto() {
    const ready = readyStorage();
    if (!ready || ready.readOnly || !photo || sessionRef.current || savingProject) return;
    const token = importToken.current;
    const form = bikeForm;
    setSavingProject(true);
    try {
      const created = await createFromPhoto(ready.h, photo);
      if (token !== importToken.current) return; // the photo was closed or replaced meanwhile
      setSession(created);
      setStorageFull(null);
      setSaveNote(null);
      // A confirmed bike was only in memory; save it on the new project too.
      if (form.confirmed) void saveConfirmedBike(form);
    } catch (e) {
      if (token !== importToken.current) return;
      setSaveNote(`This photo could not be saved: ${saveErrorText(e)} You can keep working, but nothing will be saved.`);
      if (isStorageFull(e)) { setStorageFull("import"); void refreshList(); }
    } finally {
      setSavingProject(false);
    }
  }

  async function openSaved(id: string) {
    const ready = readyStorage();
    if (!ready) return;
    const token = ++importToken.current;
    setListBusy(id);
    setListError(null);
    try {
      const opened = await openProject(ready.h, id);
      // Reading the identify cache is free; a missing entry is simply "no suggestion".
      const root = opened.session.versions.find((v) => v.id === opened.session.project.rootVersionId);
      const cached = opened.hasSavedBike || !root ? null : await cachedIdentify(ready.h, root.image.hash);
      let form = bikeFormFromRevision(opened.session.project.bikeRevision);
      if (cached) form = applySuggestion(form, cached.bike);
      if (token !== importToken.current) return; // another open or import started while this one was loading
      setStaleNotice(null);
      setNavNote(null);
      setSaveNote(null);
      showView(opened.view, opened.session);
      setBikeForm(form);
      setIdentify({ status: cached ? "done" : "off", message: null });
      setIdentifyCachedAt(cached?.cachedAt ?? null);
    } catch (e) {
      setListError(`This project could not be opened: ${saveErrorText(e)} It was not changed.`);
    } finally {
      setListBusy(null);
    }
  }

  async function deleteSaved(id: string) {
    const ready = readyStorage();
    if (!ready) return;
    setListBusy(id);
    setListError(null);
    try {
      await deleteProject(ready.h, id);
    } catch (e) {
      setListError(`The project could not be deleted: ${saveErrorText(e)}`);
    } finally {
      setListBusy(null);
    }
    await refreshList();
  }

  // ---- undo, redo, and jumping to a saved step
  async function navigate(run: (h: DreamDb, s: ProjectSession) => Promise<NavOutcome>) {
    const ready = readyStorage();
    if (!ready || !sessionRef.current || navBusy) return;
    const hadPreview = render !== null;
    setNavBusy(true);
    setNavNote(null);
    try {
      // A part save after detection may still be writing; wait so the session's version list is current.
      await persistChain.current;
      const current = sessionRef.current;
      if (!current) return;
      const out = await run(ready.h, current);
      if (out.status === "moved") {
        // The shown version changed, so any preview made for the old one can no longer be accepted.
        showView(out.view, out.session);
        setStaleNotice(hadPreview ? PREVIEW_DISCARDED : null);
      } else if (out.status === "choose_branch") {
        setBranchChoices(out.children);
      } else {
        setNavNote(out.message);
      }
    } catch (e) {
      setNavNote(`That step could not be shown: ${saveErrorText(e)} The project is unchanged.`);
    } finally {
      setNavBusy(false);
    }
  }

  // ---- bike confirmation is saved on the project (project level, SPEC 9)
  function changeBike(next: BikeFormState) {
    const previous = bikeForm;
    setBikeForm(next);
    // A confirmation and the taking back of one are both saved, so a reopened project never shows
    // a confirmation the mechanic withdrew. Other unconfirmed edits stay in memory until confirmed.
    const confirmedNow = next.confirmed && (!previous.confirmed || next.revision !== previous.revision);
    const withdrawn = previous.confirmed && !next.confirmed;
    if (confirmedNow || withdrawn) void saveConfirmedBike(next);
  }
  async function saveConfirmedBike(form: BikeFormState) {
    const ready = readyStorage();
    const current = sessionRef.current;
    if (!ready || !current) return; // an unsaved photo keeps the bike in memory only
    try {
      const saved = await saveBike(ready.h, current, bikeRevisionFromForm(form, current.project.bikeRevision.id, Date.now()));
      const now = sessionRef.current;
      if (now && now.project.id === saved.project.id) setSession({ ...now, project: saved.project });
      setSaveNote(null);
    } catch (e) {
      setSaveNote(`The confirmed bike could not be saved: ${saveErrorText(e)} It stays on screen.`);
    }
  }

  async function handleClick(point: ImagePoint) {
    if (!photo) return;
    setNotice(null);
    if (!pointMode) {
      const hit = hitTest(view.parts, point, photo);
      if (hit) selectByUser(hit.id);
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
      partsDirty.current = true;
      setMap((m) => {
        if (m.imageHash !== photo.hash) return m; // the photo changed meanwhile
        if ("bike" in result) return { ...m, bikePoint: result.bike, bikeChoice: "point" };
        const replaced = m.pointParts.filter((p) => p.slot === "custom" || p.slot !== result.part.slot);
        return { ...m, pointParts: [...replaced, result.part] };
      });
      if ("part" in result) selectByUser(result.part.id);
      setPointMode(null);
    } catch (error) {
      if (!controller.signal.aborted) setNotice(error instanceof PreflightError ? error.message : "Point selection failed.");
    } finally {
      setPointBusy(false);
    }
  }

  // A stale part (cut on an earlier picture) is shown but can never be the selected part.
  const selected = view.parts.find((p) => p.id === selectedId && !p.stale) ?? null;
  const selectionKey = photo && selected ? `${photo.hash}:${selected.id}` : null;
  const paintOnly = selected ? !modeAllowed(selected.slot, "text") : false;
  // Paint-only slots (frame, engine) never offer reference mode; a server that said "off" hides it too.
  const referenceOffered = referenceEnabled && referenceOff === null && !paintOnly;
  const mode = paintOnly ? "paint" : editMode === "reference" && !referenceOffered ? "text" : editMode;
  const reference = mode === "reference" && refState && refState.key === selectionKey ? refState.photo : null;
  // The key includes the bike as sent, so editing the bike makes an older preview stale.
  // It also includes the shown version, so a preview never carries over to another head.
  // The reference hash is part of the key too: swapping the reference makes an instruction prepared for the
  // old one stale, so a rear crop can never render with an instruction prepared for the front crop.
  const prepKey = `${session?.project.headVersionId ?? "unsaved"}:${selectionKey}:${mode}:${reference?.hash ?? "-"}:${JSON.stringify(bikeForm.bike)}`;
  const current = prepared && prepared.key === prepKey ? prepared : null;

  // Selecting another part drops the reference from memory (the key check above already ignores it).
  useEffect(() => {
    setRefState((r) => (r && r.key !== selectionKey ? null : r));
  }, [selectionKey]);

  const renderEntry = render && render.key === prepKey ? render : null;

  /** One explicit click = one paid render; `reuse` blends the cached render again without paying. */
  async function runRender(reuse: boolean) {
    if (!photo || !selected || current?.state !== "done" || renderBusy.current) return;
    if (mode === "reference" && !reference) return; // reference mode never renders without its reference
    const cached = renderEntry && renderEntry.state.kind !== "review" ? renderEntry.state.generated : null;
    if (reuse && !cached) return; // "Retry blend" never turns into a paid render
    renderBusy.current = true;
    setRenderRunning(true);
    setAccept({ saving: false, error: null });
    setStaleNotice(null);
    const controller = new AbortController();
    renderAbort.current = controller;
    const key = prepKey, base = photo, part = selected, instruction = current.instruction;
    const refPhoto = mode === "reference" ? reference : null;
    // Every preview is tied to the project and head it was made for, with fresh IDs for its accept.
    const ref: PendingRef | null = session ? { projectId: session.project.id, expectedHeadId: session.project.headVersionId } : null;
    const ids = newAcceptIds();
    const bikeBox = view.bike?.box ?? null;
    let generated: Generated | null = reuse ? cached : null;
    const put = (state: RenderState, newMask: BinaryMask | null = null) => {
      if (!controller.signal.aborted) setRender({ key, state, newMask, ref, ids, referenceHash: refPhoto?.hash ?? null });
    };
    try {
      if (!generated) {
        put({ kind: "running", stage: "generating", generated: null });
        generated = await requestEdit(base, { slot: part.slot, prompt: instruction.editPrompt, mode,
          intent: instruction.intent, quality: "high" }, crypto.randomUUID(), controller.signal, refPhoto?.blob ?? null);
      }
      const g = generated;
      const { result, newMask } = await blend(base, g, part, bikeBox, instruction.intent,
        (stage) => put({ kind: "running", stage, generated: g }), controller.signal);
      put({ kind: "review", generated: g, result }, newMask);
    } catch (error) {
      const known = error instanceof PreflightError;
      if (known && error.code === "FEATURE_DISABLED") setReferenceOff(error.message);
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
      setRender({ ...entry, newMask: null, state: { kind: "error", generated, retryable: true,
        message: "Blending cancelled. The render is kept: “Retry blend” uses it without a new render." } });
    } else {
      setRender(null);
    }
  }

  /**
   * Accept: save the preview as a new version, then show it. A refused or failed save keeps the
   * old head and the preview; a retry reuses the same IDs and never makes a new render.
   */
  async function acceptRender() {
    if (!photo || !selected || current?.state !== "done" || renderEntry?.state.kind !== "review" || acceptBusy.current) return;
    const entry = renderEntry;
    if (entry.state.kind !== "review") return; // narrows the type for TypeScript
    const result: Composited = entry.state.result;
    const next: NormalizedPhoto = { blob: result.blob, width: result.width, height: result.height, hash: result.hash, warnings: [] };
    // Other parts keep their masks only for a blended result of the same size (SPEC 9).
    const sameSize = result.width === photo.width && result.height === photo.height && result.composed;
    const part = sameSize && entry.newMask ? refreshedPart(selected.slot, selected.label, entry.newMask, next.hash) : null;
    const ready = readyStorage();
    const saved = sessionRef.current;
    // Captured now: the state below resets, and the offer is only made after a successful accept.
    const otherSlot = otherWheelSlot(selected.slot);
    const finishesFollowUp = followUpSlot.current === selected.slot;
    const nextOffer = otherSlot && !finishesFollowUp ? { slot: otherSlot, label: slotInfo(otherSlot).label, fromLabel: selected.label, mode, text: current.requestText } : null;

    // Read-only storage takes the in-memory path below: the edit shows here, says "not saved", never offers a retry.
    if (saved && ready && !ready.readOnly && entry.ref) {
      acceptBusy.current = true;
      setAccept({ saving: true, error: null });
      try {
        const out = await acceptEdit(ready.h, saved, {
          ref: entry.ref, ids: entry.ids, slot: selected.slot, mode, instruction: current.instruction,
          result, refreshed: part,
        });
        if (out.status === "refused") {
          // Refused before any write: the preview is dropped and nothing is repeated automatically.
          setRender(null);
          setPrepared(null);
          setAccept({ saving: false, error: null });
          setStaleNotice(out.message);
          return;
        }
        setSession(out.session);
      } catch (e) {
        setAccept({ saving: false, error: saveErrorText(e) });
        if (isStorageFull(e)) { setStorageFull("accept"); void refreshList(); }
        return;
      } finally {
        acceptBusy.current = false;
      }
    }

    runAbort.current?.abort();
    autoDetect.current = null; // the confirmed bike stays; only the outline and the edited part refresh
    partsDirty.current = true;
    setBranchChoices(null);
    setAccept({ saving: false, error: null });
    setStorageFull(null);
    setPhoto(next);
    setMap((m) => partMapAfterEdit(m, next.hash, part, sameSize));
    setFollowUp(null);
    setOffer(nextOffer);
    if (finishesFollowUp) followUpSlot.current = null;
    setSelectedId(part?.id ?? null);
    setPrepared(null);
    setRender(null);
    setRefState(null); // one reference per render: the next part starts without one
    const controller = new AbortController();
    runAbort.current = controller;
    recutPending.current = true;
    void recutBike(next, setMap, controller.signal).finally(() => {
      // Only the newest recut clears the flag; the no-op update re-runs the save effect.
      if (runAbort.current === controller) { recutPending.current = false; setMap((m) => ({ ...m })); }
    });
  }

  function redetect() {
    if (!photo) return;
    runAbort.current?.abort();
    const controller = new AbortController();
    runAbort.current = controller;
    partsDirty.current = true;
    recutPending.current = false; // the fresh detection now owns the bike outline
    setMap((m) => ({ ...m, done: false, bikeCarried: false, bikeStatus: "pending", bikeCandidates: [], bikeChoice: null, raw: {}, errors: [], requests: Object.fromEntries(Object.keys(m.requests).map((p) => [p, "pending"])) }));
    void buildPartMap(photo, setMap, controller.signal);
  }

  /** Yes on the offer: find the parts again; the effects below select the other wheel and prepare. */
  function acceptOffer() {
    if (!offer || !photo || busy || !map.done) return;
    followUpSent.current = false;
    followUpSlot.current = offer.slot;
    setFollowUp({ ...offer, imageHash: photo.hash });
    setOffer(null);
    setNotice(null);
    // A finished manual "Detect parts again" already found the other wheel: no second paid detection.
    if (!followUpPart(view.parts, offer.slot, photo.hash)) redetect();
  }

  /** A Prepare the mechanic clicks during the follow-up ends it, so its selection is never moved afterwards. */
  function prepareByUser(text: string) {
    // Only while a follow-up is pending: after it, the remembered slot must stay (no front/rear offer loop).
    if (followUp) clearFollowUp();
    void prepare(text);
  }

  async function prepare(text: string) {
    if (!photo || !selected || !selectionKey) return;
    if (mode === "reference" && !reference) return;
    const key = prepKey;
    setPrepared({ key, state: "busy" });
    try {
      const instruction = await requestInstruction({ slot: selected.slot, box: selected.box, bike: bikeForm.bike,
        mode, text, width: photo.width, height: photo.height }, undefined, mode === "reference" ? reference?.blob ?? null : null);
      setPrepared((p) => (p?.key === key ? { key, state: "done", instruction, requestText: text } : p));
    } catch (error) {
      if (error instanceof PreflightError && error.code === "FEATURE_DISABLED") setReferenceOff(error.message);
      setPrepared((p) => (p?.key === key ? { key, state: "error",
        message: error instanceof PreflightError ? error.message : "Preparing the change failed." } : p));
    }
  }

  // Follow-up step 1: once the new detection is complete, select the other wheel in the same mode.
  useEffect(() => {
    if (!followUp || !photo || !map.done) return;
    if (map.imageHash !== followUp.imageHash || photo.hash !== followUp.imageHash) return;
    const part = followUpPart(view.parts, followUp.slot, map.imageHash);
    if (!part) {
      const wheel = followUp.label.toLowerCase();
      setNotice(map.errors.length > 0
        ? `Detecting the parts failed, so the ${wheel} was not selected. Try “Detect parts again”, or pick it from the list.`
        : `The ${wheel} was not found on the new picture. Pick it from the list or set which side the front wheel is on.`);
      setFollowUp(null);
      followUpSlot.current = null;
      return;
    }
    if (selected?.id === part.id && editMode === followUp.mode) return; // step 2 takes over
    setSelectedId(part.id);
    setEditMode(followUp.mode);
    setPrefill({ selectionKey: `${photo.hash}:${part.id}`, text: followUp.text });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the new detection and the follow-up only
  }, [followUp, map, photo, view]);

  // Follow-up step 2: prepare once (text, paint) or ask for the missing reference. Render stays a manual click.
  useEffect(() => {
    if (!followUp || !map.done || !selected || selected.slot !== followUp.slot || editMode !== followUp.mode) return;
    if (current !== null || followUpSent.current || navBusy || accept.saving) return;
    followUpSent.current = true;
    const wheel = followUp.label.toLowerCase();
    if (mode !== followUp.mode) {
      // The server turned reference photos off meanwhile: the form shows text mode instead.
      setNotice(`The ${wheel} is selected. Use Prepare to continue.`);
    } else if (followUp.mode === "reference") {
      // The front reference must never be sent for the other wheel: no prepare, no reference.
      setNotice(`Add the ${wheel} reference photo, then Prepare.`);
    } else if (followUp.mode === "text") {
      void prepare(followUp.text);
    } else {
      const retargeted = retargetPaintText(followUp.text, followUp.fromLabel, selected.label);
      if (retargeted) void prepare(retargeted);
      else setNotice(`The ${wheel} is selected. Fill in the paint form, then Prepare.`);
    }
    setFollowUp(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the selection and mode are ready; prepare uses the same render's values
  }, [followUp, map.done, selected, editMode, current, navBusy, accept.saving]);

  const prefillFor = (key: string | null) => (key && prefill?.selectionKey === key ? prefill.text : undefined);
  const head = session ? headVersion(session) : null;
  const readOnly = storage?.status === "ready" && storage.readOnly;
  const redoKids = session && head ? children(session.versions, head.id) : [];
  const projectName = session?.project.name ?? (photo ? "Unsaved photo" : null);
  const saveStatus = !photo ? null : !session ? "Not saved" : readOnly ? "Read-only: changes are not saved" : "Saved on this device";
  const busy = navBusy || renderRunning || accept.saving || pointBusy;

  return (
    <AppShell projectName={projectName} saveStatus={saveStatus} busy={busy}
      canUndo={!!head && head.parentId !== null && !readOnly} canRedo={redoKids.length > 0 && !readOnly}
      undoHint={readOnly ? "Local storage is read-only" : undefined} redoHint={readOnly ? "Local storage is read-only" : undefined}
      onUndo={() => void navigate((h, s) => undoHead(h, s))}
      onRedo={() => void navigate((h, s) => redoHead(h, s))}>
      <main className="flex flex-1 gap-4 p-4">
        <div className="flex min-w-0 flex-[2] flex-col gap-4">
          <section aria-label="Photo" className="flex flex-1 items-center justify-center rounded-card border border-hairline bg-recess p-4">
            {photo ? (
              <ImageCanvas photo={photo} parts={view.parts} selectedId={selectedId} onImageClick={handleClick}
                cursor={pointMode ? "crosshair" : "default"} />
            ) : noticeAccepted ? <UploadDropzone onPhoto={(p) => void choosePhoto(p)} />
              : <UploadNotice onAccept={() => setNoticeAccepted(true)} />}
          </section>
          {saveNote && (
            <p role="alert" className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text text-[13px]">
              <span aria-hidden="true" className="mr-1 font-semibold">⚠</span>{saveNote}
            </p>
          )}
          {staleNotice && (
            <p role="status" className="rounded-chip bg-neutral-soft px-3 py-2 text-neutral-soft-text text-[13px]">
              <span aria-hidden="true" className="mr-1 font-semibold">ⓘ</span>{staleNotice}
            </p>
          )}
          {navNote && (
            <p role="status" className="rounded-chip bg-neutral-soft px-3 py-2 text-neutral-soft-text text-[13px]">
              <span aria-hidden="true" className="mr-1 font-semibold">ⓘ</span>{navNote}
            </p>
          )}
          {session && head && (
            <VersionStrip versions={session.versions} headId={head.id} branchChoices={branchChoices} disabled={busy || readOnly}
              onJump={(id) => void navigate((h, s) => jumpToVersion(h, s, id))}
              onChooseBranch={(id) => { setBranchChoices(null); void navigate((h, s) => redoHead(h, s, id)); }}
              onCancelChoice={() => setBranchChoices(null)} />
          )}
        </div>
        <aside aria-label="Edit panel" className="flex w-[360px] shrink-0 flex-col gap-4 overflow-y-auto rounded-card border border-hairline bg-surface-1 p-4">
          <h2 className="text-[20px] leading-[1.35]">Edit</h2>
          {!photo && (
            <>
              <p className="text-text-muted text-[13px]">Import a photo of your own bike to start, or open a saved project.</p>
              {savingProject && <p role="status" className="text-text-secondary text-[13px]">Saving the project…</p>}
              <ProjectList state={list} busyId={listBusy} error={listError} onOpen={(id) => void openSaved(id)} onDelete={(id) => void deleteSaved(id)} />
            </>
          )}
          {photo && (
            <>
              <BikeConfirm key={photo.hash} form={bikeForm} identifyStatus={identify.status} identifyMessage={identify.message} onChange={changeBike} />
              {identifyCachedAt !== null && (
                <p className="tabular text-text-muted text-[12px]">
                  Suggestion reused from {new Date(identifyCachedAt).toLocaleDateString()} (saved on this device). No new AI call was made.
                </p>
              )}
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
                onSelect={selectByUser} onStartPoint={setPointMode} onCancelPoint={() => setPointMode(null)}
                onFacing={(facing) => { if (facingChangesParts(map)) partsDirty.current = true; setMap((m) => ({ ...m, facing })); setBikeForm((f) => editField(f, "facing", facing)); }}
                onRedetect={redetect}
                onSwapFacing={() => {
                  const next = map.facing === "left" ? "right" : "left";
                  if (facingChangesParts(map)) partsDirty.current = true;
                  setMap((m) => ({ ...m, facing: next }));
                  setBikeForm((f) => editField(f, "facing", next));
                }}
                onNextBike={() => { partsDirty.current = true; setMap((m) => ({ ...m, bikeChoice: ((typeof m.bikeChoice === "number" ? m.bikeChoice : 0) + 1) % m.bikeCandidates.length })); }} />
              {selected && (
                <section aria-label="Change the selected part" className="flex flex-col gap-3 border-t border-hairline pt-3">
                  <h3 className="text-[15px] font-semibold">Change: {selected.label}</h3>
                  {paintOnly ? (
                    <p className="text-text-muted text-[12px]">{slotInfo(selected.slot).label} allows paint changes only.</p>
                  ) : (
                    <div role="tablist" aria-label="Kind of change" className="flex gap-1">
                      {(referenceOffered ? ["text", "paint", "reference"] as const : ["text", "paint"] as const).map((m) => (
                        <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setEditMode(m)}
                          className={`rounded-full px-3 py-1 text-[13px] ${mode === m ? "bg-primary text-on-fill" : "border border-hairline"}`}>
                          {m === "text" ? "Describe" : m === "paint" ? "Paint" : "Reference photo"}
                        </button>
                      ))}
                    </div>
                  )}
                  {!paintOnly && !referenceOffered && (
                    <p className="text-text-muted text-[12px]">
                      {referenceOff ?? "Reference photos are switched off on this server. Describe the part in text instead."}
                    </p>
                  )}
                  {mode === "text" && <DescribeForm key={`d-${selectionKey}`} partLabel={selected.label} initialText={prefillFor(selectionKey)} busy={current?.state === "busy"} onPrepare={prepareByUser} />}
                  {mode === "paint" && <PaintForm key={`p-${selectionKey}`} partLabel={selected.label} busy={current?.state === "busy"} onPrepare={prepareByUser} />}
                  {mode === "reference" && (
                    <ReferenceDropzone key={`r-${selectionKey}`} partLabel={selected.label} reference={reference} initialText={prefillFor(selectionKey)}
                      busy={current?.state === "busy"} onPrepare={prepareByUser}
                      onReference={(p) => setRefState(p && selectionKey ? { key: selectionKey, photo: p } : null)} />
                  )}
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
                    <EditReview base={photo} state={renderEntry.state} fromReference={renderEntry.referenceHash !== null} onAccept={() => void acceptRender()}
                      onReject={() => { setRender(null); setAccept({ saving: false, error: null }); setStorageFull((f) => (f === "accept" ? null : f)); }}
                      onRetryBlend={() => void runRender(true)} onRenderAgain={() => void runRender(false)} onCancel={cancelRender}
                      saving={accept.saving} saveError={accept.error} unsaved={!session || readOnly} readOnly={readOnly && !!session} />
                  )}
                </section>
              )}
              {offer && (
                <section aria-label="Do the same for the other wheel" className="flex flex-col gap-2 rounded-card border border-hairline bg-surface-3 p-3">
                  <p className="text-[13px] font-semibold">Do the same for the {offer.label.toLowerCase()}?</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={acceptOffer} disabled={busy || !map.done}
                      className="rounded-full bg-primary px-4 py-1.5 text-on-fill text-[13px] disabled:opacity-50">
                      Yes: find the parts and prepare the same change (about $0.04)
                    </button>
                    <button type="button" onClick={clearFollowUp} className="rounded-full border border-hairline px-4 py-1.5 text-[13px]">No</button>
                  </div>
                </section>
              )}
              {storageFull && (
                <section aria-label="Storage is full" className="flex flex-col gap-2 border-t border-hairline pt-3">
                  <p role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text text-[13px]">
                    <span aria-hidden="true" className="mr-1 font-semibold">✕</span>
                    {storageFull === "accept"
                      ? "Browser storage is full, so this change is not saved yet. What you see, including the paid preview, is kept in this tab only. Delete another saved project below, then press “Try saving again”; no new render is made."
                      : storageFull === "parts"
                      ? "Browser storage is full, so the detected parts are not saved. They stay on screen in this tab. Delete another saved project below, then press “Save the parts”."
                      : "Browser storage is full, so this photo is not saved. What you see is kept in this tab only and is lost when you close the page. Delete a saved project below, then save this photo."}
                  </p>
                  <ProjectList state={list} busyId={listBusy} error={listError} deleteOnly excludeId={session?.project.id ?? null}
                    emptyText="There is no other saved project to delete. This project alone is too large to save here, so keep working unsaved."
                    onOpen={() => undefined} onDelete={(id) => void deleteSaved(id)} />
                  {storageFull === "parts" && (
                    <button type="button" onClick={() => { partsDirty.current = true; setStorageFull(null); setMap((m) => ({ ...m })); }}
                      className="self-start rounded-full bg-primary px-4 py-1.5 text-[13px] text-on-fill">
                      Save the parts
                    </button>
                  )}
                  {storageFull === "import" && (
                    <>
                      {/* Saving gives the photo a project, which ends any open preview; finish that first. */}
                      {(render !== null || renderRunning || prepared?.state === "busy") && (
                        <p className="text-text-muted text-[12px]">Accept or discard the preview first, then save this photo.</p>
                      )}
                      <button type="button" onClick={() => void saveUnsavedPhoto()}
                        disabled={savingProject || render !== null || renderRunning || prepared?.state === "busy"}
                        className="self-start rounded-full bg-primary px-4 py-1.5 text-[13px] text-on-fill disabled:opacity-50">
                        {savingProject ? "Saving…" : "Save this photo"}
                      </button>
                    </>
                  )}
                </section>
              )}
              <button type="button" onClick={() => void choosePhoto(null)} disabled={pointBusy || renderRunning || accept.saving}
                className="self-start rounded-full border border-hairline px-4 py-1.5 text-[13px] disabled:opacity-50">
                Close project
              </button>
            </>
          )}
        </aside>
      </main>
    </AppShell>
  );
}
