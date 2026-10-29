// "Save project to folder" (Chrome/Edge File System Access API). The owner picks a folder once;
// the handle is remembered in its own small IndexedDB database (not the 'dreambike' one, whose
// schema SPEC 9 fixes at v1). No React here, so the write logic runs in tests with fake handles.
import { openDB } from "idb";
import type { ExportPlan } from "../project";

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

export type FolderSaveResult = { written: number; skipped: number; missing: string[]; folderName: string };

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

/**
 * Writes the plan into root/<folderName>. Images first (same-size files are skipped), then
 * history.json and history.md last, so a failed image write leaves the previous history in place.
 */
export async function saveProjectToFolder(
  root: FileSystemDirectoryHandle,
  plan: ExportPlan,
  readImage: (imageId: string) => Promise<Blob | null>,
  onProgress?: (done: number, total: number) => void,
): Promise<FolderSaveResult> {
  const dir = await root.getDirectoryHandle(plan.folderName, { create: true });
  const total = plan.files.length;
  let written = 0;
  let skipped = 0;
  const missing: string[] = [];

  for (const [i, file] of plan.files.entries()) {
    const blob = await readOrNull(readImage, file.imageId);
    if (!blob || blob.type !== "image/webp") {
      missing.push(file.name);
    } else if ((await existingSize(dir, file.name)) === blob.size) {
      skipped++;
    } else {
      await writeFile(dir, file.name, blob);
      written++;
    }
    onProgress?.(i + 1, total);
  }

  await writeFile(dir, "history.json", plan.historyJson);
  await writeFile(dir, "history.md", plan.historyMarkdown);
  return { written, skipped, missing, folderName: plan.folderName };
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
