// Cache keys, expiry, validation, the byte ledger and LRU eviction (SPEC 9), on fake-indexeddb.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  cacheKeys, expiresAtFor, FIT_TTL_MS, getCache, putCache, rebuildLedger, SEARCH_TTL_MS, storageStatus,
  cleanupSafeCache,
} from "@/lib/cache";
import { closeDreamDb, createProject, loadProject, openDreamDb, type DreamDb } from "@/lib/db";
import { freshIndexedDb, hash, makeImage, makeProject } from "./support/idb";

let h: DreamDb;
beforeEach(async () => {
  freshIndexedDb();
  h = await openDreamDb();
});
afterEach(() => closeDreamDb(h));

const Identify = z.object({ make: z.string(), confidence: z.number() }).strict();
const anyValue = z.unknown();

describe("keys", () => {
  it("builds the SPEC 9 key families exactly", () => {
    const a = hash("a"), b = hash("b"), c = hash("c");
    expect(cacheKeys.norm(a)).toBe(`norm:${a}:normalize-v1`);
    expect(cacheKeys.cut(a)).toBe(`cut:${a}:sam-3.1:mask-v1`);
    expect(cacheKeys.parts(a, "fuel tank")).toBe(`parts:${a}:fuel%20tank:mask-v1`);
    expect(cacheKeys.points(a, b)).toBe(`points:${a}:${b}:mask-v1`);
    expect(cacheKeys.identify(a)).toBe(`id:${a}:identify-v1`);
    expect(cacheKeys.instruction(a)).toBe(`instruction:${a}:instruction-v1`);
    expect(cacheKeys.edit({ baseHash: a, referenceHash: null, promptHash: b, quality: "high" })).toBe(`edit:${a}:none:${b}:high:tools-v1`);
    expect(cacheKeys.edit({ baseHash: a, referenceHash: c, promptHash: b, quality: "low" })).toBe(`edit:${a}:${c}:${b}:low:tools-v1`);
    expect(cacheKeys.fit(a)).toBe(`fit:${a}:fit-check-v1`);
    expect(cacheKeys.search(a)).toBe(`search:${a}:search-parts-v1`);
    expect(() => cacheKeys.cut("not-a-hash")).toThrow();
  });

  it("expires search after 1 hour, fit after 24 hours, others never", () => {
    const a = hash("a");
    expect(expiresAtFor(cacheKeys.search(a), 1000)).toBe(1000 + SEARCH_TTL_MS);
    expect(expiresAtFor(cacheKeys.fit(a), 1000)).toBe(1000 + FIT_TTL_MS);
    for (const key of [cacheKeys.identify(a), cacheKeys.cut(a), cacheKeys.norm(a), cacheKeys.instruction(a)]) {
      expect(expiresAtFor(key, 1000)).toBeNull();
    }
    expect(() => expiresAtFor("bogus:x", 1)).toThrow();
  });
});

describe("get and put", () => {
  it("identify result round-trips, so reimporting the same photo does not pay again", async () => {
    const key = cacheKeys.identify(hash("a"));
    expect(await getCache(h, key, Identify)).toBeNull();
    await putCache(h, { key, value: { make: "Harley-Davidson", confidence: 0.8 }, schema: Identify, now: 5 });
    const hit = (await getCache(h, key, Identify, 6))!;
    expect(hit.value).toEqual({ make: "Harley-Davidson", confidence: 0.8 });
    expect(hit.createdAt).toBe(5); // the original date, never a fresh one
    expect(hit.expired).toBe(false);
  });

  it("refuses to store a value that fails its schema and treats a wrongly shaped stored value as a miss", async () => {
    const key = cacheKeys.identify(hash("a"));
    await expect(putCache(h, { key, value: { make: 1 } as never, schema: Identify })).rejects.toThrow();
    expect(await h.db.get("cache", key)).toBeUndefined();
    await putCache(h, { key, value: { make: "x", confidence: 1 }, schema: Identify });
    await h.db.put("cache", { ...(await h.db.get("cache", key))!, value: { make: 5 } });
    expect(await getCache(h, key, Identify)).toBeNull();
    expect(await h.db.get("cache", key)).toBeDefined(); // a miss, not a silent delete
  });

  it("reports expired entries with their original timestamps", async () => {
    const key = cacheKeys.search(hash("a"));
    await putCache(h, { key, value: { n: 1 }, schema: anyValue, now: 1000 });
    expect((await getCache(h, key, anyValue, 1000 + SEARCH_TTL_MS - 1))!.expired).toBe(false);
    const late = (await getCache(h, key, anyValue, 1000 + SEARCH_TTL_MS))!;
    expect(late.expired).toBe(true);
    expect(late.createdAt).toBe(1000);
  });

  it("stores blobs deduplicated by hash and keeps the ledger in step", async () => {
    const img = makeImage("b", 100);
    await putCache(h, { key: cacheKeys.edit({ baseHash: hash("a"), referenceHash: null, promptHash: hash("c"), quality: "high" }), value: { ok: 1 }, schema: anyValue, blobs: [img] });
    await putCache(h, { key: cacheKeys.instruction(hash("d")), value: { ok: 2 }, schema: anyValue, blobs: [{ ...makeImage("b", 100) }] });
    expect(await h.db.count("images")).toBe(1);
    const st = await storageStatus(h);
    expect(st.imageBytes).toBe(100);
    expect(st.cacheBytes).toBeGreaterThan(0);
    expect(await rebuildLedger(h)).toMatchObject({ imageBytes: 100, cacheBytes: st.cacheBytes });
  });
});

describe("eviction", () => {
  it("evicts least recently used transient entries to the target and never project data", async () => {
    closeDreamDb(h);
    h = await openDreamDb({ targetBytes: 600 });
    const made = makeProject("a"); // root image is 10 bytes, protected
    await createProject(h, made);
    const protectedKey = cacheKeys.cut(made.image.hash); // keyed by a shown image: protected
    await putCache(h, { key: protectedKey, value: { pad: "x".repeat(200) }, schema: anyValue, now: 1 });
    const keys = ["d", "e", "f"].map((c) => cacheKeys.instruction(hash(c)));
    for (const [i, key] of keys.entries()) {
      await putCache(h, { key, value: { pad: "y".repeat(150) }, schema: anyValue, now: 10 + i });
    }
    // Touch the oldest so the middle one becomes least recently used.
    await getCache(h, keys[0]!, anyValue, 100);
    await putCache(h, { key: cacheKeys.instruction(hash("1")), value: { pad: "z".repeat(150) }, schema: anyValue, now: 200 });

    const present = async (k: string) => (await h.db.get("cache", k)) !== undefined;
    expect(await present(protectedKey)).toBe(true);
    expect(await present(keys[1]!)).toBe(false); // least recently used went first
    expect(await present(cacheKeys.instruction(hash("1")))).toBe(true); // the new entry is kept
    expect((await storageStatus(h)).totalBytes).toBeLessThanOrEqual(600);
    expect((await loadProject(h, made.project.id))!.versions).toHaveLength(1);
    expect(await h.db.count("images")).toBe(1);
  });

  it("a cache entry whose blob a version uses is protected, an unused blob goes with its entry", async () => {
    const made = makeProject("a");
    await createProject(h, made);
    const used = makeImage("a", made.image.bytes); // same hash as the root image: deduped to it
    const spare = makeImage("c", 30);
    await putCache(h, { key: cacheKeys.norm(hash("d")), value: { v: 1 }, schema: anyValue, blobs: [used] });
    await putCache(h, { key: cacheKeys.edit({ baseHash: hash("a"), referenceHash: null, promptHash: hash("e"), quality: "low" }), value: { v: 2 }, schema: anyValue, blobs: [spare] });
    expect(await h.db.count("images")).toBe(2);
    const evicted = await cleanupSafeCache(h, { all: true });
    expect(evicted).toBe(1);
    expect(await h.db.get("cache", cacheKeys.norm(hash("d")))).toBeDefined();
    expect(await h.db.get("images", made.image.id)).toBeDefined();
    expect(await h.db.get("images", spare.id)).toBeUndefined();
    expect((await storageStatus(h)).imageBytes).toBe(made.image.bytes);
  });

  it("removes expired entries first even when under the target", async () => {
    await putCache(h, { key: cacheKeys.search(hash("a")), value: { n: 1 }, schema: anyValue, now: 0 });
    await putCache(h, { key: cacheKeys.instruction(hash("b")), value: { n: 2 }, schema: anyValue, now: 0 });
    expect(await cleanupSafeCache(h, { now: SEARCH_TTL_MS + 1 })).toBe(1);
    expect(await h.db.get("cache", cacheKeys.search(hash("a")))).toBeUndefined();
    expect(await h.db.get("cache", cacheKeys.instruction(hash("b")))).toBeDefined();
  });
});
