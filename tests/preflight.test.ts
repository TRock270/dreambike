// Browser preflight header checks run before any DOM call, so Node can test them.
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { PreflightError, checkHeader } from "@/lib/browser/preflight";
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
