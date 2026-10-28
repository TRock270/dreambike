"use client";

import { useEffect, useRef, useState } from "react";
import { displayedRect, dragToImageBox, screenToImage, type ImagePoint } from "@/lib/coordinates";
import type { MapPart, NormalizedPhoto } from "@/lib/types";
import { PartOverlay } from "./PartOverlay";

type Props = {
  photo: NormalizedPhoto;
  parts: MapPart[];
  selectedId: string | null;
  onImageClick?: (point: ImagePoint) => void;
  cursor?: "default" | "crosshair";
  /** Drag a rectangle on the photo instead of clicking; clicks never reach onImageClick meanwhile. */
  boxMode?: boolean;
  onBox?: (box: [number, number, number, number]) => void;
};

// origin: the container's client position when the drag began (read in the handler, not while rendering).
// origin is the container rect at pointer down; both the live rectangle and the stored box use it.
type Drag = { start: { x: number; y: number }; end: { x: number; y: number }; origin: { left: number; top: number; width: number; height: number } };

/**
 * Shows the normalized photo contain-fit in the recess trough, with the part
 * overlay placed on exactly the displayed photo rectangle. Clicks are mapped
 * to normalized image pixels with the same math the tests cover.
 */
export function ImageCanvas({ photo, parts, selectedId, onImageClick, cursor = "default", boxMode = false, onBox }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);

  // The object URL is an external resource: create it, hand it to the DOM
  // element, and revoke it when the photo changes or the view unmounts.
  useEffect(() => {
    const objectUrl = URL.createObjectURL(photo.blob);
    if (img.current) img.current.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [photo.blob]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const shown = displayedRect({ left: 0, top: 0, ...size }, photo);
  const place = shown ? { left: shown.left, top: shown.top, width: shown.width, height: shown.height } : { display: "none" };

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (boxMode || !onImageClick || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const point = screenToImage({ x: e.clientX, y: e.clientY }, { left: r.left, top: r.top, width: r.width, height: r.height }, photo);
    if (point) onImageClick(point);
  }

  function containerRect() {
    const r = box.current!.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!boxMode || !box.current || e.button !== 0) return;
    e.preventDefault(); // no text selection while dragging
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = { x: e.clientX, y: e.clientY };
    setDrag({ start: p, end: p, origin: containerRect() });
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (drag) setDrag({ ...drag, end: { x: e.clientX, y: e.clientY } });
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag || !box.current) return;
    setDrag(null);
    if (!boxMode) return; // box mode ended during the drag (Cancel or Escape): nothing is placed
    // The end point is shifted by any scroll since pointer down, so both corners use the pointer-down rect.
    const now = containerRect();
    const end = { x: e.clientX - now.left + drag.origin.left, y: e.clientY - now.top + drag.origin.top };
    const result = dragToImageBox(drag.start, end, drag.origin, photo);
    if (result) onBox?.(result);
  }

  // The live rectangle, clamped to the displayed photo and relative to the container.
  let live: { left: number; top: number; width: number; height: number } | null = null;
  if (drag && shown) {
    const c = drag.origin;
    const clampX = (x: number) => Math.min(shown.left + shown.width, Math.max(shown.left, x - c.left));
    const clampY = (y: number) => Math.min(shown.top + shown.height, Math.max(shown.top, y - c.top));
    const x1 = clampX(drag.start.x), x2 = clampX(drag.end.x), y1 = clampY(drag.start.y), y2 = clampY(drag.end.y);
    live = { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  }

  return (
    <div className="flex h-full w-full flex-col gap-2">
      {photo.warnings.map((w) => (
        <p key={w} role="status" className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-2 font-semibold">⚠</span>{w}
        </p>
      ))}
      <div ref={box} onClick={handleClick} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp} onPointerCancel={() => setDrag(null)}
        className="relative flex-1 min-h-[420px]"
        style={{ cursor: boxMode ? "crosshair" : cursor, touchAction: boxMode ? "none" : undefined }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL, no optimization wanted */}
        <img ref={img} alt="Normalized bike photo" className="absolute select-none" style={place} draggable={false} />
        <div className="absolute" style={place}>
          <PartOverlay parts={parts} selectedId={selectedId} width={photo.width} height={photo.height}
            shownWidth={shown?.width ?? 0} imageHash={photo.hash} />
        </div>
        {live && (
          <div aria-hidden="true" className="pointer-events-none absolute border-2 border-dashed border-accent-fill bg-accent-soft/30"
            style={live} />
        )}
      </div>
      <p className="tabular text-text-muted text-[12px]">
        {photo.width} × {photo.height} px · normalized WebP · {photo.hash.slice(0, 12)}
      </p>
    </div>
  );
}
