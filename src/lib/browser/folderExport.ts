// "Save project to folder" (Chrome/Edge File System Access API). The owner picks a folder once;
// the handle is remembered in its own small IndexedDB database (not the 'dreambike' one, whose
// schema SPEC 9 fixes at v1). No React here, so the write logic runs in tests with fake handles.
import { openDB } from "idb";
import { ProjectSnapshot } from "../contracts";
import { importProject, type DreamDb, type ImportRefusal } from "../db";
import type { ExportPlan, SnapshotResult } from "../project";
import { sha256Hex } from "./renderClient";

// ------------------------------------------------------------------ types
// TypeScript's lib.dom has the handle types and createWritable, but not the picker or the
// permission methods. Only the missing members are declared here.
interface DirectoryPickerOptions {
  id?: string;
  mode?: "read" | "readwrite";
  startIn?: string;
}
type PermissionState3 = "granted" | "prompt" | "denied";
interface WindowWithPicker {
  showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
}
interface HandleWithPermissions {
  queryPermission(descriptor: { mode: "readwrite" }): Promise<PermissionState3>;
  requestPermission(descriptor: { mode: "readwrite" }): Promise<PermissionState3>;
}

export type FolderSaveResult = {
  written: number; skipped: number; missing: string[]; folderName: string;
  /** "written" only when project.json was written and every file it names is in the folder. */
  projectJson: "written" | "not_written";
  /** Why project.json was not written (shown to the owner); null when it was written. */
  projectJsonReason: string | null;
};

/** What the folder save needs besides the plan to also write project.json and masks/<id>.bin. */
export type SnapshotInput = {
  snapshot: SnapshotResult;
  readMask: (maskId: string) => Promise<Uint8Array | null>;
};

// ------------------------------------------------------------------ support
export function isFolderExportSupported(): boolean {
  return typeof window !== "undefined" && typeof (window as WindowWithPicker).showDirectoryPicker === "function";
}

// ------------------------------------------------------------------ handle store
const DB_NAME = "dreambike-folder";
const STORE = "handles";
const KEY = "results";

function openHandleDb() {
  return openDB(DB_NAME, 1, { upgrade(db) { db.createObjectStore(STORE); } });
}

async function putHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openHandleDb();
  try { await db.put(STORE, handle, KEY); } finally { db.close(); }
}

async function getHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openHandleDb();
  try {
    return ((await db.get(STORE, KEY)) as FileSystemDirectoryHandle | undefined) ?? null;
  } finally { db.close(); }
}

async function deleteHandle(): Promise<void> {
  const db = await openHandleDb();
  try { await db.delete(STORE, KEY); } finally { db.close(); }
}

/** Opens the folder dialog (needs a user click) and remembers the choice. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as WindowWithPicker).showDirectoryPicker;
  if (!picker) throw new Error("This browser cannot save to a folder.");
  const handle = await picker.call(window, { id: "dreambike-results", mode: "readwrite", startIn: "documents" });
  await putHandle(handle);
  return handle;
}

/** The remembered folder, or null when there is none or the database fails. */
export async function rememberedFolder(): Promise<FileSystemDirectoryHandle | null> {
  try { return await getHandle(); } catch { return null; }
}

export async function forgetFolder(): Promise<void> {
  try { await deleteHandle(); } catch { /* nothing stored or database unavailable */ }
}

/**
 * Permission for the remembered folder. `request` true calls requestPermission, which needs a user
 * click. Auto-save after Accept must pass false: the transient activation from the Accept click has
 * expired after the awaits, so a prompt there would fail. Then 'prompt' means "ask the owner".
 */
export async function folderPermission(
  handle: FileSystemDirectoryHandle, request: boolean,
): Promise<PermissionState3> {
  const h = handle as unknown as HandleWithPermissions;
  const state = await h.queryPermission({ mode: "readwrite" });
  if (state === "granted" || !request) return state;
  return h.requestPermission({ mode: "readwrite" });
}

// ------------------------------------------------------------------ writing
async function existingSize(dir: FileSystemDirectoryHandle, name: string): Promise<number | null> {
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    return file.size;
  } catch {
    return null; // not there (or unreadable): write it
  }
}

/** Writes one file; on any error the half-written stream is aborted so the old file stays. */
async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: Blob | string): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (e) {
    try { await writable.abort(); } catch { /* already closed */ }
    throw e;
  }
}

async function readOrNull(readImage: (imageId: string) => Promise<Blob | null>, id: string): Promise<Blob | null> {
  try { return await readImage(id); } catch { return null; }
}

async function removeIfPresent(dir: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await dir.removeEntry(name);
  } catch (e) {
    if ((e as { name?: string } | null)?.name !== "NotFoundError") throw e;
  }
}

/**
 * Writes the plan into root/<folderName>. Images first (same-size files are skipped), then the
 * masks (masks/<id>.bin), then history.json, history.md and project.json last, so a failed write
 * leaves the previous history in place. Image and mask files are immutable by id, so a same-size
 * file is skipped. project.json is written only when `snapshotInput` is complete and nothing is
 * missing; otherwise a stale project.json is removed so an import cannot restore an older state.
 */
export async function saveProjectToFolder(
  root: FileSystemDirectoryHandle,
  plan: ExportPlan,
  readImage: (imageId: string) => Promise<Blob | null>,
  onProgress?: (done: number, total: number) => void,
  snapshotInput?: SnapshotInput,
): Promise<FolderSaveResult> {
  const dir = await root.getDirectoryHandle(plan.folderName, { create: true });
  const snap = snapshotInput?.snapshot;
  const planNames = new Set(plan.files.map((f) => f.name));
  // Version images come from the plan; cutouts are extra files named only in the snapshot.
  const imageJobs = plan.files.map((f) => ({ name: f.name, imageId: f.imageId }));
  if (snap?.complete) imageJobs.push(...snap.imageFiles.filter((f) => !planNames.has(f.name)));
  const maskJobs = snap?.complete ? snap.maskFiles : [];
  const total = imageJobs.length + maskJobs.length;
  let done = 0;
  let written = 0;
  let skipped = 0;
  const missing: string[] = [];

  for (const file of imageJobs) {
    const blob = await readOrNull(readImage, file.imageId);
    if (!blob || blob.type !== "image/webp") {
      missing.push(file.name);
    } else if ((await existingSize(dir, file.name)) === blob.size) {
      skipped++;
    } else {
      await writeFile(dir, file.name, blob);
      written++;
    }
    onProgress?.(++done, total);
  }

  if (maskJobs.length > 0 && snapshotInput) {
    const masksDir = await dir.getDirectoryHandle("masks", { create: true });
    for (const m of maskJobs) {
      let pixels: Uint8Array | null = null;
      try { pixels = await snapshotInput.readMask(m.maskId); } catch { pixels = null; }
      if (!pixels) {
        missing.push(`masks/${m.name}`);
      } else if ((await existingSize(masksDir, m.name)) === pixels.length) {
        skipped++;
      } else {
        await writeFile(masksDir, m.name, new Blob([new Uint8Array(pixels)]));
        written++;
      }
      onProgress?.(++done, total);
    }
  }

  let reason: string | null = null;
  if (!snap) reason = "No project snapshot was given.";
  else if (!snap.complete) reason = snap.reason;
  else if (missing.length > 0) reason = `These files are missing, so the folder cannot be opened again: ${missing.join(", ")}.`;
  if (reason !== null) await removeIfPresent(dir, "project.json");

  await writeFile(dir, "history.json", plan.historyJson);
  await writeFile(dir, "history.md", plan.historyMarkdown);
  if (reason === null && snap?.complete) await writeFile(dir, "project.json", snap.json);
  return {
    written, skipped, missing, folderName: plan.folderName,
    projectJson: reason === null ? "written" : "not_written", projectJsonReason: reason,
  };
}

// ------------------------------------------------------------------ reading
/** Read mode needs no readwrite permission. The remembered results folder is left alone. */
export async function pickProjectFolderForImport(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as WindowWithPicker).showDirectoryPicker;
  if (!picker) throw new Error("This browser cannot open a folder.");
  return picker.call(window, { id: "dreambike-import", mode: "read" });
}

export const NO_PROJECT_JSON_MESSAGE =
  "Saved before import existed. Open the project in Chrome and save the folder again.";

const MAX_PROJECT_JSON_BYTES = 10_000_000;
const MAX_IMAGE_BYTES = 50_000_000; // same cap as ImageRef.bytes
const MAX_MASK_BYTES = 2048 * 2048; // Dimension max squared

export type FolderImportReason =
  | "no_project_json" | "project_json_too_large" | "bad_json" | "bad_schema"
  | "missing_file" | "bad_file" | "refused";
export type FolderImportResult =
  | { ok: true; projectId: string }
  | { ok: false; reason: FolderImportReason; message: string; refusal?: ImportRefusal };

export type ReadFolderDeps = {
  db: DreamDb;
  /** Decoded pixel size of an image; defaults to createImageBitmap. Injectable for tests. */
  readDimensions?: (blob: Blob) => Promise<{ width: number; height: number }>;
};

async function decodeDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  try { return { width: bitmap.width, height: bitmap.height }; } finally { bitmap.close(); }
}

const fail = (reason: FolderImportReason, message: string): FolderImportResult => ({ ok: false, reason, message });

async function fileOrNull(dir: FileSystemDirectoryHandle, name: string): Promise<File | null> {
  try { return await (await dir.getFileHandle(name)).getFile(); } catch { return null; }
}

/**
 * Reads and checks everything in the folder first and calls importProject (one atomic
 * transaction) only when every check passed. Nothing is written before that.
 */
export async function readProjectFolder(
  dir: FileSystemDirectoryHandle, deps: ReadFolderDeps,
): Promise<FolderImportResult> {
  const readDimensions = deps.readDimensions ?? decodeDimensions;
  const jsonFile = await fileOrNull(dir, "project.json");
  if (!jsonFile) return fail("no_project_json", NO_PROJECT_JSON_MESSAGE);
  if (jsonFile.size > MAX_PROJECT_JSON_BYTES) return fail("project_json_too_large", "project.json is too large to open.");

  let raw: unknown;
  try { raw = JSON.parse(await jsonFile.text()); } catch { return fail("bad_json", "project.json is not valid JSON."); }
  const parsed = ProjectSnapshot.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail("bad_schema", `project.json is not a valid project: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`.trim());
  }
  const snap = parsed.data;

  const blobs = new Map<string, Blob>();
  for (const ref of snap.images) {
    const file = await fileOrNull(dir, ref.file);
    if (!file) return fail("missing_file", `The file ${ref.file} is missing.`);
    if (file.type !== "image/webp") return fail("bad_file", `The file ${ref.file} is not a WebP image.`);
    if (file.size > MAX_IMAGE_BYTES || file.size !== ref.bytes) return fail("bad_file", `The file ${ref.file} has the wrong size.`);
    if ((await sha256Hex(file)) !== ref.hash) return fail("bad_file", `The file ${ref.file} does not match its saved hash.`);
    let dims: { width: number; height: number };
    try { dims = await readDimensions(file); } catch { return fail("bad_file", `The file ${ref.file} cannot be read as an image.`); }
    if (dims.width !== ref.width || dims.height !== ref.height) {
      return fail("bad_file", `The file ${ref.file} is ${dims.width}x${dims.height}, not ${ref.width}x${ref.height}.`);
    }
    blobs.set(ref.id, file);
  }

  const pixels = new Map<string, Uint8Array>();
  if (snap.masks.length > 0) {
    let masksDir: FileSystemDirectoryHandle | null = null;
    try { masksDir = await dir.getDirectoryHandle("masks"); } catch { masksDir = null; }
    for (const m of snap.masks) {
      const file = masksDir ? await fileOrNull(masksDir, m.file) : null;
      if (!file) return fail("missing_file", `The file masks/${m.file} is missing.`);
      const expected = m.width * m.height;
      if (expected > MAX_MASK_BYTES || file.size !== expected) return fail("bad_file", `The file masks/${m.file} has the wrong size.`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length !== expected || bytes.some((b) => b > 1)) {
        return fail("bad_file", `The file masks/${m.file} must contain only 0 and 1.`);
      }
      pixels.set(m.id, bytes);
    }
  }

  const res = await importProject(deps.db, snap, blobs, pixels);
  if (res.status === "imported") return { ok: true, projectId: res.project.id };
  return { ok: false, reason: "refused", message: res.message, refusal: res.reason };
}

// ------------------------------------------------------------------ errors
export function folderErrorText(e: unknown): string {
  const name = typeof e === "object" && e !== null && "name" in e ? String((e as { name: unknown }).name) : "";
  const message = e instanceof Error ? e.message : String(e);
  if (name === "AbortError") return "Folder choice cancelled.";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The browser did not allow access to that folder. Choose the folder again and allow changes.";
  }
  if (name === "QuotaExceededError") return "The disk is full.";
  if (e instanceof TypeError && /name/i.test(message)) {
    return "A file name was not accepted by the file system.";
  }
  return `Could not save to the folder: ${message}`;
}

/** Plain words for a failed folder pick or read (AbortError means the owner closed the dialog). */
export function folderImportErrorText(e: unknown): string {
  const name = typeof e === "object" && e !== null && "name" in e ? String((e as { name: unknown }).name) : "";
  const message = e instanceof Error ? e.message : String(e);
  if (name === "AbortError") return "Folder choice cancelled.";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The browser did not allow access to that folder. Choose the folder again and allow reading.";
  }
  if (name === "NotFoundError") return "A file in the folder could not be found. It may have been moved.";
  return `Could not open the folder: ${message}`;
}
