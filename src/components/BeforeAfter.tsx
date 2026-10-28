"use client";

import { useEffect, useRef, useState } from "react";
import { MOCK_LABEL } from "@/lib/mocks";

type Img = { blob: Blob; width: number; height: number };
type Urls = { before: string | null; after: string | null };
type Size = "small" | "fit" | "actual";

/**
 * Turns a Blob into a blob: URL kept in state, so any <img src={url}> that
 * mounts later (like inside the dialog) still gets it. The effect cleanup
 * revokes the URL when the blob changes and on unmount.
 */
function useObjectUrl(blob: Blob): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const made = URL.createObjectURL(blob);
    // A blob URL is an external resource made and revoked here, so state is set in the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(made);
    return () => {
      URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [blob]);
  return url;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** dreambike-preview[-MOCK]-YYYYMMDD-HHMM.jpg in local time. */
function downloadName(mock: boolean, now = new Date()): string {
  const day = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `dreambike-preview${mock ? "-MOCK" : ""}-${day}-${time}.jpg`;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Demo results are visibly labeled (CLAUDE.md): a mock file carries the label in its pixels, not only its name. */
function drawMockLabel(ctx: Ctx, width: number) {
  const size = Math.max(16, Math.round(width / 60));
  ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
  ctx.fillRect(0, 0, width, size * 2);
  ctx.fillStyle = "white";
  ctx.font = `${size}px sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText(`MOCK: ${MOCK_LABEL}`, size / 2, size);
}

/** Re-encode the blob as JPEG on this device. Nothing is uploaded. */
async function toJpeg(blob: Blob, mock: boolean): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.drawImage(bitmap, 0, 0);
      if (mock) drawMockLabel(ctx, bitmap.width);
      return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
    }
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(bitmap, 0, 0);
    if (mock) drawMockLabel(ctx, bitmap.width);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.92));
  } finally {
    bitmap.close();
  }
}

/** One view of the pair: slider when aligned and same size, else side by side. */
function View({ before, after, urls, aligned, split, size }: {
  before: Img; after: Img; urls: Urls; aligned: boolean; split: number; size: Size;
}) {
  const sameSize = before.width === after.width && before.height === after.height;
  const slider = aligned && sameSize;
  // Fit: as wide as fits 95% of the window width, with the tallest image at most 70% of its height
  // (the rest is left for the buttons, slider and note). Side by side, the narrower aspect decides.
  const cols = slider ? 1 : 2;
  const aspect = Math.min(before.width / before.height, after.width / after.height);
  const fitWidth = `min(95vw, calc(70vh * ${cols * aspect}))`;

  if (slider) {
    const box: React.CSSProperties = size === "small"
      ? { aspectRatio: `${before.width} / ${before.height}` }
      : size === "fit"
        ? { aspectRatio: `${before.width} / ${before.height}`, width: fitWidth }
        : { width: before.width, height: before.height };
    return (
      <div className={`relative overflow-hidden rounded-inner bg-recess ${size === "small" ? "w-full" : "shrink-0"}`} style={box}>
        {/* eslint-disable-next-line @next/next/no-img-element -- local blob URLs */}
        <img src={urls.after ?? undefined} alt="After the change" className="absolute inset-0 h-full w-full object-contain" />
        {/* eslint-disable-next-line @next/next/no-img-element -- local blob URLs */}
        <img src={urls.before ?? undefined} alt="Before the change" className="absolute inset-0 h-full w-full object-contain"
          style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} />
        <div aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-primary" style={{ left: `${split}%` }} />
      </div>
    );
  }
  const items = [{ url: urls.before, label: "Before", img: before }, { url: urls.after, label: "After", img: after }];
  return (
    <div className={size === "actual" ? "flex gap-2" : "grid grid-cols-2 gap-2"} style={size === "fit" ? { width: fitWidth } : undefined}>
      {items.map(({ url, label, img }) => (
        <figure key={label} className="flex flex-col gap-1">
          <div className="relative rounded-inner bg-recess"
            style={size === "actual" ? { width: img.width, height: img.height } : { width: "100%", aspectRatio: `${img.width} / ${img.height}` }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob URLs */}
            <img src={url ?? undefined} alt={`${label} the change`} className="absolute inset-0 h-full w-full object-contain" />
          </div>
          <figcaption className="text-[12px] text-text-secondary">{label} · <span className="tabular">{img.width} × {img.height}</span></figcaption>
        </figure>
      ))}
    </div>
  );
}

function SplitSlider({ split, onChange }: { split: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-2 text-[12px] text-text-secondary">
      Before
      <input type="range" min={0} max={100} value={split} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-primary" />
      After
    </label>
  );
}

/**
 * Before/after view. A slider only when both images share one size and the
 * result is aligned; otherwise side by side, with no pixel-alignment promise.
 * "View larger" opens the same view in a native modal dialog; the after
 * image can be saved as a JPEG made on this device.
 */
export function BeforeAfter({ before, after, aligned, mock = false }: { before: Img; after: Img; aligned: boolean; mock?: boolean }) {
  const [split, setSplit] = useState(50);
  const [open, setOpen] = useState(false);
  const [actual, setActual] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const urls: Urls = { before: useObjectUrl(before.blob), after: useObjectUrl(after.blob) };
  const slider = aligned && before.width === after.width && before.height === after.height;

  function openLarger() {
    setActual(false);
    setDownloadError(null);
    setOpen(true);
    // showModal gives Esc to close, a backdrop, and keeps focus inside.
    dialogRef.current?.showModal();
  }

  async function download() {
    setDownloadError(null);
    try {
      const jpeg = await toJpeg(after.blob, mock);
      const url = URL.createObjectURL(jpeg);
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadName(mock);
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Some browsers start the download a moment later, so the URL is revoked after a delay.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setDownloadError("The image could not be saved. Try again, or use your browser's save-image option.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* The click is a mouse shortcut; the View larger button is the keyboard path. */}
      <div className="cursor-zoom-in" onClick={openLarger}>
        <View before={before} after={after} urls={urls} aligned={aligned} split={split} size="small" />
      </div>
      {slider && <SplitSlider split={split} onChange={setSplit} />}
      <div>
        <button type="button" onClick={openLarger} className="rounded-full border border-hairline px-3 py-1 text-[12px]">View larger</button>
      </div>
      <dialog ref={dialogRef} onClose={() => setOpen(false)} aria-label="Larger preview"
        className="m-auto max-h-[96vh] max-w-[98vw] overflow-auto rounded-dialog border border-hairline bg-surface-1 p-3 text-text backdrop:bg-text/40">
        {open && (
          <div className="flex flex-col gap-2 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setActual((v) => !v)}
                className="rounded-full border border-hairline px-3 py-1">
                {actual ? "Fit" : "Actual size"}
              </button>
              <button type="button" onClick={download} className="rounded-full border border-hairline px-3 py-1">Download image</button>
              <button type="button" onClick={() => dialogRef.current?.close()} autoFocus className="rounded-full bg-primary px-3 py-1 text-on-fill">Close</button>
            </div>
            {mock && (
              <p className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text">
                <span aria-hidden="true" className="mr-1 font-semibold">⚠</span>{MOCK_LABEL}. A saved image says MOCK in its name and in a band across the top.
              </p>
            )}
            {downloadError && (
              <p role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text">
                <span aria-hidden="true" className="mr-1 font-semibold">✕</span>{downloadError}
              </p>
            )}
            <div className={actual ? "max-h-[75vh] overflow-auto" : undefined}>
              <View before={before} after={after} urls={urls} aligned={aligned} split={split} size={actual ? "actual" : "fit"} />
            </div>
            {slider && <SplitSlider split={split} onChange={setSplit} />}
            <p className="text-text-muted text-[12px]">The image is a visualization, not a guarantee of the finished bike.</p>
          </div>
        )}
      </dialog>
    </div>
  );
}
