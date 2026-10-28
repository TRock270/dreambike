"use client";

import { useEffect, useRef, useState } from "react";
import { displayedRect, screenToImage, type ImagePoint } from "@/lib/coordinates";
import type { MapPart, NormalizedPhoto } from "@/lib/types";
import { PartOverlay } from "./PartOverlay";

type Props = {
  photo: NormalizedPhoto;
  parts: MapPart[];
  selectedId: string | null;
  onImageClick?: (point: ImagePoint) => void;
  cursor?: "default" | "crosshair";
};

/**
 * Shows the normalized photo contain-fit in the recess trough, with the part
 * overlay placed on exactly the displayed photo rectangle. Clicks are mapped
 * to normalized image pixels with the same math the tests cover.
 */
export function ImageCanvas({ photo, parts, selectedId, onImageClick, cursor = "default" }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

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
    if (!onImageClick || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const point = screenToImage({ x: e.clientX, y: e.clientY }, { left: r.left, top: r.top, width: r.width, height: r.height }, photo);
    if (point) onImageClick(point);
  }

  return (
    <div className="flex h-full w-full flex-col gap-2">
      {photo.warnings.map((w) => (
        <p key={w} role="status" className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-2 font-semibold">⚠</span>{w}
        </p>
      ))}
      <div ref={box} onClick={handleClick} className="relative flex-1 min-h-[420px]" style={{ cursor }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL, no optimization wanted */}
        <img ref={img} alt="Normalized bike photo" className="absolute select-none" style={place} draggable={false} />
        <div className="absolute" style={place}>
          <PartOverlay parts={parts} selectedId={selectedId} width={photo.width} height={photo.height}
            shownWidth={shown?.width ?? 0} imageHash={photo.hash} />
        </div>
      </div>
      <p className="tabular text-text-muted text-[12px]">
        {photo.width} × {photo.height} px · normalized WebP · {photo.hash.slice(0, 12)}
      </p>
    </div>
  );
}
