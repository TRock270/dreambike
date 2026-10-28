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
import type { BinaryMask, MapPart, PhotoRef, PhraseStatus, SegmentedObject, SlotId } from "../types";
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
  requests: Record<string, "pending" | "done" | "error">;
  pointParts: MapPart[];
  facing: Facing;
  errors: string[];
  warnings: string[];
  done: boolean;
};

export type DerivedMap = { bike: MapPart | null; parts: MapPart[]; phrases: Record<string, PhraseStatus> };

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
  const pointSlots = new Set(state.pointParts.filter((p) => p.slot !== "custom").map((p) => p.slot));
  const parts: MapPart[] = [];
  const phrases: Record<string, PhraseStatus> = {};
  for (const phrase of CORE_PHRASES) {
    const req = state.requests[phrase];
    if (req === "pending" || req === "error") { phrases[phrase] = req; continue; }
    const r = cachedPartsForPhrase(phrase, state.raw[phrase] ?? EMPTY, bike?.mask ?? null, state.facing, state.imageHash);
    phrases[phrase] = r.status;
    // A point selection for a slot replaces the detected part for that slot.
    parts.push(...r.parts.filter((p) => !pointSlots.has(p.slot)));
  }
  parts.push(...state.pointParts.filter((p) => p.imageHash === state.imageHash)
    .map((p) => (bike ? clipPointPart(p, bike.mask) : p)).filter((p): p is MapPart => p !== null));
  return { bike, parts, phrases };
}

function clipPointPart(part: MapPart, bike: BinaryMask): MapPart | null {
  const mask = clipToBike(part.mask, bike);
  return makePart(part.id, part.slot, part.label, mask, "point", part.confidence, part.imageHash);
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
