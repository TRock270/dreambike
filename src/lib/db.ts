// IndexedDB layer (SPEC 9): database "dreambike", version 1, through idb only.
// Bike projects live in the visitor's browser; nothing here talks to a server.
//
// Rules this file enforces:
//  - every record read is validated with the Zod schemas in contracts.ts; a damaged record
//    makes the read fail with a clear message and is never deleted
//  - every write is ONE readwrite transaction (tx); any thrown error aborts it, so the previous
//    head and sheet stay. Callers generate all IDs before the tx, so a retry reuses them
//  - a newer database (VersionError or meta.schemaVersion > 1) opens read-only; writes are refused
//  - QuotaExceededError: safe cache cleanup, retry once with the same IDs, then STORAGE_FULL
//
// TypeScript note: `IDBPDatabase<DreamSchema>` is idb's typed wrapper; the schema interface below
// tells TypeScript the key and value type of every store, like a typed table definition.
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from "idb";
import { z } from "zod";
import {
  BikeRevision as BikeRevisionSchema, CheckResponse as CheckResponseSchema, FitResult as FitResultSchema, Project as ProjectSchema,
  Settings, StoredImage as StoredImageSchema, StoredMask as StoredMaskSchema,
  Part as PartSchema, ProjectSnapshot as ProjectSnapshotSchema, Version as VersionSchema,
} from "./contracts";
import { adjustLedger, cacheKeys, cleanupSafeCache, getCache, putCache, collectReferences, dropCacheForRemovedBlobs, evictTransient, readLedger, ledgerTotal } from "./cache";
import { AppError } from "./errors";
import { MOCK_LABEL } from "./mocks";
import { EXAMPLE_SETTINGS, REAL_SETTINGS_DEFAULT } from "./quote";
import { children, FIT_TTL_MS, fitInputCanonical, LEGAL_SEED, pathToRoot, sha256OfText, undoTarget } from "./project";
import type {
  BikeRevision, CacheEntry, ImageRef, MaskMeta, MetaRecordData, Part, Project, ProjectSnapshot, ShopSettings,
  StoredImage, StoredMask, Version,
} from "./types";

export const DB_NAME = "dreambike";
export const DB_VERSION = 1;
/** SPEC 9: 200 MB target, not a guaranteed browser quota. */
export const TARGET_BYTES = 200 * 1024 * 1024;

export type SettingsRecord = { id: string; updatedAt: number; settings: ShopSettings };

interface DreamSchema extends DBSchema {
  projects: { key: string; value: Project; indexes: { updatedAt: number } };
  versions: { key: string; value: Version; indexes: { projectId: string; parentId: string } };
  images: { key: string; value: StoredImage; indexes: { hash: string; lastAccessedAt: number } };
  masks: { key: string; value: StoredMask; indexes: { imageHash: string } };
  settings: { key: string; value: SettingsRecord; indexes: { updatedAt: number } };
  cache: { key: string; value: CacheEntry; indexes: { lastAccessedAt: number; expiresAt: number } };
  meta: { key: string; value: MetaRecordData };
}
export type { DreamSchema };

export type StoreName = StoreNames<DreamSchema>;
const ALL_STORES: StoreName[] = ["projects", "versions", "images", "masks", "settings", "cache", "meta"];
/** All writes use one tx over every store: simple typing, and one tab writes at a time. */
export type WriteTx = IDBPTransaction<DreamSchema, StoreName[], "readwrite">;
export type ReadTx = IDBPTransaction<DreamSchema, StoreName[], "readonly" | "readwrite">;

// ------------------------------------------------------------------- errors

/** The database is newer than this app (or marked so); reads work, writes are refused. */
export class ReadOnlyError extends Error {
  constructor(reason: string) {
    super(`${reason} Your saved projects are untouched and can still be opened, but changes cannot be saved.`);
    this.name = "ReadOnlyError";
  }
}

/** A stored record failed validation. The record is left untouched. */
export class CorruptRecordError extends Error {
  constructor(public store: string, public key: string, detail: string) {
    super(`A saved ${store} record (${key}) is damaged: ${detail}. It was left untouched and nothing was deleted.`);
    this.name = "CorruptRecordError";
  }
}

/** IndexedDB is missing or blocked (private mode, disabled storage). */
export class StorageUnavailableError extends Error {
  constructor(detail: string) {
    super(`Local storage is not available in this browser (${detail}). Projects cannot be saved; you can still try the demo.`);
    this.name = "StorageUnavailableError";
  }
}

/** The caller asked for a write that breaks a history rule (wrong project, missing blob, ...). */
export class InvalidWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWriteError";
  }
}

/** The connection was closed (another tab upgraded the database, or the app closed it). */
export class StorageClosedError extends Error {
  constructor() {
    super("Storage was upgraded in another tab; reload the page.");
    this.name = "StorageClosedError";
  }
}

/** True for QuotaExceededError, also when it arrives as a tx abort error or as a wrapped cause. */
export function isQuotaError(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    const o = cur as { name?: unknown; code?: unknown; cause?: unknown; error?: unknown };
    if (o.name === "QuotaExceededError" || o.code === 22) return true;
    cur = o.cause ?? o.error;
  }
  return false;
}

// -------------------------------------------------------------------- open

export type DreamDb = {
  db: IDBPDatabase<DreamSchema>;
  readOnly: boolean;
  readOnlyReason: string | null;
  targetBytes: number;
  /** Shared by every copy of the handle, so closing one copy marks all of them. */
  lifecycle: { closed: boolean };
};

/** Every read and write calls this first, so a closed connection gives one clear message. */
export function assertOpen(h: DreamDb): void {
  if (h.lifecycle.closed) throw new StorageClosedError();
}

export function assertWritable(h: DreamDb): void {
  assertOpen(h);
  if (h.readOnly) throw new ReadOnlyError(h.readOnlyReason ?? "Local storage is read-only.");
}

export async function openDreamDb(opts: { targetBytes?: number } = {}): Promise<DreamDb> {
  if (typeof indexedDB === "undefined") throw new StorageUnavailableError("IndexedDB is missing");
  const targetBytes = opts.targetBytes ?? TARGET_BYTES;
  const lifecycle = { closed: false };
  // Another tab upgrades the database: close this connection so the upgrade is not blocked.
  const blocking = (): void => {
    lifecycle.closed = true;
    try { currentDb?.close(); } catch { /* already closed */ }
  };
  let currentDb: IDBPDatabase<DreamSchema> | null = null;
  try {
    const db = await openDB<DreamSchema>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          database.createObjectStore("projects", { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
          const versions = database.createObjectStore("versions", { keyPath: "id" });
          versions.createIndex("projectId", "projectId");
          versions.createIndex("parentId", "parentId");
          const images = database.createObjectStore("images", { keyPath: "id" });
          images.createIndex("hash", "hash");
          images.createIndex("lastAccessedAt", "lastAccessedAt");
          database.createObjectStore("masks", { keyPath: "id" }).createIndex("imageHash", "imageHash");
          database.createObjectStore("settings", { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
          const cache = database.createObjectStore("cache", { keyPath: "key" });
          cache.createIndex("lastAccessedAt", "lastAccessedAt");
          cache.createIndex("expiresAt", "expiresAt");
          database.createObjectStore("meta", { keyPath: "key" });
          void tx.objectStore("meta").put({ key: "schemaVersion", value: DB_VERSION });
          void tx.objectStore("meta").put({ key: "ledger", value: { imageBytes: 0, maskBytes: 0, cacheBytes: 0 } });
        }
      },
      blocking,
    });
    currentDb = db;
    const handle: DreamDb = { db, readOnly: false, readOnlyReason: null, targetBytes, lifecycle };
    const marker = await db.get("meta", "schemaVersion");
    const v = marker?.value;
    if (marker && (typeof v !== "number" || !Number.isInteger(v) || v < 1)) {
      return { ...handle, readOnly: true, readOnlyReason: "The storage version marker is unreadable." };
    }
    if (typeof v === "number" && v > DB_VERSION) {
      return {
        ...handle, readOnly: true,
        readOnlyReason: `Local storage was written by a newer DreamBike (schema ${v}); this version only understands ${DB_VERSION}.`,
      };
    }
    if (!marker) await db.put("meta", { key: "schemaVersion", value: DB_VERSION });
    return handle;
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === "VersionError") {
      // The stored database is newer than version 1. Open whatever version exists, read-only.
      try {
        const db = await openDB<DreamSchema>(DB_NAME, undefined, { blocking });
        currentDb = db;
        return {
          db, readOnly: true, targetBytes, lifecycle,
          readOnlyReason: `Local storage was written by a newer DreamBike (database version ${db.version}).`,
        };
      } catch (e2) {
        throw new StorageUnavailableError(errWithName(e2));
      }
    }
    throw new StorageUnavailableError(errWithName(e));
  }
}

export function closeDreamDb(h: DreamDb): void {
  h.lifecycle.closed = true;
  h.db.close();
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** "UnknownError: message": the browser's error name (for example Safari's UnknownError) is kept so the UI can show it. */
function errWithName(e: unknown): string {
  const name = (e as { name?: unknown } | null)?.name;
  const msg = errText(e);
  return typeof name === "string" && name !== "" && name !== "Error" && !msg.startsWith(name) ? `${name}: ${msg}` : msg;
}

// ------------------------------------------------------ transactions + parse

/** Run `work` in one readwrite tx. A thrown error aborts the tx; nothing is half-written. */
export async function runTx<T>(h: DreamDb, work: (tx: WriteTx) => Promise<T>): Promise<T> {
  assertOpen(h);
  const tx = h.db.transaction(ALL_STORES, "readwrite");
  // Attach a handler now so an abort never becomes an unhandled promise rejection.
  tx.done.catch(() => undefined);
  try {
    const result = await work(tx);
    await tx.done; // rejects with the abort error, e.g. QuotaExceededError at commit
    return result;
  } catch (e) {
    try { tx.abort(); } catch { /* the tx had already finished or aborted */ }
    // A quota abort can reach `work` as a generic AbortError while the real cause (a
    // QuotaExceededError) is only on the transaction. Surface it so the quota rule still applies.
    const doneError = await tx.done.then(() => null, (x: unknown) => x);
    if (!isQuotaError(e) && isQuotaError(doneError)) throw doneError;
    throw e;
  }
}

/**
 * A write with the SPEC 9 quota rule: on QuotaExceededError clean safe caches once, retry once
 * with the same inputs (so the same IDs), then report STORAGE_FULL. Saved projects stay untouched.
 */
export async function writeTx<T>(h: DreamDb, work: (tx: WriteTx) => Promise<T>): Promise<T> {
  assertWritable(h);
  try {
    return await runTx(h, work);
  } catch (e) {
    if (!isQuotaError(e)) throw e;
    try { await cleanupSafeCache(h, { all: true }); } catch { /* retry anyway; it reports its own error */ }
    try {
      return await runTx(h, work);
    } catch (e2) {
      if (isQuotaError(e2)) throw new AppError("STORAGE_FULL");
      throw e2;
    }
  }
}

function parseRecord<S extends z.ZodType>(schema: S, value: unknown, store: string, key: string): z.infer<S> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  throw new CorruptRecordError(store, key, `${where}${issue?.message ?? "invalid"}`);
}

/** Validate caller input for a write: a bad value is the caller's bug, not a damaged saved record. */
function parseInput<S extends z.ZodType>(schema: S, value: unknown, what: string): z.infer<S> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  throw new InvalidWriteError(`Invalid ${what}: ${where}${issue?.message ?? "invalid"}`);
}

/** A structured clone of a typed-array view copies the whole buffer; store a tight copy instead. */
function ownedMask(m: StoredMask): StoredMask {
  const p = m.pixels;
  return p.byteOffset === 0 && p.buffer.byteLength === p.length ? m : { ...m, pixels: p.slice() };
}

function checkImage(image: StoredImage): void {
  if (image.blob.size !== image.bytes) {
    throw new InvalidWriteError(`Image ${image.id} says ${image.bytes} bytes but its blob has ${image.blob.size}.`);
  }
}

// ------------------------------------------------------------------- reads

export type ProjectSummary = { projects: Project[]; unreadable: { id: string; message: string }[] };

/** Newest first. A damaged project is reported in `unreadable`, never deleted. */
export async function listProjects(h: DreamDb): Promise<ProjectSummary> {
  assertOpen(h);
  const raw = (await h.db.getAll("projects")) as unknown[];
  const projects: Project[] = [];
  const unreadable: { id: string; message: string }[] = [];
  for (const r of raw) {
    const id = String((r as { id?: unknown } | null)?.id ?? "?");
    const parsed = ProjectSchema.safeParse(r);
    if (parsed.success) projects.push(parsed.data);
    else unreadable.push({ id, message: new CorruptRecordError("project", id, parsed.error.issues[0]?.message ?? "invalid").message });
  }
  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  return { projects, unreadable };
}

export type LoadedProject = { project: Project; versions: Version[] };

/** null when the project does not exist; CorruptRecordError when any of its records is damaged. */
export async function loadProject(h: DreamDb, projectId: string): Promise<LoadedProject | null> {
  assertOpen(h);
  const tx = h.db.transaction(["projects", "versions"], "readonly");
  const rawProject = await tx.objectStore("projects").get(projectId);
  if (!rawProject) return null;
  const rawVersions = await tx.objectStore("versions").index("projectId").getAll(projectId);
  await tx.done;
  return validateLoaded(rawProject, rawVersions, projectId);
}

/** Parse a project and its versions as stored and check that the tree is whole. */
function validateLoaded(rawProject: unknown, rawVersions: unknown[], projectId: string): LoadedProject {
  const project = parseRecord(ProjectSchema, rawProject, "project", projectId);
  const versions = rawVersions.map((v) =>
    parseRecord(VersionSchema, v, "version", String((v as { id?: unknown }).id ?? "?")));
  const byId = new Map(versions.map((v) => [v.id, v]));
  const root = byId.get(project.rootVersionId);
  if (!root || root.parentId !== null) throw new CorruptRecordError("project", projectId, "its root version is missing");
  try {
    pathToRoot(versions, project.headVersionId);
  } catch (e) {
    throw new CorruptRecordError("project", projectId, `its head does not lead back to the root (${errText(e)})`);
  }
  return { project, versions };
}

export type SnapshotSources = LoadedProject & { cutouts: ImageRef[]; masks: MaskMeta[] };

/**
 * Everything projectSnapshot needs, read in ONE readonly transaction from the stored records
 * (not from React state): project, versions, the stored cutout image refs and mask metadata.
 * A cutout or mask that is not stored is simply absent; projectSnapshot then reports incomplete.
 */
export async function snapshotSources(h: DreamDb, projectId: string): Promise<SnapshotSources | null> {
  assertOpen(h);
  const tx = h.db.transaction(["projects", "versions", "images", "masks"], "readonly");
  const rawProject = await tx.objectStore("projects").get(projectId);
  if (!rawProject) return null;
  const rawVersions = await tx.objectStore("versions").index("projectId").getAll(projectId);
  const loaded = validateLoaded(rawProject, rawVersions, projectId);
  const cutoutIds = new Set<string>();
  const maskIds = new Set<string>();
  for (const v of loaded.versions) {
    if (v.cutoutImageId) cutoutIds.add(v.cutoutImageId);
    if (v.bikeMaskId) maskIds.add(v.bikeMaskId);
    for (const p of v.parts) maskIds.add(p.maskId);
  }
  const cutouts: ImageRef[] = [];
  for (const id of cutoutIds) {
    const raw = await tx.objectStore("images").get(id);
    if (!raw) continue;
    const img = parseRecord(StoredImageSchema, raw, "image", id);
    cutouts.push({ id: img.id, hash: img.hash, width: img.width, height: img.height, bytes: img.bytes, rights: img.rights });
  }
  const masks: MaskMeta[] = [];
  for (const id of maskIds) {
    const raw = await tx.objectStore("masks").get(id);
    if (!raw) continue;
    const m = parseRecord(StoredMaskSchema, raw, "mask", id);
    masks.push({ id: m.id, imageHash: m.imageHash, width: m.width, height: m.height, createdAt: m.createdAt });
  }
  await tx.done;
  return { ...loaded, cutouts, masks };
}

export async function getStoredImage(h: DreamDb, id: string): Promise<StoredImage | null> {
  assertOpen(h);
  const raw = await h.db.get("images", id);
  if (!raw) return null;
  const image = parseRecord(StoredImageSchema, raw, "image", id);
  if (image.blob.size !== image.bytes) throw new CorruptRecordError("image", id, "blob size differs from the recorded size");
  return image;
}

export async function getStoredMask(h: DreamDb, id: string): Promise<StoredMask | null> {
  assertOpen(h);
  const raw = await h.db.get("masks", id);
  return raw ? parseRecord(StoredMaskSchema, raw, "mask", id) : null;
}

export async function getLastOpenProject(h: DreamDb): Promise<string | null> {
  assertOpen(h);
  const rec = await h.db.get("meta", "lastOpenProject");
  return typeof rec?.value === "string" ? rec.value : null;
}

export async function setLastOpenProject(h: DreamDb, projectId: string | null): Promise<void> {
  await writeTx(h, async (tx) => {
    await tx.objectStore("meta").put({ key: "lastOpenProject", value: projectId });
  });
}

// ---------------------------------------------------------------- settings

const SettingsRecordSchema = z.object({ id: z.string(), updatedAt: z.number(), settings: Settings }).strict();

/** Shop settings store for T10; the validator is the SPEC 4 Settings schema. */
export async function getShopSettings(h: DreamDb, id: string): Promise<SettingsRecord | null> {
  assertOpen(h);
  const raw = await h.db.get("settings", id);
  if (!raw) return null;
  const rec = parseRecord(SettingsRecordSchema, raw, "settings", id);
  return rec;
}

export type SettingsId = "default" | "example";

/** Only two records exist: the real shop ("default") and the labeled example ("example"). */
function assertSettingsId(id: string): asserts id is SettingsId {
  if (id !== "default" && id !== "example") throw new InvalidWriteError(`Unknown settings id "${id}".`);
}

/** Example rates may only live in "example" and real settings may never carry them. */
function checkSettingsKind(id: SettingsId, s: ShopSettings): void {
  if (id === "default" && s.demoRates) throw new InvalidWriteError("The real shop settings cannot carry the example rates.");
  if (id === "example" && !s.demoRates) throw new InvalidWriteError("The example settings must keep demoRates true.");
}

const defaultsFor = (id: SettingsId): ShopSettings => (id === "default" ? REAL_SETTINGS_DEFAULT : EXAMPLE_SETTINGS);

/** The stored settings, or the matching default when none is stored. Never writes. */
export async function loadSettings(h: DreamDb, id: string): Promise<SettingsRecord> {
  assertSettingsId(id);
  const stored = await getShopSettings(h, id);
  return stored ?? { id, updatedAt: 0, settings: structuredClone(defaultsFor(id)) };
}

export async function putShopSettings(h: DreamDb, id: string, settings: ShopSettings, now: number): Promise<void> {
  assertSettingsId(id);
  const valid = parseInput(Settings, settings, "shop settings");
  checkSettingsKind(id, valid);
  await writeTx(h, async (tx) => {
    // Only putLogo/removeLogo change the logo: keep the stored id, ignore the caller's (stale form drafts).
    const raw = await tx.objectStore("settings").get(id);
    const stored = raw ? SettingsRecordSchema.safeParse(raw) : null;
    const logoImageId = stored?.success ? stored.data.settings.logoImageId : null; // corrupt record: overwritten, no logo
    await tx.objectStore("settings").put({ id, updatedAt: now, settings: { ...valid, logoImageId } });
  });
}

/** Point a project at another settings record. Touches no version: fits go stale by hash. */
export async function setProjectSettings(h: DreamDb, projectId: string, settingsId: string, now: number = Date.now()): Promise<Project> {
  assertSettingsId(settingsId);
  return writeTx(h, async (tx) => {
    const project = await getParsedProject(tx, projectId);
    if (!project) throw new InvalidWriteError("The project does not exist.");
    const next = parseInput(ProjectSchema, { ...project, settingsId, updatedAt: Math.max(project.updatedAt, now) }, "project");
    await tx.objectStore("projects").put(next);
    return next;
  });
}

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const LOGO_MAX_BYTES = 500_000;
const LOGO_MAX_SIDE = 512;
export type LogoMeta = { id: string; width: number; height: number; now: number };

async function readSettingsInTx(tx: WriteTx, id: SettingsId): Promise<SettingsRecord> {
  const raw = await tx.objectStore("settings").get(id);
  return raw ? parseRecord(SettingsRecordSchema, raw, "settings", id) : { id, updatedAt: 0, settings: structuredClone(defaultsFor(id)) };
}

/** Save the new logo id in the settings record and drop the old image when nothing else uses it. */
async function swapLogo(tx: WriteTx, settingsId: SettingsId, logoImageId: string | null, now: number): Promise<void> {
  const rec = await readSettingsInTx(tx, settingsId);
  const old = rec.settings.logoImageId;
  const settings = parseInput(Settings, { ...rec.settings, logoImageId }, "shop settings");
  checkSettingsKind(settingsId, settings);
  await tx.objectStore("settings").put({ id: settingsId, updatedAt: now, settings });
  if (old && old !== logoImageId) {
    const refs = await collectReferences(tx); // sees the settings put above
    if (!refs.imageIds.has(old)) await removeImageIfUnused(tx, old);
  }
}

/** Store a logo as an owner image and make it the settings logo, in one transaction. */
export async function putLogo(h: DreamDb, blob: Blob, meta: LogoMeta, settingsId: string): Promise<ShopSettings> {
  assertSettingsId(settingsId);
  // SPEC 11 logo limits, checked before anything is hashed or written.
  if (!LOGO_TYPES.includes(blob.type)) throw new InvalidWriteError("The logo must be a PNG, JPEG or WebP image.");
  if (blob.size > LOGO_MAX_BYTES) throw new InvalidWriteError(`The logo is larger than ${LOGO_MAX_BYTES} bytes.`);
  for (const side of [meta.width, meta.height]) {
    if (!Number.isInteger(side) || side < 1 || side > LOGO_MAX_SIDE) throw new InvalidWriteError(`The logo must be 1 to ${LOGO_MAX_SIDE} px on each side.`);
  }
  // Hash first: a transaction closes when it awaits anything but its own requests.
  const hash = await sha256Hex(blob);
  const image = parseInput(StoredImageSchema, {
    id: meta.id, hash, width: meta.width, height: meta.height, bytes: blob.size, rights: "owner",
    blob, lastAccessedAt: meta.now,
  }, "logo image");
  checkImage(image);
  return writeTx(h, async (tx) => {
    const id = await putImageDeduped(tx, image, "owner");
    await swapLogo(tx, settingsId, id, meta.now);
    await enforceTarget(tx, h);
    return (await readSettingsInTx(tx, settingsId)).settings;
  });
}

export async function removeLogo(h: DreamDb, settingsId: string, now: number = Date.now()): Promise<ShopSettings> {
  assertSettingsId(settingsId);
  return writeTx(h, async (tx) => {
    await swapLogo(tx, settingsId, null, now);
    return (await readSettingsInTx(tx, settingsId)).settings;
  });
}

// ------------------------------------------------------------------ helpers

/** Store `image` unless an image with the same hash exists; returns the id to reference. */
async function putImageDeduped(tx: WriteTx, image: StoredImage, onlyRights?: StoredImage["rights"]): Promise<string> {
  checkImage(image);
  const sameHash = await tx.objectStore("images").index("hash").getAll(image.hash);
  for (const raw of sameHash) {
    // Reuse only a record that validates and really is this picture. A damaged record is skipped
    // and never rewritten, so nothing the owner might still recover is overwritten.
    const parsed = StoredImageSchema.safeParse(raw);
    if (!parsed.success) continue;
    const existing = parsed.data;
    if (onlyRights && existing.rights !== onlyRights) continue; // a logo must keep rights "owner"
    if (existing.blob.size !== existing.bytes || existing.width !== image.width || existing.height !== image.height) continue;
    await tx.objectStore("images").put({ ...existing, lastAccessedAt: Math.max(existing.lastAccessedAt, image.lastAccessedAt) });
    return existing.id;
  }
  // The caller's id must not collide with a (damaged) record; a retry reuses the id, so a
  // collision with a valid same-hash copy was already handled above.
  const sameId = await tx.objectStore("images").get(image.id);
  if (sameId) throw new CorruptRecordError("image", image.id, "a damaged record already uses this id");
  await tx.objectStore("images").put(image);
  await adjustLedger(tx, { imageBytes: image.bytes });
  return image.id;
}

/** Every mask handed to a write must be used by the version it is stored with. */
function assertMasksReferenced(masks: readonly StoredMask[], parts: readonly Part[], bikeMaskId: string | null): void {
  const used = new Set(parts.map((p) => p.maskId));
  if (bikeMaskId) used.add(bikeMaskId);
  for (const m of masks) {
    if (!used.has(m.id)) throw new InvalidWriteError(`Mask ${m.id} is not used by the version it was supplied with.`);
  }
}

async function putMaskOnce(tx: WriteTx, mask: StoredMask): Promise<void> {
  const existing = await tx.objectStore("masks").get(mask.id);
  if (existing) {
    // Masks are immutable; an equal retry is fine, a different mask under the same id is a bug.
    if (existing.imageHash !== mask.imageHash || existing.width !== mask.width || existing.height !== mask.height) {
      throw new InvalidWriteError(`Mask ${mask.id} already exists for a different image.`);
    }
    return;
  }
  await tx.objectStore("masks").put(ownedMask(mask));
  await adjustLedger(tx, { maskBytes: mask.pixels.length });
}

/** Every non-stale part mask (and the bike mask) must fit exactly this image. */
async function checkMaskReferences(tx: WriteTx, v: Pick<Version, "image" | "parts" | "bikeMaskId" | "cutoutImageId">): Promise<void> {
  for (const part of v.parts) {
    const mask = await tx.objectStore("masks").get(part.maskId);
    if (!mask) throw new InvalidWriteError(`Part ${part.id} points to mask ${part.maskId}, which is not stored.`);
    if (!part.stale && !maskFits(mask, v.image)) {
      throw new InvalidWriteError(`Mask of part ${part.id} does not match the image hash and size.`);
    }
  }
  if (v.bikeMaskId) {
    const mask = await tx.objectStore("masks").get(v.bikeMaskId);
    if (!mask) throw new InvalidWriteError(`Bike mask ${v.bikeMaskId} is not stored.`);
    if (!maskFits(mask, v.image)) throw new InvalidWriteError("The bike mask does not match the image hash and size.");
  }
  if (v.cutoutImageId && !(await tx.objectStore("images").get(v.cutoutImageId))) {
    throw new InvalidWriteError(`Cutout image ${v.cutoutImageId} is not stored.`);
  }
  if (v.cutoutImageId) {
    const cut = await tx.objectStore("images").get(v.cutoutImageId);
    if (cut && (cut.width !== v.image.width || cut.height !== v.image.height)) {
      throw new InvalidWriteError("The cutout image must have the same size as the version image.");
    }
  }
}

function maskFits(mask: StoredMask, image: Version["image"]): boolean {
  return mask.imageHash === image.hash && mask.width === image.width && mask.height === image.height;
}

/** Writes pause when protected content alone exceeds the target (SPEC 9). */
async function enforceTarget(tx: WriteTx, h: DreamDb): Promise<void> {
  const ledger = await readLedger(tx);
  if (ledgerTotal(ledger) <= h.targetBytes) return;
  await evictTransient(tx, { now: Date.now(), targetBytes: h.targetBytes });
  if (ledgerTotal(await readLedger(tx)) > h.targetBytes) throw new AppError("STORAGE_FULL");
}

async function getParsedProject(tx: WriteTx, projectId: string): Promise<Project | null> {
  const raw = await tx.objectStore("projects").get(projectId);
  return raw ? parseRecord(ProjectSchema, raw, "project", projectId) : null;
}

async function getParsedVersion(tx: WriteTx, id: string): Promise<Version | null> {
  const raw = await tx.objectStore("versions").get(id);
  return raw ? parseRecord(VersionSchema, raw, "version", id) : null;
}

// ------------------------------------------------------------ create project

export type CreateProjectInput = { project: Project; rootVersion: Version; image: StoredImage };

/** Root image, root version, and project in ONE tx. Retrying with the same IDs is harmless. */
export async function createProject(h: DreamDb, input: CreateProjectInput): Promise<LoadedProject> {
  const project = parseInput(ProjectSchema, input.project, "project");
  const version = parseInput(VersionSchema, input.rootVersion, "root version");
  const image = parseInput(StoredImageSchema, input.image, "image");
  const sameImage = version.image.id === image.id && version.image.hash === image.hash &&
    version.image.width === image.width && version.image.height === image.height && version.image.bytes === image.bytes;
  if (version.kind !== "root" || version.parentId !== null || version.projectId !== project.id ||
    project.rootVersionId !== version.id || project.headVersionId !== version.id || !sameImage) {
    throw new InvalidWriteError("The new project, its root version and its image do not match.");
  }
  return writeTx(h, async (tx) => {
    const already = await getParsedProject(tx, project.id);
    if (already) {
      // A retry after an unknown outcome: the first try committed.
      const root = await getParsedVersion(tx, already.rootVersionId);
      if (!root) throw new CorruptRecordError("project", project.id, "its root version is missing");
      return { project: already, versions: [root] };
    }
    if (await tx.objectStore("versions").get(version.id)) {
      throw new InvalidWriteError(`Version ${version.id} already exists.`);
    }
    const imageId = await putImageDeduped(tx, image);
    const stored: Version = { ...version, image: { ...version.image, id: imageId } };
    await tx.objectStore("versions").put(stored);
    await tx.objectStore("projects").put(project);
    await tx.objectStore("meta").put({ key: "lastOpenProject", value: project.id });
    await enforceTarget(tx, h);
    return { project, versions: [stored] };
  });
}

// ------------------------------------------------------------- accept visual

export type PreparedAccept = {
  /** The complete child version, built by visualChild with IDs generated before this call. */
  version: Version;
  /** The accepted picture; its id/hash/size must equal version.image. */
  image: StoredImage;
  /** Masks created for this version (fresh part masks, bike mask). Inherited masks already exist. */
  masks: StoredMask[];
  /** Stored cutout image, if one was produced with the accept. */
  cutoutImage?: StoredImage | null;
};

export type AcceptResult =
  | { status: "accepted"; project: Project; version: Version; idempotent: boolean }
  | { status: "stale_head"; headVersionId: string }
  | { status: "project_missing" };

/**
 * Accept a visual change. One tx re-reads the project and refuses with "stale_head" if the head
 * moved since the preview was rendered, so a late preview can never overwrite a newer head.
 * Image blob, masks, version and new head commit together or not at all.
 */
export async function acceptVisual(
  h: DreamDb, projectId: string, expectedHeadId: string, prepared: PreparedAccept,
): Promise<AcceptResult> {
  const version = parseInput(VersionSchema, prepared.version, "version");
  const image = parseInput(StoredImageSchema, prepared.image, "image");
  const masks = prepared.masks.map((m) => parseInput(StoredMaskSchema, m, "mask"));
  const cutout = prepared.cutoutImage ? parseInput(StoredImageSchema, prepared.cutoutImage, "cutout image") : null;
  // Only visual accepts for now; sheet versions get their own writer with the build sheet (T8).
  if (version.kind !== "visual" || version.projectId !== projectId || version.parentId !== expectedHeadId) {
    throw new InvalidWriteError("The new version must be a child of the expected head in this project.");
  }
  if (version.image.id !== image.id || version.image.hash !== image.hash ||
    version.image.width !== image.width || version.image.height !== image.height || version.image.bytes !== image.bytes) {
    throw new InvalidWriteError("The new version's image reference does not match the image to store.");
  }
  if (cutout && version.cutoutImageId !== cutout.id) {
    throw new InvalidWriteError("The cutout image must be the version's cutoutImageId.");
  }
  assertMasksReferenced(masks, version.parts, version.bikeMaskId);

  return writeTx<AcceptResult>(h, async (tx) => {
    const project = await getParsedProject(tx, projectId);
    if (!project) return { status: "project_missing" };

    const existing = await getParsedVersion(tx, version.id);
    if (existing) {
      if (existing.projectId !== projectId || existing.parentId !== expectedHeadId) {
        throw new InvalidWriteError(`Version ${version.id} already exists elsewhere.`);
      }
      // Same IDs again: the first try committed. Success without writing a duplicate.
      if (project.headVersionId === existing.id) return { status: "accepted", project, version: existing, idempotent: true };
      return { status: "stale_head", headVersionId: project.headVersionId };
    }
    if (project.headVersionId !== expectedHeadId) return { status: "stale_head", headVersionId: project.headVersionId };
    if (!(await getParsedVersion(tx, expectedHeadId))) {
      throw new CorruptRecordError("version", expectedHeadId, "the head version is missing");
    }

    const imageId = await putImageDeduped(tx, image);
    let cutoutId = version.cutoutImageId;
    if (cutout) cutoutId = await putImageDeduped(tx, cutout);
    for (const m of masks) await putMaskOnce(tx, m);
    const stored: Version = { ...version, image: { ...version.image, id: imageId }, cutoutImageId: cutoutId };
    await checkMaskReferences(tx, stored);
    await tx.objectStore("versions").put(stored);
    const next: Project = { ...project, headVersionId: stored.id, updatedAt: Math.max(stored.createdAt, project.updatedAt) };
    await tx.objectStore("projects").put(next);
    await enforceTarget(tx, h);
    return { status: "accepted", project: next, version: stored, idempotent: false };
  });
}

// ------------------------------------------------------------- accept sheet

/**
 * Accept a sheet-only version (items/fees changed, same picture). Same guards as acceptVisual.
 * Parts, cutout and bike mask are copied from the STORED parent, not the caller's copy: persistParts
 * may have attached newer parts to the parent after the session copy was taken. No blobs are written.
 */
export async function acceptSheet(
  h: DreamDb, projectId: string, expectedHeadId: string, input: Version,
): Promise<AcceptResult> {
  const version = parseInput(VersionSchema, input, "version");
  if (version.kind !== "sheet" || version.projectId !== projectId || version.parentId !== expectedHeadId) {
    throw new InvalidWriteError("The new sheet version must be a child of the expected head in this project.");
  }
  return writeTx<AcceptResult>(h, async (tx) => {
    const project = await getParsedProject(tx, projectId);
    if (!project) return { status: "project_missing" };

    const existing = await getParsedVersion(tx, version.id);
    if (existing) {
      if (existing.projectId !== projectId || existing.parentId !== expectedHeadId) {
        throw new InvalidWriteError(`Version ${version.id} already exists elsewhere.`);
      }
      if (project.headVersionId === existing.id) return { status: "accepted", project, version: existing, idempotent: true };
      return { status: "stale_head", headVersionId: project.headVersionId };
    }
    if (project.headVersionId !== expectedHeadId) return { status: "stale_head", headVersionId: project.headVersionId };
    const parent = await getParsedVersion(tx, expectedHeadId);
    if (!parent) throw new CorruptRecordError("version", expectedHeadId, "the head version is missing");

    const a = version.image, b = parent.image;
    if (a.id !== b.id || a.hash !== b.hash || a.width !== b.width || a.height !== b.height ||
      a.bytes !== b.bytes || a.rights !== b.rights) {
      throw new InvalidWriteError("A sheet version must use the same image as its parent.");
    }
    const stored: Version = {
      ...version, image: { ...b }, parts: parent.parts, cutoutImageId: parent.cutoutImageId, bikeMaskId: parent.bikeMaskId,
    };
    await checkMaskReferences(tx, stored);
    await tx.objectStore("versions").put(stored);
    const next: Project = { ...project, headVersionId: stored.id, updatedAt: Math.max(stored.createdAt, project.updatedAt) };
    await tx.objectStore("projects").put(next);
    await enforceTarget(tx, h);
    return { status: "accepted", project: next, version: stored, idempotent: false };
  });
}

// -------------------------------------------------------------- head moves

/** Select an existing version as head (undo, redo, branch choice). Never creates a node. */
export async function setHead(h: DreamDb, projectId: string, versionId: string, now: number = Date.now()): Promise<Project> {
  return writeTx(h, async (tx) => {
    const project = await getParsedProject(tx, projectId);
    if (!project) throw new InvalidWriteError(`Project ${projectId} does not exist.`);
    const version = await getParsedVersion(tx, versionId);
    if (!version || version.projectId !== projectId) {
      throw new InvalidWriteError(`Version ${versionId} does not belong to project ${projectId}.`);
    }
    const next: Project = { ...project, headVersionId: versionId, updatedAt: Math.max(now, project.updatedAt) };
    await tx.objectStore("projects").put(next);
    return next;
  });
}

/**
 * Select an existing version of this project as head, only if the head is still `expectedHeadId`
 * (checked in the same tx). Used by "jump to version"; never creates a node.
 */
export async function moveHead(
  h: DreamDb, projectId: string, expectedHeadId: string, targetId: string, now: number = Date.now(),
): Promise<NavResult> {
  return writeTx<NavResult>(h, async (tx) => {
    const project = await getParsedProject(tx, projectId);
    if (!project) return { status: "project_missing" };
    if (project.headVersionId !== expectedHeadId) return { status: "stale_head" };
    const target = await getParsedVersion(tx, targetId);
    if (!target || target.projectId !== projectId) {
      throw new InvalidWriteError(`Version ${targetId} does not belong to project ${projectId}.`);
    }
    const next: Project = { ...project, headVersionId: targetId, updatedAt: Math.max(now, project.updatedAt) };
    await tx.objectStore("projects").put(next);
    return { status: "moved", project: next, version: target };
  });
}

export type NavResult =
  | { status: "moved"; project: Project; version: Version }
  | { status: "at_root" | "no_redo" | "stale_head" | "project_missing" }
  | { status: "choose_branch"; children: Version[] };

async function projectVersions(tx: WriteTx, projectId: string): Promise<Version[]> {
  const raw = await tx.objectStore("versions").index("projectId").getAll(projectId);
  return raw.map((v) => parseRecord(VersionSchema, v, "version", String((v as { id?: unknown }).id ?? "?")));
}

/** Undo = select the parent. `expectedHeadId` guards against a double click or another tab. */
export async function undo(h: DreamDb, projectId: string, expectedHeadId: string, now: number = Date.now()): Promise<NavResult> {
  return writeTx<NavResult>(h, async (tx) => {
    const project = await getParsedProject(tx, projectId);
    if (!project) return { status: "project_missing" };
    if (project.headVersionId !== expectedHeadId) return { status: "stale_head" };
    const head = await getParsedVersion(tx, expectedHeadId);
    const parentId = head ? undoTarget(head) : null;
    if (!head || parentId === null) return { status: "at_root" };
    const parent = await getParsedVersion(tx, parentId);
    if (!parent) throw new CorruptRecordError("version", parentId, "the parent version is missing");
    const next: Project = { ...project, headVersionId: parentId, updatedAt: Math.max(now, project.updatedAt) };
    await tx.objectStore("projects").put(next);
    return { status: "moved", project: next, version: parent };
  });
}

/**
 * Redo = select an existing child. With several children and no `childId` the children are
 * returned so the UI can ask which branch; nothing is written then.
 */
export async function redo(
  h: DreamDb, projectId: string, expectedHeadId: string, childId?: string, now: number = Date.now(),
): Promise<NavResult> {
  return writeTx<NavResult>(h, async (tx) => {
    const project = await getParsedProject(tx, projectId);
    if (!project) return { status: "project_missing" };
    if (project.headVersionId !== expectedHeadId) return { status: "stale_head" };
    const kids = children(await projectVersions(tx, projectId), expectedHeadId);
    if (kids.length === 0) return { status: "no_redo" };
    let target: Version | undefined;
    if (childId !== undefined) {
      target = kids.find((k) => k.id === childId);
      if (!target) throw new InvalidWriteError(`Version ${childId} is not a child of the current head.`);
    } else if (kids.length === 1) {
      target = kids[0];
    } else {
      return { status: "choose_branch", children: kids };
    }
    if (!target) return { status: "no_redo" };
    const next: Project = { ...project, headVersionId: target.id, updatedAt: Math.max(now, project.updatedAt) };
    await tx.objectStore("projects").put(next);
    return { status: "moved", project: next, version: target };
  });
}

// ------------------------------------------------------------- attach parts

export type AttachPartsInput = {
  versionId: string;
  /** The image the detection ran on; the update is refused if the version has another image. */
  imageHash: string;
  /** New part list; omit to keep the existing parts. */
  parts?: Part[];
  /** New masks to store (fresh part masks and the bike mask). */
  masks?: StoredMask[];
  /** New bike mask; omit to keep, null to clear. */
  bikeMask?: StoredMask | null;
  /** New cutout image; omit to keep, null to clear. */
  cutoutImage?: StoredImage | null;
};
export type AttachResult =
  | { status: "attached"; version: Version }
  | { status: "image_mismatch" | "version_missing" };

/**
 * Display-association update (SPEC 9): only parts, bikeMaskId and cutoutImageId of a version can
 * change, and only when the version still shows the exact image the detection ran on. Items,
 * change record and image are copied from the stored version, so they cannot change.
 */
export async function attachParts(h: DreamDb, input: AttachPartsInput): Promise<AttachResult> {
  const masks = (input.masks ?? []).map((m) => parseInput(StoredMaskSchema, m, "mask"));
  const bikeMask = input.bikeMask ? parseInput(StoredMaskSchema, input.bikeMask, "bike mask") : input.bikeMask;
  const cutout = input.cutoutImage ? parseInput(StoredImageSchema, input.cutoutImage, "cutout image") : input.cutoutImage;
  const newParts = input.parts === undefined ? undefined : parseInput(z.array(PartSchema), input.parts, "parts");

  return writeTx<AttachResult>(h, async (tx) => {
    const old = await getParsedVersion(tx, input.versionId);
    if (!old) return { status: "version_missing" };
    if (old.image.hash !== input.imageHash) return { status: "image_mismatch" };

    // Nothing may be stored that the resulting version does not reference.
    const resultBikeMaskId = bikeMask === undefined ? old.bikeMaskId : bikeMask === null ? null : bikeMask.id;
    assertMasksReferenced(bikeMask ? [...masks, bikeMask] : masks, newParts ?? old.parts, resultBikeMaskId);

    for (const m of masks) await putMaskOnce(tx, m);
    if (bikeMask) await putMaskOnce(tx, bikeMask);
    let cutoutImageId = old.cutoutImageId;
    if (cutout) cutoutImageId = await putImageDeduped(tx, cutout);
    else if (cutout === null) cutoutImageId = null;

    const next: Version = {
      ...old,
      parts: newParts ?? old.parts,
      bikeMaskId: resultBikeMaskId,
      cutoutImageId,
    };
    const checked = parseInput(VersionSchema, next, "version");
    await checkMaskReferences(tx, checked);
    await tx.objectStore("versions").put(checked);

    // Masks and cutout this version no longer uses are deleted unless another version uses them.
    const dropMasks = new Set([...old.parts.map((p) => p.maskId), ...(old.bikeMaskId ? [old.bikeMaskId] : [])]);
    for (const p of checked.parts) dropMasks.delete(p.maskId);
    if (checked.bikeMaskId) dropMasks.delete(checked.bikeMaskId);
    const dropImage = old.cutoutImageId && old.cutoutImageId !== checked.cutoutImageId ? old.cutoutImageId : null;
    if (dropMasks.size > 0 || dropImage) {
      const refs = await collectReferences(tx);
      let freedMasks = 0;
      for (const id of dropMasks) {
        if (refs.maskIds.has(id)) continue;
        const m = await tx.objectStore("masks").get(id);
        if (m) { freedMasks += m.pixels.length; await tx.objectStore("masks").delete(id); }
      }
      if (freedMasks) await adjustLedger(tx, { maskBytes: -freedMasks });
      if (dropImage && !refs.imageIds.has(dropImage)) await removeImageIfUnused(tx, dropImage);
    }
    if (masks.length > 0 || bikeMask || cutout) await enforceTarget(tx, h);
    return { status: "attached", version: checked };
  });
}

/** Delete an image no version references (caller checked) and the cache entries that pointed at it. */
async function removeImageIfUnused(tx: WriteTx, imageId: string): Promise<void> {
  const img = await tx.objectStore("images").get(imageId);
  if (!img) return;
  await tx.objectStore("images").delete(imageId);
  await adjustLedger(tx, { imageBytes: -img.bytes });
  await dropCacheForRemovedBlobs(tx, new Set([imageId]), new Set()); // adjusts the ledger itself

}

// ------------------------------------------------------------- fit results

export type CheckResponseData = z.infer<typeof CheckResponseSchema>;
export type AttachFitInput = {
  projectId: string; versionId: string;
  /** The canonical text the request's inputHash was made from (fitInputCanonical at send time). */
  canonical: string;
  response: CheckResponseData;
};
export type AttachFitResult =
  | { status: "attached"; attachedItemIds: string[]; cached: boolean }
  | { status: "cache_only"; reason: "version_missing" | "project_mismatch" | "not_head" | "input_changed" | "no_matching_items"; attachedItemIds: []; cached: boolean };

/**
 * One build has several batches of at most 3 items under the same build-wide hash, so the cache
 * entry fit:<hash> holds the merged results of all batches (SPEC 9 key family is unchanged).
 */
const CachedFitSchema = z.object({
  inputHash: CheckResponseSchema.shape.inputHash,
  // Each result keeps the checkedAt of its own batch, so a merge never freshens an older result.
  results: z.array(z.object({ checkedAt: CheckResponseSchema.shape.checkedAt, result: FitResultSchema }).strict()).min(1).max(60),
}).strict();
let fitCacheQueue: Promise<unknown> = Promise.resolve();

/** Merge a batch response into fit:<hash> by itemId; serialized so batches cannot overwrite each other. */
function cacheFitResponse(h: DreamDb, response: CheckResponseData): Promise<void> {
  const run = async () => {
    const key = cacheKeys.fit(response.inputHash);
    const prev = await getCache(h, key, CachedFitSchema);
    const byId = new Map((prev?.value.results ?? []).map((r) => [r.result.itemId, r]));
    for (const r of response.results) byId.set(r.itemId, { checkedAt: response.checkedAt, result: r });
    await putCache(h, { key, value: { inputHash: response.inputHash, results: [...byId.values()].slice(-60) }, schema: CachedFitSchema });
  };
  const next = fitCacheQueue.then(run, run);
  fitCacheQueue = next.catch(() => undefined);
  return next;
}

/**
 * Read a fit response back from fit:<inputHash> without spending (SPEC 9). Returns null unless every
 * requested item (1 to 3 distinct ids) has a real (non-mock) result younger than FIT_TTL_MS and all
 * selected results come from one check. The age counts from each result's own checkedAt, because a
 * re-put renews the entry's expiresAt. The returned checkedAt is that check's original date; a date
 * is never invented or mixed.
 */
export async function readCachedFit(h: DreamDb, inputHash: string, itemIds: string[], now: number = Date.now()): Promise<CheckResponseData | null> {
  if (itemIds.length === 0 || itemIds.length > 3 || new Set(itemIds).size !== itemIds.length) return null;
  const hit = await getCache(h, cacheKeys.fit(inputHash), CachedFitSchema, now);
  if (!hit || hit.expired || hit.value.inputHash !== inputHash) return null;
  const byId = new Map(hit.value.results.map((r) => [r.result.itemId, r]));
  const picked: Array<{ checkedAt: string; result: z.infer<typeof FitResultSchema> }> = [];
  for (const id of itemIds) {
    const r = byId.get(id);
    if (!r || r.result.reasons.some((x) => x.includes(MOCK_LABEL))) return null;
    picked.push(r);
  }
  const checkedAt = picked[0]!.checkedAt;
  if (picked.some((r) => r.checkedAt !== checkedAt)) return null;
  const time = Date.parse(checkedAt);
  if (!Number.isFinite(time) || now - time > FIT_TTL_MS) return null;
  const parsed = CheckResponseSchema.safeParse({ inputHash, checkedAt, results: picked.map((r) => r.result) });
  return parsed.success ? parsed.data : null;
}

/**
 * Store a fit response and, only when it is still current, attach it to the version's items
 * (SPEC 9: fit results belong to the exact input hash; completion updates derived check data,
 * never the image head). The response is always cached under its hash. It is attached only when
 * the version exists and the canonical text recomputed inside the transaction from the stored
 * items, the project's bike revision and the shop rules equals `canonical`. The hash of
 * `canonical` is computed before the transaction because IndexedDB closes a transaction that
 * awaits anything but its own requests. No version is created and headVersionId never changes.
 */
export async function attachFitResponse(h: DreamDb, input: AttachFitInput): Promise<AttachFitResult> {
  const response = parseInput(CheckResponseSchema, input.response, "fit response");
  if ((await sha256OfText(input.canonical)) !== response.inputHash) {
    throw new InvalidWriteError("The fit response hash does not belong to the canonical input it was sent with.");
  }
  let cached = true;
  try {
    await cacheFitResponse(h, response);
  } catch (e) {
    // A failed cache write only means the result is not cached; attaching below may still work.
    if (e instanceof ReadOnlyError || e instanceof StorageClosedError) throw e;
    cached = false;
  }

  return writeTx<AttachFitResult>(h, async (tx) => {
    const version = await getParsedVersion(tx, input.versionId);
    if (!version) return { status: "cache_only", reason: "version_missing", attachedItemIds: [], cached };
    const project = await getParsedProject(tx, version.projectId);
    if (!project || project.id !== input.projectId) return { status: "cache_only", reason: "project_mismatch", attachedItemIds: [], cached };
    // Only the current head gets the result; an undone or superseded version stays untouched (SPEC 9).
    if (project.headVersionId !== version.id) return { status: "cache_only", reason: "not_head", attachedItemIds: [], cached };
    const rawSettings = await tx.objectStore("settings").get(project.settingsId);
    const settings = rawSettings ? parseRecord(SettingsRecordSchema, rawSettings, "settings", project.settingsId) : null;
    const now = fitInputCanonical(project.bikeRevision, version.items, settings?.settings.shopRules ?? [], LEGAL_SEED.version);
    if (now !== input.canonical) return { status: "cache_only", reason: "input_changed", attachedItemIds: [], cached };

    const byId = new Map(response.results.map((r) => [r.itemId, r]));
    const attached: string[] = [];
    const items = version.items.map((it) => {
      const r = byId.get(it.id);
      if (!r) return it;
      attached.push(it.id);
      // A new check clears an earlier mechanic acknowledgment of the old result.
      return { ...it, fit: r, fitInputHash: response.inputHash, fitCheckedAt: response.checkedAt, fitReviewedHash: null };
    });
    if (attached.length === 0) return { status: "cache_only", reason: "no_matching_items", attachedItemIds: [], cached };
    await tx.objectStore("versions").put(parseInput(VersionSchema, { ...version, items }, "version"));
    return { status: "attached", attachedItemIds: attached, cached };
  });
}

// ------------------------------------------------------------- bike revision

/** The confirmed bike is project level; fit hashes include its revision (SPEC 9 invalidation). */
export async function updateBikeRevision(h: DreamDb, projectId: string, revision: BikeRevision, now: number = Date.now()): Promise<Project> {
  const valid = parseInput(BikeRevisionSchema, revision, "bike revision");
  return writeTx(h, async (tx) => {
    const project = await getParsedProject(tx, projectId);
    if (!project) throw new InvalidWriteError(`Project ${projectId} does not exist.`);
    const next: Project = { ...project, bikeRevision: valid, updatedAt: Math.max(now, project.updatedAt) };
    await tx.objectStore("projects").put(next);
    return next;
  });
}

export async function renameProject(h: DreamDb, projectId: string, name: string, now: number = Date.now()): Promise<Project> {
  return writeTx(h, async (tx) => {
    const project = await getParsedProject(tx, projectId);
    if (!project) throw new InvalidWriteError(`Project ${projectId} does not exist.`);
    const next = parseInput(ProjectSchema, { ...project, name, updatedAt: Math.max(now, project.updatedAt) }, "project name");
    await tx.objectStore("projects").put(next);
    return next;
  });
}

// ------------------------------------------------------------ delete project

/**
 * Remove a project and its versions. Images and masks are removed only when no other project's
 * version (or the shop logo) references them; cache entries for removed blobs go too.
 */
export async function deleteProject(h: DreamDb, projectId: string): Promise<boolean> {
  return writeTx(h, async (tx) => {
    const projectRaw = await tx.objectStore("projects").get(projectId);
    if (!projectRaw) return false;
    // Read the versions leniently: a damaged project must still be deletable by its owner.
    const mine = (await tx.objectStore("versions").index("projectId").getAll(projectId)) as Version[];
    const imageIds = new Set<string>();
    const imageHashes = new Set<string>();
    const maskIds = new Set<string>();
    for (const v of mine) {
      if (v?.image?.id) imageIds.add(v.image.id);
      if (v?.image?.hash) imageHashes.add(v.image.hash);
      if (v?.cutoutImageId) imageIds.add(v.cutoutImageId);
      if (v?.bikeMaskId) maskIds.add(v.bikeMaskId);
      for (const p of v?.parts ?? []) if (p?.maskId) maskIds.add(p.maskId);
      await tx.objectStore("versions").delete(v.id);
    }
    await tx.objectStore("projects").delete(projectId);

    const refs = await collectReferences(tx); // what the remaining projects still use
    let freedImages = 0;
    const removedImages = new Set<string>();
    for (const id of imageIds) {
      if (refs.imageIds.has(id)) continue;
      const img = await tx.objectStore("images").get(id);
      if (!img) continue;
      freedImages += img.bytes;
      removedImages.add(id);
      await tx.objectStore("images").delete(id);
    }
    let freedMasks = 0;
    for (const id of maskIds) {
      if (refs.maskIds.has(id)) continue;
      const m = await tx.objectStore("masks").get(id);
      if (!m) continue;
      freedMasks += m.pixels.length;
      await tx.objectStore("masks").delete(id);
    }
    const goneHashes = new Set([...imageHashes].filter((x) => !refs.imageHashes.has(x)));
    await adjustLedger(tx, { imageBytes: -freedImages, maskBytes: -freedMasks });
    await dropCacheForRemovedBlobs(tx, removedImages, goneHashes); // adjusts the ledger itself
    const last = await tx.objectStore("meta").get("lastOpenProject");
    if (last?.value === projectId) await tx.objectStore("meta").put({ key: "lastOpenProject", value: null });
    return true;
  });
}

// ------------------------------------------------------------ import project

export type ImportRefusal =
  | "invalid_snapshot" | "project_exists" | "version_exists" | "invalid_history"
  | "missing_image" | "bad_image" | "missing_mask" | "bad_mask" | "inconsistent";
export type ImportResult =
  | { status: "imported"; project: Project; versions: Version[] }
  | { status: "refused"; reason: ImportRefusal; message: string };

const refuse = (reason: ImportRefusal, message: string): ImportResult => ({ status: "refused", reason, message });

/** Pure checks of the snapshot against the loaded files; the first problem found is returned. */
function checkSnapshot(
  snap: ProjectSnapshot, blobsById: ReadonlyMap<string, Blob>, maskPixelsById: ReadonlyMap<string, Uint8Array>,
): ImportResult | null {
  const { project, versions } = snap;
  const ids = new Set(versions.map((v) => v.id));
  if (ids.size !== versions.length) return refuse("invalid_history", "Two versions share the same id.");
  const roots = versions.filter((v) => v.parentId === null);
  if (roots.length !== 1 || roots[0]?.id !== project.rootVersionId) {
    return refuse("invalid_history", "The history must have exactly one root, and it must be the project's root.");
  }
  if (versions.some((v) => v.projectId !== project.id)) {
    return refuse("invalid_history", "A version belongs to a different project.");
  }
  if (!ids.has(project.headVersionId)) return refuse("invalid_history", "The head is not a version of this project.");
  for (const v of versions) {
    let path: Version[];
    try { path = pathToRoot(versions, v.id); } catch (e) { return refuse("invalid_history", errText(e)); }
    if (path[path.length - 1]?.id !== project.rootVersionId) return refuse("invalid_history", "A version does not lead back to the root.");
  }

  const imageById = new Map(snap.images.map((i) => [i.id, i]));
  if (imageById.size !== snap.images.length) return refuse("invalid_snapshot", "An image is listed twice.");
  const maskById = new Map(snap.masks.map((m) => [m.id, m]));
  if (maskById.size !== snap.masks.length) return refuse("invalid_snapshot", "A mask is listed twice.");

  if (new Set(snap.images.map((i) => i.file)).size !== snap.images.length) return refuse("invalid_snapshot", "Two images share one file name.");
  // No unreferenced extras: nothing could free them later (deleteProject follows versions only).
  const usedImages = new Set(versions.flatMap((v) => (v.cutoutImageId ? [v.image.id, v.cutoutImageId] : [v.image.id])));
  const usedMasks = new Set(versions.flatMap((v) => [...v.parts.map((p) => p.maskId), ...(v.bikeMaskId ? [v.bikeMaskId] : [])]));
  if (snap.images.some((i) => !usedImages.has(i.id))) return refuse("invalid_snapshot", "An image is listed that no version uses.");
  if (snap.masks.some((m) => !usedMasks.has(m.id))) return refuse("invalid_snapshot", "A mask is listed that no version uses.");

  for (const img of snap.images) {
    if (img.rights === "external_runtime") return refuse("invalid_snapshot", "Images from the web are never part of a saved project.");
    const blob = blobsById.get(img.id);
    if (!blob) return refuse("missing_image", `The file ${img.file} is missing.`);
    if (blob.size !== img.bytes) return refuse("bad_image", `The file ${img.file} has the wrong size.`);
  }
  for (const v of versions) {
    const ref = imageById.get(v.image.id);
    if (!ref || ref.hash !== v.image.hash || ref.width !== v.image.width || ref.height !== v.image.height ||
      ref.bytes !== v.image.bytes || ref.rights !== v.image.rights) {
      return refuse("missing_image", `The picture of version ${v.id} is not listed correctly.`);
    }
    if (v.cutoutImageId) {
      const cut = imageById.get(v.cutoutImageId);
      if (!cut) return refuse("missing_image", `The cutout image ${v.cutoutImageId} is not listed.`);
      if (cut.width !== v.image.width || cut.height !== v.image.height) return refuse("bad_image", "A cutout has the wrong size.");
    }
    const wanted = [...v.parts.map((p) => p.maskId), ...(v.bikeMaskId ? [v.bikeMaskId] : [])];
    for (const id of wanted) if (!maskById.has(id)) return refuse("missing_mask", `Mask ${id} is not listed.`);
  }
  for (const m of snap.masks) {
    const pixels = maskPixelsById.get(m.id);
    if (!pixels) return refuse("missing_mask", `The file masks/${m.file} is missing.`);
    // Same rules as the stored mask: exact length and only 0 or 1.
    if (!StoredMaskSchema.safeParse({ id: m.id, imageHash: m.imageHash, width: m.width, height: m.height, pixels, createdAt: m.createdAt }).success) {
      return refuse("bad_mask", `The file masks/${m.file} is not a valid mask for ${m.width}x${m.height} pixels.`);
    }
  }
  return null;
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Restore a project from a validated folder snapshot, atomically (OF1). Refusals write nothing.
 * Precondition for the reader (U1): image width/height are NOT decoded here; readProjectFolder must
 * decode each file and refuse a mismatch with the listed width/height. Size and sha256 are checked here.
 * Inside ONE tx: images (deduped by hash, so ids are remapped to what the store returns), masks,
 * versions, project, mask checks, storage target. Any failure aborts and leaves the store as it was.
 */
export async function importProject(
  h: DreamDb, snapshot: unknown, blobsById: ReadonlyMap<string, Blob>,
  maskPixelsById: ReadonlyMap<string, Uint8Array>, now: number = Date.now(),
  digest: (blob: Blob) => Promise<string> = sha256Hex, // injectable so fixtures with fake hashes can run
): Promise<ImportResult> {
  assertWritable(h);
  const parsed = ProjectSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return refuse("invalid_snapshot", `project.json is not valid: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`.trim());
  }
  const snap = parsed.data;
  const refused = checkSnapshot(snap, blobsById, maskPixelsById);
  if (refused) return refused;
  // Hash check before the transaction (digest is async and must not run inside IDB).
  for (const img of snap.images) {
    const blob = blobsById.get(img.id);
    if (blob && (await digest(blob)).toLowerCase() !== img.hash.toLowerCase()) {
      return refuse("bad_image", `The file ${img.file} does not match its saved hash.`);
    }
  }

  try {
    return await writeTx<ImportResult>(h, async (tx) => {
      if (await tx.objectStore("projects").get(snap.project.id)) {
        return refuse("project_exists", "This project is already in this browser.");
      }
      // A put would silently overwrite another project's version with the same id.
      for (const v of snap.versions) {
        if (await tx.objectStore("versions").get(v.id)) return refuse("version_exists", `Version ${v.id} already exists in this browser.`);
      }
      const newId = new Map<string, string>();
      for (const img of snap.images) {
        const blob = blobsById.get(img.id);
        if (!blob) throw new InvalidWriteError(`Image ${img.id} has no file.`);
        const ref: ImageRef = { id: img.id, hash: img.hash, width: img.width, height: img.height, bytes: img.bytes, rights: img.rights };
        newId.set(img.id, await putImageDeduped(tx, { ...ref, blob, lastAccessedAt: now }));
      }
      for (const m of snap.masks) {
        const pixels = maskPixelsById.get(m.id);
        if (!pixels) throw new InvalidWriteError(`Mask ${m.id} has no file.`);
        await putMaskOnce(tx, { id: m.id, imageHash: m.imageHash, width: m.width, height: m.height, pixels: new Uint8Array(pixels), createdAt: m.createdAt });
      }
      const stored: Version[] = snap.versions.map((v) => ({
        ...v,
        image: { ...v.image, id: newId.get(v.image.id) ?? v.image.id },
        cutoutImageId: v.cutoutImageId ? (newId.get(v.cutoutImageId) ?? v.cutoutImageId) : null,
      }));
      for (const v of stored) await tx.objectStore("versions").put(v);
      await tx.objectStore("projects").put(snap.project);
      for (const v of stored) await checkMaskReferences(tx, v);
      await enforceTarget(tx, h);
      return { status: "imported", project: snap.project, versions: stored };
    });
  } catch (e) {
    // A history rule broken by the files (for example a mask for another image): nothing was written.
    if (e instanceof InvalidWriteError) return refuse("inconsistent", e.message);
    throw e;
  }
}
