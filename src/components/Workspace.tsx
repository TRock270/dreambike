"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  applySuggestion, bikeFormFromRevision, bikeRevisionFromForm, editField, emptyBikeForm, type BikeFormState,
} from "@/lib/bikeForm";
import {
  attachFitResponse, deleteProject, getLastOpenProject, getShopSettings, getStoredImage, getStoredMask, listProjects, loadProject, loadSettings,
  setLastOpenProject, snapshotSources, type DreamDb,
} from "@/lib/db";
import { children, exportPlan, projectSnapshot, type PendingRef, type SnapshotResult } from "@/lib/project";
import {
  folderErrorText, folderImportErrorText, folderPermission, isFolderExportSupported, pickFolder, pickProjectFolderForImport,
  readProjectFolder, rememberedFolder, saveProjectToFolder,
} from "@/lib/browser/folderExport";
import {
  buildPartMap, derive, emptyPartMap, followUpPart, otherWheelSlot, partMapAfterEdit, recutBike, refreshedPart, selectByPoint, boxPart, boxAcceptable, withPointPart, type PartMapState,
} from "@/lib/browser/partMap";
import { AppError } from "@/lib/errors";
import { PreflightError } from "@/lib/browser/preflight";
import { requestEdit, type Composited, type Generated } from "@/lib/browser/renderClient";
import { blend } from "@/lib/browser/renderFlow";
import {
  acceptEdit, cachedIdentify, closeStorage, createFromPhoto, headVersion, identifyForPhoto, jumpToVersion, newAcceptIds,
  openProject, openStorage, persistPartMap, redoHead, saveBike, saveErrorText, saveSheet, undoHead,
  type AcceptIds, type HeadView, type NavOutcome, type ProjectSession, type StorageState,
} from "@/lib/browser/projectSession";
import { scheduleWarmup } from "@/lib/browser/pdfExport";
import { requestInstruction } from "@/lib/browser/sparkClient";
import { hitTest, type ImagePoint } from "@/lib/coordinates";
import { modeAllowed, retargetPaintText } from "@/lib/editPolicy";
import { PAIRED_SLOTS } from "@/lib/parts";
import type { AppMode } from "@/lib/server/config";
import { slotInfo } from "@/lib/slots";
import type { BinaryMask, InstructionData, NormalizedPhoto, Project, ShopSettings, SlotId, Version } from "@/lib/types";
import { AppShell, type PanelMode } from "./AppShell";
import { BikeConfirm } from "./BikeConfirm";
import { BudgetBanner } from "./BudgetBanner";
import { DemoView } from "./DemoView";
import { BuildSheet, type FitSupport, type SheetChange, type SheetSaveResult } from "./BuildSheet";
import { DescribeForm } from "./DescribeForm";
import { EditReview, type RenderState } from "./EditReview";
import { EstimatePreview } from "./EstimatePreview";
import { ImageCanvas } from "./ImageCanvas";
import { InstructionPreview } from "./InstructionPreview";
import { PaintForm } from "./PaintForm";
import { ShopSettingsForm } from "./ShopSettingsForm";
import { PartSelector, type BoxTarget, type PointTarget } from "./PartSelector";
import { ReferenceDropzone } from "./ReferenceDropzone";
import { ProjectList, type ProjectListState } from "./ProjectList";
import { UploadDropzone } from "./UploadDropzone";
import { UploadNotice } from "./UploadNotice";
import { VersionStrip } from "./VersionStrip";

const isStorageFull = (e: unknown) => e instanceof AppError && e.code === "STORAGE_FULL";

/** "QuotaExceededError: message": the error's own name (AppError has no name of its own, so its code) and message. */
function errorDetail(e: unknown): string {
  if (e instanceof AppError) return `${e.code}: ${e.message}`;
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return `Error: ${String(e)}`;
}

/** Why nothing is stored, from the storage state alone (no thrown error exists in these cases). */
function storageDetail(s: StorageState | null): string {
  if (!s) return "StorageNotReady: local storage had not finished opening.";
  if (s.status === "unavailable") return s.message; // F1's StorageUnavailableError message, with the browser's detail
  if (s.readOnly) return `ReadOnlyError: ${s.readOnlyReason ?? "Local storage is read-only."}`;
  return "NoProject: no project was stored for this photo.";
}

type FoldKey = "bike" | "parts" | "change" | "project";

/**
 * A right-panel section that folds. It uses the browser's own <details>; the open state lives in
 * Workspace (not saved anywhere) so code can fold or re-open a section. onToggle fires after the
 * user clicks the summary; e.currentTarget.open is the new state.
 */
function Fold({ title, open, onToggle, className = "", children }: {
  title: string; open: boolean; onToggle: (open: boolean) => void; className?: string; children: React.ReactNode;
}) {
  return (
    <details open={open} onToggle={(e) => onToggle(e.currentTarget.open)} className={`group ${className}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 shrink-0 transition-transform group-open:rotate-90">
          <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h3 className="text-[15px] font-semibold">{title}</h3>
      </summary>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </details>
  );
}

const PREVIEW_DISCARDED = "The preview was discarded because the version shown changed. Nothing was saved and no new render was started. Render again if you still want this change; that costs a new render.";

/** Header, photo area, edit panel and history. Projects are saved in this browser (SPEC 9). */
/** What a pending render remembers: which project and head it was made for, and the IDs an accept will use. */
type RenderEntry = { key: string; state: RenderState; newMask: BinaryMask | null; ref: PendingRef | null; ids: AcceptIds;
  /** Hash of the reference photo this render used (memory only), or null for text and paint. */ referenceHash: string | null };

/** Facing only changes the derived parts when a front/rear phrase was actually detected on this photo. */
function facingChangesParts(m: PartMapState): boolean {
  return Object.keys(PAIRED_SLOTS).some((phrase) => m.requests[phrase] === "done");
}

export function Workspace({ referenceEnabled, appMode }: { referenceEnabled: boolean; appMode: AppMode }) {
  const [noticeAccepted, setNoticeAccepted] = useState(false);
  const [photo, setPhoto] = useState<NormalizedPhoto | null>(null);
  const [map, setMap] = useState<PartMapState>(() => emptyPartMap());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pointMode, setPointMode] = useState<PointTarget | null>(null);
  // Box mode: the mechanic drags a rectangle on the photo. No network request is involved.
  const [boxMode, setBoxMode] = useState<BoxTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pointBusy, setPointBusy] = useState(false);
  // Counts every paid request that has ended (any outcome). It is part of the budget banner's refresh key,
  // so background calls such as the bike recut after an accept refresh the banner too.
  const [paidSettled, setPaidSettled] = useState(0);
  const noteSettled = () => setPaidSettled((n) => n + 1);
  const pointAbort = useRef<AbortController | null>(null);
  const boxEndedAt = useRef(0); // time of the last finished box drag
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
  // Which right-panel sections are open. Session only; every section starts open.
  const [fold, setFold] = useState<Record<FoldKey, boolean>>({ bike: true, parts: true, change: true, project: true });
  const setFolded = (key: FoldKey, open: boolean) => setFold((f) => (f[key] === open ? f : { ...f, [key]: open }));
  // The wide panel (Build sheet, Estimate or Settings) replaces the edit folds while it is open. The folds
  // stay mounted (hidden), so fold states and what the mechanic typed in the edit forms survive.
  const [panel, setPanel] = useState<PanelMode>("edit");
  const sheetOpen = panel !== "edit"; // any wide panel: the photo takes no clicks, the folds are hidden
  const [sheetSaving, setSheetSaving] = useState(false);
  const sheetBusy = useRef(false); // second guard next to the disabled buttons
  const [fitBusy, setFitBusy] = useState(false); // a fit check is running: Undo, Redo and jumps wait
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
  // The cached demo replaces the editor area while it is open. It reads only /demo/ files, so storage trouble cannot hide it.
  const [demoOpen, setDemoOpen] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  // Why the photo on screen is NOT stored in this browser. Set when a save fails or storage cannot be
  // written; cleared only by a save that succeeds (or when the photo is closed), never by other actions.
  const [lastSaveFailure, setLastSaveFailure] = useState<string | null>(null);
  // "Open project from folder": busy flag and the message shown by the project list.
  const [openingFolder, setOpeningFolder] = useState(false);
  const openingFolderRef = useRef(false);
  const [openFolderNote, setOpenFolderNote] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const restoreTried = useRef(false); // the reload restore runs once per page load
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

  // ---- project folder (File System Access API; the folder handle lives in its own small database)
  type FolderPerm = "granted" | "prompt" | "denied";
  type FolderStatus = { rootName: string; folderName: string; savedAt: number; written: number; notExported: number };
  type FolderNote = { projectId: string; tone: "warning" | "danger" | "info"; text: string };
  const [folderApi, setFolderApi] = useState(false); // set after mount so server and browser render the same first page
  const [folderHandle, setFolderHandleState] = useState<FileSystemDirectoryHandle | null>(null);
  const folderHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const [folderPerm, setFolderPerm] = useState<FolderPerm | null>(null);
  const [folderStatus, setFolderStatus] = useState<Record<string, FolderStatus>>({}); // keyed by project id
  const [folderNote, setFolderNote] = useState<FolderNote | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const folderRunning = useRef(false); // one save at a time
  const folderQueued = useRef<{ auto: boolean; projectId: string | null } | null>(null); // a request that arrived during a save, with the project that asked
  function setFolderHandle(h: FileSystemDirectoryHandle | null) {
    folderHandleRef.current = h;
    setFolderHandleState(h);
  }

  /**
   * Saves the newest history. Requests during a save are queued and run once afterwards, reading
   * sessionRef again then, so an older history.json never overwrites a newer one. `auto` saves never
   * ask for permission and report failure as a warning.
   */
  async function requestFolderSave(handle: FileSystemDirectoryHandle, auto: boolean) {
    if (folderRunning.current) {
      folderQueued.current = { auto: (folderQueued.current?.auto ?? true) && auto, projectId: sessionRef.current?.project.id ?? null };
      return;
    }
    folderRunning.current = true;
    setFolderBusy(true);
    let mode = auto;
    try {
      for (;;) {
        folderQueued.current = null;
        const ready = readyStorage();
        const s = sessionRef.current;
        if (!ready || ready.readOnly || !s) break;
        const pid = s.project.id;
        try {
          const perm = await folderPermission(handle, false);
          setFolderPerm(perm);
          if (perm !== "granted") break; // the status line then offers "Reconnect folder"
          // The snapshot is read from the stored records (not React state). If that read fails, the
          // history is still saved and project.json is reported as not written.
          let sources: Awaited<ReturnType<typeof snapshotSources>> = null;
          let sourcesError: string | null = null;
          try { sources = await snapshotSources(ready.h, pid); } catch (e) { sourcesError = errorDetail(e); }
          const exportProject = sources?.project ?? s.project;
          const exportVersions = sources?.versions ?? s.versions;
          const plan = exportPlan({
            project: exportProject, versions: exportVersions, headId: exportProject.headVersionId, exportedAt: new Date().toISOString(),
          });
          const snapshot: SnapshotResult = sources
            ? projectSnapshot({ project: sources.project, versions: sources.versions, cutouts: sources.cutouts, masks: sources.masks, plan })
            : { complete: false, reason: sourcesError ? `The saved project could not be read for project.json (${sourcesError}).` : "The saved project was not found for project.json." };
          const result = await saveProjectToFolder(
            handle, plan, async (id) => (await getStoredImage(ready.h, id))?.blob ?? null, undefined,
            { snapshot, readMask: async (id) => (await getStoredMask(ready.h, id))?.pixels ?? null },
          );
          // Count distinct images, not versions: a sheet step reuses its parent's image file.
          const imageIds = new Set(exportVersions.map((v) => v.image.id));
          const notExported = result.missing.length + (imageIds.size - plan.files.length);
          setFolderStatus((all) => ({
            ...all,
            [pid]: { rootName: handle.name, folderName: result.folderName, savedAt: Date.now(), written: result.written, notExported },
          }));
          setFolderNote((n) => (n && n.projectId === pid ? null : n));
          if (result.projectJson === "not_written") {
            // History and pictures are in the folder, but it cannot be opened again; say why.
            setFolderNote({ projectId: pid, tone: "warning",
              text: `project.json was not written, so this folder cannot be opened again with Open project from folder. ${result.projectJsonReason ?? ""}`.trim() });
          }
        } catch (e) {
          const reason = folderErrorText(e).replace(/\.$/, "");
          setFolderNote({
            projectId: pid, tone: mode ? "warning" : "danger",
            text: mode
              ? `The new step is saved in the browser, but not in the folder: ${reason}. Use Save project to folder to retry.`
              : `${reason}.`,
          });
          folderQueued.current = null;
          break;
        }
        // Re-read through a local: TypeScript thinks the ref is still null from the line above, but awaits ran in between.
        const queued = folderQueued.current as { auto: boolean; projectId: string | null } | null;
        if (!queued) break;
        if (queued.projectId && sessionRef.current?.project.id !== queued.projectId) {
          // The owner left the project that asked for this save. Never save the other project instead;
          // drop the old "last saved" line and say the newest step is not in the folder.
          const left = queued.projectId;
          setFolderStatus((all) => { const rest = { ...all }; delete rest[left]; return rest; });
          setFolderNote({ projectId: left, tone: "warning",
            text: "The newest step is saved in the browser, but not in the folder yet. Open this project and use Save project to folder." });
          folderQueued.current = null;
          break;
        }
        mode = queued.auto;
      }
    } finally {
      folderRunning.current = false;
      setFolderBusy(false);
    }
  }

  /** Button click (a user gesture): choose or reconnect the folder, then save. */
  async function onFolderClick(forcePick = false) {
    const s = sessionRef.current;
    if (!s) return;
    const pid = s.project.id;
    setFolderNote(null);
    try {
      let handle = folderHandleRef.current;
      if (!handle || folderPerm === "denied" || forcePick) {
        handle = await pickFolder(); // opens the dialog and remembers the choice
        setFolderHandle(handle);
        setFolderPerm("granted");
      } else {
        const perm = await folderPermission(handle, true); // may show the browser's permission prompt
        setFolderPerm(perm);
        if (perm !== "granted") {
          setFolderNote({ projectId: pid, tone: perm === "denied" ? "danger" : "info",
            text: perm === "denied" ? "The browser blocked access to that folder. Choose another folder." : "The folder was not reconnected." });
          return;
        }
      }
      await requestFolderSave(handle, false);
    } catch (e) {
      setFolderNote({ projectId: pid, tone: "info", text: folderErrorText(e) });
    }
  }

  // On mount and when another project opens: look up the remembered folder and its permission (no prompt).
  const folderProjectId = session?.project.id ?? null;
  useEffect(() => {
    setFolderApi(isFolderExportSupported());
    if (!isFolderExportSupported()) return;
    let cancelled = false;
    void (async () => {
      const handle = await rememberedFolder();
      if (cancelled) return;
      setFolderHandle(handle);
      setFolderPerm(handle ? await folderPermission(handle, false).catch(() => null) : null);
    })();
    return () => { cancelled = true; };
  }, [folderProjectId]);

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
    void buildPartMap(photo, setMap, controller.signal).finally(noteSettled);
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
    ).finally(noteSettled);
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
          setLastSaveFailure(null);
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
    setBoxMode(null);
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
    setDemoOpen(false);
    setPanel("edit"); // closing the panel also drops its unsaved drafts (BuildSheet unmounts)
    setStaleNotice(null);
    setNavNote(null);
    setSaveNote(null);
    autoDetect.current = null;
    recutPending.current = false;
    if (!next) {
      // Closing leaves nothing unsaved on screen, so the warning about that photo ends here.
      setLastSaveFailure(null);
      const ready0 = readyStorage();
      if (ready0 && !ready0.readOnly) void setLastOpenProject(ready0.h, null).catch(() => undefined); // best effort
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
      let failure: string | null = null;
      try {
        created = await createFromPhoto(ready.h, next);
      } catch (e) {
        full = isStorageFull(e);
        failure = errorDetail(e);
      } finally {
        setSavingProject(false);
      }
      if (token !== importToken.current) return; // another import or open started meanwhile
      setLastSaveFailure(failure); // a successful save clears an older warning; a failed one sets it
      if (full) { setStorageFull("import"); void refreshList(); }
    } else {
      // Unavailable, read-only or not opened yet: the photo stays in memory only, with a lasting warning.
      setLastSaveFailure(storageDetail(storageRef.current));
    }
    autoDetect.current = next.hash;
    partsDirty.current = true;
    setSession(created);
    setPhoto(next);
    setBikeForm(emptyBikeForm());
    setFolded("bike", true);
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
      setLastSaveFailure(null);
      // A confirmed bike was only in memory; save it on the new project too.
      if (form.confirmed) void saveConfirmedBike(form);
    } catch (e) {
      if (token !== importToken.current) return;
      setLastSaveFailure(errorDetail(e));
      if (isStorageFull(e)) { setStorageFull("import"); void refreshList(); }
    } finally {
      setSavingProject(false);
    }
  }

  /** Opens a saved project. `quiet` (the reload restore) shows no error: the project list simply stays. Returns true when it opened. */
  async function openSaved(id: string, quiet = false): Promise<boolean> {
    const ready = readyStorage();
    if (!ready) return false;
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
      if (token !== importToken.current) return false; // another open or import started while this one was loading
      setLastSaveFailure(null); // this project is stored; an older "Not saved" warning belongs to a dropped photo
      setPanel("edit");
      setDemoOpen(false); // the opened project replaces the demo view
      setStaleNotice(null);
      setNavNote(null);
      setSaveNote(null);
      showView(opened.view, opened.session);
      setBikeForm(form);
      // A saved, confirmed bike opens folded; anything else needs the mechanic's eyes.
      setFolded("bike", !form.confirmed);
      setIdentify({ status: cached ? "done" : "off", message: null });
      setIdentifyCachedAt(cached?.cachedAt ?? null);
      // Remember it for the next reload (best effort; read-only storage cannot write this).
      if (!ready.readOnly) void setLastOpenProject(ready.h, id).catch(() => undefined);
      return true;
    } catch (e) {
      if (quiet) {
        // The remembered project is gone or unreadable: forget it so the list shows and nothing is retried.
        if (!ready.readOnly) void setLastOpenProject(ready.h, null).catch(() => undefined);
      } else {
        setListError(`This project could not be opened: ${saveErrorText(e)} It was not changed.`);
      }
      return false;
    } finally {
      setListBusy(null);
    }
  }

  // Reload: once storage is ready, reopen the project that was open (unless a photo was dropped meanwhile).
  useEffect(() => {
    if (!storage || storage.status !== "ready" || restoreTried.current) return;
    restoreTried.current = true;
    // importToken starts at 0 and every drop, open or import raises it, so a nonzero value means the
    // user already acted while storage was still opening: never replace their work.
    if (importToken.current !== 0 || sessionRef.current) return;
    const startToken = importToken.current;
    void (async () => {
      try {
        const id = await getLastOpenProject(storage.h);
        if (!id || importToken.current !== startToken) return;
        await openSaved(id, true);
      } catch {
        // An unreadable "last open" record: show the project list as usual.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, when storage first becomes ready
  }, [storage]);

  /** "Open project from folder": pick, validate everything, import atomically, then open it. */
  async function openFromFolder() {
    const ready = readyStorage();
    if (!ready || ready.readOnly || openingFolderRef.current) return;
    openingFolderRef.current = true;
    setOpeningFolder(true);
    setOpenFolderNote(null);
    try {
      let dir: FileSystemDirectoryHandle;
      try {
        dir = await pickProjectFolderForImport(); // needs the click that called this function
      } catch (e) {
        // Closing the dialog is not an error: show nothing.
        if ((e as { name?: string } | null)?.name !== "AbortError") setOpenFolderNote({ tone: "danger", text: folderImportErrorText(e) });
        return;
      }
      setOpenFolderNote({ tone: "info", text: "Checking the folder and opening the project. Nothing is stored unless every file matches." });
      const tokenBefore = importToken.current;
      const res = await readProjectFolder(dir, { db: ready.h });
      if (!res.ok) {
        setOpenFolderNote({ tone: "danger", text: res.message });
        return;
      }
      await refreshList();
      if (importToken.current !== tokenBefore) {
        // A photo was dropped meanwhile; do not replace it.
        setOpenFolderNote({ tone: "info", text: "The project was added to the saved projects. Open it from the list." });
        return;
      }
      setOpenFolderNote(null);
      await openSaved(res.projectId);
    } catch (e) {
      setOpenFolderNote({ tone: "danger", text: `${folderImportErrorText(e)} Nothing was added.` });
    } finally {
      openingFolderRef.current = false;
      setOpeningFolder(false);
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
    if (!ready || !sessionRef.current || navBusy || sheetBusy.current) return;
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

  // ---- fit check: storage calls for the build sheet (the sheet itself runs the batches)
  const readyForFit = readyStorage();
  const bikeRevision = session?.project.bikeRevision ?? null;
  const fitSupport: FitSupport | null = session && readyForFit && !readyForFit.readOnly && bikeRevision ? {
    bikeRevision,
    loadShopRules: async () => (await getShopSettings(readyForFit.h, session.project.settingsId))?.settings.shopRules ?? [],
    persist: (input) => attachFitResponse(readyForFit.h, input),
    // Reload the saved rows. The current version stays the one shown: a project that moved on is left alone.
    onPersisted: async () => {
      await persistChain.current;
      const cur = sessionRef.current;
      if (!cur) return;
      const loaded = await loadProject(readyForFit.h, cur.project.id);
      const now = sessionRef.current;
      if (loaded && now && now.project.id === loaded.project.id && now.project.headVersionId === loaded.project.headVersionId) {
        setSession({ project: loaded.project, versions: loaded.versions });
      }
    },
  } : null;

  // ---- shop settings of the open project (Estimate and Settings read them)
  // The key says which project and record the settings belong to; an older answer is ignored.
  const settingsId = session?.project.settingsId ?? "default";
  const settingsKey = `${session?.project.id ?? "none"}:${settingsId}`;
  const [shop, setShop] = useState<{ key: string; settings: ShopSettings } | null>(null);
  const [shopError, setShopError] = useState<{ key: string; message: string } | null>(null);
  const [settingsTry, setSettingsTry] = useState(0); // "Try again" bumps it to run the load again
  const settingsDb = storage?.status === "ready" ? storage.h : null;
  useEffect(() => {
    let alive = true;
    if (!settingsDb) return;
    loadSettings(settingsDb, settingsId)
      .then((rec) => { if (alive) { setShopError(null); setShop({ key: settingsKey, settings: rec.settings }); } })
      .catch((e) => { if (alive) setShopError({ key: settingsKey, message: e instanceof Error ? e.message : "Unknown error." }); });
    return () => { alive = false; };
  }, [settingsDb, settingsId, settingsKey, settingsTry]);
  const shopSettings = shop && shop.key === settingsKey ? shop.settings : null;
  const shopLoadError = shopError && shopError.key === settingsKey && !shopSettings ? shopError.message : null;
  // ---- estimate PDF: the fonts and the PDF chunk load in idle time once a project is open (about 0.6 MB of fonts and the
  // pdf-lib chunk), so Export works offline in every order. The warm-up is memoized: this starts it once per session.
  const projectOpen = session !== null;
  useEffect(() => {
    if (!projectOpen) return;
    return scheduleWarmup(); // cancels a start that has not happened when the project closes or the page unmounts
  }, [projectOpen]);
  const projectChanged = (next: Project) => {
    const cur = sessionRef.current;
    if (cur && cur.project.id === next.id) setSession({ ...cur, project: next });
  };

  // ---- build sheet: a saved edit or removal becomes a new "sheet" step on the same photo
  async function saveSheetChange(change: SheetChange): Promise<SheetSaveResult> {
    if (sheetBusy.current) return { ok: false, message: "A sheet save is already running." };
    const ready = readyStorage();
    if (!ready || ready.readOnly) return { ok: false, message: "Local storage cannot be written, so nothing was saved." };
    sheetBusy.current = true;
    setSheetSaving(true);
    try {
      // A part save after detection may still be writing; wait so the session is current (as navigate does).
      await persistChain.current;
      const cur = sessionRef.current;
      if (!cur) return { ok: false, message: "There is no saved project, so nothing was saved." };
      if (cur.project.headVersionId !== change.headId) {
        return { ok: false, message: "The project moved to a different version, so this sheet change was not saved. Close the form and try again." };
      }
      const out = await saveSheet(ready.h, cur, {
        ref: { projectId: cur.project.id, expectedHeadId: change.headId },
        versionId: change.versionId, items: change.items, fees: change.fees, inspectionReview: change.inspectionReview,
      });
      if (out.status === "refused") return { ok: false, message: out.message };
      if (out.status === "unchanged") return { ok: true, unchanged: true };
      // Only the session changes: the photo, parts and part map stay as they are.
      if (sessionRef.current?.project.id === out.session.project.id) setSession(out.session);
      setLastSaveFailure(null);
      // Same background folder save as after an accepted visual change; never awaited.
      if (folderHandleRef.current) void requestFolderSave(folderHandleRef.current, true);
      return { ok: true, unchanged: false };
    } catch (e) {
      return { ok: false, message: `The sheet change could not be saved: ${saveErrorText(e)} The project is unchanged. You can try again.` };
    } finally {
      sheetBusy.current = false;
      setSheetSaving(false);
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
    // Folding happens here, in the click handler path, never in an effect that also runs when a project opens.
    if (confirmedNow) setFolded("bike", false);
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
      setLastSaveFailure(null);
    } catch (e) {
      setSaveNote(`The confirmed bike could not be saved: ${saveErrorText(e)} It stays on screen.`);
    }
  }

  function cancelPoint() {
    pointAbort.current?.abort(); // an in-flight point request must not land on a later selection
    setPointMode(null);
  }

  function startBox(target: BoxTarget) {
    cancelPoint(); // one marking mode at a time
    setNotice(null);
    setBoxMode(target);
  }

  function startPoint(target: PointTarget) {
    setBoxMode(null);
    setPointMode(target);
  }

  /** A finished drag: the rectangle is the part. Nothing is sent anywhere. */
  function handleBox(box: [number, number, number, number]) {
    if (!photo || !boxMode || sheetOpen) return;
    if (map.imageHash !== photo.hash) return; // the part map belongs to another photo
    const part = boxPart(boxMode.slot, boxMode.label, box, photo.hash, photo.width, photo.height, boxMode.absent);
    if (!part) { setNotice("That box is too small or outside the photo. Drag a larger box."); return; }
    if (!boxAcceptable(part, view.bike?.mask ?? null)) {
      setNotice("That box covers too much of the motorcycle. Drag a tighter box around the part.");
      return;
    }
    setNotice(null);
    partsDirty.current = true;
    setMap((m) => (m.imageHash !== photo.hash ? m : { ...m, pointParts: withPointPart(m.pointParts, part) }));
    selectByUser(part.id);
    boxEndedAt.current = Date.now(); // the click that ends this drag must not reselect (see handleClick)
    setBoxMode(null);
  }

  /** The selected box part is, or is not, on the bike yet. A new absent value makes the prepared change stale (prepKey). */
  function toggleAbsent(absent: boolean) {
    if (!selected || selected.source !== "box") return;
    const id = selected.id;
    // Making a box present again applies the 60% rule that absent boxes skip.
    if (!absent && !boxAcceptable({ ...selected, absent: false }, view.bike?.mask ?? null)) {
      setNotice("That box covers too much of the motorcycle, so it cannot be a part that is already on the bike. Mark a tighter box.");
      return;
    }
    partsDirty.current = true;
    setMap((m) => ({ ...m, pointParts: m.pointParts.map((p) => (p.id === id ? { ...p, absent } : p)) }));
  }

  // Escape leaves box mode.
  useEffect(() => {
    if (!boxMode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setBoxMode(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [boxMode]);

  async function handleClick(point: ImagePoint) {
    if (!photo || sheetOpen) return; // the photo does not take clicks while the sheet is open
    if (Date.now() - boxEndedAt.current < 400) return; // the click that follows a box drag
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
        return { ...m, pointParts: withPointPart(m.pointParts, result.part) };
      });
      if ("part" in result) selectByUser(result.part.id);
      setPointMode(null);
    } catch (error) {
      if (!controller.signal.aborted) setNotice(error instanceof PreflightError ? error.message : "Point selection failed.");
    } finally {
      setPointBusy(false);
      noteSettled();
    }
  }

  // A stale part (cut on an earlier picture) is shown but can never be the selected part.
  const selected = view.parts.find((p) => p.id === selectedId && !p.stale) ?? null;
  const selectionKey = photo && selected ? `${photo.hash}:${selected.id}` : null;
  const absent = selected?.absent === true;
  const paintOnly = selected ? !modeAllowed(selected.slot, "text") : false;
  // Paint-only slots (frame, engine) never offer reference mode; a server that said "off" hides it too.
  const referenceOffered = referenceEnabled && referenceOff === null && !paintOnly && !absent;
  // An absent part is added by describing it: paint and reference photos are not offered.
  const mode = paintOnly ? "paint" : absent ? "text" : editMode === "reference" && !referenceOffered ? "text" : editMode;
  const reference = mode === "reference" && refState && refState.key === selectionKey ? refState.photo : null;
  // The key includes the bike as sent, so editing the bike makes an older preview stale.
  // It also includes the shown version, so a preview never carries over to another head.
  // The reference hash is part of the key too: swapping the reference makes an instruction prepared for the
  // old one stale, so a rear crop can never render with an instruction prepared for the front crop.
  const prepKey = `${session?.project.headVersionId ?? "unsaved"}:${selectionKey}:${mode}:${absent}:${reference?.hash ?? "-"}:${JSON.stringify(bikeForm.bike)}`;
  const current = prepared && prepared.key === prepKey ? prepared : null;

  // Selecting another part drops the reference from memory (the key check above already ignores it).
  useEffect(() => {
    setRefState((r) => (r && r.key !== selectionKey ? null : r));
  }, [selectionKey]);

  const renderEntry = render && render.key === prepKey ? render : null;

  // Re-open the change section when the selection changes or a prepare or render starts or finishes,
  // so a paid preview and its Accept button never sit inside a folded section.
  const preparedState = prepared?.state, renderKind = render?.state.kind;
  useEffect(() => {
    setFolded("change", true);
  }, [selectionKey, preparedState, renderKind, renderRunning, accept.saving, accept.error]);

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
      noteSettled();
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
        setLastSaveFailure(null);
        // Background save of the new step; never awaited, so folder trouble cannot touch accept.
        if (folderHandleRef.current) void requestFolderSave(folderHandleRef.current, true);
      } catch (e) {
        // Keep the browser's error name (e.g. Safari's UnknownError) so a failed save can be diagnosed.
        setAccept({ saving: false, error: isStorageFull(e) ? saveErrorText(e) : `Not saved: ${errorDetail(e)}` });
        if (isStorageFull(e)) { setStorageFull("accept"); void refreshList(); }
        return;
      } finally {
        acceptBusy.current = false;
      }
    }

    // No stored session (in memory, read-only or unavailable): the edit is shown but never saved, so the
    // lasting warning stays or starts here. Only a real save clears it.
    if (!(saved && ready && !ready.readOnly && entry.ref)) setLastSaveFailure((f) => f ?? storageDetail(storageRef.current));
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
      noteSettled();
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
    void buildPartMap(photo, setMap, controller.signal).finally(noteSettled);
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
    // A box marked before the outline arrived skipped the 60% rule; check it now.
    if (selected.source === "box" && selected.absent !== true && !boxAcceptable(selected, view.bike?.mask ?? null)) {
      setNotice("That box covers too much of the motorcycle. Mark a tighter box around the part.");
      return;
    }
    const key = prepKey;
    setPrepared({ key, state: "busy" });
    try {
      const instruction = await requestInstruction({ slot: selected.slot, box: selected.box, bike: bikeForm.bike,
        mode, text, width: photo.width, height: photo.height, absent: selected.absent === true }, undefined, mode === "reference" ? reference?.blob ?? null : null);
      setPrepared((p) => (p?.key === key ? { key, state: "done", instruction, requestText: text } : p));
    } catch (error) {
      if (error instanceof PreflightError && error.code === "FEATURE_DISABLED") setReferenceOff(error.message);
      setPrepared((p) => (p?.key === key ? { key, state: "error",
        message: error instanceof PreflightError ? error.message : "Preparing the change failed." } : p));
    } finally {
      noteSettled();
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
  // The before photo of the estimate PDF: the root version's image (the PDF export reads it from the database).
  const rootImage = session?.versions.find((v) => v.id === session.project.rootVersionId)?.image ?? null;
  const readOnly = storage?.status === "ready" && storage.readOnly;
  const redoKids = session && head ? children(session.versions, head.id) : [];
  const projectName = session?.project.name ?? (photo ? "Unsaved photo" : null);
  // Why this photo is not stored, or null when it is. A failed save, or no stored project for the photo, is "Not saved".
  const notSavedDetail = !photo ? null : lastSaveFailure ?? (!session ? storageDetail(storage) : null);
  const saveStatus = !photo ? null : notSavedDetail ? "Not saved" : readOnly ? "Read-only: changes are not saved" : "Saved on this device";
  const busy = navBusy || renderRunning || accept.saving || pointBusy || sheetSaving || fitBusy;
  // Build sheet: why it is read-only (permanent), and why saving waits (temporary).
  const sheetReason = !photo ? "Open or import a photo first. Its sheet shows here."
    : storage?.status === "unavailable" ? "Local storage is not available, so the sheet is read-only."
    : readOnly ? "Local storage is read-only, so the sheet is read-only."
    : !session ? "This photo is not saved as a project yet, so there is no sheet to change."
    : null;
  const sheetBlocked = renderRunning || prepared?.state === "busy" || renderEntry !== null
    ? "Accept or reject the preview first."
    : navBusy || accept.saving || pointBusy ? "Wait until the current step change has finished." : null;
  // Folder block of the Project fold.
  const folderReason = !photo ? "Open or import a photo first."
    : storage?.status === "unavailable" ? "Local storage is not available, so there is no saved project to export."
    : readOnly ? "Local storage is read-only, so there is no saved project to export."
    : !session ? "This photo is not saved as a project yet."
    : null;
  const folderStat = session ? folderStatus[session.project.id] : undefined;
  const folderNoteHere = folderNote && session && folderNote.projectId === session.project.id ? folderNote : null;
  const folderLabel = folderBusy ? "Saving to folder…"
    : !folderHandle ? "Choose folder and save"
    : folderPerm === "denied" ? "Choose another folder and save"
    : folderPerm === "prompt" ? "Reconnect folder"
    : "Save project to folder";
  const noteTone = { warning: "bg-warning-soft text-warning-soft-text", danger: "bg-danger-soft text-danger-soft-text", info: "bg-neutral-soft text-neutral-soft-text" };
  const folderBlock = !folderApi ? (
    <p className="text-text-muted text-[13px]">Saving to a folder needs Chrome or Edge.</p>
  ) : (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => void onFolderClick()} disabled={!!folderReason || folderBusy}
        className="self-start rounded-full bg-primary px-4 py-1.5 text-on-fill text-[13px] disabled:opacity-50">
        {folderLabel}
      </button>
      {!folderReason && folderHandle && folderPerm !== "denied" && (
        <button type="button" onClick={() => void onFolderClick(true)} disabled={folderBusy}
          className="self-start rounded-full border border-hairline px-4 py-1.5 text-[13px] disabled:opacity-50">
          Choose another folder
        </button>
      )}
      {folderReason && <p className="text-text-muted text-[13px]">{folderReason}</p>}
      {!folderReason && !folderHandle && (
        <p className="text-text-muted text-[13px]">Pick a folder outside the code folder, for example dreambike-results.</p>
      )}
      {!folderReason && folderPerm === "prompt" && folderHandle && (
        <p className="text-warning-soft-text text-[13px]">Folder access needs to be allowed again. Press Reconnect folder.</p>
      )}
      {!folderReason && folderPerm === "denied" && !folderNoteHere && (
        <p className="text-danger-soft-text text-[13px]">The browser blocked access to the saved folder. Choose another folder.</p>
      )}
      {!folderReason && (
        <p role="status" className="text-text-secondary text-[13px]">
          {folderStat
            ? `Saving to ${folderStat.rootName}/${folderStat.folderName}: last saved ${new Date(folderStat.savedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} (${folderStat.written} new files)`
            : "Not saved to a folder yet"}
          {folderStat && folderStat.notExported > 0 && (
            <span className="text-warning-soft-text"> · {folderStat.notExported} images not exported</span>
          )}
        </p>
      )}
      {folderNoteHere && (
        <p role="alert" className={`rounded-chip px-3 py-2 text-[13px] ${noteTone[folderNoteHere.tone]}`}>{folderNoteHere.text}</p>
      )}
    </div>
  );

  // The budget banner fetches again whenever one of these flips: a paid call (segment, identify, instruction,
  // render, fit check) has started or ended. A GET costs nothing, so an extra fetch at the start is harmless.
  const budgetKey = [renderRunning, fitBusy, pointBusy, map.done, identify.status, prepared?.state ?? "none", paidSettled].join("|");
  const showDemo = demoOpen && !photo;
  const demoDb = storage?.status === "ready" && !storage.readOnly ? storage.h : null;
  const demoBlockedReason = storage === null ? "Local storage is still opening."
    : storage.status === "unavailable" ? "Local storage is not available, so a copy cannot be made."
    : storage.readOnly ? (storage.readOnlyReason ?? "Local storage is read-only, so a copy cannot be made.") : null;

  return (
    <AppShell banner={<BudgetBanner refreshKey={budgetKey} onOpenDemo={photo ? undefined : () => setDemoOpen(true)} projectOpen={!!photo} />}
      projectName={projectName} saveStatus={saveStatus} busy={busy}
      canUndo={!!head && head.parentId !== null && !readOnly} canRedo={redoKids.length > 0 && !readOnly}
      undoHint={readOnly ? "Local storage is read-only" : undefined} redoHint={readOnly ? "Local storage is read-only" : undefined}
      onUndo={() => void navigate((h, s) => undoHead(h, s))}
      onRedo={() => void navigate((h, s) => redoHead(h, s))}
      panel={panel} onPanel={setPanel} panelLocked={fitBusy || sheetSaving || showDemo}>
      {showDemo ? (
        <main className="flex min-h-0 flex-1 justify-center overflow-y-auto p-4">
          <div className="w-full max-w-[960px]">
            <DemoView db={demoDb} editBlockedReason={demoBlockedReason} onClose={() => setDemoOpen(false)}
              onOpened={(id) => { void refreshList(); void openSaved(id); }} />
          </div>
        </main>
      ) : (
      <main className="flex min-h-0 flex-1 gap-4 p-4">
        <div className="flex min-h-0 min-w-0 flex-[2] flex-col gap-4 overflow-y-auto">
          {/* The photo takes the height History leaves; without a photo the notice scrolls here instead of being cut off. */}
          <section aria-label="Photo" inert={sheetOpen} className={`flex flex-col rounded-card border border-hairline bg-recess p-4 ${photo ? "min-h-[300px] flex-1" : "min-h-0 flex-1 overflow-y-auto"}`}>
            {photo ? (
              <ImageCanvas photo={photo} parts={view.parts} selectedId={selectedId} onImageClick={handleClick} boxMode={boxMode !== null && !sheetOpen} onBox={handleBox}
                cursor={pointMode ? "crosshair" : "default"} />
            ) : <div className="m-auto">{noticeAccepted ? <UploadDropzone onPhoto={(p) => void choosePhoto(p)} />
              : <UploadNotice onAccept={() => setNoticeAccepted(true)} />}</div>}
          </section>
          {notSavedDetail && (
            <p role="alert" className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text text-[13px]">
              <span aria-hidden="true" className="mr-1 font-semibold">⚠</span>
              Not saved: this browser did not store the project. {notSavedDetail} You can keep working, but the project is lost if you reload or close this tab.
            </p>
          )}
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
        <aside aria-label={{ edit: "Edit panel", sheet: "Build sheet panel", estimate: "Estimate panel", settings: "Settings panel" }[panel]}
          className={`flex min-h-0 shrink-0 flex-col gap-4 overflow-y-auto rounded-card border border-hairline bg-surface-1 p-4 ${sheetOpen ? "w-1/2" : "w-[360px]"}`}>
          {panel === "sheet" && (
            <BuildSheet head={session && head ? head : null} readOnlyReason={sheetReason} blockedReason={sheetBlocked}
              saving={sheetSaving} onSave={saveSheetChange} onClose={() => setPanel("edit")}
              fit={fitSupport} onFitRunning={(running) => { setFitBusy(running); if (!running) noteSettled(); }} />
          )}
          {panel === "estimate" && (
            <EstimatePreview head={session && head ? head : null} readOnlyReason={sheetReason} blockedReason={sheetBlocked}
              saving={sheetSaving} settings={shopSettings} settingsError={shopLoadError} settingsId={settingsId} bikeRevision={bikeRevision}
              onSave={saveSheetChange} onOpenSettings={() => setPanel("settings")} onClose={() => setPanel("edit")}
              db={settingsDb} project={session?.project ?? null} rootImage={rootImage} appMode={appMode} />
          )}
          {panel === "settings" && (
            <ShopSettingsForm h={settingsDb} project={session?.project ?? null} saved={shopSettings}
              loadError={shopLoadError} onRetry={() => { setShopError(null); setSettingsTry((n) => n + 1); }}
              readOnlyReason={storage?.status === "unavailable" ? "Local storage is not available, so settings cannot be saved." : readOnly ? "Local storage is read-only, so settings cannot be saved." : null}
              onProjectChanged={projectChanged} onSettingsChanged={(o, s) => setShop({ key: `${o.projectId ?? "none"}:${o.settingsId}`, settings: s })}
              onClose={() => setPanel("edit")} />
          )}
          {/* "contents" keeps the folds in the same flex column; "hidden" keeps them mounted but out of sight and out of tab order. */}
          <div className={sheetOpen ? "hidden" : "contents"}>
          <h2 className="text-[20px] leading-[1.35]">Edit</h2>
          {!photo && (
            <>
              <p className="text-text-muted text-[13px]">Import a photo of your own bike to start, or open a saved project.</p>
              {savingProject && <p role="status" className="text-text-secondary text-[13px]">Saving the project…</p>}
              <ProjectList state={list} busyId={listBusy} error={listError} onOpen={(id) => void openSaved(id)} onDelete={(id) => void deleteSaved(id)}
                onViewDemo={() => setDemoOpen(true)}
                onOpenFolder={folderApi && storage?.status === "ready" && !storage.readOnly ? () => void openFromFolder() : undefined}
                openFolderBusy={openingFolder} openFolderNote={openFolderNote} />
            </>
          )}
          {photo && (
            <>
              <BikeConfirm key={photo.hash} form={bikeForm} identifyStatus={identify.status} identifyMessage={identify.message} onChange={changeBike}
                open={fold.bike} onToggle={(o) => setFolded("bike", o)} />
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
              <Fold title="Parts" open={fold.parts} onToggle={(o) => setFolded("parts", o)}>
              <PartSelector map={map} view={view} selected={selected} pointMode={pointMode} boxMode={boxMode} busy={!map.done || pointBusy}
                onSelect={selectByUser} onStartPoint={startPoint} onCancelPoint={cancelPoint}
                onStartBox={startBox} onCancelBox={() => setBoxMode(null)} onToggleAbsent={toggleAbsent}
                onFacing={(facing) => { if (facingChangesParts(map)) partsDirty.current = true; setMap((m) => ({ ...m, facing })); setBikeForm((f) => editField(f, "facing", facing)); }}
                onRedetect={redetect}
                onSwapFacing={() => {
                  const next = map.facing === "left" ? "right" : "left";
                  if (facingChangesParts(map)) partsDirty.current = true;
                  setMap((m) => ({ ...m, facing: next }));
                  setBikeForm((f) => editField(f, "facing", next));
                }}
                onNextBike={() => { partsDirty.current = true; setMap((m) => ({ ...m, bikeChoice: ((typeof m.bikeChoice === "number" ? m.bikeChoice : 0) + 1) % m.bikeCandidates.length })); }} />
              </Fold>
              {selected && (
                <Fold title={`Change: ${selected.label}`} open={fold.change} onToggle={(o) => setFolded("change", o)} className="border-t border-hairline pt-3">
                  {absent ? (
                    <p className="text-text-muted text-[12px]">This part is not on the bike yet, so describe it in text. The box marks where it goes.</p>
                  ) : paintOnly ? (
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
                  {!paintOnly && !absent && !referenceOffered && (
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
                </Fold>
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
              <Fold title="Project" open={fold.project} onToggle={(o) => setFolded("project", o)} className="border-t border-hairline pt-3">
                {folderBlock}
                <button type="button" onClick={() => void choosePhoto(null)} disabled={pointBusy || renderRunning || accept.saving || sheetSaving}
                  className="self-start rounded-full border border-hairline px-4 py-1.5 text-[13px] disabled:opacity-50">
                  Close project
                </button>
              </Fold>
            </>
          )}
          </div>
        </aside>
      </main>
      )}
    </AppShell>
  );
}
