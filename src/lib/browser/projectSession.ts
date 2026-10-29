// Glue between the UI and local storage (SPEC 9): small async functions that open a project,
// create one from a photo, accept an edit with the head guard, move undo/redo, and save parts.
// No React here, so the same code runs in tests against fake-indexeddb.
//
// TypeScript note: a "discriminated union" is a type like
//   { status: "accepted"; ... } | { status: "refused"; ... }
// Checking `result.status` tells TypeScript which fields exist, like a tagged result in Python.
import { BikeChecked } from "../contracts";
import { cacheKeys, getCache, putCache } from "../cache";
import {
  acceptSheet, acceptVisual, attachParts, closeDreamDb, createProject, getStoredImage, getStoredMask, loadProject,
  moveHead, openDreamDb, redo, undo, updateBikeRevision, type DreamDb,
} from "../db";
import { AppError } from "../errors";
import {
  canAcceptPending, newProject, newRootVersion, redoTargets, sheetChild, visualChild,
  type EditMode, type PendingRef,
} from "../project";
import { unknownBike } from "../bikeForm";
import type {
  BikeData, BikeRevision, BuildItemData, FeeData, InspectionReviewData, BinaryMask, InstructionData, MapPart, NormalizedPhoto, Part, PhotoRef,
  Project, SlotId, StoredImage, StoredMask, Version, CompositeReason,
} from "../types";
import {
  binaryToStoredMask, derive, partsToPersisted, restoredPartMap, storedMaskToBinary,
  type DerivedMap, type PartMapState, type RestoredPart,
} from "./partMap";
import { requestIdentify } from "./sparkClient";

// ------------------------------------------------------------------ storage

export type StorageState =
  | { status: "ready"; h: DreamDb; readOnly: boolean; readOnlyReason: string | null }
  | { status: "unavailable"; message: string };

/** Open the local database. Never throws: the UI shows "unavailable" and keeps working in memory. */
export async function openStorage(): Promise<StorageState> {
  try {
    const h = await openDreamDb();
    return { status: "ready", h, readOnly: h.readOnly, readOnlyReason: h.readOnlyReason };
  } catch (e) {
    return { status: "unavailable", message: e instanceof Error ? e.message : "Local storage is not available." };
  }
}

export function closeStorage(s: StorageState): void {
  if (s.status === "ready") closeDreamDb(s.h);
}

/** A project and every version of it, as loaded from IndexedDB and kept in React state. */
export type ProjectSession = { project: Project; versions: Version[] };

export function headVersion(session: ProjectSession): Version {
  const head = session.versions.find((v) => v.id === session.project.headVersionId);
  if (!head) throw new Error("The project's current version is missing.");
  return head;
}

const withVersion = (versions: Version[], next: Version): Version[] =>
  versions.some((v) => v.id === next.id) ? versions.map((v) => (v.id === next.id ? next : v)) : [...versions, next];

// ------------------------------------------------------------ view of a head

/** Everything the screen needs to show one version: the photo and its restored part map. */
export type HeadView = { photo: NormalizedPhoto; map: PartMapState };

/**
 * Load the head's photo and restore its part map from saved masks. Nothing runs automatically:
 * phrases without a restored part stay "not checked" and the mechanic can press "Detect parts again".
 * A part whose mask is missing or does not fit is skipped with a warning, never a crash.
 */
export async function loadHeadView(h: DreamDb, session: ProjectSession): Promise<HeadView> {
  const head = headVersion(session);
  const image = await getStoredImage(h, head.image.id);
  if (!image) throw new Error("The saved photo for this version is missing from this browser.");
  if (image.hash !== head.image.hash) throw new Error("The saved photo does not match its version.");
  const photo: NormalizedPhoto = { blob: image.blob, width: image.width, height: image.height, hash: image.hash, warnings: [] };
  const facing = session.project.bikeRevision.bike.facing;

  let skipped = 0;
  let bike: BinaryMask | null = null;
  if (head.bikeMaskId) {
    const stored = await getStoredMask(h, head.bikeMaskId);
    try {
      if (!stored) throw new Error("missing");
      bike = storedMaskToBinary(stored, photo.hash);
      restoredPartMap(photo, bike, [], facing); // size check only
    } catch {
      bike = null;
      skipped += 1;
    }
  }
  const restored: RestoredPart[] = [];
  for (const part of head.parts) {
    const mask = await getStoredMask(h, part.maskId);
    const candidate: RestoredPart | null = mask ? { part, mask } : null;
    try {
      if (!candidate) throw new Error("missing");
      restoredPartMap(photo, null, [candidate], facing); // validates hash, size and 0/1 bytes
      restored.push(candidate);
    } catch {
      skipped += 1;
    }
  }
  const map = restoredPartMap(photo, bike, restored, facing);
  // Do not claim "no outline found" for a version that was simply never detected.
  if (!bike) map.bikeStatus = "pending";
  if (skipped > 0) map.warnings = [`${skipped} saved outline${skipped === 1 ? "" : "s"} could not be restored. Use “Detect parts again”.`];
  return { photo, map };
}

// ------------------------------------------------------------- open / create

export type OpenedProject = { session: ProjectSession; view: HeadView; hasSavedBike: boolean };

/** Open a saved project. A damaged record makes this throw with a clear message; nothing is deleted. */
export async function openProject(h: DreamDb, projectId: string): Promise<OpenedProject> {
  const loaded = await loadProject(h, projectId);
  if (!loaded) throw new Error("This project no longer exists in this browser.");
  const session: ProjectSession = { project: loaded.project, versions: loaded.versions };
  const view = await loadHeadView(h, session);
  return { session, view, hasSavedBike: loaded.project.bikeRevision.revision > 0 };
}

/** A new import becomes a project: root image, root version and project in ONE transaction. */
export async function createFromPhoto(h: DreamDb, photo: NormalizedPhoto, now: Date = new Date()): Promise<ProjectSession> {
  const imageId = crypto.randomUUID();
  const t = now.getTime();
  const image: StoredImage = {
    id: imageId, hash: photo.hash, width: photo.width, height: photo.height, bytes: photo.blob.size,
    rights: "owner", blob: photo.blob, lastAccessedAt: t,
  };
  const projectId = crypto.randomUUID();
  const rootId = crypto.randomUUID();
  const rootVersion = newRootVersion({
    id: rootId, projectId, createdAt: t,
    image: { id: imageId, hash: photo.hash, width: photo.width, height: photo.height, bytes: image.bytes, rights: "owner" },
  });
  const bikeRevision: BikeRevision = { id: crypto.randomUUID(), bike: unknownBike(), confirmed: false, revision: 0, confirmedAt: null };
  const project = newProject({ id: projectId, rootVersionId: rootId, bikeRevision, now });
  const loaded = await createProject(h, { project, rootVersion, image });
  return { project: loaded.project, versions: loaded.versions };
}

// ------------------------------------------------------------------ identify

/** The identify cache holds a validated bike; reopening or reimporting the same photo reads it. */
export type IdentifyResult = { bike: BikeData; cachedAt: number | null };

/** Cache only. Never calls the network, so opening a project can never cost money. */
export async function cachedIdentify(h: DreamDb | null, imageHash: string): Promise<IdentifyResult | null> {
  if (!h) return null;
  try {
    const hit = await getCache(h, cacheKeys.identify(imageHash), BikeChecked);
    return hit ? { bike: hit.value, cachedAt: hit.createdAt } : null;
  } catch {
    return null; // a damaged cache is a miss
  }
}

/** Cache first; one paid identify call only on a miss. A failed cache write is not an error. */
export async function identifyForPhoto(h: DreamDb | null, photo: PhotoRef, signal?: AbortSignal): Promise<IdentifyResult> {
  const hit = await cachedIdentify(h, photo.hash);
  if (hit) return hit;
  const bike = await requestIdentify(photo, signal);
  if (h && !h.readOnly) {
    try {
      await putCache(h, { key: cacheKeys.identify(photo.hash), value: bike, schema: BikeChecked });
    } catch { /* the answer is still used; it is only not cached */ }
  }
  return { bike, cachedAt: null };
}

// -------------------------------------------------------------- bike revision

/** Save the confirmed bike on the project and return the updated session. */
export async function saveBike(h: DreamDb, session: ProjectSession, revision: BikeRevision): Promise<ProjectSession> {
  const project = await updateBikeRevision(h, session.project.id, revision);
  return { ...session, project };
}

// ------------------------------------------------------------- parts (attach)

/**
 * Save the current detection result on the head version. Only parts and masks change; the sheet,
 * change record and image stay as they are. Returns null when the head shows another image now.
 */
export async function persistParts(
  h: DreamDb, session: ProjectSession, imageHash: string, view: DerivedMap,
  newId: () => string = () => crypto.randomUUID(), now: number = Date.now(),
): Promise<ProjectSession | null> {
  const head = headVersion(session);
  if (head.image.hash !== imageHash) return null;
  const existing = new Map(head.parts.map((p) => [p.id, p.maskId]));
  const saved = partsToPersisted(view, imageHash, newId, now, existing);
  const result = await attachParts(h, {
    versionId: head.id, imageHash, parts: saved.parts, masks: saved.masks,
    // No bike mask (carried over, or none found) keeps whatever is stored.
    bikeMask: saved.bikeMask ?? undefined,
  });
  if (result.status !== "attached") return null;
  return { ...session, versions: withVersion(session.versions, result.version) };
}

/** Convenience for the UI: derive the map first. */
export const persistPartMap = (h: DreamDb, session: ProjectSession, map: PartMapState) =>
  persistParts(h, session, map.imageHash, derive(map));

// ----------------------------------------------------------------- accept

/** IDs for one accept. The UI keeps them with the preview so a retry reuses the same IDs. */
export type AcceptIds = { versionId: string; itemId: string; imageId: string; partMaskId: string };
export const newAcceptIds = (): AcceptIds => ({
  versionId: crypto.randomUUID(), itemId: crypto.randomUUID(), imageId: crypto.randomUUID(), partMaskId: crypto.randomUUID(),
});

export type AcceptInput = {
  /** The project and head the preview was rendered for. */
  ref: PendingRef;
  ids: AcceptIds;
  slot: SlotId;
  mode: EditMode;
  instruction: InstructionData;
  result: { blob: Blob; width: number; height: number; hash: string; composed: boolean; aligned: boolean;
    drift: number | null; reason: CompositeReason };
  /** The edited part cut again on the result (fresh mask under result.hash), or null. */
  refreshed: MapPart | null;
  now?: number;
};

export type RefusedReason = "wrong_project" | "stale_head" | "project_missing";
export type AcceptOutcome =
  | { status: "accepted"; session: ProjectSession; version: Version; idempotent: boolean }
  | { status: "refused"; reason: RefusedReason; message: string };

export const REFUSED_MESSAGE: Record<RefusedReason, string> = {
  wrong_project: "This preview belongs to another project, so it was not accepted. Nothing was saved.",
  stale_head: "The project moved to a different version after this preview was rendered, so it was not accepted. Nothing was saved. Render again if you still want this change.",
  project_missing: "This project no longer exists in this browser, so the preview was not accepted.",
};
const refuse = (reason: RefusedReason): AcceptOutcome => ({ status: "refused", reason, message: REFUSED_MESSAGE[reason] });

/**
 * Accept one preview as a new version. Refused (never written) when the project or head moved.
 * Errors (STORAGE_FULL, read-only, write failure) are thrown and leave the head untouched; the
 * caller keeps the preview and calls this again with the same `ids`, which is safe even if the
 * first try secretly committed.
 */
export async function acceptEdit(h: DreamDb, session: ProjectSession, input: AcceptInput): Promise<AcceptOutcome> {
  const check = canAcceptPending(session.project, input.ref);
  if (!check.ok) return refuse(check.reason);
  const parent = session.versions.find((v) => v.id === input.ref.expectedHeadId);
  if (!parent) return refuse("stale_head");

  const now = input.now ?? Date.now();
  const { result, ids } = input;
  const image: StoredImage = {
    id: ids.imageId, hash: result.hash, width: result.width, height: result.height, bytes: result.blob.size,
    rights: parent.image.rights, blob: result.blob, lastAccessedAt: now,
  };
  // A fresh part mask exists only for a blended result of the same size (SPEC 9 invalidation table).
  const sameSize = parent.image.width === result.width && parent.image.height === result.height;
  let refreshedPart: Part | null = null;
  const masks: StoredMask[] = [];
  if (input.refreshed && result.composed && sameSize) {
    const r = input.refreshed;
    masks.push(binaryToStoredMask(r.mask, result.hash, ids.partMaskId, now));
    refreshedPart = { id: r.id, slot: r.slot, label: r.label, box: r.box, maskId: ids.partMaskId, area: r.area,
      source: r.source, confidence: r.confidence, stale: false };
  }
  const version = visualChild(parent, {
    versionId: ids.versionId, itemId: ids.itemId, createdAt: now, slot: input.slot, mode: input.mode,
    instruction: input.instruction,
    image: { id: image.id, hash: image.hash, width: image.width, height: image.height, bytes: image.bytes, rights: image.rights },
    composite: { composed: result.composed, aligned: result.aligned, drift: result.drift, reason: result.reason },
    refreshedPart,
  });
  const res = await acceptVisual(h, session.project.id, input.ref.expectedHeadId, { version, image, masks });
  if (res.status === "stale_head") return refuse("stale_head");
  if (res.status === "project_missing") return refuse("project_missing");
  return {
    status: "accepted", version: res.version, idempotent: res.idempotent,
    session: { project: res.project, versions: withVersion(session.versions, res.version) },
  };
}

// ------------------------------------------------------------------- sheet

export type SheetRefusedReason = "wrong_project" | "stale_head" | "project_missing";
export type SheetOutcome =
  | { status: "saved"; session: ProjectSession; version: Version; idempotent: boolean }
  | { status: "unchanged" }
  | { status: "refused"; reason: SheetRefusedReason; message: string };

export const SHEET_REFUSED_MESSAGE: Record<SheetRefusedReason, string> = {
  wrong_project: "This sheet belongs to another project, so this sheet change was not saved. Nothing was written.",
  stale_head: "The project moved to a different version, so this sheet change was not saved. Nothing was written.",
  project_missing: "This project no longer exists in this browser, so this sheet change was not saved.",
};
const refuseSheet = (reason: SheetRefusedReason): SheetOutcome =>
  ({ status: "refused", reason, message: SHEET_REFUSED_MESSAGE[reason] });

/** Structural equality for plain JSON data, ignoring key order. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => k in b && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export type SaveSheetInput = {
  ref: PendingRef;
  /** Generated by the caller and kept for retries of the same draft. */
  versionId: string;
  items: BuildItemData[];
  fees: FeeData[];
  /** undefined keeps the parent's review, null clears it, a value replaces it. */
  inspectionReview?: InspectionReviewData | null;
  now?: number;
};

/**
 * Save items/fees as a sheet version on the same picture. Nothing is written when they equal the
 * parent's. Storage errors are thrown with the head unchanged; retry with the same versionId.
 */
export async function saveSheet(h: DreamDb, session: ProjectSession, input: SaveSheetInput): Promise<SheetOutcome> {
  const check = canAcceptPending(session.project, input.ref);
  if (!check.ok) return refuseSheet(check.reason);
  const parent = session.versions.find((v) => v.id === input.ref.expectedHeadId);
  if (!parent) return refuseSheet("stale_head");
  const review = input.inspectionReview === undefined ? parent.inspectionReview : input.inspectionReview;
  if (deepEqual(parent.items, input.items) && deepEqual(parent.fees, input.fees) && deepEqual(parent.inspectionReview, review)) {
    return { status: "unchanged" };
  }

  const version = sheetChild(parent, {
    versionId: input.versionId, createdAt: input.now ?? Date.now(), items: input.items, fees: input.fees,
    inspectionReview: input.inspectionReview,
  });
  const res = await acceptSheet(h, session.project.id, input.ref.expectedHeadId, version);
  if (res.status === "stale_head") return refuseSheet("stale_head");
  if (res.status === "project_missing") return refuseSheet("project_missing");
  // Storage is the truth for display associations (persistParts may have changed the parent's
  // parts after the session copy), so refresh every version from it rather than patching the copy.
  const stored = await loadProject(h, session.project.id);
  const versions = stored ? stored.versions : withVersion(session.versions, res.version);
  return {
    status: "saved", version: res.version, idempotent: res.idempotent,
    session: { project: stored ? stored.project : res.project, versions },
  };
}

// ------------------------------------------------------------- undo / redo

export type NavOutcome =
  | { status: "moved"; session: ProjectSession; view: HeadView }
  | { status: "choose_branch"; children: Version[] }
  | { status: "nothing"; message: string };

const STALE_NAV = "The project changed in another tab. Reload the project to continue.";

/**
 * The session as it would look with `targetId` as head. Its view is loaded BEFORE the head move is
 * written, so a missing photo or damaged record makes the move fail with the stored head unchanged.
 */
async function previewMove(h: DreamDb, session: ProjectSession, targetId: string): Promise<{ next: ProjectSession; view: HeadView }> {
  const next: ProjectSession = { project: { ...session.project, headVersionId: targetId }, versions: session.versions };
  return { next, view: await loadHeadView(h, next) };
}

/** Commit a move that was already previewed; the stored project from the guarded write wins. */
function committed(project: Project, session: ProjectSession, view: HeadView): NavOutcome {
  return { status: "moved", session: { project, versions: session.versions }, view };
}

export async function undoHead(h: DreamDb, session: ProjectSession): Promise<NavOutcome> {
  const parentId = headVersion(session).parentId;
  if (parentId === null) return { status: "nothing", message: "Nothing to undo." };
  const { view } = await previewMove(h, session, parentId);
  const r = await undo(h, session.project.id, session.project.headVersionId);
  if (r.status === "moved") return committed(r.project, session, view);
  if (r.status === "at_root") return { status: "nothing", message: "Nothing to undo." };
  return { status: "nothing", message: STALE_NAV };
}

/** With several children and no `childId`, the children are returned and nothing is written. */
export async function redoHead(h: DreamDb, session: ProjectSession, childId?: string): Promise<NavOutcome> {
  const kids = redoTargets(session.versions, session.project.headVersionId);
  if (kids.length === 0) return { status: "nothing", message: "Nothing to redo." };
  if (kids.length > 1 && childId === undefined) return { status: "choose_branch", children: kids };
  const targetId = childId ?? kids[0]!.id;
  const { view } = await previewMove(h, session, targetId);
  // Pass the previewed target, so storage never offers a branch this tab has not loaded.
  const r = await redo(h, session.project.id, session.project.headVersionId, targetId);
  if (r.status === "moved") return committed(r.project, session, view);
  if (r.status === "choose_branch") return { status: "choose_branch", children: r.children };
  if (r.status === "no_redo") return { status: "nothing", message: "Nothing to redo." };
  return { status: "nothing", message: STALE_NAV };
}

/** Jump to any saved version of this project (a node in the strip). No new node is created. */
export async function jumpToVersion(h: DreamDb, session: ProjectSession, versionId: string): Promise<NavOutcome> {
  if (versionId === session.project.headVersionId) return { status: "nothing", message: "This version is already shown." };
  const { view } = await previewMove(h, session, versionId);
  const r = await moveHead(h, session.project.id, session.project.headVersionId, versionId);
  if (r.status === "moved") return committed(r.project, session, view);
  return { status: "nothing", message: STALE_NAV };
}

/** Text for a failed save or move: the stable STORAGE_FULL message, or the error's own text. */
export function saveErrorText(e: unknown): string {
  if (e instanceof AppError && e.code === "STORAGE_FULL") return e.message;
  return e instanceof Error ? e.message : "The change could not be saved.";
}
