// Folder export write logic against in-memory fake directory/file handles (fake data only).
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  folderErrorText, folderImportErrorText, isFolderExportSupported, NO_PROJECT_JSON_MESSAGE, readProjectFolder,
  saveProjectToFolder, type ReadFolderDeps, type SnapshotInput,
} from "@/lib/browser/folderExport";
import { sha256Hex } from "@/lib/browser/renderClient";
import {
  acceptVisual, attachParts, closeDreamDb, createProject, deleteProject, getStoredImage, getStoredMask, loadProject,
  openDreamDb, setHead, snapshotSources, undo, type DreamDb, type PreparedAccept,
} from "@/lib/db";
import { exportPlan, newProject, newRootVersion, projectSnapshot, visualChild, type ExportPlan, type VisualChildInput } from "@/lib/project";
import type { StoredImage, StoredMask, Version } from "@/lib/types";
import { bikeRevision, freshIndexedDb, makePart, uuid } from "./support/idb";

type Content = Blob | string;
const mimeOf = (name: string) => (name.endsWith(".webp") ? "image/webp" : "");

class FakeDir {
  files = new Map<string, Content>();
  dirs = new Map<string, FakeDir>();
  aborts = 0;
  failWriteFor: string | null = null;
  removeCalls: string[] = [];
  failRemoveFor: string | null = null;
  failListing = false;

  /** Like FileSystemDirectoryHandle.entries(): files and subdirectories as [name, handle]. */
  async *entries() {
    if (this.failListing) throw new Error("listing failed");
    for (const name of [...this.files.keys()]) yield [name, { kind: "file" as const }] as const;
    for (const [name, d] of [...this.dirs]) yield [name, { kind: "directory" as const, d }] as const;
  }

  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) throw new DOMException("missing", "NotFoundError");
      d = new FakeDir();
      d.parent = this;
      this.dirs.set(name, d);
    }
    return d as unknown as FileSystemDirectoryHandle;
  }
  parent: FakeDir | null = null;
  async removeEntry(name: string) {
    this.removeCalls.push(name);
    if (this.failRemoveFor === name) throw new Error("remove failed");
    if (this.dirs.delete(name)) return; // a directory goes too, so a missing kind check shows up
    if (!this.files.delete(name)) throw new DOMException("missing", "NotFoundError");
  }
  async getFileHandle(name: string, opts?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!opts?.create) throw new DOMException("missing", "NotFoundError");
    }
    const files = this.files;
    const failFor = () => this.failWriteFor;
    const abort = () => { this.aborts++; };
    return {
      getFile: async () => {
        const c = files.get(name)!;
        return new File([c], name, { type: typeof c === "string" ? "" : c.type || mimeOf(name) });
      },
      createWritable: async () => {
        let staged: Content | null = null;
        return {
          write: async (data: Content) => {
            if (failFor() === name) throw new Error("disk error");
            staged = data;
          },
          close: async () => { files.set(name, staged ?? ""); },
          abort: async () => { abort(); },
        };
      },
    } as unknown as FileSystemFileHandle;
  }
}

const webp = (n: number) => new Blob([new Uint8Array(n)], { type: "image/webp" });
const plan = (): ExportPlan => ({
  folderName: "Bike (abcd1234)",
  files: [
    { name: "00-start-a.webp", versionId: "v0", imageId: "i0" },
    { name: "01-frame-b.webp", versionId: "v1", imageId: "i1" },
  ],
  historyJson: '{"v":1}',
  historyMarkdown: "# Bike",
});
const reader = (m: Record<string, Blob | null>) => async (id: string) => m[id] ?? null;

async function setup() {
  const root = new FakeDir();
  const run = (images: Record<string, Blob | null>, p = plan()) =>
    saveProjectToFolder(root as unknown as FileSystemDirectoryHandle, p, reader(images));
  return { root, run, dir: () => root.dirs.get("Bike (abcd1234)")! };
}

describe("saveProjectToFolder", () => {
  it("first save writes every image and both history files", async () => {
    const { run, dir } = await setup();
    const r = await run({ i0: webp(10), i1: webp(20) });
    expect(r).toMatchObject({ written: 2, skipped: 0, missing: [], folderName: "Bike (abcd1234)" });
    expect(r.projectJson).toBe("not_written"); // no snapshot given
    expect([...dir().files.keys()].sort()).toEqual(
      ["00-start-a.webp", "01-frame-b.webp", "history.json", "history.md"]);
  });

  it("second save skips same-size files but rewrites history", async () => {
    const { run, dir } = await setup();
    await run({ i0: webp(10), i1: webp(20) });
    const p = plan();
    p.historyJson = '{"v":2}';
    const r = await run({ i0: webp(10), i1: webp(20) }, p);
    expect(r.written).toBe(0);
    expect(r.skipped).toBe(2);
    expect(dir().files.get("history.json")).toBe('{"v":2}');
  });

  it("rewrites a file whose size changed", async () => {
    const { run, dir } = await setup();
    await run({ i0: webp(10), i1: webp(20) });
    const r = await run({ i0: webp(10), i1: webp(25) });
    expect(r.written).toBe(1);
    expect(r.skipped).toBe(1);
    expect((dir().files.get("01-frame-b.webp") as Blob).size).toBe(25);
  });

  it("lists null and non-WebP blobs as missing and does not write them", async () => {
    const { run, dir } = await setup();
    const r = await run({ i0: null, i1: new Blob([new Uint8Array(5)], { type: "image/png" }) });
    expect(r.missing).toEqual(["00-start-a.webp", "01-frame-b.webp"]);
    expect(r.written).toBe(0);
    expect(dir().files.has("00-start-a.webp")).toBe(false);
    expect(dir().files.has("history.json")).toBe(true);
  });

  it("treats a throwing reader as missing", async () => {
    const { root } = await setup();
    const r = await saveProjectToFolder(root as unknown as FileSystemDirectoryHandle, plan(), async (id) => {
      if (id === "i0") throw new Error("boom");
      return webp(3);
    });
    expect(r.missing).toEqual(["00-start-a.webp"]);
    expect(r.written).toBe(1);
  });

  it("a failing image write aborts and leaves the old history.json", async () => {
    const { root, run, dir } = await setup();
    await run({ i0: webp(10), i1: webp(20) });
    dir().failWriteFor = "01-frame-b.webp";
    const p = plan();
    p.historyJson = '{"v":2}';
    await expect(run({ i0: webp(10), i1: webp(30) }, p)).rejects.toThrow("disk error");
    expect(dir().aborts).toBe(1);
    expect(dir().files.get("history.json")).toBe('{"v":1}');
    expect((dir().files.get("01-frame-b.webp") as Blob).size).toBe(20);
    expect(root.aborts).toBe(0);
  });

  it("reports progress per file", async () => {
    const { root } = await setup();
    const onProgress = vi.fn();
    await saveProjectToFolder(
      root as unknown as FileSystemDirectoryHandle, plan(), reader({ i0: webp(1), i1: webp(2) }), onProgress);
    expect(onProgress.mock.calls).toEqual([[1, 2], [2, 2]]);
  });
});

// ------------------------------------------------------- project.json, masks and import (OF1)
let h: DreamDb;
beforeEach(async () => { freshIndexedDb(); h = await openDreamDb(); });
afterEach(() => { closeDreamDb(h); });

const W = 8;
const H = 4;
/** A WebP-typed blob with real sha256 so the reader's hash check can pass. */
async function realImage(c: string, size = 10): Promise<StoredImage> {
  const blob = new Blob([new Uint8Array(size).fill(c.charCodeAt(0))], { type: "image/webp" });
  return { id: uuid(), hash: await sha256Hex(blob), width: W, height: H, bytes: blob.size, rights: "owner", blob, lastAccessedAt: 1 };
}
const refOf = (i: StoredImage) => ({ id: i.id, hash: i.hash, width: i.width, height: i.height, bytes: i.bytes, rights: "owner" as const });
function realMask(imageHash: string): StoredMask {
  const pixels = new Uint8Array(W * H);
  pixels[0] = 1; pixels[W * H - 1] = 1;
  return { id: uuid(), imageHash, width: W, height: H, pixels, createdAt: 1 };
}
async function prepare(parent: Version, slot: "tank" | "exhaust", title: string, c: string, t: number) {
  const image = await realImage(c);
  const mask = realMask(image.hash);
  const input: VisualChildInput = {
    versionId: uuid(), itemId: uuid(), createdAt: t, slot, mode: "text",
    instruction: { title, editPrompt: `p ${title}`, spec: [{ key: "finish", value: "matte" }], intent: "paint", warnings: [] },
    image: refOf(image), composite: { composed: true, aligned: true, drift: 0.01, reason: "composited" },
    refreshedPart: makePart(slot, mask),
  };
  const prepared: PreparedAccept = { version: visualChild(parent, input), image, masks: [mask] };
  return { prepared, image, mask };
}

/** root -> tank -> exhaust (bike mask + cutout), head at the exhaust version, then one undo. */
async function build() {
  const rootImage = await realImage("a");
  const projectId = uuid();
  const rootId = uuid();
  const root = newRootVersion({ id: rootId, projectId, createdAt: 5, image: refOf(rootImage) });
  const project = newProject({ id: projectId, rootVersionId: rootId, bikeRevision, now: new Date(2026, 9, 28, 9, 5) });
  await createProject(h, { project, rootVersion: root, image: rootImage });
  const a = await prepare(root, "tank", "Red tank", "b", 10);
  await acceptVisual(h, projectId, root.id, a.prepared);
  const b = await prepare(a.prepared.version, "exhaust", "Short exhaust", "c", 20);
  await acceptVisual(h, projectId, a.prepared.version.id, b.prepared);
  const bikeMask = realMask(b.image.hash);
  const cutout = await realImage("e");
  await attachParts(h, { versionId: b.prepared.version.id, imageHash: b.image.hash, bikeMask, cutoutImage: cutout });
  await undo(h, projectId, b.prepared.version.id);
  await setHead(h, projectId, b.prepared.version.id);
  return { projectId, bikeMask, cutout };
}

async function inputsOf(projectId: string) {
  const src = (await snapshotSources(h, projectId))!;
  const plan = exportPlan({ project: src.project, versions: src.versions, headId: src.project.headVersionId, exportedAt: "t" });
  const snapshot = projectSnapshot({ ...src, plan });
  const readImage = async (id: string) => (await getStoredImage(h, id))?.blob ?? null;
  const input: SnapshotInput = { snapshot, readMask: async (id) => (await getStoredMask(h, id))?.pixels ?? null };
  return { plan, snapshot, readImage, input, src };
}

async function saveFolder(projectId: string, root = new FakeDir()) {
  const x = await inputsOf(projectId);
  const result = await saveProjectToFolder(root as unknown as FileSystemDirectoryHandle, x.plan, x.readImage, undefined, x.input);
  const dir = root.dirs.get(x.plan.folderName)!;
  return { root, dir, result, ...x };
}

const dims = async () => ({ width: W, height: H });
const deps = (): ReadFolderDeps => ({ db: h, readDimensions: dims });
const asHandle = (d: FakeDir) => d as unknown as FileSystemDirectoryHandle;
const counts = async () => ({
  projects: await h.db.count("projects"), versions: await h.db.count("versions"),
  images: await h.db.count("images"), masks: await h.db.count("masks"),
});
const jsonOf = (d: FakeDir) => JSON.parse(d.files.get("project.json") as string);
const putJson = (d: FakeDir, v: unknown) => d.files.set("project.json", JSON.stringify(v));

describe("saveProjectToFolder with a snapshot", () => {
  it("writes cutout, masks/<id>.bin, history and project.json last", async () => {
    const r = await build();
    const order: string[] = [];
    const root = new FakeDir();
    const x = await inputsOf(r.projectId);
    // Record the order in which files finish writing.
    const dir = await root.getDirectoryHandle(x.plan.folderName, { create: true }) as unknown as FakeDir;
    const set = dir.files.set.bind(dir.files);
    dir.files.set = (k, v) => { order.push(k); return set(k, v); };
    const res = await saveProjectToFolder(asHandle(root), x.plan, x.readImage, undefined, x.input);
    expect(res.projectJson).toBe("written");
    expect(res.projectJsonReason).toBeNull();
    expect(res.missing).toEqual([]);
    expect(order.slice(-3)).toEqual(["history.json", "history.md", "project.json"]);
    expect(dir.files.has(`cutout-${r.cutout.id}.webp`)).toBe(true);
    const masks = dir.dirs.get("masks")!;
    expect(masks.files.has(`${r.bikeMask.id}.bin`)).toBe(true);
    const bin = masks.files.get(`${r.bikeMask.id}.bin`) as Blob;
    expect(bin.size).toBe(W * H);
    expect(new Uint8Array(await bin.arrayBuffer())).toEqual(r.bikeMask.pixels);
    expect(jsonOf(dir).formatVersion).toBe(1);
  });

  it("a second save skips immutable files but rewrites project.json", async () => {
    const r = await build();
    const first = await saveFolder(r.projectId);
    first.dir.files.set("project.json", "old");
    const second = await saveFolder(r.projectId, first.root);
    expect(second.result.written).toBe(0);
    expect(second.result.skipped).toBeGreaterThan(0);
    expect(second.dir.files.get("project.json")).not.toBe("old");
  });

  it("does not write project.json and removes a stale one when an image is missing", async () => {
    const r = await build();
    const root = new FakeDir();
    const first = await saveFolder(r.projectId, root);
    expect(first.dir.files.has("project.json")).toBe(true);
    const x = await inputsOf(r.projectId);
    const lost = x.plan.files[1]!.imageId;
    const res = await saveProjectToFolder(asHandle(root), x.plan, async (id) => (id === lost ? null : x.readImage(id)), undefined, x.input);
    expect(res.projectJson).toBe("not_written");
    expect(res.projectJsonReason).toContain(x.plan.files[1]!.name);
    expect(first.dir.files.has("project.json")).toBe(false);
    expect(first.dir.files.has("history.json")).toBe(true);
  });

  it("does not write project.json when a mask file is missing", async () => {
    const r = await build();
    const x = await inputsOf(r.projectId);
    const root = new FakeDir();
    const res = await saveProjectToFolder(asHandle(root), x.plan, x.readImage, undefined,
      { snapshot: x.snapshot, readMask: async () => null });
    expect(res.projectJson).toBe("not_written");
    expect(res.missing.every((m) => m.startsWith("masks/"))).toBe(true);
    expect(root.dirs.get(x.plan.folderName)!.files.has("project.json")).toBe(false);
  });

  it("does not write project.json for an incomplete snapshot and reports the reason", async () => {
    const r = await build();
    const x = await inputsOf(r.projectId);
    const root = new FakeDir();
    const dir = await root.getDirectoryHandle(x.plan.folderName, { create: true }) as unknown as FakeDir;
    dir.files.set("project.json", "stale");
    const res = await saveProjectToFolder(asHandle(root), x.plan, x.readImage, undefined,
      { snapshot: { complete: false, reason: "An image from the web is not saved." }, readMask: async () => null });
    expect(res.projectJson).toBe("not_written");
    expect(res.projectJsonReason).toBe("An image from the web is not saved.");
    expect(dir.files.has("project.json")).toBe(false);
  });
});

const bin = (id: string) => `${id}.bin`;
const STALE = "11111111-2222-3333-4444-555555555555.bin";
const STALE_BYTES = new Uint8Array(W * H).fill(1);
const plant = (dir: FakeDir, name = STALE) => {
  const masks = dir.dirs.get("masks") ?? new FakeDir();
  dir.dirs.set("masks", masks);
  masks.files.set(name, new Blob([STALE_BYTES]));
  return masks;
};
const saveInto = async (projectId: string, root: FakeDir) => saveFolder(projectId, root);
async function folderWithPlanted(projectId: string) {
  // Save once, then plant files that no version references, then save again.
  const first = await saveFolder(projectId);
  return { first, masks: first.dir.dirs.get("masks")! };
}

describe("stale mask cleanup", () => {
  it("removes a stale uuid .bin and keeps every referenced mask byte-identical", async () => {
    const r = await build();
    const { first, masks } = await folderWithPlanted(r.projectId);
    const before = new Map<string, Uint8Array>();
    for (const [n, c] of masks.files) before.set(n, new Uint8Array(await (c as Blob).arrayBuffer()));
    plant(first.dir);
    const second = await saveInto(r.projectId, first.root);
    expect(second.result.projectJson).toBe("written");
    expect(second.result.removedMasks).toBe(1);
    expect(masks.files.has(STALE)).toBe(false);
    expect([...masks.files.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [n, bytes] of before) expect(new Uint8Array(await (masks.files.get(n) as Blob).arrayBuffer())).toEqual(bytes);
  });

  it("keeps other names, uppercase uuid files and subdirectories without touching them", async () => {
    const r = await build();
    const { first, masks } = await folderWithPlanted(r.projectId);
    const upperBin = STALE.replace(/[a-f]/g, (c) => c.toUpperCase());
    masks.files.set("notes.txt", "hi");
    masks.files.set(upperBin, new Blob([STALE_BYTES]));
    masks.dirs.set("plain", new FakeDir());
    masks.dirs.set(STALE, new FakeDir());
    masks.files.set("11111111-2222-3333-4444-555555555555.bin.txt", "x");
    const res = (await saveInto(r.projectId, first.root)).result;
    expect(res.removedMasks).toBe(0);
    expect(masks.removeCalls).toEqual([]);
    expect(masks.files.has("notes.txt")).toBe(true);
    expect(masks.files.has(upperBin)).toBe(true);
    expect(masks.dirs.has("plain")).toBe(true);
    expect(masks.dirs.has(STALE)).toBe(true);
  });

  it("keeps a lowercase file that a referenced uppercase name resolves to", async () => {
    // Case-insensitive folders: the snapshot names X.bin (upper), the disk file is lower case.
    const r = await build();
    const x = await inputsOf(r.projectId);
    const refName = x.snapshot.complete ? x.snapshot.maskFiles[0]!.name : "";
    const upperName = refName.toUpperCase().replace(".BIN", ".bin");
    const root = new FakeDir();
    const dir = await root.getDirectoryHandle(x.plan.folderName, { create: true }) as unknown as FakeDir;
    plant(dir, refName.toLowerCase());
    const snapshot = x.snapshot.complete
      ? { ...x.snapshot, maskFiles: x.snapshot.maskFiles.map((m, i) => (i === 0 ? { ...m, name: upperName } : m)) }
      : x.snapshot;
    // readMask for the renamed entry returns pixels of the same length, so the job is "skipped".
    const res = await saveProjectToFolder(asHandle(root), x.plan, x.readImage, undefined,
      { snapshot, readMask: async () => new Uint8Array(W * H) });
    expect(res.projectJson).toBe("written");
    expect(dir.dirs.get("masks")!.removeCalls).not.toContain(refName.toLowerCase());
    expect(dir.dirs.get("masks")!.files.has(refName.toLowerCase())).toBe(true);
  });

  it("removes nothing when project.json is not written", async () => {
    const r = await build();
    const { first, masks } = await folderWithPlanted(r.projectId);
    plant(first.dir);
    // (a) a version with external_runtime rights: projectSnapshot itself must refuse it
    const x = await inputsOf(r.projectId);
    const last = x.src.versions[x.src.versions.length - 1]!;
    const versions = x.src.versions.map((v) => (v.id === last.id ? { ...v, image: { ...v.image, rights: "external_runtime" as const } } : v));
    const webPlan = exportPlan({ project: x.src.project, versions, headId: x.src.project.headVersionId, exportedAt: "t" });
    const webSnapshot = projectSnapshot({ ...x.src, versions, plan: webPlan });
    expect(webSnapshot.complete).toBe(false);
    const a = await saveProjectToFolder(asHandle(first.root), webPlan, x.readImage, undefined,
      { snapshot: webSnapshot, readMask: x.input.readMask });
    expect(a.projectJson).toBe("not_written");
    expect(a.removedMasks).toBe(0);
    // (b) a missing image
    const lost = x.plan.files[1]!.imageId;
    const b = await saveProjectToFolder(asHandle(first.root), x.plan, async (id) => (id === lost ? null : x.readImage(id)), undefined, x.input);
    expect(b.projectJson).toBe("not_written");
    expect(b.removedMasks).toBe(0);
    expect(masks.removeCalls).toEqual([]);
    expect(masks.files.has(STALE)).toBe(true);
  });

  it("does not remove anything without a snapshot", async () => {
    const root = new FakeDir();
    const dir = await root.getDirectoryHandle("Bike (abcd1234)", { create: true }) as unknown as FakeDir;
    const masks = plant(dir);
    const res = await saveProjectToFolder(asHandle(root), plan(), reader({ i0: webp(1), i1: webp(2) }));
    expect(res.removedMasks).toBe(0);
    expect(masks.files.has(STALE)).toBe(true);
  });

  it("a failing removeEntry leaves the save written and is not counted", async () => {
    const r = await build();
    const { first, masks } = await folderWithPlanted(r.projectId);
    plant(first.dir);
    plant(first.dir, "22222222-2222-3333-4444-555555555555.bin");
    masks.failRemoveFor = STALE;
    const res = (await saveInto(r.projectId, first.root)).result;
    expect(res.projectJson).toBe("written");
    expect(res.projectJsonReason).toBeNull();
    expect(res.removedMasks).toBe(1);
    expect(masks.files.has(STALE)).toBe(true);
    expect(masks.files.has("22222222-2222-3333-4444-555555555555.bin")).toBe(false);
  });

  it("a failing listing leaves the save written with 0 removed", async () => {
    const r = await build();
    const { first, masks } = await folderWithPlanted(r.projectId);
    plant(first.dir);
    masks.failListing = true;
    const res = (await saveInto(r.projectId, first.root)).result;
    expect(res.projectJson).toBe("written");
    expect(res.removedMasks).toBe(0);
    expect(masks.files.has(STALE)).toBe(true);
  });

  it("rejects when project.json cannot be written and leaves the stale file alone", async () => {
    const r = await build();
    const { first, masks } = await folderWithPlanted(r.projectId);
    plant(first.dir);
    first.dir.failWriteFor = "project.json";
    await expect(saveInto(r.projectId, first.root)).rejects.toThrow("disk error");
    expect(masks.files.has(STALE)).toBe(true);
    expect(masks.removeCalls).toEqual([]);
  });

  it("creates no masks directory for a project without masks", async () => {
    const image = await realImage("a");
    const projectId = uuid();
    const rootId = uuid();
    const rootVersion = newRootVersion({ id: rootId, projectId, createdAt: 5, image: refOf(image) });
    const project = newProject({ id: projectId, rootVersionId: rootId, bikeRevision, now: new Date(2026, 9, 28, 9, 5) });
    await createProject(h, { project, rootVersion, image });
    const res = await saveFolder(projectId);
    expect(res.result.projectJson).toBe("written");
    expect(res.result.removedMasks).toBe(0);
    expect(res.dir.dirs.has("masks")).toBe(false);
  });

  it("end to end: a replaced part mask is removed, the new one stays, and the folder imports", async () => {
    const r = await build();
    const first = await saveFolder(r.projectId);
    const masks = first.dir.dirs.get("masks")!;
    const sources = (await snapshotSources(h, r.projectId))!;
    const head = sources.versions.find((v) => v.id === sources.project.headVersionId)!;
    const oldPart = head.parts[0]!;
    const fresh = realMask(head.image.hash);
    fresh.pixels[1] = 1;
    expect(masks.files.has(bin(oldPart.maskId))).toBe(true);
    const att = await attachParts(h, {
      versionId: head.id, imageHash: head.image.hash, masks: [fresh],
      parts: head.parts.map((p, i) => (i === 0 ? { ...p, maskId: fresh.id } : p)),
    });
    expect(att.status).toBe("attached");
    const second = await saveInto(r.projectId, first.root);
    expect(second.result.projectJson).toBe("written");
    expect(second.result.removedMasks).toBe(1);
    expect(masks.files.has(bin(oldPart.maskId))).toBe(false);
    expect(masks.files.has(bin(fresh.id))).toBe(true);
    await deleteProject(h, r.projectId);
    const imported = await readProjectFolder(asHandle(second.dir), deps());
    expect(imported).toEqual({ ok: true, projectId: r.projectId });
    expect((await getStoredMask(h, fresh.id))!.pixels).toEqual(fresh.pixels);
  });
});

describe("readProjectFolder", () => {
  it("round trips project, head, versions, images and masks into an empty store", async () => {
    const r = await build();
    const before = (await loadProject(h, r.projectId))!;
    const imageBytes = new Map<string, Uint8Array>();
    for (const v of before.versions) imageBytes.set(v.image.id, new Uint8Array(await (await getStoredImage(h, v.image.id))!.blob.arrayBuffer()));
    const maskBefore = (await getStoredMask(h, r.bikeMask.id))!;
    const { dir } = await saveFolder(r.projectId);
    await deleteProject(h, r.projectId);
    expect(await counts()).toEqual({ projects: 0, versions: 0, images: 0, masks: 0 });

    const res = await readProjectFolder(asHandle(dir), deps());
    expect(res).toEqual({ ok: true, projectId: r.projectId });
    const after = (await loadProject(h, r.projectId))!;
    expect(after.project).toEqual(before.project);
    const sort = (vs: Version[]) => [...vs].sort((x, y) => x.id.localeCompare(y.id));
    expect(sort(after.versions)).toEqual(sort(before.versions));
    for (const v of before.versions) {
      const img = (await getStoredImage(h, v.image.id))!;
      expect(new Uint8Array(await img.blob.arrayBuffer())).toEqual(imageBytes.get(v.image.id));
    }
    expect(await getStoredImage(h, r.cutout.id)).not.toBeNull();
    expect((await getStoredMask(h, r.bikeMask.id))!.pixels).toEqual(maskBefore.pixels);
  });

  /** Save, delete the project, apply `damage`, and expect a refusal with an empty store. */
  async function refused(damage: (dir: FakeDir, ctx: Awaited<ReturnType<typeof build>>) => void | Promise<void>, d = deps()) {
    const r = await build();
    const { dir } = await saveFolder(r.projectId);
    await deleteProject(h, r.projectId);
    await damage(dir, r);
    const res = await readProjectFolder(asHandle(dir), d);
    expect(res.ok).toBe(false);
    expect(await counts()).toEqual({ projects: 0, versions: 0, images: 0, masks: 0 });
    return res as Extract<typeof res, { ok: false }>;
  }
  const firstImageFile = (dir: FakeDir) => jsonOf(dir).images[0].file as string;

  it("refuses a folder without project.json with the exact message", async () => {
    const res = await refused((dir) => { dir.files.delete("project.json"); });
    expect(res.reason).toBe("no_project_json");
    expect(res.message).toBe("Saved before import existed. Open the project in Chrome and save the folder again.");
    expect(NO_PROJECT_JSON_MESSAGE).toBe(res.message);
  });

  it("refuses a version with a part box outside its image before writing anything", async () => {
    const res = await refused((dir) => {
      const j = jsonOf(dir);
      const v = j.versions.find((x: { parts: unknown[] }) => x.parts.length > 0);
      v.parts[0].box = [0, 0, 1e9, 1e9];
      putJson(dir, j);
    });
    expect(res.reason).toBe("bad_schema");
  });

  it("refuses invalid JSON", async () => {
    const res = await refused((dir) => { dir.files.set("project.json", "{not json"); });
    expect(res.reason).toBe("bad_json");
  });

  it("refuses a schema error", async () => {
    const res = await refused((dir) => { const j = jsonOf(dir); j.formatVersion = 2; putJson(dir, j); });
    expect(res.reason).toBe("bad_schema");
  });

  it("refuses an oversized project.json before parsing it", async () => {
    const res = await refused((dir) => { dir.files.set("project.json", new Blob([new Uint8Array(10_000_001)])); });
    expect(res.reason).toBe("project_json_too_large");
  });

  it("refuses a hash mismatch", async () => {
    const res = await refused((dir) => {
      const f = firstImageFile(dir);
      dir.files.set(f, new Blob([new Uint8Array((dir.files.get(f) as Blob).size).fill(7)], { type: "image/webp" }));
    });
    expect(res.reason).toBe("bad_file");
    expect(res.message).toContain("hash");
  });

  it("refuses wrong decoded dimensions", async () => {
    const res = await refused(() => {}, { db: h, readDimensions: async () => ({ width: W + 1, height: H }) });
    expect(res.reason).toBe("bad_file");
    expect(res.message).toContain(`${W + 1}x${H}`);
  });

  it("refuses a wrong file size", async () => {
    const res = await refused((dir) => {
      const f = firstImageFile(dir);
      dir.files.set(f, new Blob([new Uint8Array(3)], { type: "image/webp" }));
    });
    expect(res.reason).toBe("bad_file");
    expect(res.message).toContain("wrong size");
  });

  it("refuses an image whose stored type is not WebP", async () => {
    const res = await refused((dir) => {
      const f = firstImageFile(dir);
      dir.files.set(f, new Blob([dir.files.get(f) as Blob], { type: "image/png" }));
    });
    expect(res.reason).toBe("bad_file");
    expect(res.message).toContain("WebP");
  });

  it("refuses a wrong mask length", async () => {
    const res = await refused((dir) => {
      const m = jsonOf(dir).masks[0].file as string;
      dir.dirs.get("masks")!.files.set(m, new Blob([new Uint8Array(W * H - 1)]));
    });
    expect(res.reason).toBe("bad_file");
    expect(res.message).toContain("masks/");
  });

  it("refuses a mask byte of 2", async () => {
    const res = await refused((dir) => {
      const m = jsonOf(dir).masks[0].file as string;
      const bytes = new Uint8Array(W * H);
      bytes[3] = 2;
      dir.dirs.get("masks")!.files.set(m, new Blob([bytes]));
    });
    expect(res.reason).toBe("bad_file");
    expect(res.message).toContain("0 and 1");
  });

  it("refuses a missing image file and names it", async () => {
    let name = "";
    const res = await refused((dir) => { name = firstImageFile(dir); dir.files.delete(name); });
    expect(res.reason).toBe("missing_file");
    expect(res.message).toContain(name);
  });

  it("refuses a missing mask file and names it", async () => {
    let name = "";
    const res = await refused((dir) => { name = jsonOf(dir).masks[0].file; dir.dirs.get("masks")!.files.delete(name); });
    expect(res.reason).toBe("missing_file");
    expect(res.message).toContain(`masks/${name}`);
  });

  it("refuses a missing masks directory", async () => {
    const res = await refused((dir) => { dir.dirs.delete("masks"); });
    expect(res.reason).toBe("missing_file");
  });

  it("refuses a project id that already exists and adds nothing", async () => {
    const r = await build();
    const { dir } = await saveFolder(r.projectId);
    const before = await counts();
    const res = await readProjectFolder(asHandle(dir), deps());
    expect(res).toMatchObject({ ok: false, reason: "refused", refusal: "project_exists" });
    expect(await counts()).toEqual(before);
  });
});

describe("folderImportErrorText", () => {
  it("maps known errors to plain words", () => {
    expect(folderImportErrorText(new DOMException("x", "AbortError"))).toBe("Folder choice cancelled.");
    expect(folderImportErrorText(new DOMException("x", "NotAllowedError"))).toMatch(/did not allow/);
    expect(folderImportErrorText(new DOMException("x", "NotFoundError"))).toMatch(/could not be found/);
    expect(folderImportErrorText(new Error("weird"))).toContain("weird");
  });
});

describe("folderErrorText", () => {
  it("maps known errors to plain words", () => {
    expect(folderErrorText(new DOMException("x", "AbortError"))).toBe("Folder choice cancelled.");
    expect(folderErrorText(new DOMException("x", "NotAllowedError"))).toMatch(/did not allow/);
    expect(folderErrorText(new DOMException("x", "SecurityError"))).toMatch(/did not allow/);
    expect(folderErrorText(new DOMException("x", "QuotaExceededError"))).toBe("The disk is full.");
    expect(folderErrorText(new TypeError("Name is not allowed."))).toMatch(/file name/);
  });
  it("falls back with the message", () => {
    expect(folderErrorText(new Error("weird"))).toContain("weird");
  });
});

describe("isFolderExportSupported", () => {
  it("is false in node", () => {
    expect(isFolderExportSupported()).toBe(false);
  });
});
