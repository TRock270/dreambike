// Synthetic, labeled segmentation for MOCK=1 UI work. Shapes are geometric
// placeholders (an ellipse for the bike, two discs for wheels, a disc around
// a clicked point), never a claim about the real photo.
import type { BinaryMask } from "../coordinates";
import { MOCK_LABEL } from "./index";

function ellipse(width: number, height: number, cx: number, cy: number, rx: number, ry: number): BinaryMask {
  const pixels = new Uint8Array(width * height);
  for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(height, Math.ceil(cy + ry)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(width, Math.ceil(cx + rx)); x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) pixels[y * width + x] = 1;
    }
  }
  return { width, height, pixels };
}

export const MOCK_SEGMENT_WARNING = `${MOCK_LABEL}: placeholder shapes, not the real parts.`;

export function mockConcept(width: number, height: number, phrase: string): BinaryMask[] {
  const r = Math.min(width, height) * 0.16;
  switch (phrase) {
    case "motorcycle":
      return [ellipse(width, height, width / 2, height * 0.58, width * 0.4, height * 0.3)];
    case "wheel":
      return [ellipse(width, height, width * 0.26, height * 0.72, r, r), ellipse(width, height, width * 0.74, height * 0.72, r, r)];
    case "fuel tank":
      return [ellipse(width, height, width * 0.5, height * 0.42, width * 0.1, height * 0.06)];
    default:
      return [];
  }
}

export function mockPoints(width: number, height: number, points: readonly { x: number; y: number; label: string }[]): BinaryMask[] {
  const first = points.find((p) => p.label === "positive");
  if (!first) return [];
  const r = Math.max(8, Math.min(width, height) * 0.06);
  return [ellipse(width, height, first.x + 0.5, first.y + 0.5, r, r)];
}
