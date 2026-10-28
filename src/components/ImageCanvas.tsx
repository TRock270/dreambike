"use client";

import { useEffect, useRef } from "react";
import type { NormalizedPhoto } from "@/lib/types";

/**
 * Shows the normalized photo with contain-fit inside the recess trough.
 * Overlays and click mapping (T3) use this same normalized raster.
 */
export function ImageCanvas({ photo }: { photo: NormalizedPhoto }) {
  const img = useRef<HTMLImageElement>(null);
  // The object URL is an external resource: create it, hand it to the DOM
  // element, and revoke it when the photo changes or the view unmounts.
  useEffect(() => {
    const objectUrl = URL.createObjectURL(photo.blob);
    if (img.current) img.current.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [photo.blob]);

  return (
    <div className="flex h-full w-full flex-col gap-2">
      {photo.warnings.map((w) => (
        <p key={w} role="status" className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text text-[13px]">
          <span aria-hidden="true" className="mr-2 font-semibold">⚠</span>{w}
        </p>
      ))}
      <div className="relative flex-1 min-h-[420px]">
        {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL, no optimization wanted */}
        <img ref={img} alt="Normalized bike photo" className="absolute inset-0 h-full w-full object-contain" />
      </div>
      <p className="tabular text-text-muted text-[12px]">
        {photo.width} × {photo.height} px · normalized WebP · {photo.hash.slice(0, 12)}
      </p>
    </div>
  );
}
