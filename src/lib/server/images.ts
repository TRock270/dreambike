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
