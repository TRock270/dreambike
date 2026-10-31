// IndexedDB layer against fake-indexeddb with a fresh factory per test.
import "fake-indexeddb/auto";
import { openDB } from "idb";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptSheet, acceptVisual, attachFitResponse, attachParts, readCachedFit, closeDreamDb, CorruptRecordError, createProject, deleteProject,
  getLastOpenProject, getStoredImage, moveHead, StorageClosedError, getStoredMask, InvalidWriteError, listProjects, loadProject,
  importProject, openDreamDb, putShopSettings, loadSettings, setProjectSettings, putLogo, removeLogo, snapshotSources, StorageUnavailableError, getShopSettings, ReadOnlyError, redo, setHead, undo, updateBikeRevision,
  type DreamDb, type PreparedAccept,
} from "@/lib/db";
import { cacheKeys, getCache, putCache, rebuildLedger, storageStatus } from "@/lib/cache";
import { AppError } from "@/lib/errors";
import { MOCK_LABEL } from "@/lib/mocks";
import { EXAMPLE_SETTINGS, REAL_SETTINGS_DEFAULT } from "@/lib/quote";
import { activeItems, exportPlan, fitInputCanonical, LEGAL_SEED, sha256OfText, pathFromRoot, projectSnapshot, sheetChild, visualChild, type VisualChildInput } from "@/lib/project";
import type { StoredImage, StoredMask, Version } from "@/lib/types";
import { bikeRevision, freshIndexedDb, hash, makeImage, makeMask, makePart, makeProject, uuid } from "./support/idb";

let h: DreamDb;
beforeEach(async () => {
  freshIndexedDb();
  h = await openDreamDb();
});
afterEach(() => {
  vi.restoreAllMocks();
  closeDreamDb(h);
});

const instruction = (title: string) => ({
  title, editPrompt: `prompt ${title}`, spec: [{ key: "finish", value: "matte" }],
  intent: "paint" as const, warnings: [],
});

/** Build everything acceptVisual needs for a child of `parent`. */
function prepare(parent: Version, slot: Version["items"][number]["slot"], title: string, c: string, t = 10): PreparedAccept & { image: StoredImage; freshMask: StoredMask } {
  const image = makeImage(c);
  const freshMask = makeMask(image.hash);
  const input: VisualChildInput = {
    versionId: uuid(), itemId: uuid(), createdAt: t, slot, mode: "text", instruction: instruction(title),
    image: { id: image.id, hash: image.hash, width: image.width, height: image.height, bytes: image.bytes, rights: "owner" },
    composite: { composed: true, aligned: true, drift: 0.01, reason: "composited" },
    refreshedPart: makePart(slot, freshMask),
  };
  return { version: visualChild(parent, input), image, masks: [freshMask], freshMask };
}

async function setup(c = "a") {
  const made = makeProject(c);
  // Give the root a part with a stored mask so inherited (stale) masks exist.
  const loaded = await createProject(h, made);
  return { ...made, loaded };
}

async function countStores() {
  return {
    versions: await h.db.count("versions"), images: await h.db.count("images"), masks: await h.db.count("masks"),
  };
}

describe("schema and open", () => {
  it("creates exactly the SPEC 9 stores and indexes", () => {
    expect([...h.db.objectStoreNames].sort()).toEqual(["cache", "images", "masks", "meta", "projects", "settings", "versions"]);
    const idx = (s: "projects" | "versions" | "images" | "masks" | "settings" | "cache") =>
      [...h.db.transaction(s).store.indexNames].sort();
    expect(idx("projects")).toEqual(["updatedAt"]);
    expect(idx("versions")).toEqual(["parentId", "projectId"]);
    expect(idx("images")).toEqual(["hash", "lastAccessedAt"]);
    expect(idx("masks")).toEqual(["imageHash"]);
    expect(idx("settings")).toEqual(["updatedAt"]);
    expect(idx("cache")).toEqual(["expiresAt", "lastAccessedAt"]);
    expect(h.readOnly).toBe(false);
  });
});

describe("history", () => {
  it("three accepted edits survive close and reopen", async () => {
    const { project, rootVersion } = await setup();
    const a = prepare(rootVersion, "tank", "Red tank", "b", 10);
    expect((await acceptVisual(h, project.id, rootVersion.id, a)).status).toBe("accepted");
    const b = prepare(a.version, "exhaust", "Short exhaust", "c", 20);
    await acceptVisual(h, project.id, a.version.id, b);
    const c = prepare(b.version, "seat", "Solo seat", "d", 30);
    await acceptVisual(h, project.id, b.version.id, c);

    closeDreamDb(h);
    h = await openDreamDb();
    const loaded = (await loadProject(h, project.id))!;
    expect(loaded.project.headVersionId).toBe(c.version.id);
    const path = pathFromRoot(loaded.versions, loaded.project.headVersionId);
    expect(path.map((v) => v.change?.instruction ?? "root")).toEqual(["root", "Red tank", "Short exhaust", "Solo seat"]);
    expect(activeItems(path[3]!).map((i) => i.slot).sort()).toEqual(["exhaust", "seat", "tank"]);
    const blob = (await getStoredImage(h, path[3]!.image.id))!;
    expect(blob.hash).toBe(c.image.hash);
    expect(blob.blob.size).toBe(c.image.bytes);
    expect((await getStoredMask(h, c.freshMask.id))!.pixels.length).toBe(32);
    expect(await getLastOpenProject(h)).toBe(project.id);
  });

  it("undo restores image ref and items together; redo returns; no node is created", async () => {
    const { project, rootVersion } = await setup();
    const a = prepare(rootVersion, "tank", "Red tank", "b");
    await acceptVisual(h, project.id, rootVersion.id, a);
    const b = prepare(a.version, "exhaust", "Short exhaust", "c", 20);
    await acceptVisual(h, project.id, a.version.id, b);
    const before = await countStores();

    const u = await undo(h, project.id, b.version.id);
    expect(u.status).toBe("moved");
    const l1 = (await loadProject(h, project.id))!;
    const head = l1.versions.find((v) => v.id === l1.project.headVersionId)!;
    expect(head.id).toBe(a.version.id);
    expect(head.image.hash).toBe(a.image.hash);
    expect(activeItems(head).map((i) => i.slot)).toEqual(["tank"]);

    const r = await redo(h, project.id, a.version.id);
    expect(r).toMatchObject({ status: "moved" });
    expect((await loadProject(h, project.id))!.project.headVersionId).toBe(b.version.id);
    expect(await countStores()).toEqual(before);

    expect((await undo(h, project.id, rootVersion.id)).status).toBe("stale_head");
    await setHead(h, project.id, rootVersion.id);
    expect((await undo(h, project.id, rootVersion.id)).status).toBe("at_root");
  });

  it("editing an older node branches; redo then asks which branch", async () => {
    const { project, rootVersion } = await setup();
    const a = prepare(rootVersion, "tank", "Red tank", "b", 10);
    await acceptVisual(h, project.id, rootVersion.id, a);
    await undo(h, project.id, a.version.id);
    const branch = prepare(rootVersion, "tank", "Blue tank", "c", 20);
    const res = await acceptVisual(h, project.id, rootVersion.id, branch);
    expect(res.status).toBe("accepted");

    const loaded = (await loadProject(h, project.id))!;
    expect(loaded.versions).toHaveLength(3);
    const old = loaded.versions.find((v) => v.id === a.version.id)!;
    expect(old).toEqual(a.version); // the old branch is untouched
    expect(loaded.versions.filter((v) => v.parentId === rootVersion.id)).toHaveLength(2);

    await undo(h, project.id, branch.version.id);
    const ask = await redo(h, project.id, rootVersion.id);
    expect(ask.status).toBe("choose_branch");
    if (ask.status === "choose_branch") expect(ask.children.map((v) => v.id)).toEqual([a.version.id, branch.version.id]);
    const picked = await redo(h, project.id, rootVersion.id, a.version.id);
    expect(picked.status).toBe("moved");
    await setHead(h, project.id, rootVersion.id);
    await expect(redo(h, project.id, rootVersion.id, uuid())).rejects.toBeInstanceOf(InvalidWriteError);
  });

  it("same slot edited twice: one active item, two historical change records", async () => {
    const { project, rootVersion } = await setup();
    const a = prepare(rootVersion, "tank", "Red tank", "b", 10);
    await acceptVisual(h, project.id, rootVersion.id, a);
    const b = prepare(a.version, "tank", "Blue tank", "c", 20);
    await acceptVisual(h, project.id, a.version.id, b);
    const { versions, project: p } = (await loadProject(h, project.id))!;
    const head = versions.find((v) => v.id === p.headVersionId)!;
    expect(head.items.map((i) => i.title)).toEqual(["Blue tank"]);
    expect(versions.filter((v) => v.change).map((v) => v.change!.instruction).sort()).toEqual(["Blue tank", "Red tank"]);
    expect(versions.find((v) => v.id === a.version.id)!.items[0]!.title).toBe("Red tank");
  });

  it("refuses a stale expectedHeadId and writes nothing", async () => {
    const { project, rootVersion } = await setup();
    const a = prepare(rootVersion, "tank", "Red tank", "b", 10);
    await acceptVisual(h, project.id, rootVersion.id, a);
    const late = prepare(rootVersion, "exhaust", "Late preview", "c", 20); // rendered for the old head
    const before = await countStores();
    const res = await acceptVisual(h, project.id, rootVersion.id, late);
    expect(res).toEqual({ status: "stale_head", headVersionId: a.version.id });
    expect(await countStores()).toEqual(before);
    expect((await loadProject(h, project.id))!.project.headVersionId).toBe(a.version.id);
    expect(await acceptVisual(h, uuid(), rootVersion.id, late).catch((e) => e)).toBeInstanceOf(InvalidWriteError);
  });

  it("a retry with the same IDs is idempotent (no duplicate version, image, or line)", async () => {
    const { project, rootVersion } = await setup();
    const a = prepare(rootVersion, "tank", "Red tank", "b", 10);
    const first = await acceptVisual(h, project.id, rootVersion.id, a);
    const counts = await countStores();
    const again = await acceptVisual(h, project.id, rootVersion.id, a);
    expect(first).toMatchObject({ status: "accepted", idempotent: false });
    expect(again).toMatchObject({ status: "accepted", idempotent: true });
    expect(await countStores()).toEqual(counts);
    const head = (await loadProject(h, project.id))!.versions.find((v) => v.id === a.version.id)!;
    expect(head.items).toHaveLength(1);
  });

  it("dedupes the image by hash and rewrites version.image.id to the stored one", async () => {
    const { project, rootVersion } = await setup();
    const a = prepare(rootVersion, "tank", "Red tank", "b", 10);
    await acceptVisual(h, project.id, rootVersion.id, a);
    await undo(h, project.id, a.version.id);
    // A branch that produces byte-identical pixels (same hash) under a brand-new image id.
    const same = prepare(rootVersion, "tank", "Red tank again", "b", 20);
    expect(same.image.id).not.toBe(a.image.id);
    const res = await acceptVisual(h, project.id, rootVersion.id, same);
    expect(res.status === "accepted" && res.version.image.id).toBe(a.image.id);
    expect(await h.db.count("images")).toBe(2); // root + one shared "b"
    // Retrying the same prepared data stays idempotent even though the id was rewritten.
    expect(await acceptVisual(h, project.id, rootVersion.id, same)).toMatchObject({ status: "accepted", idempotent: true });
    expect(await h.db.count("versions")).toBe(3);
  });
});

describe("byte ledger", () => {
  it("matches a full recount after create, accept, attach, branch and delete", async () => {
    const { project, rootVersion, image } = await setup();
    const a = prepare(rootVersion, "tank", "Red tank", "b");
    await acceptVisual(h, project.id, rootVersion.id, a);
    const m = makeMask(image.hash);
    await attachParts(h, { versionId: rootVersion.id, imageHash: image.hash, parts: [makePart("seat", m)], masks: [m], bikeMask: makeMask(image.hash) });
    await putCache(h, { key: cacheKeys.identify(image.hash), value: { a: 1 }, schema: schemaAny });
    const live = await storageStatus(h);
    const { imageBytes, maskBytes, cacheBytes } = live;
    expect({ imageBytes, maskBytes, cacheBytes }).toEqual(await rebuildLedger(h));
    expect(imageBytes).toBe(image.bytes + a.image.bytes);
    await deleteProject(h, project.id);
    expect(await storageStatus(h)).toMatchObject({ imageBytes: 0, maskBytes: 0, cacheBytes: 0 });
  });
});

describe("atomicity", () => {
  it("a failure inside acceptVisual keeps the prior head and leaves no orphan version, image or mask", async () => {
    const { project, rootVersion } = await setup();
    const before = await countStores();
    const a = prepare(rootVersion, "tank", "Red tank", "b");
    // Fail only when the project head is written: everything before it must roll back.
    const realPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof realPut>) {
      if (this.name === "projects") throw new Error("injected failure");
      return realPut.apply(this, args);
    });
    await expect(acceptVisual(h, project.id, rootVersion.id, a)).rejects.toThrow("injected failure");
    vi.restoreAllMocks();
    expect(await countStores()).toEqual(before);
    expect((await loadProject(h, project.id))!.project.headVersionId).toBe(rootVersion.id);
    expect(await getStoredMask(h, a.freshMask.id)).toBeNull();
    expect(await h.db.get("images", a.image.id)).toBeUndefined();
    // The same prepared data can be retried afterwards.
    expect((await acceptVisual(h, project.id, rootVersion.id, a)).status).toBe("accepted");
  });

  it("rejects a version whose referenced mask was never stored", async () => {
    const { project, rootVersion } = await setup();
    const a = prepare(rootVersion, "tank", "Red tank", "b");
    await expect(acceptVisual(h, project.id, rootVersion.id, { ...a, masks: [] })).rejects.toBeInstanceOf(InvalidWriteError);
    expect(await h.db.count("versions")).toBe(1);
    expect(await h.db.get("images", a.image.id)).toBeUndefined();
  });
});

describe("attachParts", () => {
  it("attaches parts and bike mask only for the exact image hash; items stay untouched", async () => {
    const { project, rootVersion, image } = await setup();
    const tank = makeMask(image.hash);
    const bike = makeMask(image.hash);
    const res = await attachParts(h, {
      versionId: rootVersion.id, imageHash: image.hash, parts: [makePart("tank", tank)], masks: [tank], bikeMask: bike,
    });
    expect(res.status).toBe("attached");
    const v = (await loadProject(h, project.id))!.versions[0]!;
    expect(v.parts.map((p) => p.maskId)).toEqual([tank.id]);
    expect(v.bikeMaskId).toBe(bike.id);
    expect({ ...v, parts: [], bikeMaskId: null }).toEqual({ ...rootVersion, parts: [], bikeMaskId: null });

    const wrongHash = await attachParts(h, { versionId: rootVersion.id, imageHash: hash("f"), parts: [] });
    expect(wrongHash.status).toBe("image_mismatch");
    expect((await attachParts(h, { versionId: uuid(), imageHash: image.hash })).status).toBe("version_missing");
  });

  it("allows a bike-mask-only update that keeps parts; refuses masks of another image or size", async () => {
    const { project, rootVersion, image } = await setup();
    const tank = makeMask(image.hash);
    await attachParts(h, { versionId: rootVersion.id, imageHash: image.hash, parts: [makePart("tank", tank)], masks: [tank] });
    const bike = makeMask(image.hash);
    await attachParts(h, { versionId: rootVersion.id, imageHash: image.hash, bikeMask: bike });
    const v = (await loadProject(h, project.id))!.versions[0]!;
    expect(v.parts).toHaveLength(1);
    expect(v.bikeMaskId).toBe(bike.id);

    const other = makeMask(hash("e"));
    await expect(attachParts(h, { versionId: rootVersion.id, imageHash: image.hash, parts: [makePart("seat", other)], masks: [other] }))
      .rejects.toBeInstanceOf(InvalidWriteError);
    const small = makeMask(image.hash, 4, 2);
    await expect(attachParts(h, { versionId: rootVersion.id, imageHash: image.hash, bikeMask: small }))
      .rejects.toBeInstanceOf(InvalidWriteError);
    // A stale part may keep an old mask of another image, as long as that mask exists.
    const v2 = (await loadProject(h, project.id))!.versions[0]!;
    expect(v2.bikeMaskId).toBe(bike.id);
  });

  it("drops masks a version no longer uses unless a child version still references them", async () => {
    const { project, rootVersion, image } = await setup();
    const tank = makeMask(image.hash);
    const seat = makeMask(image.hash);
    await attachParts(h, { versionId: rootVersion.id, imageHash: image.hash, parts: [makePart("tank", tank), makePart("seat", seat)], masks: [tank, seat] });
    const root2 = (await loadProject(h, project.id))!.versions[0]!;
    const child = prepare(root2, "tank", "Red tank", "b");
    await acceptVisual(h, project.id, rootVersion.id, child); // seat part inherited as stale with seat.id
    const fresh = makeMask(image.hash);
    await attachParts(h, { versionId: rootVersion.id, imageHash: image.hash, parts: [makePart("tank", fresh)], masks: [fresh] });
    expect(await getStoredMask(h, tank.id)).toBeNull(); // nobody else used it
    expect(await getStoredMask(h, seat.id)).not.toBeNull(); // the child still points at it
  });
});

describe("projects", () => {
  it("lists newest first and reports a damaged record without deleting it", async () => {
    const one = makeProject("a", new Date(2026, 9, 1));
    const two = makeProject("b", new Date(2026, 9, 2));
    await createProject(h, one);
    await createProject(h, two);
    await h.db.put("projects", { id: uuid(), name: 5 } as never);
    const { projects, unreadable } = await listProjects(h);
    expect(projects.map((p) => p.id)).toEqual([two.project.id, one.project.id]);
    expect(unreadable).toHaveLength(1);
    expect(unreadable[0]!.message).toMatch(/left untouched/);
    expect(await h.db.count("projects")).toBe(3);
  });

  it("rejects an invalid persisted version and never deletes it", async () => {
    const { project, rootVersion } = await setup();
    await h.db.put("versions", { ...rootVersion, items: [{ id: "nope" }] } as never);
    await expect(loadProject(h, project.id)).rejects.toBeInstanceOf(CorruptRecordError);
    await expect(loadProject(h, project.id)).rejects.toThrow(/damaged.*left untouched/);
    expect(await h.db.get("versions", rootVersion.id)).toBeDefined();
    expect(await h.db.count("projects")).toBe(1);
  });

  it("rejects a stored image whose blob is a base64 string", async () => {
    const { rootVersion } = await setup();
    await h.db.put("images", { ...(await h.db.get("images", rootVersion.image.id))!, blob: "AAAA" as never });
    await expect(getStoredImage(h, rootVersion.image.id)).rejects.toBeInstanceOf(CorruptRecordError);
  });

  it("rejects a mask with the wrong length or non-binary bytes", async () => {
    const m = makeMask(hash("a"));
    await h.db.put("masks", { ...m, pixels: new Uint8Array(5) });
    await expect(getStoredMask(h, m.id)).rejects.toBeInstanceOf(CorruptRecordError);
    const px = new Uint8Array(32); px[3] = 2;
    await h.db.put("masks", { ...m, pixels: px });
    await expect(getStoredMask(h, m.id)).rejects.toBeInstanceOf(CorruptRecordError);
  });

  it("createProject is one tx and a retry with the same IDs adds nothing", async () => {
    const made = makeProject();
    await createProject(h, made);
    await createProject(h, made);
    expect(await countStores()).toEqual({ versions: 1, images: 1, masks: 0 });
    // Failure after the image and version were written leaves nothing behind.
    const other = makeProject("c");
    const realPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof realPut>) {
      if (this.name === "projects") throw new Error("injected failure");
      return realPut.apply(this, args);
    });
    await expect(createProject(h, other)).rejects.toThrow("injected failure");
    vi.restoreAllMocks();
    expect(await countStores()).toEqual({ versions: 1, images: 1, masks: 0 });
  });

  it("updateBikeRevision stores the confirmed bike at project level", async () => {
    const { project } = await setup();
    const rev = { ...bikeRevision, revision: 2, confirmedAt: 99, bike: { ...bikeRevision.bike, make: "Harley-Davidson" } };
    await updateBikeRevision(h, project.id, rev, 50);
    expect((await loadProject(h, project.id))!.project.bikeRevision.bike.make).toBe("Harley-Davidson");
    await expect(updateBikeRevision(h, project.id, { ...rev, revision: -1 })).rejects.toBeInstanceOf(InvalidWriteError);
  });

  it("deleteProject keeps blobs and masks another project still uses, and drops the rest", async () => {
    const A = makeProject("a");
    const B = makeProject("a"); // same photo: same hash, deduped to one stored image
    await createProject(h, A);
    const lb = await createProject(h, B);
    expect(await h.db.count("images")).toBe(1);
    expect(lb.versions[0]!.image.id).toBe(A.image.id);

    const onlyA = prepare(A.rootVersion, "tank", "Red tank", "b");
    await acceptVisual(h, A.project.id, A.rootVersion.id, onlyA);
    await putCache(h, { key: cacheKeys.identify(hash("b")), value: { x: 1 }, schema: schemaAny });
    await putCache(h, { key: cacheKeys.identify(hash("a")), value: { x: 2 }, schema: schemaAny });

    expect(await deleteProject(h, A.project.id)).toBe(true);
    expect(await h.db.get("images", A.image.id)).toBeDefined(); // B still shows it
    expect(await h.db.get("images", onlyA.image.id)).toBeUndefined();
    expect(await getStoredMask(h, onlyA.freshMask.id)).toBeNull();
    expect(await getCache(h, cacheKeys.identify(hash("b")), schemaAny)).toBeNull(); // no project shows it any more
    expect(await getCache(h, cacheKeys.identify(hash("a")), schemaAny)).not.toBeNull();
    expect((await loadProject(h, B.project.id))!.versions).toHaveLength(1);
    expect(await getLastOpenProject(h)).toBe(B.project.id);

    expect(await deleteProject(h, B.project.id)).toBe(true);
    expect(await countStores()).toEqual({ versions: 0, images: 0, masks: 0 });
    expect(await deleteProject(h, B.project.id)).toBe(false);
  });

  it("stores and validates shop settings", async () => {
    await expect(putShopSettings(h, "default", { shopConfirmed: true } as never, 1)).rejects.toBeInstanceOf(InvalidWriteError);
    expect(await getShopSettings(h, "default")).toBeNull();
  });
});

const schemaAny = z.unknown();

describe("read-only on a newer schema", () => {
  it("opens a version-2 database read-only: list and load work, writes are refused, nothing is deleted", async () => {
    const { project } = await setup();
    closeDreamDb(h);
    // Another build upgrades the database to version 2.
    const v2 = await openDB("dreambike", 2, { upgrade(db) { db.createObjectStore("future"); } });
    v2.close();
    h = await openDreamDb();
    expect(h.readOnly).toBe(true);
    expect(h.readOnlyReason).toMatch(/newer/);
    expect((await listProjects(h)).projects.map((p) => p.id)).toEqual([project.id]);
    expect((await loadProject(h, project.id))!.project.id).toBe(project.id);
    const made = makeProject("c");
    await expect(createProject(h, made)).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(deleteProject(h, project.id)).rejects.toThrow(/read-only|newer/i);
    await expect(setHead(h, project.id, project.rootVersionId)).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(putCache(h, { key: cacheKeys.identify(hash("a")), value: {}, schema: schemaAny })).rejects.toBeInstanceOf(ReadOnlyError);
    expect(await h.db.count("projects")).toBe(1);
  });

  it("opens read-only when meta.schemaVersion is above 1", async () => {
    const { project } = await setup();
    await h.db.put("meta", { key: "schemaVersion", value: 2 });
    closeDreamDb(h);
    h = await openDreamDb();
    expect(h.readOnly).toBe(true);
    expect(await loadProject(h, project.id)).not.toBeNull();
    await expect(setHead(h, project.id, project.rootVersionId)).rejects.toBeInstanceOf(ReadOnlyError);
  });
});

describe("quota", () => {
  function quotaOnProjectPut(times: number) {
    const realPut = IDBObjectStore.prototype.put;
    let left = times;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof realPut>) {
      if (this.name === "projects" && left > 0) {
        left -= 1;
        throw new DOMException("disk full", "QuotaExceededError");
      }
      return realPut.apply(this, args);
    });
  }

  it("evicts unprotected cache entries, retries once with the same IDs, then succeeds", async () => {
    const { project, rootVersion } = await setup();
    await putCache(h, { key: cacheKeys.search(hash("e")), value: { hits: 1 }, schema: schemaAny });
    await putCache(h, { key: cacheKeys.cut(rootVersion.image.hash), value: { cut: 1 }, schema: schemaAny });
    const a = prepare(rootVersion, "tank", "Red tank", "b");
    quotaOnProjectPut(1);
    const res = await acceptVisual(h, project.id, rootVersion.id, a);
    vi.restoreAllMocks();
    expect(res).toMatchObject({ status: "accepted", idempotent: false });
    expect(await getCache(h, cacheKeys.search(hash("e")), schemaAny)).toBeNull(); // transient: evicted
    expect(await getCache(h, cacheKeys.cut(rootVersion.image.hash), schemaAny)).not.toBeNull(); // project image: kept
    expect(await h.db.count("versions")).toBe(2);
  });

  it("throws STORAGE_FULL when the retry also fails; saved projects stay intact", async () => {
    const { project, rootVersion } = await setup();
    const a = prepare(rootVersion, "tank", "Red tank", "b");
    quotaOnProjectPut(5);
    const err = await acceptVisual(h, project.id, rootVersion.id, a).catch((e) => e);
    vi.restoreAllMocks();
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("STORAGE_FULL");
    const loaded = (await loadProject(h, project.id))!;
    expect(loaded.project.headVersionId).toBe(rootVersion.id);
    expect(await countStores()).toEqual({ versions: 1, images: 1, masks: 0 });
  });

  it("recognizes a quota error that arrives as a transaction abort", async () => {
    const { isQuotaError } = await import("@/lib/db");
    expect(isQuotaError(new DOMException("x", "QuotaExceededError"))).toBe(true);
    expect(isQuotaError(Object.assign(new Error("tx"), { cause: new DOMException("x", "QuotaExceededError") }))).toBe(true);
    expect(isQuotaError(Object.assign(new Error("tx"), { error: { name: "QuotaExceededError" } }))).toBe(true);
    expect(isQuotaError(new Error("other"))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });
});

describe("closed connection", () => {
  it("closes when another tab upgrades the database; later calls fail with a reload message", async () => {
    const { project } = await setup();
    const other = await openDB("dreambike", 2, { upgrade(db) { db.createObjectStore("future"); } });
    other.close();
    await expect(listProjects(h)).rejects.toBeInstanceOf(StorageClosedError);
    await expect(loadProject(h, project.id)).rejects.toThrow(/reload the page/);
    await expect(setHead(h, project.id, project.rootVersionId)).rejects.toBeInstanceOf(StorageClosedError);
    expect(await openDB("dreambike", 2).then((d) => { const n = d.count("projects"); d.close(); return n; })).toBe(1);
  });
});

describe("write input validation", () => {
  it("reports caller input as InvalidWriteError, not as a damaged record", async () => {
    const made = makeProject("a");
    const bad = { ...made, project: { ...made.project, name: "" } };
    const err = await createProject(h, bad).catch((e) => e);
    expect(err).toBeInstanceOf(InvalidWriteError);
    expect(err).not.toBeInstanceOf(CorruptRecordError);
    expect(await h.db.count("projects")).toBe(0);
  });

  it("acceptVisual refuses kind sheet", async () => {
    const { project, rootVersion } = await setup();
    const a = prepare(rootVersion, "tank", "Red tank", "b");
    await expect(acceptVisual(h, project.id, rootVersion.id, { ...a, version: { ...a.version, kind: "sheet" } }))
      .rejects.toBeInstanceOf(InvalidWriteError);
    expect((await loadProject(h, project.id))!.project.headVersionId).toBe(rootVersion.id);
  });

  it("acceptVisual refuses a mask the version does not reference and stores nothing", async () => {
    const { project, rootVersion } = await setup();
    const a = prepare(rootVersion, "tank", "Red tank", "b");
    const extra = makeMask(a.image.hash);
    await expect(acceptVisual(h, project.id, rootVersion.id, { ...a, masks: [...a.masks, extra] }))
      .rejects.toThrow(/not used by the version/);
    expect(await countStores()).toEqual({ versions: 1, images: 1, masks: 0 });
  });

  it("attachParts refuses unreferenced masks and bike masks", async () => {
    const { project, rootVersion } = await setup();
    const m = makeMask(rootVersion.image.hash);
    const stray = makeMask(rootVersion.image.hash);
    await expect(attachParts(h, { versionId: rootVersion.id, imageHash: rootVersion.image.hash, parts: [makePart("tank", m)], masks: [m, stray] }))
      .rejects.toBeInstanceOf(InvalidWriteError);
    await expect(attachParts(h, { versionId: rootVersion.id, imageHash: rootVersion.image.hash, masks: [m] }))
      .rejects.toBeInstanceOf(InvalidWriteError);
    expect(await h.db.count("masks")).toBe(0);
    // A bike mask replaced in the same call is fine.
    const bike = makeMask(rootVersion.image.hash);
    const ok = await attachParts(h, { versionId: rootVersion.id, imageHash: rootVersion.image.hash, parts: [makePart("tank", m)], masks: [m], bikeMask: bike });
    expect(ok.status).toBe("attached");
    expect(project.id).toBeTruthy();
  });

  it("refuses a cutout whose size differs from the version image", async () => {
    const { project, rootVersion } = await setup();
    const a = prepare(rootVersion, "tank", "Red tank", "b");
    const cut = { ...makeImage("c"), width: W2, height: H2 };
    await expect(acceptVisual(h, project.id, rootVersion.id, { ...a, version: { ...a.version, cutoutImageId: cut.id }, cutoutImage: cut }))
      .rejects.toThrow(/same size/);
    const m = makeMask(rootVersion.image.hash);
    await expect(attachParts(h, { versionId: rootVersion.id, imageHash: rootVersion.image.hash, cutoutImage: cut }))
      .rejects.toThrow(/same size/);
    expect(m).toBeTruthy();
    expect(await countStores()).toEqual({ versions: 1, images: 1, masks: 0 });
  });

  it("attachParts pauses when protected content alone exceeds the target", async () => {
    const { project, rootVersion } = await setup();
    closeDreamDb(h);
    h = await openDreamDb({ targetBytes: 5 }); // the 10-byte root image is protected
    const m = makeMask(rootVersion.image.hash);
    const err = await attachParts(h, { versionId: rootVersion.id, imageHash: rootVersion.image.hash, parts: [makePart("tank", m)], masks: [m] }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("STORAGE_FULL");
    expect(await h.db.count("masks")).toBe(0);
    expect(project.id).toBeTruthy();
  });
});

const W2 = 4;
const H2 = 2;

describe("same-hash image reuse", () => {
  it("does not reuse or rewrite a damaged same-hash record; the caller's valid image is stored", async () => {
    const { project, rootVersion } = await setup();
    const a = prepare(rootVersion, "tank", "Red tank", "b");
    const damaged = { ...makeImage("b"), bytes: 999 }; // same hash, size lies
    await h.db.put("images", damaged);
    const res = await acceptVisual(h, project.id, rootVersion.id, a);
    expect(res.status).toBe("accepted");
    if (res.status !== "accepted") return;
    expect(res.version.image.id).toBe(a.image.id);
    expect(res.version.image.id).not.toBe(damaged.id);
    expect((await h.db.get("images", damaged.id))!.bytes).toBe(999); // untouched
    expect((await getStoredImage(h, a.image.id))!.bytes).toBe(a.image.bytes);
  });

  it("refuses to overwrite a damaged record that has the caller's own id", async () => {
    const { project, rootVersion } = await setup();
    const a = prepare(rootVersion, "tank", "Red tank", "b");
    await h.db.put("images", { ...a.image, hash: hash("z"), bytes: 1 }); // damaged, different hash, same id
    await expect(acceptVisual(h, project.id, rootVersion.id, a)).rejects.toBeInstanceOf(CorruptRecordError);
    expect((await h.db.get("images", a.image.id))!.bytes).toBe(1);
  });
});

describe("guarded head move", () => {
  it("moveHead refuses when the head is not the expected one", async () => {
    const { project, rootVersion } = await setup();
    const a = prepare(rootVersion, "tank", "Red tank", "b");
    await acceptVisual(h, project.id, rootVersion.id, a);
    const stale = await moveHead(h, project.id, rootVersion.id, a.version.id);
    expect(stale).toEqual({ status: "stale_head" });
    const ok = await moveHead(h, project.id, a.version.id, rootVersion.id);
    expect(ok.status).toBe("moved");
  });
});

describe("quota as a transaction abort", () => {
  it("retries exactly once when QuotaExceededError arrives through tx.done", async () => {
    const { project, rootVersion } = await setup();
    const a = prepare(rootVersion, "tank", "Red tank", "b");
    const realPut = IDBObjectStore.prototype.put;
    let attempts = 0;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof realPut>) {
      if (this.name === "projects") {
        attempts += 1;
        // The browser aborts the tx with a quota error; the request itself only sees an abort.
        Object.defineProperty(this.transaction, "error", { value: new DOMException("disk full", "QuotaExceededError") });
        this.transaction.abort();
      }
      return realPut.apply(this, args);
    });
    const err = await acceptVisual(h, project.id, rootVersion.id, a).catch((e) => e);
    vi.restoreAllMocks();
    expect(attempts).toBe(2);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("STORAGE_FULL");
    expect((await loadProject(h, project.id))!.project.headVersionId).toBe(rootVersion.id);
  });
});

describe("acceptSheet", () => {
  const retitled = (v: Version, title: string) => v.items.map((i) => ({ ...i, title }));
  const sheetOf = (parent: Version, title: string, t = 50) =>
    sheetChild(parent, { versionId: uuid(), createdAt: t, items: retitled(parent, title), fees: [] });

  async function withVisual() {
    const s = await setup();
    const a = prepare(s.rootVersion, "tank", "Red tank", "b", 10);
    await acceptVisual(h, s.project.id, s.rootVersion.id, a);
    return { ...s, a };
  }

  it("accepts a sheet version; undo restores the parent's sheet and redo brings it back; no blobs are written", async () => {
    const { project, a } = await withVisual();
    const before = await countStores();
    const sheet = sheetOf(a.version, "Renamed");
    const res = await acceptSheet(h, project.id, a.version.id, sheet);
    expect(res).toMatchObject({ status: "accepted", idempotent: false });
    const after = await countStores();
    expect(after).toEqual({ ...before, versions: before.versions + 1 });
    expect((await loadProject(h, project.id))!.project.headVersionId).toBe(sheet.id);

    await undo(h, project.id, sheet.id);
    const loaded = (await loadProject(h, project.id))!;
    expect(loaded.project.headVersionId).toBe(a.version.id);
    expect(loaded.versions.find((v) => v.id === a.version.id)!.items[0]!.title).not.toBe("Renamed");
    await redo(h, project.id, a.version.id);
    const back = (await loadProject(h, project.id))!;
    expect(back.project.headVersionId).toBe(sheet.id);
    expect(back.versions.find((v) => v.id === sheet.id)!.items[0]!.title).toBe("Renamed");
  });

  it("refuses a stale head and writes nothing; project_missing for an unknown project", async () => {
    const { project, rootVersion, a } = await withVisual();
    const late = sheetOf(rootVersion, "Late");
    const before = await countStores();
    expect(await acceptSheet(h, project.id, rootVersion.id, late)).toEqual({ status: "stale_head", headVersionId: a.version.id });
    expect(await countStores()).toEqual(before);
    const orphan = { ...late, projectId: uuid() };
    expect(await acceptSheet(h, orphan.projectId, rootVersion.id, orphan)).toEqual({ status: "project_missing" });
  });

  it("a retry with the same version id writes one version; stale once the head moved on", async () => {
    const { project, a } = await withVisual();
    const sheet = sheetOf(a.version, "Once");
    await acceptSheet(h, project.id, a.version.id, sheet);
    const n = (await countStores()).versions;
    expect(await acceptSheet(h, project.id, a.version.id, sheet)).toMatchObject({ status: "accepted", idempotent: true });
    expect((await countStores()).versions).toBe(n);
    await undo(h, project.id, sheet.id);
    expect((await acceptSheet(h, project.id, a.version.id, sheet)).status).toBe("stale_head");
    const other = { ...sheet, parentId: uuid() };
    await expect(acceptSheet(h, project.id, other.parentId!, other)).rejects.toBeInstanceOf(InvalidWriteError);
  });

  it("refuses a different image ref, a non-sheet kind and a wrong parent", async () => {
    const { project, a, rootVersion } = await withVisual();
    const sheet = sheetOf(a.version, "X");
    const otherImage = { ...sheet, image: { ...sheet.image, id: uuid() } };
    await expect(acceptSheet(h, project.id, a.version.id, otherImage)).rejects.toBeInstanceOf(InvalidWriteError);
    const rights = { ...sheet, image: { ...sheet.image, rights: "visitor" as const } };
    await expect(acceptSheet(h, project.id, a.version.id, rights)).rejects.toBeInstanceOf(InvalidWriteError);
    await expect(acceptSheet(h, project.id, a.version.id, { ...sheet, kind: "visual" })).rejects.toBeInstanceOf(InvalidWriteError);
    await expect(acceptSheet(h, project.id, rootVersion.id, sheet)).rejects.toBeInstanceOf(InvalidWriteError);
    expect((await loadProject(h, project.id))!.project.headVersionId).toBe(a.version.id);
  });

  it("takes parts and bike mask from the stored parent, not from the caller's older copy", async () => {
    const { project, a, image } = await withVisual();
    const sheet = sheetOf(a.version, "Race"); // built from the copy without the new parts
    const seat = makeMask(a.image.hash);
    const bike = makeMask(a.image.hash);
    await attachParts(h, { versionId: a.version.id, imageHash: a.image.hash, parts: [makePart("seat", seat)], masks: [seat], bikeMask: bike });
    const res = await acceptSheet(h, project.id, a.version.id, sheet);
    expect(res.status).toBe("accepted");
    const stored = (await loadProject(h, project.id))!.versions.find((v) => v.id === sheet.id)!;
    expect(stored.parts.map((p) => p.maskId)).toContain(seat.id);
    expect(stored.bikeMaskId).toBe(bike.id);
    expect(image.hash).not.toBe(a.image.hash);
  });

  it("the shared image counts once and survives enforceTarget", async () => {
    closeDreamDb(h);
    h = await openDreamDb({ targetBytes: 500 }); // tight: only the two images and masks fit
    const { project, a, image } = await withVisual();
    const sheet = sheetOf(a.version, "Shared");
    const live0 = await storageStatus(h);
    await acceptSheet(h, project.id, a.version.id, sheet);
    const live = await storageStatus(h);
    expect(live.imageBytes).toBe(live0.imageBytes);
    expect(live.imageBytes).toBe(image.bytes + a.image.bytes);
    expect(await getStoredImage(h, a.image.id)).not.toBeNull();
    expect(await getStoredImage(h, image.id)).not.toBeNull();
    const { imageBytes, maskBytes, cacheBytes } = live;
    expect({ imageBytes, maskBytes, cacheBytes }).toEqual(await rebuildLedger(h));
  });
});

// ------------------------------------------------------- import project (OF1)

/** Folder contents as the reader would hand them to importProject. */
type Folder = { snapshot: unknown; blobs: Map<string, Blob>; pixels: Map<string, Uint8Array>; digest: (b: Blob) => Promise<string> };

let lastDigest: (b: Blob) => Promise<string> = async () => "unknown";

async function folderOf(projectId: string): Promise<Folder> {
  const src = await snapshotSources(h, projectId);
  if (!src) throw new Error("project missing");
  const plan = exportPlan({ project: src.project, versions: src.versions, headId: src.project.headVersionId, exportedAt: "t" });
  const snap = projectSnapshot({ ...src, plan });
  if (!snap.complete) throw new Error(snap.reason);
  const blobs = new Map<string, Blob>();
  const hashOfBlob = new Map<Blob, string>(); // fixtures carry fake hashes, so the digest is looked up
  for (const f of snap.imageFiles) {
    const stored = (await getStoredImage(h, f.imageId))!;
    blobs.set(f.imageId, stored.blob);
    hashOfBlob.set(stored.blob, stored.hash);
  }
  const pixels = new Map<string, Uint8Array>();
  for (const f of snap.maskFiles) pixels.set(f.maskId, (await getStoredMask(h, f.maskId))!.pixels);
  // Through JSON, exactly like a real project.json on disk.
  lastDigest = async (b) => hashOfBlob.get(b) ?? "unknown";
  return { snapshot: JSON.parse(snap.json), blobs, pixels, digest: lastDigest };
}

/** root -> v1 (tank) -> v2 (exhaust, with bike mask + cutout) -> sheet; plus a branch v1b off v1. */
async function richProject() {
  const { project, rootVersion } = await setup("a");
  const a = prepare(rootVersion, "tank", "Red tank", "b", 10);
  await acceptVisual(h, project.id, rootVersion.id, a);
  const b = prepare(a.version, "exhaust", "Short exhaust", "c", 20);
  await acceptVisual(h, project.id, a.version.id, b);
  const bikeMask = makeMask(hash("c"));
  const cutout = makeImage("e");
  await attachParts(h, { versionId: b.version.id, imageHash: hash("c"), bikeMask, cutoutImage: cutout });
  const v2 = (await loadProject(h, project.id))!.versions.find((v) => v.id === b.version.id)!;
  const items = v2.items.map((i) => ({ ...i, partPriceCents: 11900, laborMinutes: 30 }));
  const fee = { id: uuid(), label: "Aenderungsabnahme", kind: "aenderungsabnahme" as const, netCents: 10000, itemIds: [], confirmed: true };
  const sheet = sheetChild(v2, { versionId: uuid(), createdAt: 30, items, fees: [fee] });
  await acceptSheet(h, project.id, v2.id, sheet);
  // A branch: go back to v1 and accept another edit there.
  await setHead(h, project.id, a.version.id);
  const branch = prepare(a.version, "seat", "Brown seat", "d", 40);
  await acceptVisual(h, project.id, a.version.id, branch);
  await setHead(h, project.id, sheet.id);
  return { project, root: rootVersion, v1: a.version, v2, sheet, branch: branch.version, bikeMask, cutout };
}

async function ledgerOf(): Promise<unknown> {
  return (await h.db.get("meta", "ledger"))?.value;
}

describe("importProject", () => {
  it("round trips head, tree, items, fees, bike revision, images and masks, and undo works", async () => {
    const r = await richProject();
    const before = (await loadProject(h, r.project.id))!;
    const folder = await folderOf(r.project.id);
    const imageBytes = new Map<string, Uint8Array>();
    for (const v of before.versions) imageBytes.set(v.image.id, new Uint8Array(await (await getStoredImage(h, v.image.id))!.blob.arrayBuffer()));
    const maskBefore = (await getStoredMask(h, r.bikeMask.id))!;
    expect(await deleteProject(h, r.project.id)).toBe(true);
    expect(await countStores()).toEqual({ versions: 0, images: 0, masks: 0 });

    const res = await importProject(h, folder.snapshot, folder.blobs, folder.pixels, 99, folder.digest);
    expect(res.status).toBe("imported");
    const after = (await loadProject(h, r.project.id))!;
    expect(after.project).toEqual(before.project);
    expect(after.project.bikeRevision.confirmed).toBe(true);
    const sort = (vs: Version[]) => [...vs].sort((x, y) => x.id.localeCompare(y.id));
    expect(sort(after.versions)).toEqual(sort(before.versions));
    expect(after.versions.find((v) => v.id === r.sheet.id)!.fees).toHaveLength(1);
    expect(after.versions.some((v) => v.parts.some((p) => p.stale))).toBe(true);
    for (const v of before.versions) {
      const img = (await getStoredImage(h, v.image.id))!;
      expect(new Uint8Array(await img.blob.arrayBuffer())).toEqual(imageBytes.get(v.image.id));
      expect(img.lastAccessedAt).toBe(99);
    }
    expect(await getStoredMask(h, r.bikeMask.id)).toEqual(maskBefore);
    expect(await getStoredImage(h, r.cutout.id)).not.toBeNull();
    await rebuildLedger(h);
    // Undo, then redo, on the imported project.
    const u = await undo(h, r.project.id, r.sheet.id);
    expect(u.status).toBe("moved");
    const rd = await redo(h, r.project.id, r.v2.id);
    expect(rd.status).toBe("moved");
    expect(after.project.headVersionId).toBe(r.sheet.id);
  });

  it("refuses a project whose settingsId is not default or example, before any write", async () => {
    const r = await richProject();
    const folder = await folderOf(r.project.id);
    await deleteProject(h, r.project.id);
    const snap = structuredClone(folder.snapshot) as { project: { settingsId: string } };
    snap.project.settingsId = "shop2";
    const res = await importProject(h, snap, folder.blobs, folder.pixels, undefined, folder.digest);
    expect(res.status).toBe("refused");
    expect(await countStores()).toEqual({ versions: 0, images: 0, masks: 0 });
  });

  it("keeps the ledger consistent with a rebuild", async () => {
    const r = await richProject();
    const folder = await folderOf(r.project.id);
    await deleteProject(h, r.project.id);
    await importProject(h, folder.snapshot, folder.blobs, folder.pixels, undefined, folder.digest);
    const ledger = await ledgerOf();
    await rebuildLedger(h);
    expect(await ledgerOf()).toEqual(ledger);
  });

  it("remaps image ids when another project already stores the same photo", async () => {
    const r = await richProject();
    const folder = await folderOf(r.project.id);
    await deleteProject(h, r.project.id);
    // Another project with the same root photo hash "a" but a different image id.
    const other = makeProject("a");
    const otherLoaded = await createProject(h, other);
    const res = await importProject(h, folder.snapshot, folder.blobs, folder.pixels, undefined, folder.digest);
    expect(res.status).toBe("imported");
    const loaded = (await loadProject(h, r.project.id))!;
    const root = loaded.versions.find((v) => v.id === r.root.id)!;
    expect(root.image.id).toBe(otherLoaded.versions[0]!.image.id);
    expect(await getStoredImage(h, root.image.id)).not.toBeNull();
    expect((await loadProject(h, other.project.id))!.versions).toHaveLength(1);
  });

  it("refuses an existing project id and writes nothing", async () => {
    const r = await richProject();
    const folder = await folderOf(r.project.id);
    const counts = await countStores();
    const res = await importProject(h, folder.snapshot, folder.blobs, folder.pixels, undefined, folder.digest);
    expect(res).toMatchObject({ status: "refused", reason: "project_exists" });
    expect(res.status === "refused" && res.message).toContain("already in this browser");
    expect(await countStores()).toEqual(counts);
  });

  it("refuses a version id that belongs to another project", async () => {
    const r = await richProject();
    const folder = await folderOf(r.project.id);
    const snap = structuredClone(folder.snapshot) as { project: { id: string }; versions: { projectId: string }[] };
    const newPid = uuid();
    snap.project.id = newPid;
    for (const v of snap.versions) v.projectId = newPid;
    const counts = await countStores();
    const res = await importProject(h, snap, folder.blobs, folder.pixels, undefined, folder.digest);
    expect(res).toMatchObject({ status: "refused", reason: "version_exists" });
    expect(await countStores()).toEqual(counts);
    expect(await h.db.get("projects", newPid)).toBeUndefined();
    // The original project's versions are untouched.
    expect((await loadProject(h, r.project.id))!.versions.find((v) => v.id === r.root.id)!.projectId).toBe(r.project.id);
  });

  describe("refusals before any write", () => {
    async function emptyFolder() {
      const r = await richProject();
      const folder = await folderOf(r.project.id);
      await deleteProject(h, r.project.id);
      return { r, folder };
    }
    const clone = <T,>(x: T): T => structuredClone(x);
    type Snap = { project: { headVersionId: string; rootVersionId: string }; versions: { id: string; parentId: string | null; projectId: string; kind: string }[]; images: { id: string }[]; masks: { id: string }[] };

    async function expectRefused(snap: unknown, blobs: Map<string, Blob>, pixels: Map<string, Uint8Array>, reason: string) {
      const res = await importProject(h, snap, blobs, pixels, undefined, lastDigest);
      expect(res).toMatchObject({ status: "refused", reason });
      expect(await countStores()).toEqual({ versions: 0, images: 0, masks: 0 });
      expect(await h.db.count("projects")).toBe(0);
    }

    it("a missing image file", async () => {
      const { folder } = await emptyFolder();
      const blobs = new Map(folder.blobs);
      blobs.delete((folder.snapshot as Snap).images[0]!.id);
      await expectRefused(folder.snapshot, blobs, folder.pixels, "missing_image");
    });
    it("a wrong blob size", async () => {
      const { folder } = await emptyFolder();
      const blobs = new Map(folder.blobs);
      blobs.set((folder.snapshot as Snap).images[0]!.id, new Blob([new Uint8Array(3)]));
      await expectRefused(folder.snapshot, blobs, folder.pixels, "bad_image");
    });
    it("a missing mask file", async () => {
      const { folder } = await emptyFolder();
      const pixels = new Map(folder.pixels);
      pixels.delete((folder.snapshot as Snap).masks[0]!.id);
      await expectRefused(folder.snapshot, folder.blobs, pixels, "missing_mask");
    });
    it("a mask with the wrong length", async () => {
      const { folder } = await emptyFolder();
      const pixels = new Map(folder.pixels);
      pixels.set((folder.snapshot as Snap).masks[0]!.id, new Uint8Array(5));
      await expectRefused(folder.snapshot, folder.blobs, pixels, "bad_mask");
    });
    it("a mask byte of 2", async () => {
      const { folder } = await emptyFolder();
      const pixels = new Map(folder.pixels);
      const id = (folder.snapshot as Snap).masks[0]!.id;
      const bad = new Uint8Array(pixels.get(id)!);
      bad[3] = 2;
      pixels.set(id, bad);
      await expectRefused(folder.snapshot, folder.blobs, pixels, "bad_mask");
    });
    it("a mask not listed in the snapshot", async () => {
      const { folder } = await emptyFolder();
      const snap = clone(folder.snapshot) as Snap;
      snap.masks = snap.masks.slice(1);
      await expectRefused(snap, folder.blobs, folder.pixels, "missing_mask");
    });
    it("an image or mask that no version uses", async () => {
      const { folder } = await emptyFolder();
      const extraImage = clone(folder.snapshot) as Snap & { images: { id: string; file: string }[] };
      extraImage.images.push({ ...extraImage.images[0]!, id: uuid(), file: "99-extra.webp" });
      const blobs = new Map(folder.blobs);
      blobs.set(extraImage.images[extraImage.images.length - 1]!.id, folder.blobs.get(extraImage.images[0]!.id)!);
      await expectRefused(extraImage, blobs, folder.pixels, "invalid_snapshot");
      const extraMask = clone(folder.snapshot) as Snap & { masks: { id: string }[] };
      const id = uuid();
      extraMask.masks.push({ ...extraMask.masks[0]!, id });
      const pixels = new Map(folder.pixels);
      pixels.set(id, folder.pixels.get(extraMask.masks[0]!.id)!);
      await expectRefused(extraMask, folder.blobs, pixels, "invalid_snapshot");
    });
    it("same-size bytes that do not match the saved hash, with the real sha256", async () => {
      const { folder } = await emptyFolder();
      // Rewrite every fake fixture hash to the real sha256 of its blob, consistently across the JSON.
      let text = JSON.stringify(folder.snapshot);
      for (const img of (folder.snapshot as { images: { id: string; hash: string }[] }).images) {
        const bytes = new Uint8Array(await folder.blobs.get(img.id)!.arrayBuffer());
        const real = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
        text = text.split(img.hash).join(real);
      }
      const snap = JSON.parse(text) as Snap & { images: { id: string }[] };
      const first = snap.images[0]!.id;
      const original = folder.blobs.get(first)!;
      const damaged = new Blob([new Uint8Array(original.size).fill(7)]);
      const blobs = new Map(folder.blobs);
      blobs.set(first, damaged);
      await expectRefused(snap, blobs, folder.pixels, "bad_image");
      // The untouched files import with the default (real) digest.
      expect((await importProject(h, snap, folder.blobs, folder.pixels)).status).toBe("imported");
    });
    it("a cycle", async () => {
      const { folder } = await emptyFolder();
      const snap = clone(folder.snapshot) as Snap;
      const leaf = snap.versions.find((v) => v.kind === "sheet")!;
      const parent = snap.versions.find((v) => v.id === leaf.parentId)!;
      const grand = snap.versions.find((v) => v.id === parent.parentId)!;
      grand.parentId = leaf.id; // leaf -> parent -> grand -> leaf
      await expectRefused(snap, folder.blobs, folder.pixels, "invalid_history");
    });
    it("a foreign root", async () => {
      const { folder } = await emptyFolder();
      const snap = clone(folder.snapshot) as Snap;
      snap.project.rootVersionId = uuid();
      await expectRefused(snap, folder.blobs, folder.pixels, "invalid_history");
    });
    it("a head outside the project", async () => {
      const { folder } = await emptyFolder();
      const snap = clone(folder.snapshot) as Snap;
      snap.project.headVersionId = uuid();
      await expectRefused(snap, folder.blobs, folder.pixels, "invalid_history");
    });
    it("a version of another project", async () => {
      const { folder } = await emptyFolder();
      const snap = clone(folder.snapshot) as Snap;
      snap.versions[0]!.projectId = uuid();
      await expectRefused(snap, folder.blobs, folder.pixels, "invalid_history");
    });
    it("an invalid or unknown-version snapshot", async () => {
      const { folder } = await emptyFolder();
      await expectRefused({ ...(folder.snapshot as object), formatVersion: 2 }, folder.blobs, folder.pixels, "invalid_snapshot");
      await expectRefused({ ...(folder.snapshot as object), extra: 1 }, folder.blobs, folder.pixels, "invalid_snapshot");
      await expectRefused(null, folder.blobs, folder.pixels, "invalid_snapshot");
      const snap = clone(folder.snapshot) as Snap & { images: { file: string }[] };
      snap.images[0]!.file = "../evil.webp";
      await expectRefused(snap, folder.blobs, folder.pixels, "invalid_snapshot");
      snap.images[0]!.file = "a/b.webp";
      await expectRefused(snap, folder.blobs, folder.pixels, "invalid_snapshot");
    });
  });

  it("a failure inside the transaction leaves nothing behind", async () => {
    const r = await richProject();
    const folder = await folderOf(r.project.id);
    await deleteProject(h, r.project.id);
    // Keep another project so the ledger is not zero, then try again with a tiny target.
    const keep = await createProject(h, makeProject("f"));
    const before = { counts: await countStores(), ledger: await ledgerOf(), projects: await h.db.count("projects") };
    const small = await openDreamDb({ targetBytes: 5 });
    try {
      await expect(importProject(small, folder.snapshot, folder.blobs, folder.pixels, undefined, folder.digest)).rejects.toMatchObject({ code: "STORAGE_FULL" });
    } finally {
      closeDreamDb(small);
    }
    expect({ counts: await countStores(), ledger: await ledgerOf(), projects: await h.db.count("projects") }).toEqual(before);
    expect(await loadProject(h, r.project.id)).toBeNull();
    expect(await loadProject(h, keep.project.id)).not.toBeNull();
  });
});

describe("openDreamDb failures", () => {
  it("keeps the original error name in the message", async () => {
    const err = Object.assign(new Error("Connection to Indexed Database server lost."), { name: "UnknownError" });
    const real = indexedDB.open.bind(indexedDB);
    vi.spyOn(indexedDB, "open").mockImplementation(() => { throw err; });
    await expect(openDreamDb()).rejects.toSatisfy((e: unknown) =>
      e instanceof StorageUnavailableError && e.message.includes("UnknownError: Connection to Indexed Database server lost."));
    vi.restoreAllMocks();
    expect(real).toBeTypeOf("function");
  });
});

describe("attachFitResponse", () => {
  const fit = (itemId: string) => ({
    itemId, status: "verify" as const, approval: "unknown" as const, documentCoverage: "unknown" as const,
    inspection: "unknown" as const, eintragung: "unknown" as const, carryDocuments: "unknown" as const,
    reasons: ["Unknown."], toMeasure: [], extraParts: [], conditions: [], sources: [], confidence: 0.3,
  });
  async function fitSetup() {
    const s = await setup();
    const a = prepare(s.rootVersion, "tank", "Red tank", "b", 10);
    await acceptVisual(h, s.project.id, s.rootVersion.id, a);
    const version = (await loadProject(h, s.project.id))!.versions.find((v) => v.id === a.version.id)!;
    const canonical = fitInputCanonical(s.project.bikeRevision, version.items, [], LEGAL_SEED.version);
    const inputHash = await sha256OfText(canonical);
    const response = { inputHash, checkedAt: "2026-10-29T10:00:00.000Z", results: [fit(version.items[0]!.id)] };
    return { ...s, version, canonical, inputHash, response };
  }

  it("attaches to the exact version, caches the response, creates no version and keeps the head", async () => {
    const f = await fitSetup();
    const before = (await loadProject(h, f.project.id))!;
    const r = await attachFitResponse(h, { projectId: f.project.id, versionId: f.version.id, canonical: f.canonical, response: f.response });
    expect(r).toEqual({ status: "attached", attachedItemIds: [f.version.items[0]!.id], cached: true });
    const after = (await loadProject(h, f.project.id))!;
    expect(after.versions).toHaveLength(before.versions.length);
    expect(after.project.headVersionId).toBe(before.project.headVersionId);
    const item = after.versions.find((v) => v.id === f.version.id)!.items[0]!;
    expect(item).toMatchObject({ fitInputHash: f.inputHash, fitCheckedAt: f.response.checkedAt, fitReviewedHash: null });
    expect(item.fit?.status).toBe("verify");
    expect(await getCache(h, cacheKeys.fit(f.inputHash), z.unknown())).not.toBeNull();
  });

  it("a recheck clears an earlier mechanic acknowledgment", async () => {
    const f = await fitSetup();
    const reviewedItems = f.version.items.map((i) => ({ ...i, fitReviewedHash: "a".repeat(64) }));
    const sheet = sheetChild(f.version, { versionId: uuid(), createdAt: 50, items: reviewedItems, fees: [] });
    expect((await acceptSheet(h, f.project.id, f.version.id, sheet)).status).toBe("accepted");
    const r = await attachFitResponse(h, { projectId: f.project.id, versionId: sheet.id, canonical: f.canonical, response: f.response });
    expect(r.status).toBe("attached");
    const item = (await loadProject(h, f.project.id))!.versions.find((v) => v.id === sheet.id)!.items[0]!;
    expect(item.fitInputHash).toBe(f.inputHash);
    expect(item.fitReviewedHash).toBeNull();
  });

  it("a late response whose canonical no longer matches stays cache only", async () => {
    const f = await fitSetup();
    // The bike was corrected after the request went out.
    const revision = { ...f.project.bikeRevision, revision: f.project.bikeRevision.revision + 1 };
    await updateBikeRevision(h, f.project.id, revision);
    const before = (await loadProject(h, f.project.id))!;
    const r = await attachFitResponse(h, { projectId: f.project.id, versionId: f.version.id, canonical: f.canonical, response: f.response });
    expect(r).toMatchObject({ status: "cache_only", reason: "input_changed", attachedItemIds: [], cached: true });
    const after = (await loadProject(h, f.project.id))!;
    expect(after.project.headVersionId).toBe(before.project.headVersionId);
    expect(after.versions.find((v) => v.id === f.version.id)!.items[0]!.fit).toBeNull();
    expect(await getCache(h, cacheKeys.fit(f.inputHash), z.unknown())).not.toBeNull();
  });

  it("a result for a version that is no longer the head stays cache only and leaves that version untouched", async () => {
    const f = await fitSetup();
    const b = prepare(f.version, "seat", "Seat", "c", 11);
    await acceptVisual(h, f.project.id, f.version.id, b);
    const before = (await loadProject(h, f.project.id))!;
    expect(before.project.headVersionId).not.toBe(f.version.id);
    const r = await attachFitResponse(h, { projectId: f.project.id, versionId: f.version.id, canonical: f.canonical, response: f.response });
    expect(r).toMatchObject({ status: "cache_only", reason: "not_head", attachedItemIds: [], cached: true });
    const after = (await loadProject(h, f.project.id))!;
    expect(after.versions.find((v) => v.id === f.version.id)).toEqual(before.versions.find((v) => v.id === f.version.id));
    expect(after.project.headVersionId).toBe(before.project.headVersionId);
  });

  it("two batches with the same hash both stay in the cache", async () => {
    const f = await fitSetup();
    const second = { ...f.response, results: [fit(uuid())] };
    await attachFitResponse(h, { projectId: f.project.id, versionId: f.version.id, canonical: f.canonical, response: f.response });
    await attachFitResponse(h, { projectId: f.project.id, versionId: f.version.id, canonical: f.canonical, response: second });
    const hit = await getCache(h, cacheKeys.fit(f.inputHash), z.object({ results: z.array(z.object({ result: z.object({ itemId: z.string() }) })) }));
    expect(hit!.value.results.map((x) => x.result.itemId).sort()).toEqual([f.version.items[0]!.id, second.results[0]!.itemId].sort());
  });

  describe("readCachedFit", () => {
    const T1 = "2026-10-29T10:00:00.000Z";
    const T2 = "2026-10-29T15:00:00.000Z";
    const at = (iso: string, plusMs = 0) => Date.parse(iso) + plusMs;
    const HOUR = 3600_000;
    const put = async (hash: string, ids: string[], checkedAt: string, reasons = ["Unknown."]) => {
      const response = { inputHash: hash, checkedAt, results: ids.map((id) => ({ ...fit(id), reasons })) };
      return response;
    };
    // Cache directly through the real merge path: attachFitResponse needs a matching canonical.
    async function cacheBatch(f: Awaited<ReturnType<typeof fitSetup>>, ids: string[], checkedAt: string, reasons?: string[]) {
      const response = await put(f.inputHash, ids, checkedAt, reasons);
      await attachFitResponse(h, { projectId: f.project.id, versionId: f.version.id, canonical: f.canonical, response });
    }

    it("hit returns the original checkedAt and the ids in the requested order", async () => {
      const f = await fitSetup();
      const [a, b] = [uuid(), uuid()];
      await cacheBatch(f, [a, b], T1);
      const r = await readCachedFit(h, f.inputHash, [b, a], at(T1, HOUR));
      expect(r!.checkedAt).toBe(T1);
      expect(r!.results.map((x) => x.itemId)).toEqual([b, a]);
    });

    it("misses when an id is missing, the list is empty or longer than 3, or the hash differs", async () => {
      const f = await fitSetup();
      const a = uuid();
      await cacheBatch(f, [a], T1);
      expect(await readCachedFit(h, f.inputHash, [a, uuid()], at(T1, HOUR))).toBeNull();
      expect(await readCachedFit(h, f.inputHash, [], at(T1, HOUR))).toBeNull();
      expect(await readCachedFit(h, f.inputHash, [a, a, a, a], at(T1, HOUR))).toBeNull();
      expect(await readCachedFit(h, await sha256OfText("other"), [a], at(T1, HOUR))).toBeNull();
    });

    it("misses when any selected result is mock-labelled", async () => {
      const f = await fitSetup();
      const [real, mock] = [uuid(), uuid()];
      await cacheBatch(f, [real], T1);
      await cacheBatch(f, [mock], T1, [`${MOCK_LABEL} (example)`]);
      expect(await readCachedFit(h, f.inputHash, [real], at(T1, HOUR))).not.toBeNull();
      expect(await readCachedFit(h, f.inputHash, [real, mock], at(T1, HOUR))).toBeNull();
    });

    it("misses past 24 h from checkedAt, also after a re-put renewed expiresAt", async () => {
      const f = await fitSetup();
      const [a, b] = [uuid(), uuid()];
      await cacheBatch(f, [a], T1);
      expect(await readCachedFit(h, f.inputHash, [a], at(T1, 25 * HOUR))).toBeNull();
      // A later batch re-puts the entry now, which renews the entry expiry but not a's checkedAt.
      vi.useFakeTimers({ toFake: ["Date"], now: at(T1, 23 * HOUR) });
      try { await cacheBatch(f, [b], "2026-10-30T09:00:00.000Z"); } finally { vi.useRealTimers(); }
      expect(await readCachedFit(h, f.inputHash, [b], at(T1, 25 * HOUR))).not.toBeNull();
      expect(await readCachedFit(h, f.inputHash, [a], at(T1, 25 * HOUR))).toBeNull();
      expect(await readCachedFit(h, f.inputHash, [a, b], at(T1, 25 * HOUR))).toBeNull();
    });

    it("keeps each batch's own date after a merge, and misses when selected results differ in date", async () => {
      const f = await fitSetup();
      const [a, b] = [uuid(), uuid()];
      await cacheBatch(f, [a], T1);
      await cacheBatch(f, [b], T2);
      expect((await readCachedFit(h, f.inputHash, [a], at(T2)))!.checkedAt).toBe(T1);
      expect((await readCachedFit(h, f.inputHash, [b], at(T2)))!.checkedAt).toBe(T2);
      expect(await readCachedFit(h, f.inputHash, [a, b], at(T2))).toBeNull();
    });

    it("misses on duplicate ids", async () => {
      const f = await fitSetup();
      const a = uuid();
      await cacheBatch(f, [a], T1);
      expect(await readCachedFit(h, f.inputHash, [a], at(T1, HOUR))).not.toBeNull();
      expect(await readCachedFit(h, f.inputHash, [a, a], at(T1, HOUR))).toBeNull();
    });

    it("misses when the stored inputHash differs from the requested one", async () => {
      const f = await fitSetup();
      const a = uuid();
      const other = await sha256OfText("other");
      // Entry under f's key whose value claims another hash.
      await putCache(h, { key: cacheKeys.fit(f.inputHash), value: { inputHash: other, results: [{ checkedAt: T1, result: fit(a) }] }, schema: z.any() });
      expect(await readCachedFit(h, f.inputHash, [a], at(T1, HOUR))).toBeNull();
    });

    it("treats an old-shape entry as a miss and the next cache write replaces it", async () => {
      const f = await fitSetup();
      const a = uuid();
      await putCache(h, { key: cacheKeys.fit(f.inputHash), value: { inputHash: f.inputHash, results: [fit(a)] }, schema: z.any() });
      expect(await readCachedFit(h, f.inputHash, [a], at(T1, HOUR))).toBeNull();
      await cacheBatch(f, [a], T1);
      expect((await readCachedFit(h, f.inputHash, [a], at(T1, HOUR)))!.checkedAt).toBe(T1);
    });

    it("a returned response attaches with fitCheckedAt equal to the original", async () => {
      const f = await fitSetup();
      const id = f.version.items[0]!.id;
      await cacheBatch(f, [id], T1);
      const cached = (await readCachedFit(h, f.inputHash, [id], at(T1, HOUR)))!;
      await attachFitResponse(h, { projectId: f.project.id, versionId: f.version.id, canonical: f.canonical, response: cached });
      const v = (await loadProject(h, f.project.id))!.versions.find((x) => x.id === f.version.id)!;
      expect(v.items[0]!.fitCheckedAt).toBe(T1);
    });
  });

  it("stays cache only for a missing version or another project, and rejects a hash that is not the canonical's", async () => {
    const f = await fitSetup();
    expect(await attachFitResponse(h, { projectId: f.project.id, versionId: uuid(), canonical: f.canonical, response: f.response }))
      .toMatchObject({ status: "cache_only", reason: "version_missing" });
    expect(await attachFitResponse(h, { projectId: uuid(), versionId: f.version.id, canonical: f.canonical, response: f.response }))
      .toMatchObject({ status: "cache_only", reason: "project_mismatch" });
    await expect(attachFitResponse(h, { projectId: f.project.id, versionId: f.version.id, canonical: f.canonical + " ", response: f.response }))
      .rejects.toBeInstanceOf(InvalidWriteError);
  });
});

describe("shop settings (T10)", () => {
  const real = { ...REAL_SETTINGS_DEFAULT, shopName: "Werkstatt Nord", hourlyRateNetCents: 9000 };
  const logoOf = (c: string) => new Blob([new Uint8Array(7).fill(c.charCodeAt(0))], { type: "image/png" });

  it("round-trips and survives close and reopen", async () => {
    await putShopSettings(h, "default", real, 5);
    closeDreamDb(h);
    h = await openDreamDb();
    expect((await loadSettings(h, "default")).settings).toEqual(real);
  });

  it("an absent record falls back to the matching default without writing", async () => {
    expect((await loadSettings(h, "default")).settings).toEqual(REAL_SETTINGS_DEFAULT);
    expect((await loadSettings(h, "example")).settings).toEqual(EXAMPLE_SETTINGS);
    expect(await h.db.count("settings")).toBe(0);
  });

  it("keeps real and example isolated and refuses other ids", async () => {
    await putShopSettings(h, "example", EXAMPLE_SETTINGS, 1);
    expect((await loadSettings(h, "default")).settings).toEqual(REAL_SETTINGS_DEFAULT);
    await expect(putShopSettings(h, "default", { ...real, demoRates: true }, 2)).rejects.toBeInstanceOf(InvalidWriteError);
    await expect(putShopSettings(h, "example", { ...EXAMPLE_SETTINGS, demoRates: false }, 2)).rejects.toBeInstanceOf(InvalidWriteError);
    await expect(putShopSettings(h, "other", real, 2)).rejects.toBeInstanceOf(InvalidWriteError);
    await expect(loadSettings(h, "other")).rejects.toBeInstanceOf(InvalidWriteError);
    expect(await h.db.count("settings")).toBe(1);
  });

  it("setProjectSettings changes the project and no version", async () => {
    const { project } = await setup();
    const before = await h.db.getAll("versions");
    const next = await setProjectSettings(h, project.id, "example", 99);
    expect(next.settingsId).toBe("example");
    expect((await h.db.get("projects", project.id))!.settingsId).toBe("example");
    expect(await h.db.getAll("versions")).toEqual(before);
    await expect(setProjectSettings(h, project.id, "x")).rejects.toBeInstanceOf(InvalidWriteError);
  });

  it("a logo replace frees the old image and its bytes; a still-used logo is kept", async () => {
    await putLogo(h, logoOf("a"), { id: uuid(), width: 4, height: 2, now: 1 }, "default");
    const first = (await loadSettings(h, "default")).settings.logoImageId!;
    expect((await getStoredImage(h, first))!.rights).toBe("owner");
    const bytesWith = (await storageStatus(h)).imageBytes;
    expect(bytesWith).toBe(7);
    const secondId = uuid();
    await putLogo(h, logoOf("b"), { id: secondId, width: 4, height: 2, now: 2 }, "default");
    expect((await loadSettings(h, "default")).settings.logoImageId).toBe(secondId);
    expect(await getStoredImage(h, first)).toBeNull();
    expect((await storageStatus(h)).imageBytes).toBe(7);
    // The example record shares the logo, so removing it from the real record keeps the image.
    await putLogo(h, logoOf("b"), { id: uuid(), width: 4, height: 2, now: 3 }, "example");
    expect((await loadSettings(h, "example")).settings.logoImageId).toBe(secondId);
    await removeLogo(h, "default", 4);
    expect((await loadSettings(h, "default")).settings.logoImageId).toBeNull();
    expect(await getStoredImage(h, secondId)).not.toBeNull();
    await removeLogo(h, "example", 5);
    expect(await getStoredImage(h, secondId)).toBeNull();
    expect((await storageStatus(h)).imageBytes).toBe(0);
  });

  it("rejects a logo of the wrong type, size or dimensions and writes nothing", async () => {
    const meta = (over: Partial<{ width: number; height: number }> = {}) => ({ id: uuid(), width: 4, height: 2, now: 1, ...over });
    const before = await countStores();
    await expect(putLogo(h, new Blob([new Uint8Array(7)], { type: "image/svg+xml" }), meta(), "default")).rejects.toBeInstanceOf(InvalidWriteError);
    await expect(putLogo(h, new Blob([new Uint8Array(7)]), meta(), "default")).rejects.toBeInstanceOf(InvalidWriteError);
    await expect(putLogo(h, new Blob([new Uint8Array(500_001)], { type: "image/png" }), meta(), "default")).rejects.toBeInstanceOf(InvalidWriteError);
    await expect(putLogo(h, logoOf("a"), meta({ width: 513 }), "default")).rejects.toBeInstanceOf(InvalidWriteError);
    await expect(putLogo(h, logoOf("a"), meta({ height: 0 }), "default")).rejects.toBeInstanceOf(InvalidWriteError);
    await expect(putLogo(h, logoOf("a"), meta({ width: 4.5 }), "default")).rejects.toBeInstanceOf(InvalidWriteError);
    expect(await countStores()).toEqual(before);
    expect((await loadSettings(h, "default")).settings.logoImageId).toBeNull();
    // The limits themselves are accepted.
    await putLogo(h, new Blob([new Uint8Array(500_000)], { type: "image/webp" }), meta({ width: 512, height: 512 }), "default");
  });

  it("a logo with the bytes of an external image gets its own owner record", async () => {
    const bytes = new Uint8Array(7).fill(120);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((b) => b.toString(16).padStart(2, "0")).join("");
    const extId = uuid();
    await h.db.put("images", {
      id: extId, hash: digest, width: 4, height: 2, bytes: 7, rights: "external_runtime",
      blob: new Blob([bytes], { type: "image/png" }), lastAccessedAt: 1,
    });
    const logoId = uuid();
    await putLogo(h, logoOf("x"), { id: logoId, width: 4, height: 2, now: 2 }, "default");
    expect((await loadSettings(h, "default")).settings.logoImageId).toBe(logoId);
    expect((await getStoredImage(h, logoId))!.rights).toBe("owner");
    const ext = (await getStoredImage(h, extId))!;
    expect(ext.rights).toBe("external_runtime");
    expect(ext.lastAccessedAt).toBe(1);
  });

  it("putShopSettings never changes the logo: stale or foreign ids neither orphan nor dangle", async () => {
    await putLogo(h, logoOf("a"), { id: uuid(), width: 4, height: 2, now: 1 }, "default");
    const logo = (await loadSettings(h, "default")).settings.logoImageId!;
    const bytes = (await storageStatus(h)).imageBytes;
    await putShopSettings(h, "default", { ...real, logoImageId: null }, 2);
    await putShopSettings(h, "default", { ...real, logoImageId: uuid() }, 3);
    const rec = await loadSettings(h, "default");
    expect(rec.settings.logoImageId).toBe(logo);
    expect(rec.settings.shopName).toBe(real.shopName);
    expect(await getStoredImage(h, logo)).not.toBeNull();
    expect((await storageStatus(h)).imageBytes).toBe(bytes);
    // A first save without any stored record cannot invent a logo either.
    await putShopSettings(h, "example", { ...EXAMPLE_SETTINGS, logoImageId: logo }, 4);
    expect((await loadSettings(h, "example")).settings.logoImageId).toBeNull();
  });

  it("quota on a settings write gives STORAGE_FULL and keeps the old record", async () => {
    await putShopSettings(h, "default", real, 1);
    const realPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof realPut>) {
      if (this.name === "settings") throw new DOMException("disk full", "QuotaExceededError");
      return realPut.apply(this, args);
    });
    const err = await putShopSettings(h, "default", { ...real, shopName: "New" }, 2).catch((e) => e);
    vi.restoreAllMocks();
    expect((err as AppError).code).toBe("STORAGE_FULL");
    expect((await loadSettings(h, "default")).settings.shopName).toBe("Werkstatt Nord");
  });
});
