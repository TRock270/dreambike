// Derivation cache, byte ledger and safe eviction on top of db.ts (SPEC 9).
//
// Cache entries hold schema-validated data only. Which entries may be evicted:
//  - never one whose blobs a version (or the shop logo) uses, and never one keyed by the hash of
//    an image a saved project shows (cut/parts/points/id persist while the project exists)
//  - everything else is transient and is dropped least-recently-used first
// Saved projects, versions, version images and masks are never touched by eviction.
import { z } from "zod";
import { CacheEntry as CacheEntrySchema, Hash, StoredImage as StoredImageSchema } from "./contracts";
import { assertOpen, assertWritable, runTx, writeTx, type DreamDb, type ReadTx, type WriteTx } from "./db";
import type { CacheEntry, StoredImage } from "./types";

// ------------------------------------------------------------------- keys

const phraseOk = (s: string) => encodeURIComponent(s);
const hashOf = (label: string, v: string): string => {
  if (!Hash.safeParse(v).success) throw new Error(`Cache key part "${label}" must be a 64-character hash.`);
  return v;
};
const tokenOf = (label: string, v: string): string => {
  if (!/^[a-z0-9_-]{1,40}$/.test(v)) throw new Error(`Cache key part "${label}" is not a simple token.`);
  return v;
};
function limit(key: string): string {
  if (key.length > 500) throw new Error("Cache key is too long.");
  return key;
}

/** SPEC 9 key families. Derivation keys include the algorithm/prompt version at the end. */
export const cacheKeys = {
  norm: (sourceHash: string) => `norm:${hashOf("sourceHash", sourceHash)}:normalize-v1`,
  cut: (imageHash: string) => `cut:${hashOf("imageHash", imageHash)}:sam-3.1:mask-v1`,
  parts: (imageHash: string, phrase: string) => limit(`parts:${hashOf("imageHash", imageHash)}:${phraseOk(phrase)}:mask-v1`),
  points: (imageHash: string, pointHash: string) =>
    `points:${hashOf("imageHash", imageHash)}:${hashOf("pointHash", pointHash)}:mask-v1`,
  identify: (imageHash: string) => `id:${hashOf("imageHash", imageHash)}:identify-v1`,
  instruction: (inputHash: string) => `instruction:${hashOf("inputHash", inputHash)}:instruction-v1`,
  edit: (a: { baseHash: string; referenceHash: string | null; promptHash: string; quality: string }) =>
    `edit:${hashOf("baseHash", a.baseHash)}:${a.referenceHash === null ? "none" : hashOf("referenceHash", a.referenceHash)}:` +
    `${hashOf("promptHash", a.promptHash)}:${tokenOf("quality", a.quality)}:tools-v1`,
  fit: (fitInputHash: string) => `fit:${hashOf("fitInputHash", fitInputHash)}:fit-check-v1`,
  search: (inputHash: string) => `search:${hashOf("inputHash", inputHash)}:search-parts-v1`,
};

const FAMILIES = ["norm", "cut", "parts", "points", "id", "instruction", "edit", "fit", "search"] as const;
export type CacheFamily = (typeof FAMILIES)[number];
/** Families whose second key segment is the hash of an image a project may show. */
const IMAGE_HASH_FAMILIES: readonly string[] = ["cut", "parts", "points", "id"];

export function cacheFamily(key: string): CacheFamily {
  const family = key.split(":")[0] ?? "";
  if (!(FAMILIES as readonly string[]).includes(family)) throw new Error(`Unknown cache key family "${family}".`);
  return family as CacheFamily;
}

export const SEARCH_TTL_MS = 60 * 60 * 1000;
export const FIT_TTL_MS = 24 * 60 * 60 * 1000;

/** Search expires in 1 hour, fit research in 24 hours, everything else never. */
export function expiresAtFor(key: string, now: number): number | null {
  const family = cacheFamily(key);
  if (family === "search") return now + SEARCH_TTL_MS;
  if (family === "fit") return now + FIT_TTL_MS;
  return null;
}

// ----------------------------------------------------------------- ledger

export type Ledger = { imageBytes: number; maskBytes: number; cacheBytes: number };
const LedgerSchema = z.object({
  imageBytes: z.number().int().min(0), maskBytes: z.number().int().min(0), cacheBytes: z.number().int().min(0),
}).strict();

export const ledgerTotal = (l: Ledger): number => l.imageBytes + l.maskBytes + l.cacheBytes;

/** Recount from the stores. Used only when the ledger record is missing or unreadable. */
export async function scanLedger(tx: ReadTx): Promise<Ledger> {
  let imageBytes = 0, maskBytes = 0, cacheBytes = 0;
  for (const i of await tx.objectStore("images").getAll()) imageBytes += Number(i?.bytes) || 0;
  for (const m of await tx.objectStore("masks").getAll()) maskBytes += m?.pixels?.length ?? 0;
  for (const c of await tx.objectStore("cache").getAll()) cacheBytes += Number(c?.bytes) || 0;
  return { imageBytes, maskBytes, cacheBytes };
}

async function readLedgerRecord(tx: ReadTx): Promise<Ledger | null> {
  const rec = await tx.objectStore("meta").get("ledger");
  const parsed = LedgerSchema.safeParse(rec?.value);
  return parsed.success ? parsed.data : null;
}

export async function readLedger(tx: ReadTx): Promise<Ledger> {
  return (await readLedgerRecord(tx)) ?? scanLedger(tx);
}

/**
 * Add deltas to the ledger inside the same tx as the data change (never below zero). Callers
 * adjust AFTER changing the data, so a missing or unreadable record is rebuilt by recounting,
 * which already includes the change; the delta is then not added a second time.
 */
export async function adjustLedger(tx: WriteTx, delta: Partial<Ledger>): Promise<void> {
  const l = await readLedgerRecord(tx);
  const next: Ledger = l === null ? await scanLedger(tx) : {
    imageBytes: Math.max(0, l.imageBytes + (delta.imageBytes ?? 0)),
    maskBytes: Math.max(0, l.maskBytes + (delta.maskBytes ?? 0)),
    cacheBytes: Math.max(0, l.cacheBytes + (delta.cacheBytes ?? 0)),
  };
  await tx.objectStore("meta").put({ key: "ledger", value: next });
}

export async function storageStatus(h: DreamDb): Promise<Ledger & { totalBytes: number; targetBytes: number; overTarget: boolean }> {
  assertOpen(h);
  const tx = h.db.transaction(["images", "masks", "cache", "meta"], "readonly");
  const l = await readLedger(tx as unknown as ReadTx);
  await tx.done;
  const totalBytes = ledgerTotal(l);
  return { ...l, totalBytes, targetBytes: h.targetBytes, overTarget: totalBytes > h.targetBytes };
}

/** Repair the ledger by recounting (cheap for a few projects). */
export async function rebuildLedger(h: DreamDb): Promise<Ledger> {
  return writeTx(h, async (tx) => {
    const l = await scanLedger(tx);
    await tx.objectStore("meta").put({ key: "ledger", value: l });
    return l;
  });
}

// ------------------------------------------------------------- references

export type References = { imageIds: Set<string>; imageHashes: Set<string>; maskIds: Set<string> };

/**
 * What saved projects use: image IDs and hashes, mask IDs, and the shop logo. Read leniently so a
 * damaged record keeps whatever it names protected instead of blocking cleanup.
 */
export async function collectReferences(tx: ReadTx): Promise<References> {
  const refs: References = { imageIds: new Set(), imageHashes: new Set(), maskIds: new Set() };
  for (const v of await tx.objectStore("versions").getAll()) {
    if (v?.image?.id) refs.imageIds.add(v.image.id);
    if (v?.image?.hash) refs.imageHashes.add(v.image.hash);
    if (v?.cutoutImageId) refs.imageIds.add(v.cutoutImageId);
    if (v?.bikeMaskId) refs.maskIds.add(v.bikeMaskId);
    for (const p of v?.parts ?? []) if (p?.maskId) refs.maskIds.add(p.maskId);
  }
  for (const s of await tx.objectStore("settings").getAll()) {
    const logo = s?.settings?.logoImageId;
    if (logo) refs.imageIds.add(logo);
  }
  return refs;
}

function isProtected(entry: CacheEntry, refs: References): boolean {
  if ((entry.blobIds ?? []).some((id) => refs.imageIds.has(id))) return true;
  const [family, segment] = String(entry.key).split(":");
  return IMAGE_HASH_FAMILIES.includes(family ?? "") && refs.imageHashes.has(segment ?? "");
}

/**
 * Delete cache entries and the blobs only they used. A blob stays if a version uses it or a
 * remaining cache entry lists it. Adjusts the ledger.
 */
async function removeEntries(tx: WriteTx, doomed: CacheEntry[], refs: References): Promise<void> {
  if (doomed.length === 0) return;
  const doomedKeys = new Set(doomed.map((e) => e.key));
  const stillUsed = new Set<string>();
  for (const e of await tx.objectStore("cache").getAll()) {
    if (!doomedKeys.has(e.key)) for (const id of e.blobIds ?? []) stillUsed.add(id);
  }
  let cacheBytes = 0, imageBytes = 0;
  for (const e of doomed) {
    await tx.objectStore("cache").delete(e.key);
    cacheBytes += Number(e.bytes) || 0;
  }
  const checked = new Set<string>();
  for (const e of doomed) {
    for (const id of e.blobIds ?? []) {
      if (checked.has(id) || stillUsed.has(id) || refs.imageIds.has(id)) continue;
      checked.add(id);
      const img = await tx.objectStore("images").get(id);
      if (!img) continue;
      await tx.objectStore("images").delete(id);
      imageBytes += img.bytes;
    }
  }
  await adjustLedger(tx, { cacheBytes: -cacheBytes, imageBytes: -imageBytes });
}

/**
 * After a project delete: drop cache entries that list a removed blob or are keyed by the hash of
 * an image that no project shows any more.
 */
export async function dropCacheForRemovedBlobs(tx: WriteTx, removedImageIds: Set<string>, goneHashes: Set<string>): Promise<void> {
  const refs = await collectReferences(tx);
  const doomed = (await tx.objectStore("cache").getAll()).filter((e) => {
    const [family, segment] = String(e.key).split(":");
    return (e.blobIds ?? []).some((id) => removedImageIds.has(id)) ||
      (IMAGE_HASH_FAMILIES.includes(family ?? "") && goneHashes.has(segment ?? ""));
  });
  await removeEntries(tx, doomed, refs);
}

/**
 * Evict unprotected cache entries: expired ones first, then least recently used until the ledger
 * is at or below `targetBytes` (null evicts every unprotected entry). `keepKey` is never evicted.
 */
export async function evictTransient(
  tx: WriteTx, opts: { now: number; targetBytes: number | null; keepKey?: string },
): Promise<number> {
  const refs = await collectReferences(tx);
  const entries = await tx.objectStore("cache").index("lastAccessedAt").getAll(); // oldest first
  const evictable = entries.filter((e) => e.key !== opts.keepKey && !isProtected(e, refs));
  const expired = evictable.filter((e) => e.expiresAt !== null && e.expiresAt <= opts.now);
  const rest = evictable.filter((e) => !(e.expiresAt !== null && e.expiresAt <= opts.now));
  const doomed = [...expired];
  if (opts.targetBytes === null) {
    doomed.push(...rest);
  } else {
    let total = ledgerTotal(await readLedger(tx)) - doomed.reduce((n, e) => n + e.bytes, 0);
    for (const e of rest) {
      if (total <= opts.targetBytes) break;
      doomed.push(e);
      total -= e.bytes;
    }
  }
  await removeEntries(tx, doomed, refs);
  return doomed.length;
}

/** The "safe cleanup" before a quota retry: `all` drops every unprotected cache entry. */
export async function cleanupSafeCache(h: DreamDb, opts: { all?: boolean; now?: number } = {}): Promise<number> {
  assertWritable(h);
  return runTx(h, (tx) => evictTransient(tx, {
    now: opts.now ?? Date.now(), targetBytes: opts.all ? null : h.targetBytes,
  }));
}

// -------------------------------------------------------------- get / put

export type CacheHit<T> = {
  value: T; createdAt: number; expiresAt: number | null;
  /** True past expiresAt. The data is returned with its original createdAt, never a new date. */
  expired: boolean; blobIds: string[];
};

/**
 * Read a cache entry and validate its value with `schema`. A missing, damaged, or wrongly shaped
 * entry is a miss (the caller recomputes and overwrites it). Marks the entry as recently used.
 */
export async function getCache<T>(h: DreamDb, key: string, schema: z.ZodType<T>, now: number = Date.now()): Promise<CacheHit<T> | null> {
  cacheFamily(key);
  assertOpen(h);
  const raw = await h.db.get("cache", key);
  if (!raw) return null;
  const entry = CacheEntrySchema.safeParse(raw);
  if (!entry.success) return null;
  const value = schema.safeParse(entry.data.value);
  if (!value.success) return null;
  if (!h.readOnly) {
    // Best effort: failing to record the use must never fail a read.
    try {
      await runTx(h, async (tx) => {
        const cur = await tx.objectStore("cache").get(key);
        if (cur) await tx.objectStore("cache").put({ ...cur, lastAccessedAt: Math.max(cur.lastAccessedAt, now) });
      });
    } catch { /* ignore */ }
  }
  const e = entry.data;
  return { value: value.data, createdAt: e.createdAt, expiresAt: e.expiresAt, expired: e.expiresAt !== null && e.expiresAt <= now, blobIds: e.blobIds };
}

export type PutCacheInput<T> = {
  key: string; value: T; schema: z.ZodType<T>;
  /** Image blobs that belong to this entry (stored deduplicated by hash). */
  blobs?: StoredImage[]; now?: number;
};

/**
 * Store a validated value (plus optional blobs) in one tx, then evict LRU if over the target.
 * Throws AppError STORAGE_FULL when storage stays full after one cleanup and retry; callers
 * treat a failed cache write as non-fatal (the result is only not cached).
 */
export async function putCache<T>(h: DreamDb, input: PutCacheInput<T>): Promise<void> {
  cacheFamily(input.key);
  const value = input.schema.parse(input.value);
  const now = input.now ?? Date.now();
  const blobs = (input.blobs ?? []).map((b) => StoredImageSchema.parse(b));
  const bytes = JSON.stringify(value)?.length ?? 0;
  await writeTx(h, async (tx) => {
    const prev = await tx.objectStore("cache").get(input.key);
    // Replacing an entry: drop the old one first so blobs only it used do not become orphans.
    if (prev) await removeEntries(tx, [prev], await collectReferences(tx));
    const blobIds: string[] = [];
    let newImageBytes = 0;
    for (const b of blobs) {
      const existing = await tx.objectStore("images").index("hash").get(b.hash);
      if (existing) {
        blobIds.push(existing.id);
        continue;
      }
      if (b.blob.size !== b.bytes) throw new Error(`Image ${b.id} says ${b.bytes} bytes but its blob has ${b.blob.size}.`);
      await tx.objectStore("images").put(b);
      blobIds.push(b.id);
      newImageBytes += b.bytes;
    }
    const entry: CacheEntry = {
      key: input.key, blobIds, value, bytes, createdAt: now, lastAccessedAt: now,
      expiresAt: expiresAtFor(input.key, now),
    };
    await tx.objectStore("cache").put(entry);
    await adjustLedger(tx, { cacheBytes: bytes, imageBytes: newImageBytes });
    if (ledgerTotal(await readLedger(tx)) > h.targetBytes) {
      await evictTransient(tx, { now, targetBytes: h.targetBytes, keepKey: input.key });
    }
  });
}
