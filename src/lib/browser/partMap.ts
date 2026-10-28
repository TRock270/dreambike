// Part map for one normalized photo (PLAN.md 9.2–9.3).
//
// Detection only records raw per-phrase results through functional updates
// (`update(s => next)`), so the mechanic's answers (facing, chosen bike,
// point parts) are never overwritten by a late result. The visible parts are
// derived from raw results + bike + facing by the pure `derive` function, with
// stable IDs ("phrase:slot"), so a selection survives re-derivation.
import { PAIRED_SLOTS, acceptableAsPart, assignFrontRear, clipToBike, maskArea, maskBox, unionMasks } from "../parts";
import { runLimited } from "../queue";
import { CORE_PHRASES, SLOTS } from "../slots";
import type { BinaryMask, MapPart, Part, PhotoRef, PhraseStatus, SegmentedObject, SlotId, StoredMask } from "../types";
import { PreflightError } from "./preflight";
import { requestSegment } from "./segmentClient";

export const MAX_IN_FLIGHT = 4;

export type Facing = "left" | "right" | "unknown";

export type PartMapState = {
  imageHash: string;
  /** Motorcycle candidates ranked by area, then confidence. */
  bikeCandidates: SegmentedObject[];
  /** Index into bikeCandidates, "point" for the mechanic's point selection, or null. */
  bikeChoice: number | "point" | null;
  bikePoint: SegmentedObject | null;
  bikeStatus: "pending" | "found" | "none" | "error";
  raw: Record<string, SegmentedObject[]>;
  /** "stale": not detected on this version (after an accepted edit); detection is a manual step. */
  requests: Record<string, "pending" | "done" | "error" | "stale">;
  pointParts: MapPart[];
  facing: Facing;
  errors: string[];
  warnings: string[];
  done: boolean;
  /** The bike outline comes from the previous photo until recutBike replaces it; never persisted. */
  bikeCarried?: boolean;
};

export type DerivedMap = { bike: MapPart | null; parts: MapPart[]; phrases: Record<string, PhraseStatus>;
  /** True while the bike outline is the one carried over from the previous photo (not yet recut). */
  bikeCarried?: boolean };

export function emptyPartMap(imageHash = ""): PartMapState {
  return {
    imageHash, bikeCandidates: [], bikeChoice: null, bikePoint: null, bikeStatus: "pending", raw: {},
    requests: Object.fromEntries(CORE_PHRASES.map((p) => [p, "pending"])), pointParts: [], facing: "unknown",
    errors: [], warnings: [], done: false,
  };
}

function makePart(id: string, slot: SlotId, label: string, mask: BinaryMask, source: "concept" | "point",
  confidence: number | null, imageHash: string): MapPart | null {
  const box = maskBox(mask);
  if (!box) return null;
  return { id, slot, label, mask, area: maskArea(mask), box, source, confidence, stale: false, imageHash };
}

/** Rank bike candidates by pixel area, then confidence (PLAN 9.2). */
export function rankBikes(objects: SegmentedObject[]): SegmentedObject[] {
  return [...objects].sort((a, b) => maskArea(b.mask) - maskArea(a.mask) || (b.confidence ?? 0) - (a.confidence ?? 0));
}

export function currentBike(state: PartMapState): SegmentedObject | null {
  if (state.bikeChoice === "point") return state.bikePoint;
  if (state.bikeChoice === null) return null;
  return state.bikeCandidates[state.bikeChoice] ?? null;
}

/** One phrase's raw objects to slot parts, given the bike mask and facing. */
export function partsForPhrase(phrase: string, objects: SegmentedObject[], bike: BinaryMask | null,
  facing: Facing, imageHash: string): { parts: MapPart[]; status: PhraseStatus } {
  const clipped = objects
    .map((o) => (bike ? { ...o, mask: clipToBike(o.mask, bike) } : o))
    .filter((o) => maskArea(o.mask) > 0 && acceptableAsPart(o.mask, bike));
  if (clipped.length === 0) return { parts: [], status: "none" };
  const pair = PAIRED_SLOTS[phrase];
  if (pair) {
    const assigned = assignFrontRear(clipped.map((o) => maskBox(o.mask)!), facing, bike ? maskBox(bike) : null);
    if (assigned.kind === "needs_facing") return { parts: [], status: "needs_facing" };
    if (assigned.kind === "needs_point") return { parts: [], status: "needs_point" };
    const parts: MapPart[] = [];
    for (const [index, slot] of [[assigned.front, pair[0]], [assigned.rear, pair[1]]] as const) {
      if (index === null) continue;
      const o = clipped[index]!;
      const part = makePart(`${phrase}:${slot}`, slot, SLOTS.find((s) => s.id === slot)!.label, o.mask, "concept", o.confidence, imageHash);
      if (part) parts.push(part);
    }
    return { parts, status: "found" };
  }
  const slot = SLOTS.find((s) => s.core && s.phrase === phrase);
  if (!slot) return { parts: [], status: "none" };
  // All objects of one phrase form one slot (two mirrors, four turn signals),
  // but the union itself must still pass the 60% rule.
  const mask = unionMasks(clipped.map((o) => o.mask))!;
  if (!acceptableAsPart(mask, bike)) return { parts: [], status: "needs_point" };
  const confidence = Math.max(...clipped.map((o) => o.confidence ?? 0)) || null;
  const part = makePart(`${phrase}:${slot.id}`, slot.id, slot.label, mask, "concept", confidence, imageHash);
  return { parts: part ? [part] : [], status: "found" };
}

// derive() runs on every state change; a phrase's parts only change when its
// raw result, the bike mask, the facing, or the photo changes, so cache them.
type PhraseCacheEntry = { raw: SegmentedObject[]; bike: BinaryMask | null; facing: Facing; hash: string;
  result: { parts: MapPart[]; status: PhraseStatus } };
const phraseCache = new Map<string, PhraseCacheEntry>();

function cachedPartsForPhrase(phrase: string, raw: SegmentedObject[], bike: BinaryMask | null, facing: Facing, hash: string) {
  const hit = phraseCache.get(phrase);
  if (hit && hit.raw === raw && hit.bike === bike && hit.facing === facing && hit.hash === hash) return hit.result;
  const result = partsForPhrase(phrase, raw, bike, facing, hash);
  phraseCache.set(phrase, { raw, bike, facing, hash, result });
  return result;
}

const EMPTY: SegmentedObject[] = [];
let bikeCache: { obj: SegmentedObject | null; hash: string; part: MapPart | null; source: string } | null = null;

/** Pure view of the map: bike, selectable parts, and per-phrase status. */
export function derive(state: PartMapState): DerivedMap {
  const bikeObj = currentBike(state);
  const source = state.bikeChoice === "point" ? "point" : "concept";
  // Keep the same bike object (and mask reference) while nothing changed, so the phrase cache hits.
  if (!bikeCache || bikeCache.obj !== bikeObj || bikeCache.hash !== state.imageHash || bikeCache.source !== source) {
    bikeCache = { obj: bikeObj, hash: state.imageHash, source,
      part: bikeObj ? makePart("bike", "custom", "Motorcycle", bikeObj.mask, source, bikeObj.confidence, state.imageHash) : null };
  }
  const bike = bikeCache.part;
  // Stale parts (carried over from an earlier photo) never replace a fresh detection.
  const pointSlots = new Set(state.pointParts.filter((p) => p.slot !== "custom" && !p.stale).map((p) => p.slot));
  const parts: MapPart[] = [];
  const phrases: Record<string, PhraseStatus> = {};
  for (const phrase of CORE_PHRASES) {
    const req = state.requests[phrase];
    if (req === "pending" || req === "error" || req === "stale") { phrases[phrase] = req; continue; }
    const r = cachedPartsForPhrase(phrase, state.raw[phrase] ?? EMPTY, bike?.mask ?? null, state.facing, state.imageHash);
    phrases[phrase] = r.status;
    // A point selection for a slot replaces the detected part for that slot.
    parts.push(...r.parts.filter((p) => !pointSlots.has(p.slot)));
  }
  // Fresh parts must belong to this photo. Stale parts keep their old hash and stay as they are
  // (visible, never selectable); a slot that has a fresh part drops its stale one.
  const fresh = state.pointParts.filter((p) => !p.stale && p.imageHash === state.imageHash)
    .map((p) => (bike ? clipPointPart(p, bike.mask) : p)).filter((p): p is MapPart => p !== null);
  parts.push(...fresh);
  const freshSlots = new Set(parts.map((p) => p.slot));
  parts.push(...state.pointParts.filter((p) => p.stale && (p.slot === "custom" || !freshSlots.has(p.slot))));
  return { bike, parts, phrases, bikeCarried: !!state.bikeCarried && state.bikeChoice !== "point" };
}

// Keeps source and the stale flag; only the mask is clipped.
function clipPointPart(part: MapPart, bike: BinaryMask): MapPart | null {
  const made = makePart(part.id, part.slot, part.label, clipToBike(part.mask, bike), part.source, part.confidence, part.imageHash);
  return made && { ...made, stale: part.stale };
}

type Update = (fn: (s: PartMapState) => PartMapState) => void;

/**
 * Bike outline first (so parts can be clipped), then the 14 core phrases with
 * at most MAX_IN_FLIGHT requests. Only raw results are written; failures leave
 * earlier results usable.
 */
export async function buildPartMap(photo: PhotoRef, update: Update, signal?: AbortSignal): Promise<void> {
  const same = (s: PartMapState) => s.imageHash === photo.hash;
  try {
    const cut = await requestSegment(photo, { mode: "concept", phrase: "motorcycle" }, signal);
    const ranked = rankBikes(cut.objects);
    update((s) => (!same(s) ? s : {
      ...s, bikeCandidates: ranked, bikeChoice: s.bikeChoice ?? (ranked.length ? 0 : null),
      bikeStatus: ranked.length ? "found" : "none", warnings: [...new Set([...s.warnings, ...cut.warnings])],
    }));
  } catch (error) {
    if (signal?.aborted) return;
    update((s) => (!same(s) ? s : { ...s, bikeStatus: "error", errors: [...s.errors, messageOf(error, "Bike outline")] }));
  }
  if (signal?.aborted) return;
  await runLimited(CORE_PHRASES.map((phrase) => () => requestSegment(photo, { mode: "concept", phrase }, signal)),
    MAX_IN_FLIGHT, (index, settled) => {
      if (signal?.aborted) return;
      const phrase = CORE_PHRASES[index]!;
      update((s) => {
        if (!same(s)) return s;
        if (!settled.ok) {
          return { ...s, requests: { ...s.requests, [phrase]: "error" }, errors: [...s.errors, messageOf(settled.error, phrase)] };
        }
        return { ...s, requests: { ...s.requests, [phrase]: "done" }, raw: { ...s.raw, [phrase]: settled.value.objects },
          warnings: [...new Set([...s.warnings, ...settled.value.warnings])] };
      });
    });
  update((s) => (!same(s) ? s : { ...s, done: true }));
}

let pointCounter = 0;

/**
 * Point selection. target "bike" recovers the bike outline (no 60% rule);
 * any other target is a part: clipped to the bike, must contain the clicked
 * pixel, and may not cover more than 60% of the bike.
 */
export async function selectByPoint(photo: PhotoRef, point: { x: number; y: number },
  target: { kind: "bike" } | { kind: "part"; slot: SlotId; label: string }, bike: BinaryMask | null,
  signal?: AbortSignal): Promise<{ bike: SegmentedObject } | { part: MapPart }> {
  const res = await requestSegment(photo, { mode: "points", points: [{ ...point, label: "positive" }] }, signal);
  const at = (m: BinaryMask) => m.pixels[point.y * m.width + point.x] === 1;
  if (target.kind === "bike") {
    const best = rankBikes(res.objects.filter((o) => at(o.mask)))[0];
    if (!best) throw new PreflightError("NO_RESULT", "No bike outline was found at that point. Try the middle of the bike.");
    return { bike: best };
  }
  const candidates = res.objects
    .map((o) => (bike ? { ...o, mask: clipToBike(o.mask, bike) } : o))
    .filter((o) => maskArea(o.mask) > 0 && at(o.mask))
    .sort((a, b) => maskArea(a.mask) - maskArea(b.mask));
  if (candidates.length === 0) {
    throw new PreflightError("NO_RESULT", bike ? "That point is outside the bike outline. Click on the part itself."
      : "Nothing was found at that point. Try a point closer to the part's center.");
  }
  const best = candidates.find((o) => acceptableAsPart(o.mask, bike));
  if (!best) throw new PreflightError("NO_RESULT", "That selection covers most of the bike. Click on the part itself.");
  const part = makePart(`point:${target.slot}:${pointCounter++}`, target.slot, target.label, best.mask, "point",
    best.confidence, photo.hash);
  if (!part) throw new PreflightError("NO_RESULT", "Nothing was found at that point.");
  return { part };
}

function messageOf(error: unknown, what: string): string {
  return `${what}: ${error instanceof PreflightError ? error.message : "detection failed"}`;
}

/** The part map for an accepted edit: no automatic re-detection (PLAN 9.3), only the refreshed part. */
export function partMapAfterEdit(previous: PartMapState, imageHash: string, refreshed: MapPart | null,
  sameSize: boolean): PartMapState {
  // For a same-size result the old outline stays in use until the background recut replaces it,
  // so the blend radius keeps coming from the bike, not from the photo width.
  const keep = sameSize ? currentBike(previous) : null;
  // Other parts of a same-size result stay on the map as stale (SPEC 9): shown, not selectable.
  // A size change drops them, because their masks no longer fit the raster.
  const inherited = sameSize
    ? derive(previous).parts.filter((p) => p.slot === "custom" || p.slot !== refreshed?.slot).map((p) => ({ ...p, stale: true }))
    : [];
  return { ...emptyPartMap(imageHash), facing: previous.facing, done: true,
    bikeCandidates: keep ? [keep] : [], bikeChoice: keep ? 0 : null, bikeStatus: keep ? "found" : "pending", bikeCarried: !!keep,
    requests: Object.fromEntries(CORE_PHRASES.map((p) => [p, "stale"])), pointParts: refreshed ? [refreshed, ...inherited] : inherited };
}

/** Re-detect the outline of the bike only (after an accepted edit). */
export async function recutBike(photo: PhotoRef, update: Update, signal?: AbortSignal): Promise<void> {
  try {
    const cut = await requestSegment(photo, { mode: "concept", phrase: "motorcycle" }, signal);
    const ranked = rankBikes(cut.objects);
    update((s) => (s.imageHash !== photo.hash ? s : { ...s, bikeCandidates: ranked, bikeChoice: ranked.length ? 0 : null,
      bikeStatus: ranked.length ? "found" : "none", bikeCarried: false }));
  } catch (error) {
    if (signal?.aborted) return;
    update((s) => (s.imageHash !== photo.hash ? s : { ...s, bikeStatus: "error", errors: [...s.errors, messageOf(error, "Bike outline")] }));
  }
}

/** Make a part from a mask (used for the edited part after an accepted render). */
export function refreshedPart(slot: SlotId, label: string, mask: BinaryMask, imageHash: string): MapPart | null {
  return makePart(`point:${slot}:accepted:${imageHash.slice(0, 12)}`, slot, label, mask, "point", null, imageHash);
}

// ---- Persistence glue (SPEC 9): pure conversions, no IndexedDB ----

/** A StoredMask to a BinaryMask; wrong size, wrong hash, or non-0/1 bytes are rejected. */
export function storedMaskToBinary(m: StoredMask, expectedHash?: string): BinaryMask {
  if (expectedHash !== undefined && m.imageHash !== expectedHash) throw new Error(`Mask ${m.id} belongs to another photo.`);
  checkPixels(m.id, m.width, m.height, m.pixels);
  return { width: m.width, height: m.height, pixels: m.pixels.slice() };
}

/** A BinaryMask to a StoredMask for one image hash; bytes are copied and checked. */
export function binaryToStoredMask(mask: BinaryMask, imageHash: string, id: string, now: number): StoredMask {
  checkPixels(id, mask.width, mask.height, mask.pixels);
  return { id, imageHash, width: mask.width, height: mask.height, pixels: mask.pixels.slice(), createdAt: now };
}

function checkPixels(id: string, width: number, height: number, pixels: Uint8Array): void {
  if (pixels.length !== width * height) throw new Error(`Mask ${id} has ${pixels.length} bytes, expected ${width * height}.`);
  for (let i = 0; i < pixels.length; i++) if (pixels[i] !== 0 && pixels[i] !== 1) throw new Error(`Mask ${id} has a byte that is not 0 or 1.`);
}

export type RestoredPart = { part: Part; mask: StoredMask };

/**
 * The map for a reopened version. Nothing runs automatically: phrases without a restored part
 * stay "stale", which shows "Detect parts again". Non-stale parts must have a mask for this exact
 * photo; stale ones keep their old mask (older hash) and are shown disabled.
 */
export function restoredPartMap(photo: { hash: string; width: number; height: number }, bike: BinaryMask | null,
  parts: RestoredPart[], facing: Facing): PartMapState {
  const imageHash = photo.hash;
  const fits = (m: BinaryMask) => m.width === photo.width && m.height === photo.height;
  if (bike && !fits(bike)) throw new Error("The bike outline does not match the photo size.");
  const mapParts: MapPart[] = parts.map(({ part, mask }) => {
    const binary = storedMaskToBinary(mask, part.stale ? undefined : imageHash);
    if (!fits(binary)) throw new Error(`Mask ${mask.id} does not match the photo size.`);
    return { id: part.id, slot: part.slot, label: part.label, mask: binary, area: part.area, box: part.box, source: part.source,
      confidence: part.confidence, stale: part.stale, imageHash: part.stale ? mask.imageHash : imageHash };
  });
  const bikeBox = bike ? maskBox(bike) : null;
  const candidate: SegmentedObject | null = bike && bikeBox ? { mask: bike, box: bikeBox, confidence: null } : null;
  return { ...emptyPartMap(imageHash), facing, done: true,
    bikeCandidates: candidate ? [candidate] : [], bikeChoice: candidate ? 0 : null, bikeStatus: candidate ? "found" : "none",
    requests: Object.fromEntries(CORE_PHRASES.map((p) => [p, "stale"])), pointParts: mapParts };
}

export type PersistedParts = { bikeMask: StoredMask | null; parts: Part[]; masks: StoredMask[] };

/**
 * The derived view as Part[] plus StoredMask records for attachParts. Fresh masks are stored
 * under imageHash. A stale part reuses its old maskId from existingMaskIds (no new record);
 * without one, its mask is stored under the part's own older hash.
 */
export function partsToPersisted(view: DerivedMap, imageHash: string, newId: () => string, now: number,
  existingMaskIds: ReadonlyMap<string, string> = new Map()): PersistedParts {
  const masks: StoredMask[] = [];
  const bikeMask = view.bike && !view.bikeCarried ? binaryToStoredMask(view.bike.mask, imageHash, newId(), now) : null;
  const parts: Part[] = view.parts.map((p) => {
    let maskId = p.stale ? existingMaskIds.get(p.id) : undefined;
    if (!maskId) {
      if (!p.stale && p.imageHash !== imageHash) throw new Error(`Part ${p.id} belongs to another photo.`);
      const stored = binaryToStoredMask(p.mask, p.stale ? p.imageHash : imageHash, newId(), now);
      masks.push(stored);
      maskId = stored.id;
    }
    return { id: p.id, slot: p.slot, label: p.label, box: p.box, maskId, area: p.area, source: p.source,
      confidence: p.confidence, stale: p.stale };
  });
  return { bikeMask, parts, masks };
}
