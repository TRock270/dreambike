// Cached demo (SPEC 9, 13). Browser-safe on purpose: a client component imports this file, so
// no sharp, no node:* modules and nothing from src/lib/server. Hashing uses crypto.subtle.
//
// The read-only demo needs only loadDemo (manifest + images, same-origin /demo/* paths).
// "Try editing" calls importDemo, which gives the visitor a fresh independent project copy;
// masks are fetched and decoded only there.
import { DemoFileName, DemoManifest as DemoManifestSchema } from "./contracts";
import { importProject, type DreamDb, type ImportResult } from "./db";
import { pathFromRoot } from "./project";
import type { DemoManifest, ImageRef, ProjectSnapshot, SnapshotImage, Version } from "./types";

export class DemoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoError";
  }
}

export const DEMO_BASE = "/demo/";
export const DEMO_MANIFEST_FILE = "project.json";
const MAX_MANIFEST_BYTES = 2_000_000;

/** Same shape as fetch; tests pass a recorder. */
export type DemoFetch = (url: string, init?: RequestInit) => Promise<Response>;
/** Decode an image file to its pixel size. Injectable so tests need no canvas. */
export type DecodeImage = (blob: Blob) => Promise<{ width: number; height: number }>;
/** Decode a mask PNG to exactly width*height bytes, each 0 or 1. */
export type DecodeMask = (blob: Blob, size: { width: number; height: number }) => Promise<Uint8Array>;

// ------------------------------------------------------------------ fetching

/** The only URL builder: a validated plain file name under /demo/, nothing else. */
export function demoUrl(name: string): string {
  if (!DemoFileName.safeParse(name).success) throw new DemoError(`Demo file name is not allowed: ${name}`);
  return `${DEMO_BASE}${name}`;
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fetch one demo file. redirect "error" keeps a redirect from leaving /demo/. */
async function fetchDemoFile(fetchFn: DemoFetch, name: string, expectedBytes: number | null): Promise<Blob> {
  const res = await fetchFn(demoUrl(name), { credentials: "same-origin", redirect: "error" });
  if (!res.ok) throw new DemoError(`The demo file ${name} could not be loaded (${res.status}).`);
  const declared = res.headers.get("content-length");
  const limit = expectedBytes ?? MAX_MANIFEST_BYTES;
  if (declared !== null && (expectedBytes === null ? Number(declared) > limit : Number(declared) !== limit)) {
    throw new DemoError(`The demo file ${name} has an unexpected size.`);
  }
  return res.blob();
}

async function checkedBinary(fetchFn: DemoFetch, name: string, bytes: number, sha256: string): Promise<Blob> {
  const blob = await fetchDemoFile(fetchFn, name, bytes);
  if (blob.size !== bytes) throw new DemoError(`The demo file ${name} has the wrong size.`);
  if ((await sha256Hex(blob)) !== sha256.toLowerCase()) throw new DemoError(`The demo file ${name} does not match its hash.`);
  return blob;
}

/** createImageBitmap reads the real pixel size of a WebP; used in the browser only. */
export const decodeImageInBrowser: DecodeImage = async (blob) => {
  const bitmap = await createImageBitmap(blob);
  try { return { width: bitmap.width, height: bitmap.height }; } finally { bitmap.close(); }
};

/** Browser decoder for 1-bit PNG masks: white (red channel above 127) is 1. Not used in tests. */
export const decodeMaskInBrowser: DecodeMask = async (blob, { width, height }) => {
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none" });
  try {
    if (bitmap.width !== width || bitmap.height !== height) throw new DemoError("A demo mask has the wrong size.");
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new DemoError("Masks cannot be decoded in this browser.");
    ctx.drawImage(bitmap, 0, 0);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const out = new Uint8Array(width * height);
    for (let i = 0; i < out.length; i++) out[i] = (rgba[i * 4] ?? 0) > 127 ? 1 : 0;
    return out;
  } finally { bitmap.close(); }
};

// ------------------------------------------------------------------- loading

export type LoadedDemo = { manifest: DemoManifest; blobsById: Map<string, Blob> };

/** Read and validate the manifest through the size-capped path (shared by loadDemo and loadDemoPreview). */
async function readManifest(fetchFn: DemoFetch): Promise<DemoManifest> {
  const manifestBlob = await fetchDemoFile(fetchFn, DEMO_MANIFEST_FILE, null);
  if (manifestBlob.size > MAX_MANIFEST_BYTES) throw new DemoError("The demo manifest is too large.");
  let raw: unknown;
  try { raw = JSON.parse(await manifestBlob.text()); } catch { throw new DemoError("The demo manifest is not valid JSON."); }
  const parsed = DemoManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new DemoError(`The demo manifest is not valid: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`.trim());
  }
  return parsed.data;
}

/**
 * Re-wrap verified bytes as a fresh image/webp Blob (the served Content-Type is not trusted) and
 * check the RIFF....WEBP signature.
 */
async function asWebp(blob: Blob, name: string): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const tag = (from: number): string => String.fromCharCode(...bytes.slice(from, from + 4));
  if (bytes.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WEBP") throw new DemoError(`The demo image ${name} is not a WebP file.`);
  return new Blob([bytes], { type: "image/webp" });
}

/** Manifest, then every version image checked against its size, hash, WebP signature and decoded dimensions. */
export async function loadDemo(
  fetchFn: DemoFetch, decodeImage: DecodeImage = decodeImageInBrowser,
): Promise<LoadedDemo> {
  const manifest = await readManifest(fetchFn);
  const blobs = await Promise.all(manifest.snapshot.images.map(async (img) => {
    const blob = await asWebp(await checkedBinary(fetchFn, img.file, img.bytes, img.hash), img.file);
    const size = await decodeImage(blob);
    if (size.width !== img.width || size.height !== img.height) {
      throw new DemoError(`The demo image ${img.file} has the wrong dimensions.`);
    }
    return [img.id, blob] as const;
  }));
  return { manifest, blobsById: new Map(blobs) };
}

/** Manifest plus only the original photo (v0) as a thumbnail, verified like loadDemo does. */
export async function loadDemoPreview(fetchFn: DemoFetch): Promise<{ manifest: DemoManifest; thumbnail: Blob }> {
  const manifest = await readManifest(fetchFn);
  const root = manifest.snapshot.versions.find((v) => v.id === manifest.snapshot.project.rootVersionId);
  const img = manifest.snapshot.images.find((i) => i.id === root?.image.id);
  if (!img) throw new DemoError("The demo has no original photo.");
  const thumbnail = await asWebp(await checkedBinary(fetchFn, img.file, img.bytes, img.hash), img.file);
  return { manifest, thumbnail };
}

// ---------------------------------------------------------------- fresh copy

/**
 * An independent copy for "Try editing". Only the identity of the project and of its versions is
 * new: project.id, root/head ids, version ids, parentId, version.projectId and
 * BuildItem.originVersionId. Item, bike-revision, image and mask ids stay, so fit hashes (which
 * cover the bike revision id and item data) remain valid and images and masks dedupe across copies.
 */
export function freshDemoCopy(snapshot: ProjectSnapshot, newId: () => string = () => crypto.randomUUID()): ProjectSnapshot {
  const projectId = newId();
  const versionIds = new Map(snapshot.versions.map((v) => [v.id, newId()]));
  const map = (id: string): string => {
    const next = versionIds.get(id);
    if (next === undefined) throw new DemoError(`Version ${id} is not part of the demo.`);
    return next;
  };
  const versions: Version[] = snapshot.versions.map((v) => ({
    ...v,
    id: map(v.id), projectId, parentId: v.parentId === null ? null : map(v.parentId),
    items: v.items.map((it) => ({ ...it, originVersionId: map(it.originVersionId) })),
  }));
  return {
    ...snapshot,
    project: { ...snapshot.project, id: projectId, rootVersionId: map(snapshot.project.rootVersionId), headVersionId: map(snapshot.project.headVersionId) },
    versions,
  };
}

// -------------------------------------------------------------------- import

export type ImportDemoOptions = { decodeImage?: DecodeImage; now?: number; newId?: () => string };

/**
 * Try editing: load, copy, fetch and decode the masks (only here), then one atomic importProject.
 * A refusal or any error writes nothing.
 */
export async function importDemo(
  db: DreamDb, fetchFn: DemoFetch, decodeMask: DecodeMask, opts: ImportDemoOptions = {},
): Promise<ImportResult> {
  const { manifest, blobsById } = await loadDemo(fetchFn, opts.decodeImage);
  const copy = freshDemoCopy(manifest.snapshot, opts.newId);
  const pixels = new Map<string, Uint8Array>();
  for (const entry of manifest.masks) {
    const blob = await checkedBinary(fetchFn, entry.file, entry.bytes, entry.sha256);
    const decoded = await decodeMask(blob, { width: entry.width, height: entry.height });
    if (decoded.length !== entry.width * entry.height) throw new DemoError(`The demo mask ${entry.file} decoded to the wrong size.`);
    pixels.set(entry.id, decoded);
  }
  return importProject(db, copy, blobsById, pixels, opts.now ?? Date.now());
}

// ------------------------------------------------------------------- pruning

export type PrunedDemo = {
  snapshot: ProjectSnapshot;
  /** Where each kept image came from (its old file name) and the demo name it gets. */
  imageFiles: { id: string; from: string; to: string }[];
};

/**
 * The pure part of packing: keep only the root-to-head path (the fork branch goes), the images
 * those versions use (including cutouts) and every mask they reference. Images are renamed to
 * v<n>.webp, n = index among root/visual versions (sheet versions add no image); cutouts get
 * v<n>-cutout.webp. Mask file names stay '<id>.bin' (the snapshot rule); the pack writes PNGs.
 */
export function pruneDemoSnapshot(snapshot: ProjectSnapshot): PrunedDemo {
  const { project } = snapshot;
  const path = pathFromRoot(snapshot.versions, project.headVersionId);
  if (path[0]?.id !== project.rootVersionId) throw new DemoError("The head does not lead back to the project root.");

  const imageById = new Map(snapshot.images.map((i) => [i.id, i]));
  const kept = new Map<string, SnapshotImage>();
  const imageFiles: PrunedDemo["imageFiles"] = [];
  const keep = (ref: ImageRef | { id: string }, to: string): void => {
    if (kept.has(ref.id)) return;
    const img = imageById.get(ref.id);
    if (!img) throw new DemoError(`Image ${ref.id} is not listed in the snapshot.`);
    kept.set(img.id, { ...img, file: to });
    imageFiles.push({ id: img.id, from: img.file, to });
  };
  // Name by image index (root = v0, n-th visual = v<n>); sheet versions share their parent's image.
  let n = -1;
  for (const v of path) {
    if (v.kind !== "sheet") n++;
    keep(v.image, `v${Math.max(n, 0)}.webp`);
    if (v.cutoutImageId) keep({ id: v.cutoutImageId }, `v${Math.max(n, 0)}-cutout.webp`);
  }

  const maskIds = new Set(path.flatMap((v) => [...v.parts.map((p) => p.maskId), ...(v.bikeMaskId ? [v.bikeMaskId] : [])]));
  const masks = snapshot.masks.filter((m) => maskIds.has(m.id));
  if (masks.length !== maskIds.size) throw new DemoError("A mask used by the kept versions is not listed in the snapshot.");

  return { snapshot: { ...snapshot, versions: path, images: [...kept.values()], masks }, imageFiles };
}
