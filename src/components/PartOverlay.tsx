"use client";

import { useEffect, useRef } from "react";
import { outlinePixels } from "@/lib/parts";
import { slotInfo } from "@/lib/slots";
import type { MapPart } from "@/lib/types";

type Props = {
  parts: MapPart[]; selectedId: string | null; width: number; height: number;
  /** Displayed photo width in CSS px, so the outline stays about 2 screen px. */
  shownWidth: number; imageHash: string;
};

/** Read one series color from the Nordlicht tokens as RGB. */
function seriesRgb(n: number): [number, number, number] {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(`--nl-series-${n}`).trim().replace("#", "");
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0) as [number, number, number];
}

const FILL_ALPHA = 0.35;
const STALE_ALPHA = 0.6;

/**
 * Draws part masks at image resolution: 35% fill and an opaque outline in the
 * fixed slot color, about 2 screen px wide (the selected part gets twice that).
 * Stale parts (not checked on this version) get only a dashed, lighter outline.
 * The parent stretches the canvas over exactly the displayed photo rectangle.
 */
export function PartOverlay({ parts, selectedId, width, height, shownWidth, imageHash }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || shownWidth <= 0) return;
    el.width = width;
    el.height = height;
    const image = ctx.createImageData(width, height);
    const out = image.data;
    const imagePxPerScreenPx = width / shownWidth;
    // Stale parts are drawn first (underneath), then current ones, the selected part last.
    const ordered = [
      ...parts.filter((p) => p.stale),
      ...parts.filter((p) => !p.stale && p.id !== selectedId),
      ...parts.filter((p) => !p.stale && p.id === selectedId),
    ];
    for (const part of ordered) {
      if (part.mask.width !== width || part.mask.height !== height) continue;
      // A stale part keeps the mask of an earlier picture, so its hash differs by design.
      if (!part.stale && part.imageHash !== imageHash) continue;
      const [r, g, b] = seriesRgb(slotInfo(part.slot).series);
      const screenPx = part.id === selectedId ? 4 : 2;
      const [l, t, rr, bb] = part.box;
      const edge = outlinePixels(part.mask, part.box, Math.ceil(screenPx * imagePxPerScreenPx));
      const bw = rr - l;
      for (let y = t; y < bb; y++) {
        for (let x = l; x < rr; x++) {
          const i = y * width + x;
          if (!part.mask.pixels[i]) continue;
          const onEdge = edge[(y - t) * bw + (x - l)];
          // Stale: dashed, half-transparent outline only, no fill. Not checked on this version.
          const a = part.stale ? (onEdge && (((x + y) >> 3) & 1) === 0 ? STALE_ALPHA : 0) : onEdge ? 1 : FILL_ALPHA;
          if (a === 0) continue;
          const o = i * 4;
          // Straight-alpha "over" on whatever earlier parts left in the buffer.
          const prevA = out[o + 3]! / 255;
          const outA = a + prevA * (1 - a);
          const mix = (c: number, prev: number) => Math.round((c * a + prev * prevA * (1 - a)) / outA);
          out[o] = mix(r, out[o]!); out[o + 1] = mix(g, out[o + 1]!); out[o + 2] = mix(b, out[o + 2]!);
          out[o + 3] = Math.round(outA * 255);
        }
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [parts, selectedId, width, height, shownWidth, imageHash]);

  return <canvas ref={canvas} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />;
}
