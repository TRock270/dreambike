// Display-to-image point conversion and part hit testing (SPEC.md 7 and 9.3).
// Every coordinate refers to the one oriented, normalized bitmap. Pure module:
// used by the browser overlay and by offline tests.
import type { BinaryMask, SlotId } from "./types";

export type { BinaryMask };

export type Rect = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };
export type ImagePoint = { x: number; y: number };

/** Where a contain-fit image actually sits inside its container (letterbox removed). */
export function displayedRect(container: Rect, image: Size): Rect | null {
  if (container.width <= 0 || container.height <= 0 || image.width <= 0 || image.height <= 0) return null;
  const scale = Math.min(container.width / image.width, container.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    left: container.left + (container.width - width) / 2,
    top: container.top + (container.height - height) / 2,
    width, height,
  };
}

/**
 * Map a click (client coordinates) to an image pixel, or null when it lands
 * in the letterbox. Floors to the containing pixel, then clamps to
 * width-1/height-1 (SPEC 7 correction of 2026-10-27).
 */
export function screenToImage(point: { x: number; y: number }, container: Rect, image: Size): ImagePoint | null {
  const shown = displayedRect(container, image);
  if (!shown) return null;
  const rx = point.x - shown.left;
  const ry = point.y - shown.top;
  if (rx < 0 || ry < 0 || rx >= shown.width || ry >= shown.height) return null;
  return {
    x: Math.min(image.width - 1, Math.max(0, Math.floor((rx * image.width) / shown.width))),
    y: Math.min(image.height - 1, Math.max(0, Math.floor((ry * image.height) / shown.height))),
  };
}

/** Smallest side of a dragged box, in image pixels. */
export const MIN_BOX_SIDE = 8;

/**
 * A drag (two client points) to a half-open image box [left, top, right, bottom).
 * Each point is clamped to the displayed photo rectangle first, so a drag that ends in
 * the letterbox or outside the element still gives a box. Pixels use the same
 * floor/clamp rule as screenToImage; right/bottom are the largest pixel + 1.
 * Corners may come in any order. Null when either side is under MIN_BOX_SIDE px.
 */
export function dragToImageBox(start: { x: number; y: number }, end: { x: number; y: number }, container: Rect,
  image: Size): [number, number, number, number] | null {
  const shown = displayedRect(container, image);
  if (!shown) return null;
  const toPixel = (p: { x: number; y: number }): ImagePoint => {
    const rx = Math.min(shown.width, Math.max(0, p.x - shown.left));
    const ry = Math.min(shown.height, Math.max(0, p.y - shown.top));
    return {
      x: Math.min(image.width - 1, Math.max(0, Math.floor((rx * image.width) / shown.width))),
      y: Math.min(image.height - 1, Math.max(0, Math.floor((ry * image.height) / shown.height))),
    };
  };
  const a = toPixel(start), b = toPixel(end);
  const left = Math.min(a.x, b.x), top = Math.min(a.y, b.y);
  const right = Math.min(image.width, Math.max(a.x, b.x) + 1), bottom = Math.min(image.height, Math.max(a.y, b.y) + 1);
  if (right - left < MIN_BOX_SIDE || bottom - top < MIN_BOX_SIDE) return null;
  return [left, top, right, bottom];
}

export type HitPart = { id: string; slot: SlotId; mask: BinaryMask; area: number; stale: boolean; imageHash?: string };

/**
 * The part under a pixel: the smallest non-stale mask that contains it wins
 * an overlap (PLAN 9.3). Masks for a different image (size or hash) never match.
 * `<P extends HitPart>` returns the caller's own part type, not just HitPart.
 */
export function hitTest<P extends HitPart>(parts: readonly P[], point: ImagePoint,
  image: Size & { hash?: string }): P | null {
  let best: P | null = null;
  for (const part of parts) {
    const m = part.mask;
    if (part.stale || m.width !== image.width || m.height !== image.height) continue;
    // A mask from another photo of the same size must never be clickable.
    if (image.hash !== undefined && part.imageHash !== image.hash) continue;
    if (m.pixels[point.y * m.width + point.x] !== 1) continue;
    if (!best || part.area < best.area) best = part;
  }
  return best;
}
