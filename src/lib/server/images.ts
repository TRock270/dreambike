// Authoritative server image normalization with sharp (SPEC.md 7, PLAN 9.1).
// Same rules and sizes as spike/imaging.py: EXIF orientation applied once,
// alpha flattened on the canvas color, sRGB, metadata stripped, WebP at most
// 2048 px and 1,250,000 bytes, no upscaling.
import "server-only";
import { createHash } from "node:crypto";
import sharp, { type Metadata, type OutputInfo } from "sharp";
import { AppError, HEIC_MESSAGE } from "../errors";
import {
  LOW_RES_WARNING, MAX_BYTES, MAX_EDGE, MAX_INPUT_PIXELS, MAX_SOURCE_BYTES, MIN_EDGE, MIN_QUALITY,
  WARN_EDGE, fitWithin, headerSize, isAnimated, qualitySteps, shrinkStep, sniffFormat,
} from "../imageFormat";
import type { BinaryMask } from "../coordinates";
import type { SamObject } from "./meta";
import type { NormalizedImage, NormalizeOptions } from "../types";

/** --nl-canvas from tokens.css as RGB (a test keeps the two in sync). */
export const CANVAS_RGB = { r: 211, g: 227, b: 245 } as const;
/** libvips stops a single pipeline after this long (the route deadline is 10 s). */
const SHARP_TIMEOUT_S = 8;

type Raw = { data: Buffer; info: OutputInfo };

/** EXIF orientations 5..8 swap width and height when applied. */
function orientedSize(width: number, height: number, orientation: number | undefined) {
  return orientation !== undefined && orientation >= 5 ? { width: height, height: width } : { width, height };
}

export async function normalize(input: Uint8Array, options: NormalizeOptions = {}): Promise<NormalizedImage> {
  const maxEdge = options.maxEdge ?? MAX_EDGE;
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const kind = sniffFormat(input);
  if (kind === "heic") throw new AppError("UNSUPPORTED_FORMAT", HEIC_MESSAGE);
  if (kind === "unknown") throw new AppError("UNSUPPORTED_FORMAT", "Only JPEG, PNG, and WebP photos are supported.");
  if (input.byteLength > MAX_SOURCE_BYTES) throw new AppError("TOO_LARGE", "The photo file is larger than 25 MB.");
  // libvips does not see APNG frames, so check the chunks ourselves.
  if (isAnimated(input)) throw new AppError("UNSUPPORTED_FORMAT", "Animated images are not supported.");

  // Header check before sharp allocates pixels.
  const header = headerSize(input);
  if (header && header.width * header.height > MAX_INPUT_PIXELS) {
    throw new AppError("TOO_LARGE", "The photo has more than 40 megapixels.");
  }

  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, pages: -1 }).metadata();
  } catch {
    throw new AppError("INVALID_IMAGE", "The photo could not be read.");
  }
  if (!meta.width || !meta.height) throw new AppError("INVALID_IMAGE", "The photo could not be read.");
  if ((meta.pages ?? 1) > 1) throw new AppError("UNSUPPORTED_FORMAT", "Animated images are not supported.");
  const storedHeight = meta.pageHeight ?? meta.height;
  if (meta.width * storedHeight > MAX_INPUT_PIXELS) {
    throw new AppError("TOO_LARGE", "The photo has more than 40 megapixels.");
  }

  const oriented = orientedSize(meta.width, storedHeight, meta.orientation);
  const longEdge = Math.max(oriented.width, oriented.height);
  if (longEdge < MIN_EDGE) throw new AppError("INVALID_IMAGE", "The photo is too small (long edge under 256 px).");
  const warnings = longEdge < WARN_EDGE ? [LOW_RES_WARNING] : [];

  // Decode, orient, flatten, convert to sRGB, and resize in one streaming
  // pipeline, so a large source never sits in memory as a full raw raster.
  // Explicit width/height (computed like the Python spike) instead of fit
  // "inside"; fastShrinkOnLoad off keeps JPEG pixels close to Pillow's.
  // failOn "error" turns truncated or corrupt data into an exception.
  let size = fitWithin(oriented.width, oriented.height, maxEdge);
  let raw: Raw;
  try {
    raw = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
      .timeout({ seconds: SHARP_TIMEOUT_S })
      .rotate()
      .flatten({ background: CANVAS_RGB })
      .toColourspace("srgb")
      .removeAlpha()
      .resize(size.width, size.height, { fit: "fill", kernel: "lanczos3", fastShrinkOnLoad: false })
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new AppError("INVALID_IMAGE", "The photo is corrupt or truncated.");
  }

  // SPEC 7: lower quality in steps to 60 first, then shrink 90% at quality 60.
  for (const quality of qualitySteps()) {
    const out = await encode(raw, size, quality);
    if (out.byteLength <= maxBytes) return result(out, size, quality, warnings);
  }
  for (;;) {
    const next = shrinkStep(size.width, size.height);
    if (next.width === size.width && next.height === size.height) {
      throw new AppError("INVALID_IMAGE", "The photo could not be compressed under the size limit.");
    }
    size = next;
    const out = await encode(raw, size, MIN_QUALITY);
    if (out.byteLength <= maxBytes) return result(out, size, MIN_QUALITY, warnings);
  }
}

function result(out: Buffer, size: { width: number; height: number }, quality: number,
  warnings: string[]): NormalizedImage {
  return {
    bytes: new Uint8Array(out), width: size.width, height: size.height, quality, warnings,
    hash: createHash("sha256").update(out).digest("hex"),
  };
}

async function encode(raw: Raw, size: { width: number; height: number }, quality: number): Promise<Buffer> {
  let pipeline = sharp(raw.data, { raw: { width: raw.info.width, height: raw.info.height, channels: 3 } })
    .timeout({ seconds: SHARP_TIMEOUT_S });
  if (size.width !== raw.info.width || size.height !== raw.info.height) {
    pipeline = pipeline.resize(size.width, size.height, { fit: "fill", kernel: "lanczos3" });
  }
  try {
    return await pipeline.webp({ quality, effort: 4 }).toBuffer();
  } catch {
    throw new AppError("INVALID_IMAGE", "The photo could not be encoded.");
  }
}

/** RIFF chunk names of a WebP, used to prove there is no EXIF/XMP/ICCP metadata. */
export function webpChunks(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const names: string[] = [];
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    names.push(String.fromCharCode(...bytes.subarray(pos, pos + 4)));
    const size = view.getUint32(pos + 4, true);
    pos += 8 + size + (size & 1);
  }
  return names;
}

export function toDataUrl(mime: "image/webp" | "image/png", bytes: Uint8Array): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

// ------------------------------------------------------------------ SAM masks

/**
 * How a SAM raster sits in the image, fixed by U01 with owned off-origin
 * overlays (SPEC 7). U01 2026-10-28: concept masks come back box-sized and
 * land on their parts (owner checked the overlays), so "box_relative".
 * Rasters SAM downscaled to a 1024 px long edge are handled by
 * VERIFIED_SAM_DOWNSCALED below. null would accept full-image rasters only.
 */
export const VERIFIED_SAM_PLACEMENT: "box_relative" | null = "box_relative";

/** SAM shrinks rasters of objects larger than this (long edge) to exactly this many pixels. */
export const SAM_MASK_MAX_EDGE = 1024;

/**
 * A downscaled raster (long edge 1024, box aspect kept) is stretched back onto
 * its box by nearest neighbour. U01 2026-10-28: the live "motorcycle" overlay
 * drawn this way (1024x702 for a 1431x981 box) was checked by the owner
 * ("looks good"). false would refuse the outline and point lanes before paying.
 */
export const VERIFIED_SAM_DOWNSCALED: boolean = true;

/**
 * Point clicks in live mode. U01 2026-10-28: the rear-hub click returned the
 * whole bike (confidence 0.45) and no point overlay was owner-checked, so the
 * route refuses points before any reservation while this is false.
 */
export const VERIFIED_SAM_POINTS: boolean = false;

/** True when the raster looks like SAM's 1024-long-edge shrink of a box this size. */
export function isDownscaled(maskWidth: number, maskHeight: number, boxWidth: number, boxHeight: number): boolean {
  if (Math.max(boxWidth, boxHeight) <= SAM_MASK_MAX_EDGE || Math.min(boxWidth, boxHeight) <= 0) return false;
  const wide = boxWidth >= boxHeight;
  const boxLong = wide ? boxWidth : boxHeight, boxShort = wide ? boxHeight : boxWidth;
  const maskLong = wide ? maskWidth : maskHeight, maskShort = wide ? maskHeight : maskWidth;
  // Math.round rounds .5 up for positive numbers, like round_half_up in spike/imaging.py.
  return maskLong === SAM_MASK_MAX_EDGE
    && Math.abs(maskShort - Math.round((boxShort * SAM_MASK_MAX_EDGE) / boxLong)) <= 1;
}

export type SamBounds = { left: number; top: number; right: number; bottom: number };

/** One decoded SAM raster (0/1 bytes, row-major) to a full-image binary mask. */
export function maskToNormalized(raster: Uint8Array, maskWidth: number, maskHeight: number,
  bounds: SamBounds, imageWidth: number, imageHeight: number,
  placement: "box_relative" | null = VERIFIED_SAM_PLACEMENT,
  downscaled: boolean = VERIFIED_SAM_DOWNSCALED): BinaryMask {
  // A raster shorter or longer than its declared size is a malformed answer, not a placement question.
  if (raster.length !== maskWidth * maskHeight) throw new AppError("SCHEMA_INVALID");
  if (maskWidth === imageWidth && maskHeight === imageHeight) {
    return { width: imageWidth, height: imageHeight, pixels: Uint8Array.from(raster, (v) => (v ? 1 : 0)) };
  }
  const boxW = bounds.right - bounds.left;
  const boxH = bounds.bottom - bounds.top;
  if (placement === "box_relative" && downscaled && isDownscaled(maskWidth, maskHeight, boxW, boxH)) {
    // Nearest neighbour at pixel centres: box-local dx reads source floor((dx + 0.5) * maskW / boxW).
    // Only the part of the box inside the image is visited, so huge upstream bounds cannot
    // allocate more than the image itself.
    const pixels = new Uint8Array(imageWidth * imageHeight);
    const x0 = Math.max(0, bounds.left), y0 = Math.max(0, bounds.top);
    const x1 = Math.min(imageWidth, bounds.right), y1 = Math.min(imageHeight, bounds.bottom);
    for (let y = y0; y < y1; y++) {
      const dy = y - bounds.top;
      const sy = Math.min(maskHeight - 1, Math.floor(((2 * dy + 1) * maskHeight) / (2 * boxH)));
      for (let x = x0; x < x1; x++) {
        const dx = x - bounds.left;
        const sx = Math.min(maskWidth - 1, Math.floor(((2 * dx + 1) * maskWidth) / (2 * boxW)));
        pixels[y * imageWidth + x] = raster[sy * maskWidth + sx] ? 1 : 0;
      }
    }
    return { width: imageWidth, height: imageHeight, pixels };
  }
  if (placement !== "box_relative" || maskWidth !== boxW || maskHeight !== boxH) {
    throw new AppError("MASK_PLACEMENT_UNKNOWN");
  }
  return placeBoxRaster(raster, boxW, boxH, bounds, imageWidth, imageHeight);
}

/** Copies a box-sized raster at the box's top-left, clipped at the image border. */
function placeBoxRaster(raster: Uint8Array, maskWidth: number, maskHeight: number,
  bounds: SamBounds, imageWidth: number, imageHeight: number): BinaryMask {
  const pixels = new Uint8Array(imageWidth * imageHeight);
  const x0 = Math.max(0, bounds.left), y0 = Math.max(0, bounds.top);
  const x1 = Math.min(imageWidth, bounds.right), y1 = Math.min(imageHeight, bounds.bottom);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      pixels[y * imageWidth + x] = raster[(y - bounds.top) * maskWidth + (x - bounds.left)] ? 1 : 0;
    }
  }
  return { width: imageWidth, height: imageHeight, pixels };
}

/**
 * Places every SAM raster; one that cannot be placed (MASK_PLACEMENT_UNKNOWN,
 * such as a downscaled mask) is dropped and counted instead of failing the
 * whole, already paid, answer. Any other error still throws.
 */
export function placeSamRasters(objects: SamObject[], imageWidth: number, imageHeight: number,
  placement: "box_relative" | null = VERIFIED_SAM_PLACEMENT,
  downscaled: boolean = VERIFIED_SAM_DOWNSCALED) {
  const masks: { mask: BinaryMask; confidence: number | null; objectId: string }[] = [];
  let dropped = 0;
  for (const o of objects) {
    try {
      masks.push({ mask: maskToNormalized(o.raster, o.maskWidth, o.maskHeight, o.bounds, imageWidth, imageHeight, placement, downscaled),
        confidence: o.confidence, objectId: o.objectId });
    } catch (error) {
      if (!(error instanceof AppError && error.code === "MASK_PLACEMENT_UNKNOWN")) throw error;
      dropped++;
    }
  }
  return { masks, dropped };
}

/** Full-image binary mask as a 1-channel PNG (0 or 255), WireMask png_binary_full_image. */
export async function maskToPng(mask: BinaryMask): Promise<Uint8Array> {
  const gray = Buffer.from(mask.pixels.map((v) => (v ? 255 : 0)));
  return new Uint8Array(await sharp(gray, { raw: { width: mask.width, height: mask.height, channels: 1 } })
    .png({ compressionLevel: 9, palette: false }).toBuffer());
}

/** Decode a mask PNG back to 0/1 pixels; dimensions must match the image. */
export async function pngToMask(png: Uint8Array, width: number, height: number): Promise<BinaryMask> {
  const { data, info } = await sharp(png).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  if (info.width !== width || info.height !== height) throw new AppError("INVALID_IMAGE", "Mask size does not match the image.");
  return { width, height, pixels: Uint8Array.from(data, (v) => (v > 127 ? 1 : 0)) };
}

/** A normalized WebP upload must decode to exactly the declared size (one coordinate space). */
export async function assertWebpSize(bytes: Uint8Array, width: number, height: number): Promise<void> {
  const meta = await sharp(bytes).metadata().catch(() => null);
  if (!meta || meta.format !== "webp" || (meta.pages ?? 1) > 1) throw new AppError("INVALID_IMAGE");
  if (meta.width !== width || meta.height !== height) {
    throw new AppError("INVALID_REQUEST", "Declared size does not match the image.");
  }
}

// ------------------------------------------------- composite and drift (SPEC 7)
// A port of spike/imaging.py; tests/composite.test.ts checks pixel equality
// against the Python reference. Every operand must share dimensions.

export const DRIFT_THRESHOLD = 0.05;
export const ASPECT_LIMIT = 0.02;
export const SMALL_EDGE = 1024;

/** Python round_half_up: floor(x + 0.5). */
const roundHalfUp = (x: number) => Math.floor(x + 0.5);
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function sameSize(...masks: { width: number; height: number }[]): void {
  const [first, ...rest] = masks;
  for (const m of rest) {
    if (m.width !== first!.width || m.height !== first!.height) {
      throw new AppError("INVALID_IMAGE", "Mask and image sizes differ; masks are never resized silently.");
    }
  }
}

export function unionMask(a: BinaryMask, b: BinaryMask): BinaryMask {
  sameSize(a, b);
  const pixels = new Uint8Array(a.pixels.length);
  for (let i = 0; i < pixels.length; i++) pixels[i] = a.pixels[i]! | b.pixels[i]!;
  return { width: a.width, height: a.height, pixels };
}

/** Binary dilation with a disk: for each row offset dy, a horizontal run of half-width isqrt(r² − dy²). */
export function dilate(mask: BinaryMask, radius: number): BinaryMask {
  const { width: w, height: h } = mask;
  if (radius <= 0) return { width: w, height: h, pixels: mask.pixels.slice() };
  // prefix[y * (w + 1) + x] = number of set pixels in row y before column x
  const prefix = new Int32Array(h * (w + 1));
  for (let y = 0; y < h; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) { run += mask.pixels[y * w + x]!; prefix[y * (w + 1) + x + 1] = run; }
  }
  const out = new Uint8Array(w * h);
  for (let dy = Math.max(-radius, 1 - h); dy <= Math.min(radius, h - 1); dy++) {
    const half = Math.floor(Math.sqrt(radius * radius - dy * dy) + 1e-9);
    for (let y = Math.max(0, -dy); y < Math.min(h, h - dy); y++) {
      const src = (y + dy) * (w + 1);
      for (let x = 0; x < w; x++) {
        if (out[y * w + x]) continue;
        const x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1);
        if (prefix[src + x1]! - prefix[src + x0]! > 0) out[y * w + x] = 1;
      }
    }
  }
  return { width: w, height: h, pixels: out };
}

export function gaussianKernel(sigma: number): Float64Array {
  const radius = Math.ceil(3 * sigma);
  const k = new Float64Array(2 * radius + 1);
  let sum = 0;
  for (let i = 0; i < k.length; i++) { const x = i - radius; k[i] = Math.exp(-(x * x) / (2 * sigma * sigma)); sum += k[i]!; }
  for (let i = 0; i < k.length; i++) k[i] = k[i]! / sum;
  return k;
}

/** Separable Gaussian blur of a 0/1 mask (rows, then columns; edge pixels replicated) to 0..255 alpha. */
export function feather(mask: BinaryMask, sigma = 1.5): Uint8Array {
  const { width: w, height: h } = mask;
  const k = gaussianKernel(sigma);
  const r = (k.length - 1) / 2;
  const rows = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      // Same accumulation order as the numpy reference (kernel index ascending).
      for (let i = 0; i < k.length; i++) acc += k[i]! * mask.pixels[y * w + clamp(x - r + i, 0, w - 1)]!;
      rows[y * w + x] = acc;
    }
  }
  const alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = 0; i < k.length; i++) acc += k[i]! * rows[clamp(y - r + i, 0, h - 1) * w + x]!;
      alpha[y * w + x] = clamp(roundHalfUp(acc * 255), 0, 255);
    }
  }
  return alpha;
}

/** Mean absolute grayscale difference outside `excluded`, divided by 255; null with no outside pixels. */
export function driftCheck(base: Uint8Array, edited: Uint8Array, excluded: BinaryMask): { score: number | null; outsidePixels: number } {
  const n = excluded.width * excluded.height;
  if (base.length !== n * 3 || edited.length !== n * 3) throw new AppError("INVALID_IMAGE", "Drift operands differ in size.");
  let sum = 0, count = 0;
  for (let i = 0; i < n; i++) {
    if (excluded.pixels[i]) continue;
    const gb = 0.299 * base[i * 3]! + 0.587 * base[i * 3 + 1]! + 0.114 * base[i * 3 + 2]!;
    const ge = 0.299 * edited[i * 3]! + 0.587 * edited[i * 3 + 1]! + 0.114 * edited[i * 3 + 2]!;
    sum += Math.abs(gb - ge);
    count++;
  }
  return { score: count === 0 ? null : sum / count / 255, outsidePixels: count };
}

export function compositeParams(bikeWidth: number): { radius: number; sigma: number } {
  return { radius: roundHalfUp(clamp(0.015 * bikeWidth, 6, 24)), sigma: clamp(0.005 * bikeWidth, 3, 8) };
}

export function aspectDifference(genW: number, genH: number, baseW: number, baseH: number): number {
  return Math.abs((genW / genH) / (baseW / baseH) - 1);
}

/** Reasons decided before any pixel work (SPEC 7 order), or null when blending may proceed. */
export function compositeSkipReason(enabled: boolean, intent: "paint" | "replace" | "geometry",
  generated: { width: number; height: number }, base: { width: number; height: number }): "disabled" | "geometry" | "small" | "aspect" | null {
  if (!enabled) return "disabled";
  if (intent === "geometry") return "geometry";
  if (Math.min(generated.width, generated.height) < SMALL_EDGE) return "small";
  if (aspectDifference(generated.width, generated.height, base.width, base.height) > ASPECT_LIMIT) return "aspect";
  return null;
}

export type CompositeReason = "composited" | "disabled" | "geometry" | "small" | "aspect" | "drift" | "missing_mask" | "no_outside_area";
export type RawRgb = { width: number; height: number; data: Uint8Array };
export type CompositeOutcome = { image: RawRgb; composed: boolean; aligned: boolean; drift: number | null; reason: CompositeReason };

/**
 * Protect pixels outside the edited part (SPEC 7 order of checks). `edited`
 * must already be resized to the base size when composition is possible;
 * generated size is the raw model output size.
 */
export function compositeRgb(base: RawRgb, edited: RawRgb, oldMask: BinaryMask | null, newMask: BinaryMask | null,
  bikeWidth: number, intent: "paint" | "replace" | "geometry", generated: { width: number; height: number },
  enabled = true): CompositeOutcome {
  const full = (reason: CompositeReason, drift: number | null = null): CompositeOutcome =>
    ({ image: edited, composed: false, aligned: false, drift, reason });
  const skip = compositeSkipReason(enabled, intent, generated, base);
  if (skip) return full(skip);
  if (!oldMask || !newMask) return full("missing_mask");
  if (edited.width !== base.width || edited.height !== base.height) {
    throw new AppError("INVALID_IMAGE", "The edited image must be resized to the base size first.");
  }
  sameSize(base, oldMask, newMask);
  const { radius, sigma } = compositeParams(bikeWidth);
  const region = dilate(unionMask(oldMask, newMask), radius);
  const { score } = driftCheck(base.data, edited.data, region);
  if (score === null) return full("no_outside_area");
  if (score > DRIFT_THRESHOLD) return full("drift", score);
  const alpha = feather(region, sigma);
  const out = new Uint8Array(base.data.length);
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i]!;
    for (let c = 0; c < 3; c++) {
      const b = base.data[i * 3 + c]!;
      // Same arithmetic as numpy: b + (e − b) × a / 255, then round half up; a = 0 keeps the base pixel.
      out[i * 3 + c] = clamp(Math.floor(b + ((edited.data[i * 3 + c]! - b) * a) / 255 + 0.5), 0, 255);
    }
  }
  return { image: { width: base.width, height: base.height, data: out }, composed: true, aligned: true, drift: score, reason: "composited" };
}

/** Decode an encoded image to raw RGB (3 channels), refusing anything over 40 MP. */
export async function decodeRgb(bytes: Uint8Array): Promise<RawRgb> {
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
      .timeout({ seconds: SHARP_TIMEOUT_S }).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 3) throw new Error("channels");
    return { width: info.width, height: info.height, data: new Uint8Array(data) };
  } catch {
    throw new AppError("INVALID_IMAGE", "An image could not be decoded.");
  }
}

/** Encode raw RGB as WebP within the byte limit (quality ladder, no resize: composites stay base-sized). */
export async function encodeRgbBounded(raw: RawRgb): Promise<NormalizedImage> {
  for (const quality of qualitySteps()) {
    const out = await sharp(Buffer.from(raw.data), { raw: { width: raw.width, height: raw.height, channels: 3 } })
      .timeout({ seconds: SHARP_TIMEOUT_S }).webp({ quality, effort: 4 }).toBuffer();
    if (out.byteLength <= MAX_BYTES) return result(out, { width: raw.width, height: raw.height }, quality, []);
  }
  // Never shrink silently: a composite must keep the base size, so a raster that does not fit fails visibly.
  throw new AppError("INVALID_IMAGE", "The blended image is too large to send.");
}

/** A WebP upload's real size; refuses other formats and animation whatever the declared MIME. */
export async function webpSize(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  const meta = await sharp(bytes).metadata().catch(() => null);
  if (!meta || meta.format !== "webp" || (meta.pages ?? 1) > 1 || !meta.width || !meta.height) throw new AppError("INVALID_IMAGE");
  return { width: meta.width, height: meta.height };
}
