// Browser photo preflight (SPEC.md 7): reject HEIC/animated/huge files before
// decoding, apply EXIF orientation once, and re-encode a fresh bounded image
// (no EXIF passes through). The server normalizes again and is authoritative.
import { ERRORS, HEIC_MESSAGE } from "../errors";
import type { ErrorCodeId } from "../types";
import {
  MAX_BYTES, MAX_INPUT_PIXELS, MAX_SOURCE_BYTES, MIN_EDGE, MIN_QUALITY, fitWithin, headerSize,
  isAnimated, qualitySteps, shrinkStep, sniffFormat,
} from "../imageFormat";

export class PreflightError extends Error {
  readonly retryable: boolean;
  constructor(public code: ErrorCodeId, message: string) {
    super(message);
    this.retryable = ERRORS[code].retryable;
  }
}

const HEIC_MIME = /^image\/hei[cf](-sequence)?$/;
/** Large APP segments can push a JPEG frame header far into the file. */
const HEAD_BYTES = 1024 * 1024;

/** Checks that need only the first bytes; no DOM. Exported for offline tests. */
export async function checkHeader(file: File): Promise<void> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const kind = sniffFormat(head);
  if (HEIC_MIME.test(file.type) || kind === "heic" || /\.hei[cf]$/i.test(file.name)) {
    throw new PreflightError("UNSUPPORTED_FORMAT", HEIC_MESSAGE);
  }
  if (kind === "unknown") {
    throw new PreflightError("UNSUPPORTED_FORMAT", "Only JPEG, PNG, and WebP photos are supported.");
  }
  if (file.size > MAX_SOURCE_BYTES) throw new PreflightError("TOO_LARGE", "The photo file is larger than 25 MB.");
  if (isAnimated(head)) throw new PreflightError("UNSUPPORTED_FORMAT", "Animated images are not supported.");
  const size = headerSize(head);
  if (size && size.width * size.height > MAX_INPUT_PIXELS) {
    throw new PreflightError("TOO_LARGE", "The photo has more than 40 megapixels.");
  }
}

export async function preflightPhoto(file: File): Promise<Blob> {
  await checkHeader(file);
  const decoded = await decode(file);
  try {
    if (decoded.width * decoded.height > MAX_INPUT_PIXELS) {
      throw new PreflightError("TOO_LARGE", "The photo has more than 40 megapixels.");
    }
    if (Math.max(decoded.width, decoded.height) < MIN_EDGE) {
      throw new PreflightError("INVALID_IMAGE", "The photo is too small (long edge under 256 px).");
    }
    return await encodeBounded(decoded.source, decoded.width, decoded.height);
  } finally {
    decoded.release();
  }
}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

/**
 * Decode with the EXIF orientation applied exactly once. createImageBitmap
 * with imageOrientation "from-image" is preferred; browsers that reject the
 * option fall back to an <img>, which also honors EXIF orientation when drawn.
 */
async function decode(file: File): Promise<Decoded> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch (error) {
    if (!(error instanceof TypeError)) throw new PreflightError("INVALID_IMAGE", "The photo could not be read.");
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new PreflightError("INVALID_IMAGE", "The photo could not be read.");
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
}

/** Canvas background for transparent pixels: the --nl-canvas token. */
function canvasColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--nl-canvas").trim() || "white";
}

function draw(source: CanvasImageSource, size: { width: number; height: number }): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PreflightError("INVALID_IMAGE", "This browser cannot prepare the photo.");
  ctx.fillStyle = canvasColor();
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

/** Same ladder as the server and the Python spike: qualities down to 60, then shrink at 60. */
async function encodeBounded(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  let size = fitWithin(width, height);
  let canvas = draw(source, size);
  try {
    for (const quality of qualitySteps()) {
      const blob = await toBlob(canvas, quality / 100);
      if (blob.size <= MAX_BYTES) return blob;
    }
    for (;;) {
      const next = shrinkStep(size.width, size.height);
      if (next.width === size.width && next.height === size.height) {
        throw new PreflightError("INVALID_IMAGE", "The photo could not be compressed under the size limit.");
      }
      size = next;
      release(canvas);
      canvas = draw(source, size);
      const blob = await toBlob(canvas, MIN_QUALITY / 100);
      if (blob.size <= MAX_BYTES) return blob;
    }
  } finally {
    release(canvas);
  }
}

/** Free the canvas backing store right away instead of waiting for garbage collection. */
function release(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

let webpEncodeSupported: boolean | null = null;

/** WebP where the browser can encode it; JPEG otherwise (older Safari returns PNG for WebP). */
async function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  if (webpEncodeSupported !== false) {
    const webp = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", quality));
    // Only a real non-WebP answer proves missing support; null may be transient.
    if (webp) webpEncodeSupported = webp.type === "image/webp";
    if (webp && webpEncodeSupported) return webp;
  }
  const jpeg = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
  if (!jpeg) throw new PreflightError("INVALID_IMAGE", "This browser cannot prepare the photo.");
  return jpeg;
}
