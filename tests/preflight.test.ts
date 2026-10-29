// Browser preflight header checks run before any DOM call, so Node can test them.
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { PreflightError, checkHeader, checkLogoHeader, logoOutputSize, logoTargetSize, LOGO_MAX_BYTES } from "@/lib/browser/preflight";
import { HEIC_MESSAGE } from "@/lib/errors";

const HEIC = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from("ftypheic"), 0, 0, 0, 0, ...Buffer.from("mif1heic"), ...new Array(64).fill(0)]);
const jpeg = async () => new Uint8Array(await sharp({ create: { width: 640, height: 480, channels: 3,
  background: { r: 9, g: 9, b: 9 } } }).jpeg().toBuffer());

async function outcome(file: File): Promise<string> {
  try { await checkHeader(file); return "OK"; } catch (e) {
    return e instanceof PreflightError ? `${e.code}:${e.message}` : `THROWN:${String(e)}`;
  }
}

describe("browser preflight header checks", () => {
  it("rejects HEIC by signature, by MIME, and by extension with the exact message", async () => {
    const heic = `UNSUPPORTED_FORMAT:${HEIC_MESSAGE}`;
    expect(await outcome(new File([HEIC], "photo.jpg", { type: "image/jpeg" }))).toBe(heic);
    expect(await outcome(new File([await jpeg()], "photo", { type: "image/heic" }))).toBe(heic);
    expect(await outcome(new File([await jpeg()], "IMG_1570.HEIC", { type: "" }))).toBe(heic);
  });

  it("rejects unknown, oversized, huge, and animated files before decoding", async () => {
    expect(await outcome(new File([new Uint8Array(100)], "x.bin"))).toMatch(/^UNSUPPORTED_FORMAT/);
    const big = new Uint8Array(25 * 1024 * 1024 + 1);
    big.set(await jpeg());
    expect(await outcome(new File([big], "big.jpg", { type: "image/jpeg" }))).toMatch(/^TOO_LARGE/);
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8000, 0); ihdr.writeUInt32BE(6000, 4);
    const len = Buffer.alloc(4); len.writeUInt32BE(13);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), len, Buffer.from("IHDR"), ihdr, Buffer.alloc(4)]);
    expect(await outcome(new File([png], "huge.png", { type: "image/png" }))).toMatch(/^TOO_LARGE:.*40 megapixels/);
    const frame = (r: number) => sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g: 0, b: 0 } } }).png().toBuffer();
    const anim = await sharp([await frame(0), await frame(255)], { join: { animated: true } }).webp().toBuffer();
    expect(await outcome(new File([new Uint8Array(anim)], "a.webp", { type: "image/webp" }))).toMatch(/^UNSUPPORTED_FORMAT:Animated/);
  });

  it("lets a normal JPEG through and marks network-type errors as retryable", async () => {
    expect(await outcome(new File([await jpeg()], "bike.jpg", { type: "image/jpeg" }))).toBe("OK");
    expect(new PreflightError("UPSTREAM_UNAVAILABLE", "x").retryable).toBe(true);
    expect(new PreflightError("UNSUPPORTED_FORMAT", "x").retryable).toBe(false);
  });
});

async function logoOutcome(file: File): Promise<string> {
  try { return await checkLogoHeader(file); } catch (e) {
    return e instanceof PreflightError ? `${e.code}:${e.message}` : `THROWN:${String(e)}`;
  }
}

describe("logo header checks", () => {
  const solid = (r: number) => sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g: 0, b: 0 } } }).png().toBuffer();

  it("sniffs real PNG, JPEG and WebP by bytes, ignoring the declared type", async () => {
    const png = new Uint8Array(await solid(1));
    expect(await logoOutcome(new File([png], "l.jpg", { type: "image/jpeg" }))).toBe("png");
    expect(await logoOutcome(new File([await jpeg()], "l.png", { type: "image/png" }))).toBe("jpeg");
    const webp = new Uint8Array(await sharp(await solid(2)).webp().toBuffer());
    expect(await logoOutcome(new File([webp], "l.webp"))).toBe("webp");
  });

  it("rejects SVG text, GIF, HEIC and animated PNG/WebP", async () => {
    const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(await logoOutcome(new File([svg], "l.svg", { type: "image/svg+xml" }))).toMatch(/^UNSUPPORTED_FORMAT/);
    expect(await logoOutcome(new File([Buffer.from("GIF89a\x01\x00\x01\x00", "latin1")], "l.gif", { type: "image/gif" }))).toMatch(/^UNSUPPORTED_FORMAT/);
    expect(await logoOutcome(new File([HEIC], "l.png", { type: "image/png" }))).toBe(`UNSUPPORTED_FORMAT:${HEIC_MESSAGE}`);
    const anim = await sharp([await solid(0), await solid(255)], { join: { animated: true } }).webp().toBuffer();
    expect(await logoOutcome(new File([new Uint8Array(anim)], "a.webp"))).toMatch(/^UNSUPPORTED_FORMAT:Animated/);
    // Minimal APNG: signature, acTL before IDAT.
    const chunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
      return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)]);
    };
    const apng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", Buffer.alloc(13)), chunk("acTL", Buffer.alloc(8)), chunk("IDAT", Buffer.alloc(1))]);
    expect(await logoOutcome(new File([apng], "a.png"))).toMatch(/^UNSUPPORTED_FORMAT:Animated/);
  });

  it("enforces the 5 MB source limit exactly", async () => {
    const png = new Uint8Array(await solid(3));
    const at = new Uint8Array(5 * 1024 * 1024); at.set(png);
    expect(await logoOutcome(new File([at], "l.png"))).toBe("png");
    const over = new Uint8Array(5 * 1024 * 1024 + 1); over.set(png);
    expect(await logoOutcome(new File([over], "l.png"))).toMatch(/^TOO_LARGE/);
  });
});

describe("logoTargetSize", () => {
  it("shrinks to a 512 px long edge, never upscales", () => {
    expect(logoTargetSize(2000, 500)).toEqual({ width: 512, height: 128 });
    expect(logoTargetSize(500, 2000)).toEqual({ width: 128, height: 512 });
    expect(logoTargetSize(100, 40)).toEqual({ width: 100, height: 40 });
    expect(logoTargetSize(512, 300)).toEqual({ width: 512, height: 300 });
    expect(logoTargetSize(513, 100)).toEqual({ width: 512, height: 100 });
  });
});

describe("logoOutputSize", () => {
  it("derives the output from the decoded size, within 1..512", () => {
    expect(logoOutputSize(2000, 500)).toEqual({ width: 512, height: 128 });
    expect(logoOutputSize(1, 1)).toEqual({ width: 1, height: 1 });
    expect(logoOutputSize(4000, 3)).toEqual({ width: 512, height: 1 });
  });

  it("rejects zero-size, NaN and over-40MP decoded bitmaps", () => {
    for (const [w, h] of [[0, 100], [100, 0], [NaN, 5]] as [number, number][]) {
      expect(() => logoOutputSize(w, h)).toThrow("The logo could not be read.");
    }
    expect(() => logoOutputSize(8000, 5001)).toThrow(/40 megapixels/);
  });

  it("uses the 500,000 byte logo limit", () => {
    expect(LOGO_MAX_BYTES).toBe(500_000);
  });
});
