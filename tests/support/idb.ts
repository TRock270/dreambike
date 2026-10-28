// Test helpers: a fresh fake IndexedDB per test plus builders for images, masks and projects.
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { BikeRevision } from "@/lib/contracts";
import { newProject, newRootVersion } from "@/lib/project";
import type { Part, Project, StoredImage, StoredMask, Version } from "@/lib/types";

/** Replace the global IndexedDB with an empty one. idb reads `indexedDB` at open time. */
export function freshIndexedDb(): IDBFactory {
  const factory = new IDBFactory();
  Object.assign(globalThis, { indexedDB: factory, IDBKeyRange });
  return factory;
}

export const uuid = (): string => crypto.randomUUID();
/** A 64-character hex hash made of one repeated character (unique per char). */
export const hash = (c: string): string => c.repeat(64);

export const W = 8;
export const H = 4;

export function makeImage(c: string, size = 10): StoredImage {
  const blob = new Blob([new Uint8Array(size).fill(c.charCodeAt(0))]);
  return {
    id: uuid(), hash: hash(c), width: W, height: H, bytes: blob.size, rights: "owner",
    blob, lastAccessedAt: 1,
  };
}

export function makeMask(imageHash: string, w = W, h = H): StoredMask {
  const pixels = new Uint8Array(w * h);
  pixels[0] = 1;
  return { id: uuid(), imageHash, width: w, height: h, pixels, createdAt: 1 };
}

export function makePart(slot: Part["slot"], mask: StoredMask, stale = false): Part {
  return {
    id: `p:${slot}`, slot, label: slot, box: [0, 0, 4, 2], maskId: mask.id, area: 1,
    source: "concept", confidence: 0.9, stale,
  };
}

export const bikeRevision = BikeRevision.parse({
  id: uuid(), confirmed: true, revision: 1, confirmedAt: 5,
  bike: {
    make: null, model: null, family: "unknown", engine: null, yearFrom: null, yearTo: null,
    abs: "unknown", style: null, facing: "left", confidence: 0.5, limitations: [],
  },
});

export function makeProject(c = "a", now = new Date(2026, 9, 28, 9, 5)): { project: Project; rootVersion: Version; image: StoredImage } {
  const image = makeImage(c);
  const projectId = uuid();
  const rootId = uuid();
  const rootVersion = newRootVersion({
    id: rootId, projectId, createdAt: now.getTime(),
    image: { id: image.id, hash: image.hash, width: image.width, height: image.height, bytes: image.bytes, rights: "owner" },
  });
  const project = newProject({ id: projectId, rootVersionId: rootId, bikeRevision, now });
  return { project, rootVersion, image };
}
