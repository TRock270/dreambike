"use client";

import { useEffect, useRef, useState } from "react";

type Img = { blob: Blob; width: number; height: number };

function useObjectUrl(blob: Blob): React.RefObject<HTMLImageElement | null> {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    if (ref.current) ref.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return ref;
}

/**
 * Before/after view. A slider only when both images share one size and the
 * result is aligned; otherwise side by side, with no pixel-alignment promise.
 */
export function BeforeAfter({ before, after, aligned }: { before: Img; after: Img; aligned: boolean }) {
  const [split, setSplit] = useState(50);
  const beforeRef = useObjectUrl(before.blob);
  const afterRef = useObjectUrl(after.blob);
  const sameSize = before.width === after.width && before.height === after.height;

  if (aligned && sameSize) {
    return (
      <div className="flex flex-col gap-2">
        <div className="relative w-full overflow-hidden rounded-inner bg-recess" style={{ aspectRatio: `${before.width} / ${before.height}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob URLs */}
          <img ref={afterRef} alt="After the change" className="absolute inset-0 h-full w-full object-contain" />
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob URLs */}
          <img ref={beforeRef} alt="Before the change" className="absolute inset-0 h-full w-full object-contain"
            style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />
          <div aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-primary" style={{ left: `${split}%` }} />
        </div>
        <label className="flex items-center gap-2 text-[12px] text-text-secondary">
          Before
          <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} className="flex-1 accent-primary" />
          After
        </label>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {[{ ref: beforeRef, label: "Before", img: before }, { ref: afterRef, label: "After", img: after }].map(({ ref, label, img }) => (
        <figure key={label} className="flex flex-col gap-1">
          <div className="relative w-full rounded-inner bg-recess" style={{ aspectRatio: `${img.width} / ${img.height}` }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob URLs */}
            <img ref={ref} alt={`${label} the change`} className="absolute inset-0 h-full w-full object-contain" />
          </div>
          <figcaption className="text-[12px] text-text-secondary">{label} · <span className="tabular">{img.width} × {img.height}</span></figcaption>
        </figure>
      ))}
    </div>
  );
}
