// Part-map rules (PLAN.md 9.3): clip part masks to the bike, assign front/rear
// by x position and confirmed facing, and reject a "part" that covers most of
// the bike. Pure functions over full-image binary masks.
import type { BinaryMask, SlotId } from "./types";

/** A point part covering more than this share of bike pixels is not a part. */
export const MAX_PART_SHARE_OF_BIKE = 0.6;

export function maskArea(mask: BinaryMask): number {
  let n = 0;
  for (const v of mask.pixels) n += v;
  return n;
}

/** Half-open bounding box [left, top, right, bottom) of the set pixels, or null when empty. */
export function maskBox(mask: BinaryMask): [number, number, number, number] | null {
  let left = mask.width, top = mask.height, right = -1, bottom = -1;
  for (let y = 0; y < mask.height; y++) {
    const row = y * mask.width;
    for (let x = 0; x < mask.width; x++) {
      if (mask.pixels[row + x]) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        bottom = y;
      }
    }
  }
  return right < 0 ? null : [left, top, right + 1, bottom + 1];
}

function sameSize(a: BinaryMask, b: BinaryMask): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error("mask dimensions differ; masks are never resized silently");
  }
}

/** Part ∩ bike. */
export function clipToBike(part: BinaryMask, bike: BinaryMask): BinaryMask {
  sameSize(part, bike);
  // Plain loop: about 3 M pixels per call, so avoid a per-pixel callback.
  const pixels = new Uint8Array(part.pixels.length);
  const a = part.pixels, b = bike.pixels;
  for (let i = 0; i < pixels.length; i++) pixels[i] = a[i]! & b[i]!;
  return { width: part.width, height: part.height, pixels };
}

/** Share of bike pixels the part covers (0..1). */
export function shareOfBike(part: BinaryMask, bike: BinaryMask): number {
  sameSize(part, bike);
  const bikeArea = maskArea(bike);
  if (bikeArea === 0) return 0;
  let both = 0;
  for (let i = 0; i < part.pixels.length; i++) both += part.pixels[i]! & bike.pixels[i]!;
  return both / bikeArea;
}

/** True when a selected mask may be used as a part (cutout mode accepts anything). */
export function acceptableAsPart(part: BinaryMask, bike: BinaryMask | null): boolean {
  return bike === null || shareOfBike(part, bike) <= MAX_PART_SHARE_OF_BIKE;
}

export type PairAssignment =
  | { kind: "assigned"; front: number | null; rear: number | null }
  | { kind: "needs_facing" }
  | { kind: "needs_point"; reason: string };

/**
 * Assign wheel or fender objects to front/rear by box center x and the
 * confirmed facing ("right" = front wheel on the right side of the image).
 * One object spanning both ends is merged: ask for a point instead of
 * splitting pixels. More than two objects is ambiguous too.
 */
export function assignFrontRear(boxes: readonly [number, number, number, number][],
  facing: "left" | "right" | "unknown", bikeBox: [number, number, number, number] | null): PairAssignment {
  if (boxes.length === 0) return { kind: "assigned", front: null, rear: null };
  if (boxes.length > 2) return { kind: "needs_point", reason: "More than two candidates were found." };
  if (facing === "unknown") return { kind: "needs_facing" };
  if (bikeBox) {
    const bikeWidth = bikeBox[2] - bikeBox[0];
    const merged = boxes.find((b) => b[2] - b[0] > 0.6 * bikeWidth);
    if (merged) return { kind: "needs_point", reason: "Front and rear were found as one shape." };
  }
  if (!bikeBox) return { kind: "needs_point", reason: "Cannot tell front from rear without the bike outline." };
  const centers = boxes.map((b, i) => ({ i, cx: (b[0] + b[2]) / 2 }));
  centers.sort((a, b) => a.cx - b.cx);
  const leftmost = centers[0]!.i;
  const rightmost = centers[centers.length - 1]!.i;
  if (boxes.length === 1) {
    if (!bikeBox) return { kind: "needs_point", reason: "Cannot tell front from rear without the bike outline." };
    const onRightHalf = (boxes[0]![0] + boxes[0]![2]) / 2 > (bikeBox[0] + bikeBox[2]) / 2;
    const isFront = onRightHalf === (facing === "right");
    return { kind: "assigned", front: isFront ? 0 : null, rear: isFront ? null : 0 };
  }
  // Two candidates on the same half of the bike are duplicates of one part, not a pair.
  if (bikeBox) {
    const mid = (bikeBox[0] + bikeBox[2]) / 2;
    if ((centers[0]!.cx < mid) === (centers[1]!.cx < mid)) {
      return { kind: "needs_point", reason: "Both candidates are on the same side of the bike." };
    }
  }
  return facing === "right"
    ? { kind: "assigned", front: rightmost, rear: leftmost }
    : { kind: "assigned", front: leftmost, rear: rightmost };
}

/** Union of masks of one size (one slot can be several objects, e.g. two mirrors). */
export function unionMasks(masks: readonly BinaryMask[]): BinaryMask | null {
  if (masks.length === 0) return null;
  const first = masks[0]!;
  const pixels = new Uint8Array(first.pixels.length);
  for (const m of masks) {
    sameSize(m, first);
    for (let i = 0; i < pixels.length; i++) pixels[i] = pixels[i]! | m.pixels[i]!;
  }
  return { width: first.width, height: first.height, pixels };
}

/**
 * Outline pixels of a mask inside its box: set pixels with an unset pixel (or
 * the image border) within `thickness` steps (square window). Separable
 * erosion: a horizontal pass, then a vertical pass. Returns a box-sized array.
 */
export function outlinePixels(mask: BinaryMask, box: [number, number, number, number], thickness: number): Uint8Array {
  const [l, t, r, b] = box;
  const w = r - l, h = b - t, k = Math.max(1, Math.round(thickness));
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= mask.width || y >= mask.height ? 0 : mask.pixels[y * mask.width + x]!);
  // Horizontal erosion over rows t-k..b+k so the vertical pass has its neighbors.
  const rows = h + 2 * k;
  const horiz = new Uint8Array(w * rows);
  for (let ry = 0; ry < rows; ry++) {
    const y = t - k + ry;
    for (let x = l; x < r; x++) {
      let all = 1;
      for (let dx = -k; dx <= k && all; dx++) all = at(x + dx, y);
      horiz[ry * w + (x - l)] = all;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(l + x, t + y)) continue;
      let all = 1;
      for (let dy = -k; dy <= k && all; dy++) all = horiz[(y + k + dy) * w + x]!;
      out[y * w + x] = all ? 0 : 1;
    }
  }
  return out;
}

/** The slots one shared SAM phrase fills. */
export const PAIRED_SLOTS: Partial<Record<string, readonly [SlotId, SlotId]>> = {
  wheel: ["wheel_front", "wheel_rear"],
  fender: ["fender_front", "fender_rear"],
};
