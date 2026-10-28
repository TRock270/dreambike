// Pure image-format helpers shared by the browser preflight and the server
// (SPEC.md 7). No DOM and no sharp here, so Node tests cover both sides.
// The sizing rules match spike/imaging.py exactly.

export const MAX_EDGE = 2048;
export const MAX_BYTES = 1_250_000;
export const QUALITY = 82;
export const MIN_QUALITY = 60;
export const QUALITY_STEP = 6;
export const MAX_INPUT_PIXELS = 40_000_000;
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const WARN_EDGE = 800;
export const MIN_EDGE = 256;
export const LOW_RES_WARNING = "Low resolution: the long edge is under 800 px. Results may be poor.";

export type SniffedFormat = "jpeg" | "png" | "webp" | "heic" | "unknown";

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** HEIF family if the ftyp major brand or any compatible brand is a HEIF brand. */
function isHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || ascii(bytes, 4, 8) !== "ftyp") return false;
  if (HEIF_BRANDS.has(ascii(bytes, 8, 12))) return true;
  const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  for (let pos = 16; pos + 4 <= Math.min(boxSize, bytes.length); pos += 4) {
    if (HEIF_BRANDS.has(ascii(bytes, pos, pos + 4))) return true;
  }
  return false;
}

/** Classify by file signature, never by the declared MIME type. */
export function sniffFormat(bytes: Uint8Array): SniffedFormat {
  if (isHeif(bytes)) return "heic";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG") return "png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  return "unknown";
}

/**
 * Stored (pre-orientation) pixel size from the file header, or null if it
 * cannot be read. Used to reject huge images before any decode allocates memory.
 */
export function headerSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kind = sniffFormat(bytes);
  if (kind === "png" && bytes.length >= 24 && ascii(bytes, 12, 16) === "IHDR") {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (kind === "webp" && bytes.length >= 30) {
    const chunk = ascii(bytes, 12, 16);
    if (chunk === "VP8X") {
      const w = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
      const h = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
      return { width: w, height: h };
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const b = view.getUint32(21, true);
      return { width: (b & 0x3fff) + 1, height: ((b >>> 14) & 0x3fff) + 1 };
    }
    // Lossy VP8 keyframe: frame tag bit 0 is 0 and the start code 9d 01 2a follows.
    if (chunk === "VP8 " && ((bytes[20] ?? 1) & 1) === 0
      && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    return null;
  }
  if (kind === "jpeg") {
    // Walk segments to the first start-of-frame marker (SOF0..SOF15 except DHT/JPG/DAC).
    let pos = 2;
    while (pos + 9 < bytes.length) {
      if (bytes[pos] !== 0xff) return null;
      while (bytes[pos + 1] === 0xff && pos + 2 < bytes.length) pos++; // fill bytes before a marker
      const marker = bytes[pos + 1]!;
      if (marker === 0xda || marker === 0xd9) return null; // scan data or end before any frame header
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { pos += 2; continue; }
      const length = view.getUint16(pos + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: view.getUint16(pos + 5), width: view.getUint16(pos + 7) };
      pos += 2 + length;
    }
    return null;
  }
  return null;
}

/**
 * True for animated WebP (VP8X animation flag) and APNG (acTL chunk before
 * IDAT). The browser re-encodes a still frame, so this must be caught first.
 */
export function isAnimated(bytes: Uint8Array): boolean {
  const kind = sniffFormat(bytes);
  if (kind === "webp") return ascii(bytes, 12, 16) === "VP8X" && ((bytes[20] ?? 0) & 0x02) !== 0;
  if (kind === "png") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pos = 8;
    while (pos + 8 <= bytes.length) {
      const type = ascii(bytes, pos + 4, pos + 8);
      if (type === "acTL") return true;
      if (type === "IDAT") return false;
      pos += 12 + view.getUint32(pos);
    }
  }
  return false;
}

/** floor(x + 0.5): equals Python's round_half_up and JavaScript Math.round for x >= 0. */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

/** Target size for a long edge of at most maxEdge; never upscales. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height };
  const scale = maxEdge / long;
  return { width: Math.max(1, roundHalfUp(width * scale)), height: Math.max(1, roundHalfUp(height * scale)) };
}

/** One 90% shrink step used after quality reaches its minimum (integer math). */
export function shrinkStep(width: number, height: number): { width: number; height: number } {
  return { width: Math.max(1, Math.floor((width * 9) / 10)), height: Math.max(1, Math.floor((height * 9) / 10)) };
}

/** The quality sequence tried before shrinking: 82, 76, 70, 64, 60. */
export function qualitySteps(): number[] {
  const steps: number[] = [];
  for (let q = QUALITY; ; q = Math.max(MIN_QUALITY, q - QUALITY_STEP)) {
    steps.push(q);
    if (q === MIN_QUALITY) return steps;
  }
}
