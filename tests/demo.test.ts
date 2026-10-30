// Cached demo: manifest contract, loading, fresh copies, import, pruning and the pack helpers.
// Everything is synthetic and in memory: no binary fixture files and no owner photos.
import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DemoManifest as DemoManifestSchema } from "@/lib/contracts";
import {
  closeDreamDb, getStoredImage, getStoredMask, importProject, loadProject, openDreamDb, renameProject, setHead, type DreamDb,
} from "@/lib/db";
import {
  DemoError, demoUrl, freshDemoCopy, importDemo, loadDemo, loadDemoPreview, pruneDemoSnapshot, type DecodeImage, type DemoFetch,
} from "@/lib/demo";
import { fitInputHash, fitReviewHash, LEGAL_SEED, newProject, newRootVersion, sheetChild, visualChild } from "@/lib/project";
import { mockFitFor } from "@/lib/mocks";
import { EXAMPLE_SETTINGS } from "@/lib/quote";
import {
  buildProvenance, DemoPackError, fitHashProblems, maskToPng, mockProblems, packDemo, pngToMask, ProvenanceInput, strictFitProblems,
} from "@/lib/server/demoPack";
import type { DemoManifest, ImageRef, Part, ProjectSnapshot, Version } from "@/lib/types";
import { bikeRevision, freshIndexedDb, uuid } from "./support/idb";

const W = 8;
const H = 4;
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
// Real, distinct 8x4 WebP files: the pack checks dimensions with sharp and the loader checks the signature.
const webps = new Map<number, Uint8Array>();
beforeAll(async () => {
  for (let n = 0; n <= 9; n++) {
    const raw = Buffer.from(Uint8Array.from({ length: W * H * 3 }, (_, i) => (i * 7 + n * 25) % 251));
    webps.set(n, new Uint8Array(await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).webp({ lossless: true }).toBuffer()));
  }
});
const bytesOf = (n: number): Uint8Array => webps.get(n)!;

type Fixture = {
  source: ProjectSnapshot; // root, front wheel, rear wheel, tank, two sheet saves (head), plus the fork branch
  files: Map<string, Uint8Array>; // source file name -> bytes
  maskPixels: Map<string, Uint8Array>;
  ids: { root: string; v1: string; v2: string; v3: string; sheetA: string; head: string; fork: string; forkMask: string; forkImage: string };
};

function imageOf(n: number): { ref: ImageRef; bytes: Uint8Array } {
  const bytes = bytesOf(n);
  return { ref: { id: uuid(), hash: sha(bytes), width: W, height: H, bytes: bytes.length, rights: "owner" }, bytes };
}

function maskFor(image: ImageRef, hot: number): { id: string; pixels: Uint8Array; meta: ProjectSnapshot["masks"][number] } {
  const pixels = new Uint8Array(W * H);
  pixels[hot] = 1;
  pixels[W * H - 1 - hot] = 1;
  const id = uuid();
  return { id, pixels, meta: { id, imageHash: image.hash, width: W, height: H, createdAt: 1, file: `${id}.bin` } };
}

const partFor = (slot: Part["slot"], maskId: string): Part => ({
  id: `p:${slot}`, slot, label: slot, box: [0, 0, 4, 2], maskId, area: 2, source: "concept", confidence: 0.9, stale: false,
});

async function buildFixture(): Promise<Fixture> {
  const files = new Map<string, Uint8Array>();
  const images: ProjectSnapshot["images"] = [];
  const masks: ProjectSnapshot["masks"] = [];
  const maskPixels = new Map<string, Uint8Array>();
  const addImage = (n: number): ImageRef => {
    const { ref, bytes } = imageOf(n);
    const file = `${ref.id}.webp`;
    files.set(file, bytes);
    images.push({ ...ref, file });
    return ref;
  };
  const addMask = (image: ImageRef, hot: number): string => {
    const m = maskFor(image, hot);
    masks.push(m.meta);
    maskPixels.set(m.id, m.pixels);
    return m.id;
  };

  const rootImage = addImage(0);
  const projectId = uuid();
  const root = newRootVersion({ id: uuid(), projectId, image: rootImage, createdAt: Date.UTC(2026, 9, 20) });
  const step = (parent: Version, slot: Part["slot"], n: number, hot: number): { v: Version; image: ImageRef } => {
    const image = addImage(n);
    const maskId = addMask(image, hot);
    const v = visualChild(parent, {
      versionId: uuid(), itemId: uuid(), createdAt: Date.UTC(2026, 9, 20 + n), slot, mode: "text",
      instruction: { title: `Green ${slot}`, editPrompt: "p", spec: [{ key: "finish", value: "green" }], intent: "paint", warnings: [] },
      image, composite: { composed: true, aligned: true, drift: 0.01, reason: "composited" },
      refreshedPart: partFor(slot, maskId),
    });
    return { v, image };
  };
  const s1 = step(root, "wheel_front", 1, 0);
  const s2 = step(s1.v, "wheel_rear", 2, 1);
  const fork = step(s1.v, "seat", 9, 2); // a branch off v1 that the demo must drop
  const s3 = step(s2.v, "tank", 3, 3);
  // v3 also carries a bike mask and a cutout, like a version after "Prepare parts".
  const bikeMask = addMask(s3.image, 4);
  const cutout = addImage(5);
  const v3: Version = { ...s3.v, bikeMaskId: bikeMask, cutoutImageId: cutout.id };
  // Sheet saves after v3: a price edit, then the fit check with the mechanic's review (the real demo's head).
  const sheetA = sheetChild(v3, { versionId: uuid(), createdAt: Date.UTC(2026, 9, 28), items: v3.items.map((i) => ({ ...i, mechanicNotes: "illustrative" })), fees: [] });

  const headId = uuid();
  const project = { ...newProject({ id: projectId, rootVersionId: root.id, bikeRevision, now: new Date(2026, 9, 20) }), headVersionId: headId, settingsId: "example" as const };
  // Fit results on the head, hashed with the example settings, and a mechanic acknowledgment.
  const hashNow = await fitInputHash(bikeRevision, sheetA.items, EXAMPLE_SETTINGS.shopRules, LEGAL_SEED.version);
  const items = [];
  for (const it of sheetA.items) {
    const withFit = {
      ...it, fitInputHash: hashNow, fitCheckedAt: "2026-10-29T10:00:00.000Z",
      fit: {
        itemId: it.id, status: "verify" as const, approval: "unknown" as const, documentCoverage: "unknown" as const,
        inspection: "unknown" as const, eintragung: "unknown" as const, carryDocuments: "unknown" as const,
        reasons: ["Unknown."], toMeasure: [], extraParts: [], conditions: [], sources: [], confidence: 0.3,
      },
    };
    items.push({ ...withFit, fitReviewedHash: await fitReviewHash(withFit) });
  }
  const head: Version = sheetChild(sheetA, { versionId: headId, createdAt: Date.UTC(2026, 9, 29), items, fees: [], inspectionReview: { fitInputHash: hashNow, decision: "none", notes: "No inspection needed (test).", reviewedAt: "2026-10-29T10:30:00.000Z" } });

  const source: ProjectSnapshot = {
    formatVersion: 1, project, versions: [root, s1.v, s2.v, fork.v, v3, sheetA, head], images, masks,
  };
  return {
    source, files, maskPixels,
    ids: {
      root: root.id, v1: s1.v.id, v2: s2.v.id, v3: v3.id, sheetA: sheetA.id, head: head.id, fork: fork.v.id,
      forkMask: fork.v.parts[0]!.maskId, forkImage: fork.image.id,
    },
  };
}

/** The packed demo as the browser sees it: manifest plus the static files under /demo/. */
async function buildDemo(fx: Fixture): Promise<{ manifest: DemoManifest; served: Map<string, Uint8Array> }> {
  const pruned = pruneDemoSnapshot(fx.source);
  const served = new Map<string, Uint8Array>();
  for (const f of pruned.imageFiles) served.set(f.to, fx.files.get(f.from)!);
  const masks: DemoManifest["masks"] = [];
  for (const m of pruned.snapshot.masks) {
    const png = new Uint8Array(await maskToPng(fx.maskPixels.get(m.id)!, W, H));
    served.set(`${m.id}.png`, png);
    masks.push({ id: m.id, file: `${m.id}.png`, sha256: sha(png), bytes: png.length, width: W, height: H });
  }
  const pdf = new TextEncoder().encode("%PDF-synthetic");
  served.set("quote.pdf", pdf);
  const rights = [...served.keys()].map((file) => ({
    file, kind: file === "v0.webp" ? "owner_photo" as const : "generated_derivative" as const, credit: "Test", clearance: "test record",
  }));
  const fileOf = new Map(pruned.imageFiles.map((f) => [f.id, f.to]));
  const manifest = DemoManifestSchema.parse({
    schemaVersion: 1, cachedAt: "2026-10-29T12:00:00.000Z",
    provenance: buildProvenance(pruned.snapshot.versions, (v) => fileOf.get(v.image.id)!, { entries: [], assetCalls: [], promptFiles: [], rights: { credit: "Test", clearance: "x" } }),
    rights, snapshot: pruned.snapshot, masks,
    quote: { path: "quote.pdf", bytes: pdf.length, sha256: sha(pdf) },
  });
  served.set("project.json", new TextEncoder().encode(JSON.stringify(manifest)));
  return { manifest, served };
}

/** A fetch over /demo/ files that records every URL. */
function fakeFetch(served: Map<string, Uint8Array>): { fetchFn: DemoFetch; urls: string[] } {
  const urls: string[] = [];
  const fetchFn: DemoFetch = async (url) => {
    urls.push(url);
    const bytes = url.startsWith("/demo/") ? served.get(url.slice("/demo/".length)) : undefined;
    return bytes ? new Response(new Blob([new Uint8Array(bytes)])) : new Response("missing", { status: 404 });
  };
  return { fetchFn, urls };
}

const decodeImage: DecodeImage = async () => ({ width: W, height: H });
const decodeMask = async (blob: Blob): Promise<Uint8Array> => (await pngToMask(new Uint8Array(await blob.arrayBuffer()))).pixels;

let fx: Fixture;
beforeEach(async () => {
  fx = await buildFixture();
});

describe("pruning for the pack", () => {
  it("keeps the root-to-head path, drops the fork branch, renames images and keeps every referenced mask", () => {
    const pruned = pruneDemoSnapshot(fx.source);
    const ids = pruned.snapshot.versions.map((v) => v.id);
    expect(ids).toEqual([fx.ids.root, fx.ids.v1, fx.ids.v2, fx.ids.v3, fx.ids.sheetA, fx.ids.head]);
    expect(pruned.snapshot.images.map((i) => i.file).sort()).toEqual(["v0.webp", "v1.webp", "v2.webp", "v3-cutout.webp", "v3.webp"]);
    expect(pruned.snapshot.images.some((i) => i.id === fx.ids.forkImage)).toBe(false);
    const referenced = new Set(pruned.snapshot.versions.flatMap((v) => [...v.parts.map((p) => p.maskId), ...(v.bikeMaskId ? [v.bikeMaskId] : [])]));
    expect(new Set(pruned.snapshot.masks.map((m) => m.id))).toEqual(referenced);
    expect(referenced.has(fx.ids.forkMask)).toBe(false);
    expect(referenced.size).toBe(4); // wheel front, wheel rear, tank and the bike mask; the fork's seat mask is gone
    expect(pruned.snapshot.project.headVersionId).toBe(fx.ids.head);
    // The fork branch left the original untouched.
    expect(fx.source.versions).toHaveLength(7);
  });

  it("the pruned manifest validates with sheet versions on the path; a fifth image version does not", async () => {
    const { manifest } = await buildDemo(fx);
    expect(DemoManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest.snapshot.versions.map((v) => v.kind)).toEqual(["root", "visual", "visual", "visual", "sheet", "sheet"]);
    // The fork would be a fifth image version.
    expect(DemoManifestSchema.safeParse({ ...manifest, snapshot: fx.source }).success).toBe(false);
  });

  it("names images by image index, not path position, when a sheet save sits between visuals", () => {
    const [root, s1, s2, , v3] = fx.source.versions as [Version, Version, Version, Version, Version];
    const sheet = sheetChild(s1, { versionId: uuid(), createdAt: 5, items: s1.items, fees: [] });
    const s2b: Version = { ...s2, parentId: sheet.id };
    const v3b: Version = { ...v3, parentId: s2b.id };
    const src: ProjectSnapshot = {
      ...fx.source, versions: [root, s1, sheet, s2b, v3b],
      project: { ...fx.source.project, headVersionId: v3b.id },
    };
    const files = Object.fromEntries(pruneDemoSnapshot(src).imageFiles.map((f) => [f.id, f.to]));
    expect(files[s2.image.id]).toBe("v2.webp");
    expect(files[v3.image.id]).toBe("v3.webp");
  });

  it("refuses more than four image versions or too many sheet versions", async () => {
    const { manifest } = await buildDemo(fx);
    const head = manifest.snapshot.versions.at(-1)!;
    const extra = Array.from({ length: 20 }, () => ({ ...head, id: uuid() }));
    const versions = [...manifest.snapshot.versions, ...extra];
    const provenance = { ...manifest.provenance, steps: versions.map((_, n) => manifest.provenance.steps[Math.min(n, manifest.provenance.steps.length - 1)]!) };
    expect(DemoManifestSchema.safeParse({ ...manifest, snapshot: { ...manifest.snapshot, versions }, provenance }).success).toBe(false);
  });
});

describe("manifest validation", () => {
  it("refuses a wrong schema version, missing rights and unknown keys", async () => {
    const { manifest } = await buildDemo(fx);
    expect(DemoManifestSchema.safeParse({ ...manifest, schemaVersion: 2 }).success).toBe(false);
    expect(DemoManifestSchema.safeParse({ ...manifest, rights: manifest.rights.slice(1) }).success).toBe(false);
    expect(DemoManifestSchema.safeParse({ ...manifest, extra: 1 }).success).toBe(false);
    expect(DemoManifestSchema.safeParse({ ...manifest, masks: manifest.masks.slice(1) }).success).toBe(false);
    expect(DemoManifestSchema.safeParse({ ...manifest, masks: manifest.masks.map((m) => ({ ...m, file: "x.png" })) }).success).toBe(false);
  });

  it("refuses file names that could leave /demo/ and never fetches them", async () => {
    const { manifest, served } = await buildDemo(fx);
    for (const bad of ["../v0.webp", "/etc/passwd", "https://evil.example/v0.webp", "a%2Fb.webp", "v0.webp?x=1", "..", "a b.webp"]) {
      const images = manifest.snapshot.images.map((i, n) => (n === 0 ? { ...i, file: bad } : i));
      expect(DemoManifestSchema.safeParse({ ...manifest, snapshot: { ...manifest.snapshot, images } }).success, bad).toBe(false);
      expect(() => demoUrl(bad), bad).toThrow(DemoError);
    }
    // And a manifest carrying one is refused by loadDemo before any image request.
    const evil = JSON.parse(new TextDecoder().decode(served.get("project.json")!));
    evil.snapshot.images[0].file = "../v0.webp";
    served.set("project.json", new TextEncoder().encode(JSON.stringify(evil)));
    const { fetchFn, urls } = fakeFetch(served);
    await expect(loadDemo(fetchFn, decodeImage)).rejects.toThrow(DemoError);
    expect(urls).toEqual(["/demo/project.json"]);
  });
});

describe("loadDemo", () => {
  it("loads manifest and images from /demo/ only and fetches no masks", async () => {
    const { manifest, served } = await buildDemo(fx);
    const { fetchFn, urls } = fakeFetch(served);
    const loaded = await loadDemo(fetchFn, decodeImage);
    expect(loaded.manifest).toEqual(manifest);
    expect(loaded.blobsById.size).toBe(5);
    expect(urls.every((u) => u.startsWith("/demo/"))).toBe(true);
    expect(urls.some((u) => u.endsWith(".png") || u.endsWith(".pdf"))).toBe(false);
  });

  it("refuses a changed file, a wrong size and wrong dimensions", async () => {
    const { served } = await buildDemo(fx);
    const tampered = new Map(served);
    const v1 = Uint8Array.from(served.get("v1.webp")!);
    v1[3] = (v1[3]! + 1) % 256; // same length, different content
    tampered.set("v1.webp", v1);
    await expect(loadDemo(fakeFetch(tampered).fetchFn, decodeImage)).rejects.toThrow(/hash/);

    const short = new Map(served);
    short.set("v2.webp", served.get("v2.webp")!.slice(0, 10));
    await expect(loadDemo(fakeFetch(short).fetchFn, decodeImage)).rejects.toThrow(/size/);

    await expect(loadDemo(fakeFetch(served).fetchFn, async () => ({ width: W + 1, height: H }))).rejects.toThrow(/dimensions/);

    const missing = new Map(served);
    missing.delete("v3.webp");
    await expect(loadDemo(fakeFetch(missing).fetchFn, decodeImage)).rejects.toThrow(/could not be loaded/);
  });

  it("refuses a manifest that is not JSON", async () => {
    const served = new Map([["project.json", new TextEncoder().encode("{nope")]]);
    await expect(loadDemo(fakeFetch(served).fetchFn, decodeImage)).rejects.toThrow(/JSON/);
  });
});

describe("freshDemoCopy", () => {
  it("remaps only project and version identity and keeps item, bike, image and mask ids", async () => {
    const { manifest } = await buildDemo(fx);
    const before = structuredClone(manifest.snapshot);
    const copy = freshDemoCopy(manifest.snapshot);
    expect(manifest.snapshot).toEqual(before); // input untouched
    expect(copy.project.id).not.toBe(before.project.id);
    const oldIds = new Set(before.versions.map((v) => v.id));
    const newIds = new Set(copy.versions.map((v) => v.id));
    expect([...newIds].some((i) => oldIds.has(i))).toBe(false);
    expect(copy.versions.every((v) => v.projectId === copy.project.id)).toBe(true);
    expect(copy.project.rootVersionId).toBe(copy.versions[0]!.id);
    expect(copy.project.headVersionId).toBe(copy.versions[5]!.id);
    copy.versions.forEach((v, n) => {
      expect(v.parentId).toBe(n === 0 ? null : copy.versions[n - 1]!.id);
      for (const it of v.items) expect(newIds.has(it.originVersionId)).toBe(true);
      expect(v.items.map((i) => i.id)).toEqual(before.versions[n]!.items.map((i) => i.id));
      expect(v.image).toEqual(before.versions[n]!.image);
    });
    expect(copy.project.bikeRevision).toEqual(before.project.bikeRevision);
    expect(copy.images).toEqual(before.images);
    expect(copy.masks).toEqual(before.masks);
  });

  it("keeps the fit input hash and the mechanic's fit review valid", async () => {
    const { manifest } = await buildDemo(fx);
    const copy = freshDemoCopy(manifest.snapshot);
    const head = copy.versions.find((v) => v.id === copy.project.headVersionId)!;
    expect(head.items.every((i) => i.fit !== null && i.fitReviewedHash !== null)).toBe(true);
    expect(await fitHashProblems(head, copy.project.bikeRevision, EXAMPLE_SETTINGS)).toEqual([]);
  });

  it("fitHashProblems reports a changed item and a changed fit result", async () => {
    const head = fx.source.versions.find((v) => v.id === fx.ids.head)!;
    const changed: Version = { ...head, items: head.items.map((i, n) => (n === 0 ? { ...i, title: "Other part" } : i)) };
    expect((await fitHashProblems(changed, fx.source.project.bikeRevision, EXAMPLE_SETTINGS)).length).toBeGreaterThan(0);
    const reviewed: Version = { ...head, items: head.items.map((i, n) => (n === 0 && i.fit ? { ...i, fit: { ...i.fit, status: "ok" as const } } : i)) };
    expect((await fitHashProblems(reviewed, fx.source.project.bikeRevision, EXAMPLE_SETTINGS)).join()).toMatch(/review hash/);
  });
});

describe("importDemo", () => {
  let h: DreamDb;
  beforeEach(async () => {
    freshIndexedDb();
    h = await openDreamDb();
  });
  afterEach(() => closeDreamDb(h));

  it("imports twice into disjoint projects, dedupes images and masks, and edits stay separate", async () => {
    const { served, manifest } = await buildDemo(fx);
    const { fetchFn, urls } = fakeFetch(served);
    const a = await importDemo(h, fetchFn, decodeMask, { decodeImage });
    const b = await importDemo(h, fetchFn, decodeMask, { decodeImage });
    if (a.status !== "imported" || b.status !== "imported") throw new Error(JSON.stringify([a, b]));
    expect(a.project.id).not.toBe(b.project.id);
    const idsA = new Set(a.versions.map((v) => v.id));
    expect(b.versions.some((v) => idsA.has(v.id))).toBe(false);
    expect(urls.every((u) => u.startsWith("/demo/"))).toBe(true);

    // Images and masks are stored once however often the demo is imported.
    expect(await h.db.count("images")).toBe(manifest.snapshot.images.length);
    expect(await h.db.count("masks")).toBe(manifest.masks.length);
    const bikeMask = a.versions.at(-1)!.bikeMaskId!;
    expect((await getStoredMask(h, bikeMask))!.pixels).toEqual(fx.maskPixels.get(manifest.snapshot.masks.find((m) => m.id === bikeMask)!.id));
    expect((await getStoredImage(h, a.versions[0]!.image.id))!.blob.size).toBe(a.versions[0]!.image.bytes);

    // Editing copy A (rename, move the head) leaves copy B unchanged.
    const bBefore = await loadProject(h, b.project.id);
    await renameProject(h, a.project.id, "My own project");
    await setHead(h, a.project.id, a.versions[1]!.id);
    expect(await loadProject(h, b.project.id)).toEqual(bBefore);
    expect((await loadProject(h, a.project.id))!.project.headVersionId).toBe(a.versions[1]!.id);
  });

  it("fetches masks only during the import, never while loading", async () => {
    const { served } = await buildDemo(fx);
    const load = fakeFetch(served);
    await loadDemo(load.fetchFn, decodeImage);
    expect(load.urls.filter((u) => u.endsWith(".png"))).toEqual([]);
    const imp = fakeFetch(served);
    await importDemo(h, imp.fetchFn, decodeMask, { decodeImage });
    expect(imp.urls.filter((u) => u.endsWith(".png")).length).toBe(4);
  });

  it("writes nothing when a mask file is damaged", async () => {
    const { served, manifest } = await buildDemo(fx);
    const damaged = new Map(served);
    const m = manifest.masks[0]!;
    const png = Uint8Array.from(served.get(m.file)!);
    png[png.length - 1] = (png[png.length - 1]! + 1) % 256;
    damaged.set(m.file, png);
    await expect(importDemo(h, fakeFetch(damaged).fetchFn, decodeMask, { decodeImage })).rejects.toThrow(/hash/);
    expect(await h.db.count("projects")).toBe(0);
    expect(await h.db.count("images")).toBe(0);
  });
});

describe("mask PNGs", () => {
  it("round trips 0/1 bytes through a 1-bit PNG", async () => {
    const pixels = new Uint8Array(13 * 7);
    for (let i = 0; i < pixels.length; i += 3) pixels[i] = 1;
    const png = await maskToPng(pixels, 13, 7);
    expect(png[24]).toBe(1); // IHDR bit depth
    const back = await pngToMask(png);
    expect([back.width, back.height]).toEqual([13, 7]);
    expect(Array.from(back.pixels)).toEqual(Array.from(pixels));
  });

  it("round trips an all-empty and an all-full mask", async () => {
    for (const fill of [0, 1]) {
      const pixels = new Uint8Array(6 * 5).fill(fill);
      expect(Array.from((await pngToMask(await maskToPng(pixels, 6, 5))).pixels)).toEqual(Array.from(pixels));
    }
  });
});

describe("provenance", () => {
  const rights = { credit: "c", clearance: "r" };
  it("takes dates from the versions and keeps unknown models and times as unknown", () => {
    const versions = fx.source.versions.filter((v) => v.id !== fx.ids.fork);
    const known = versions[1]!;
    const p = buildProvenance(versions, () => "v.webp", {
      entries: [{ versionId: known.id, route: "edit", model: "model-x", at: "2026-10-21T08:00:00.000Z" }],
      assetCalls: [], promptFiles: [], rights,
    });
    expect(p.steps[0]).toMatchObject({ kind: "root", calls: [], createdAt: new Date(versions[0]!.createdAt).toISOString() });
    expect(p.steps[1]!.calls).toEqual([{ route: "edit", model: "model-x", at: "2026-10-21T08:00:00.000Z" }]);
    expect(p.steps[2]!.calls).toEqual([{ route: "unknown", model: "unknown", at: "unknown" }]);
    expect(p.steps.at(-1)).toMatchObject({ kind: "sheet", calls: [] });
  });

  it("keeps every ledger call of one version and the asset calls", () => {
    const versions = fx.source.versions.filter((v) => v.id !== fx.ids.fork);
    const id = versions[1]!.id;
    const p = buildProvenance(versions, () => "v.webp", {
      entries: [
        { versionId: id, route: "instruction", model: "spark", at: "2026-10-21T08:00:00.000Z" },
        { versionId: id, route: "edit", model: "image-model", at: "2026-10-21T08:01:00.000Z" },
      ],
      assetCalls: [{ route: "segment", model: "sam", at: "2026-10-21T07:00:00.000Z" }, { route: "fit", model: "fit-model", at: "2026-10-29T10:00:00.000Z" }],
      promptFiles: [], rights,
    });
    expect(p.steps[1]!.calls.map((c) => c.model)).toEqual(["spark", "image-model"]);
    expect(p.assetCalls.map((c) => c.model)).toEqual(["sam", "fit-model"]);
  });

  it("validates the lead's provenance input", () => {
    expect(ProvenanceInput.safeParse({ entries: [], promptFiles: [], rights }).success).toBe(true);
    expect(ProvenanceInput.safeParse({ entries: [], promptFiles: [] }).success).toBe(false);
  });
});

describe("mock content", () => {
  it("is refused anywhere in the pruned snapshot, and a clean one passes", () => {
    expect(mockProblems(pruneDemoSnapshot(fx.source).snapshot)).toEqual([]);
    const head = fx.source.versions.at(-1)!;
    const fit = { ...mockFitFor(head.items[0]!.id, "2026-10-29T10:00:00.000Z") };
    const dirty: ProjectSnapshot = {
      ...fx.source,
      versions: fx.source.versions.map((v) => (v.id === head.id ? { ...v, items: v.items.map((i, n) => (n === 0 ? { ...i, fit } : i)) } : v)),
    };
    expect(mockProblems(pruneDemoSnapshot(dirty).snapshot).length).toBe(1);
  });
});

describe("manifest public rights (SPEC 13)", () => {
  const bad = (m: unknown) => DemoManifestSchema.safeParse(m).success;
  it("refuses a non-owner image, a reference edit, a product image URL, a wrong rights kind and a mismatched provenance step", async () => {
    const { manifest } = await buildDemo(fx);
    expect(bad(manifest)).toBe(true);
    const imgId = manifest.snapshot.images[1]!.id;
    const images = manifest.snapshot.images.map((i) => (i.id === imgId ? { ...i, rights: "visitor" as const } : i));
    expect(bad({ ...manifest, snapshot: { ...manifest.snapshot, images } })).toBe(false);

    const withVersion = (n: number, patch: Partial<Version>) => ({
      ...manifest, snapshot: { ...manifest.snapshot, versions: manifest.snapshot.versions.map((v, k) => (k === n ? { ...v, ...patch } : v)) },
    });
    const v1 = manifest.snapshot.versions[1]!;
    expect(bad(withVersion(1, { change: { ...v1.change!, mode: "reference" } }))).toBe(false);
    const withImage = v1.items.map((it) => ({ ...it, product: productWithImage() }));
    expect(bad(withVersion(1, { items: withImage }))).toBe(false);

    // Rights kind: the root file must be owner_photo, every other file generated_derivative.
    expect(bad({ ...manifest, rights: manifest.rights.map((r) => (r.file === "v0.webp" ? { ...r, kind: "generated_derivative" as const } : r)) })).toBe(false);
    expect(bad({ ...manifest, rights: manifest.rights.map((r) => (r.file === "v1.webp" ? { ...r, kind: "owner_photo" as const } : r)) })).toBe(false);

    const steps = manifest.provenance.steps.map((st, n) => (n === 1 ? { ...st, file: "v2.webp" } : st));
    expect(bad({ ...manifest, provenance: { ...manifest.provenance, steps } })).toBe(false);
    const kinds = manifest.provenance.steps.map((st, n) => (n === 4 ? { ...st, kind: "visual" as const } : st));
    expect(bad({ ...manifest, provenance: { ...manifest.provenance, steps: kinds } })).toBe(false);
  });
});

function productWithImage(): NonNullable<Version["items"][number]["product"]> {
  return {
    id: uuid(), name: "Part", brand: null, partNumber: null, url: "https://shop.example/part", imageUrl: "https://shop.example/part.jpg",
    priceText: null, priceEurCents: null, taxBasis: "unknown", approval: "unknown", approvalText: null,
    fulfillmentRegion: "unknown", source: { url: "https://shop.example/part", title: "Shop", accessedAt: "2026-10-29T10:00:00.000Z", supports: "x" },
    linkState: "unchecked",
  };
}

describe("loadDemo hardening and loadDemoPreview", () => {
  it("rewraps every image as image/webp bytes and refuses a file without the WebP signature", async () => {
    const { served } = await buildDemo(fx);
    const loaded = await loadDemo(fakeFetch(served).fetchFn, decodeImage);
    for (const blob of loaded.blobsById.values()) expect(blob.type).toBe("image/webp");

    // A file whose size and hash match the manifest but is not a WebP.
    const manifest = JSON.parse(new TextDecoder().decode(served.get("project.json")!));
    const fake = new TextEncoder().encode("not a webp file at all, but long enough");
    manifest.snapshot.images[1].bytes = fake.length;
    manifest.snapshot.images[1].hash = sha(fake);
    const name = manifest.snapshot.images[1].file as string;
    const tampered = new Map(served);
    tampered.set(name, fake);
    tampered.set("project.json", new TextEncoder().encode(JSON.stringify(manifest)));
    await expect(loadDemo(fakeFetch(tampered).fetchFn, decodeImage)).rejects.toThrow(/not a WebP/);
  });

  it("the preview reads the manifest and fetches only the v0 thumbnail, checked against its hash", async () => {
    const { served, manifest } = await buildDemo(fx);
    const { fetchFn, urls } = fakeFetch(served);
    const preview = await loadDemoPreview(fetchFn);
    expect(preview.manifest).toEqual(manifest);
    expect(urls).toEqual(["/demo/project.json", "/demo/v0.webp"]);
    expect(preview.thumbnail.type).toBe("image/webp");
    expect(preview.thumbnail.size).toBe(manifest.snapshot.images.find((i) => i.file === "v0.webp")!.bytes);

    const tampered = new Map(served);
    const v0 = Uint8Array.from(served.get("v0.webp")!);
    v0[v0.length - 1] = (v0[v0.length - 1]! + 1) % 256;
    tampered.set("v0.webp", v0);
    await expect(loadDemoPreview(fakeFetch(tampered).fetchFn)).rejects.toThrow(/hash/);
    const short = new Map(served);
    short.set("v0.webp", v0.slice(0, 20));
    await expect(loadDemoPreview(fakeFetch(short).fetchFn)).rejects.toThrow(/size/);
    await expect(loadDemoPreview(fakeFetch(new Map()).fetchFn)).rejects.toThrow(/could not be loaded/);
  });
});

/** Write the fixture as a "Save project to folder" directory. */
async function writeSource(f: Fixture, source: ProjectSnapshot = f.source, files: Map<string, Uint8Array> = f.files): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "demo-src-"));
  await mkdir(path.join(dir, "masks"));
  await writeFile(path.join(dir, "project.json"), JSON.stringify(source));
  for (const [name, bytes] of files) await writeFile(path.join(dir, name), bytes);
  for (const m of source.masks) await writeFile(path.join(dir, "masks", m.file), f.maskPixels.get(m.id)!);
  await writeFile(path.join(dir, "quote.pdf"), "%PDF-synthetic");
  return dir;
}

describe("packDemo", () => {
  const provenance = ProvenanceInput.parse({ entries: [], promptFiles: [], rights: { credit: "Owner", clearance: "private record" } });
  const run = async (source: ProjectSnapshot = fx.source, files?: Map<string, Uint8Array>) => {
    const srcDir = await writeSource(fx, source, files);
    const outDir = path.join(await mkdtemp(path.join(tmpdir(), "demo-out-")), "demo");
    const result = packDemo({ srcDir, outDir, cachedAt: "2026-10-29T12:00:00.000Z", provenance });
    return { result, outDir };
  };
  const headEdit = (edit: (v: Version) => Version): ProjectSnapshot => ({
    ...fx.source, versions: fx.source.versions.map((v) => (v.id === fx.ids.head ? edit(v) : v)),
  });
  const refused = async (source: ProjectSnapshot, re: RegExp, files?: Map<string, Uint8Array>) => {
    const { result, outDir } = await run(source, files);
    await expect(result).rejects.toThrow(re);
    await expect(readdir(outDir)).rejects.toThrow(); // nothing written, not even the folder
  };

  it("packs, reports published text and the quote source hash, and the output loads and imports", async () => {
    const { result, outDir } = await run();
    const report = await result;
    expect(report.files.sort()).toEqual(["project.json", "quote.pdf", "v0.webp", "v1.webp", "v2.webp", "v3-cutout.webp", "v3.webp", ...report.manifest.masks.map((m) => m.file)].sort());
    expect((await readdir(outDir)).sort()).toEqual([...report.files].sort());
    expect(report.quoteSource.sha256).toBe(sha(new TextEncoder().encode("%PDF-synthetic")));
    expect(report.published.some((p) => p.text === "Green tank")).toBe(true);
    expect(report.published.some((p) => p.field.startsWith("quote."))).toBe(true);
    expect(report.manifest.rights.find((r) => r.file === "v0.webp")!.kind).toBe("owner_photo");
    // The written folder is what the browser reads.
    const served = new Map(await Promise.all((await readdir(outDir)).map(async (n) => [n, new Uint8Array(await readFile(path.join(outDir, n)))] as const)));
    freshIndexedDb();
    const h = await openDreamDb();
    try {
      const imp = await importDemo(h, fakeFetch(served).fetchFn, decodeMask, { decodeImage });
      expect(imp.status).toBe("imported");
    } finally { closeDreamDb(h); }
  });

  it("refuses a non-owner image, a reference edit and a product image URL", async () => {
    const images = fx.source.images.map((i, n) => (n === 1 ? { ...i, rights: "visitor" as const } : i));
    const versions = fx.source.versions.map((v) => (v.image.id === images[1]!.id ? { ...v, image: { ...v.image, rights: "visitor" as const } } : v));
    await refused({ ...fx.source, images, versions }, /rights "visitor"/);

    await refused({
      ...fx.source, versions: fx.source.versions.map((v) => (v.id === fx.ids.v1 ? { ...v, change: { ...v.change!, mode: "reference" as const } } : v)),
    }, /reference-photo edit/);

    await refused(headEdit((v) => ({ ...v, items: v.items.map((it, n) => (n === 0 ? { ...it, product: productWithImage() } : it)) })), /product image URL/);
  });

  it("refuses a head without a fit, without a review, with wrong hashes or without an inspection review", async () => {
    await refused(headEdit((v) => ({ ...v, items: v.items.map((it, n) => (n === 0 ? { ...it, fit: null, fitInputHash: null, fitCheckedAt: null, fitReviewedHash: null } : it)) })), /no fit result/);
    await refused(headEdit((v) => ({ ...v, items: v.items.map((it, n) => (n === 0 ? { ...it, fitReviewedHash: null } : it)) })), /not reviewed/);
    await refused(headEdit((v) => ({ ...v, items: v.items.map((it, n) => (n === 0 ? { ...it, fitInputHash: "a".repeat(64) } : it)) })), /fit input hash/);
    await refused(headEdit((v) => ({ ...v, items: v.items.map((it, n) => (n === 0 ? { ...it, fitReviewedHash: "b".repeat(64) } : it)) })), /review hash/);
    await refused(headEdit((v) => ({ ...v, inspectionReview: null })), /no inspection review/);
    await refused(headEdit((v) => ({ ...v, inspectionReview: { ...v.inspectionReview!, fitInputHash: "c".repeat(64) } })), /inspection review does not match/);
  });

  it("strictFitProblems names the items", async () => {
    const head = fx.source.versions.find((v) => v.id === fx.ids.head)!;
    expect(await strictFitProblems(head, fx.source.project.bikeRevision, EXAMPLE_SETTINGS)).toEqual([]);
    const noFit: Version = { ...head, items: head.items.map((it) => ({ ...it, fit: null })) };
    expect((await strictFitProblems(noFit, fx.source.project.bikeRevision, EXAMPLE_SETTINGS)).join()).toContain("tank: no fit result");
  });

  it("refuses mock fit data", async () => {
    const mockFit = mockFitFor(fx.source.versions.at(-1)!.items[0]!.id, "2026-10-29T10:00:00.000Z");
    await refused(headEdit((v) => ({ ...v, items: v.items.map((it, n) => (n === 0 ? { ...it, fit: mockFit } : it)) })), /mock/i);
  });

  it("writes nothing when an image has the wrong dimensions, and refuses a non-empty output folder", async () => {
    const files = new Map(fx.files);
    const wrong = new Uint8Array(await sharp({ create: { width: 3, height: 3, channels: 3, background: "#123456" } }).webp().toBuffer());
    // Keep size and hash consistent with the listing so only the real dimensions are wrong.
    const target = fx.source.images.find((i) => i.file.length > 0 && fx.files.get(i.file) === bytesOf(1))!;
    const images = fx.source.images.map((i) => (i.id === target.id ? { ...i, bytes: wrong.length, hash: sha(wrong) } : i));
    const versions = fx.source.versions.map((v) => (v.image.id === target.id ? { ...v, image: { ...v.image, bytes: wrong.length, hash: sha(wrong) } } : v));
    files.set(target.file, wrong);
    await refused({ ...fx.source, images, versions }, /not a WebP of 8x4/, files);

    const srcDir = await writeSource(fx);
    const outDir = await mkdtemp(path.join(tmpdir(), "demo-full-"));
    await writeFile(path.join(outDir, "old.txt"), "x");
    await expect(packDemo({ srcDir, outDir, cachedAt: "2026-10-29T12:00:00.000Z", provenance })).rejects.toThrow(DemoPackError);
    expect(await readdir(outDir)).toEqual(["old.txt"]);
  });
});

// Run by the lead against the owner's saved folder; never by the builder or CI.
const packSrc = process.env.DEMO_PACK_SRC;
const packOut = process.env.DEMO_PACK_OUT;
const packProvenance = process.env.DEMO_PROVENANCE;
describe.skipIf(!packSrc || !packOut || !packProvenance)("pack the owner's project (env-gated)", () => {
  it("writes a valid manifest that survives its own schema", async () => {
    const provenance = ProvenanceInput.parse(JSON.parse(await readFile(packProvenance!, "utf8")));
    const report = await packDemo({ srcDir: packSrc!, outDir: packOut!, cachedAt: new Date().toISOString(), provenance });
    const written = DemoManifestSchema.parse(JSON.parse(await readFile(path.join(packOut!, "project.json"), "utf8")));
    expect(written).toEqual(report.manifest);
    expect(written.snapshot.versions.filter((v) => v.kind !== "sheet").length).toBeLessThanOrEqual(4);
    // For the lead's review before anything goes public.
    console.log(`quote source ${report.quoteSource.path} sha256 ${report.quoteSource.sha256}`);
    console.log("PUBLISHED TEXT\n" + report.published.map((p) => `${p.field}: ${p.text}`).join("\n"));
    // The browser path: fresh copy, masks decoded from the packed PNGs, then importProject.
    const blobs = new Map<string, Blob>();
    for (const img of written.snapshot.images) blobs.set(img.id, new Blob([new Uint8Array(await readFile(path.join(packOut!, img.file)))], { type: "image/webp" }));
    const pixels = new Map<string, Uint8Array>();
    for (const m of written.masks) pixels.set(m.id, (await pngToMask(new Uint8Array(await readFile(path.join(packOut!, m.file))))).pixels);
    freshIndexedDb();
    const h = await openDreamDb();
    try {
      const imported = await importProject(h, freshDemoCopy(written.snapshot), blobs, pixels);
      expect(imported.status).toBe("imported");
    } finally { closeDreamDb(h); }
  }, 300_000); // 38 mask conversions plus a full import take longer than the 5 s default.
});

