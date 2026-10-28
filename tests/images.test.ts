import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/normalize/route";
import { ErrorResponse, NormalizeResponse } from "@/lib/contracts";
import { AppError, HEIC_MESSAGE } from "@/lib/errors";
import {
  fitWithin, headerSize, isAnimated, qualitySteps, shrinkStep, sniffFormat,
} from "@/lib/imageFormat";
import { assertSameOrigin } from "@/lib/server/http";
import { CANVAS_RGB, normalize, webpChunks } from "@/lib/server/images";
import { crc32 } from "node:zlib";

const HEIC = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from("ftypheic"), 0, 0, 0, 0, ...Buffer.from("mif1heic"), ...new Array(64).fill(0)]);

function pngHeaderOnly(width: number, height: number): Uint8Array {
  const chunk = (type: string, payload: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(payload.length);
    return Buffer.concat([len, Buffer.from(type), payload, Buffer.alloc(4)]); // CRC unchecked by our header reader
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", Buffer.alloc(0)), chunk("IEND", Buffer.alloc(0))]));
}

const solid = (w: number, h: number, rgb = { r: 90, g: 90, b: 90 }) =>
  sharp({ create: { width: w, height: h, channels: 3, background: rgb } });

async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; return "OK"; } catch (e) { return e instanceof AppError ? `${e.code}:${e.message}` : `THROWN:${String(e)}`; }
}

describe("format helpers", () => {
  it("sniffs by signature and reads header sizes before decoding", async () => {
    const jpeg = new Uint8Array(await solid(640, 480).jpeg().toBuffer());
    const lossy = new Uint8Array(await solid(321, 123).webp().toBuffer());
    const lossless = new Uint8Array(await solid(321, 123).webp({ lossless: true }).toBuffer());
    const alpha = new Uint8Array(await sharp({ create: { width: 321, height: 123, channels: 4,
      background: { r: 1, g: 2, b: 3, alpha: 0.5 } } }).webp().toBuffer());
    expect(sniffFormat(HEIC)).toBe("heic");
    expect(sniffFormat(jpeg)).toBe("jpeg");
    expect(headerSize(jpeg)).toEqual({ width: 640, height: 480 });
    expect(headerSize(pngHeaderOnly(8000, 6000))).toEqual({ width: 8000, height: 6000 });
    for (const w of [lossy, lossless, alpha]) {
      expect(sniffFormat(w)).toBe("webp");
      expect(headerSize(w)).toEqual({ width: 321, height: 123 });
    }
  });

  it("finds HEIF via compatible brands, skips JPEG fill bytes, stops at scan data, checks VP8 sync", async () => {
    const isom = new Uint8Array([0, 0, 0, 0x1c, ...Buffer.from("ftypisom"), 0, 0, 0, 0, ...Buffer.from("mif1heicmiaf"), ...new Array(16).fill(0)]);
    expect(sniffFormat(isom)).toBe("heic");
    const jpeg = await solid(640, 480).jpeg().toBuffer();
    const padded = new Uint8Array(Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xff, 0xff]), jpeg.subarray(2)]));
    expect(headerSize(padded)).toEqual({ width: 640, height: 480 });
    expect(headerSize(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 8, 1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    const lossy = new Uint8Array(await solid(321, 123).webp().toBuffer());
    lossy[23] = 0;
    expect(headerSize(lossy)).toBeNull();
  });

  it("detects animated WebP and leaves still images alone", async () => {
    const frames = [await solid(64, 64).png().toBuffer(), await solid(64, 64, { r: 200, g: 0, b: 0 }).png().toBuffer()];
    const animated = new Uint8Array(await sharp(frames, { join: { animated: true } }).webp().toBuffer());
    expect(isAnimated(animated)).toBe(true);
    expect(isAnimated(new Uint8Array(await solid(64, 64).webp().toBuffer()))).toBe(false);
    expect(isAnimated(new Uint8Array(await solid(64, 64).png().toBuffer()))).toBe(false);
  });

  it("sizes like the Python spike: no upscaling, round half up, integer shrink", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1536, height: 2048 });
    expect(fitWithin(1000, 700)).toEqual({ width: 1000, height: 700 });
    expect(fitWithin(4097, 3)).toEqual({ width: 2048, height: 1 });
    expect(shrinkStep(29, 10)).toEqual({ width: 26, height: 9 });
    expect(qualitySteps()).toEqual([82, 76, 70, 64, 60]);
  });
});

describe("server normalize", () => {
  it("rejects HEIC with the exact message, other formats, corrupt, animated, and huge inputs", async () => {
    expect(await codeOf(normalize(HEIC))).toBe(`UNSUPPORTED_FORMAT:${HEIC_MESSAGE}`);
    expect(await codeOf(normalize(new Uint8Array(await solid(300, 300).gif().toBuffer())))).toMatch(/^UNSUPPORTED_FORMAT/);
    const jpeg = await solid(900, 600).jpeg().toBuffer();
    expect(await codeOf(normalize(new Uint8Array(jpeg.subarray(0, jpeg.length / 3))))).toMatch(/^INVALID_IMAGE/);
    const frames = [await solid(400, 400).png().toBuffer(), await solid(400, 400, { r: 0, g: 0, b: 255 }).png().toBuffer()];
    const anim = new Uint8Array(await sharp(frames, { join: { animated: true } }).webp().toBuffer());
    expect(await codeOf(normalize(anim))).toMatch(/^UNSUPPORTED_FORMAT:Animated/);
    expect(await codeOf(normalize(pngHeaderOnly(8000, 6000)))).toMatch(/^TOO_LARGE/);
    expect(await codeOf(normalize(new Uint8Array(await solid(200, 120).png().toBuffer())))).toMatch(/^INVALID_IMAGE/);
  });

  it("rejects APNG, which libvips would decode as a still frame", async () => {
    const png = await solid(400, 400).png().toBuffer();
    const actl = Buffer.alloc(8); actl.writeUInt32BE(2, 0); // two frames, loop forever
    const body = Buffer.concat([Buffer.from("acTL"), actl]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    const len = Buffer.alloc(4); len.writeUInt32BE(8);
    const afterIhdr = 8 + 25; // signature + IHDR chunk
    const apng = new Uint8Array(Buffer.concat([png.subarray(0, afterIhdr), len, body, crc, png.subarray(afterIhdr)]));
    expect(isAnimated(apng)).toBe(true);
    expect(await codeOf(normalize(apng))).toMatch(/^UNSUPPORTED_FORMAT:Animated/);
  });

  it("warns below 800 px and never upscales", async () => {
    const out = await normalize(new Uint8Array(await solid(700, 500).png().toBuffer()));
    expect(out.warnings).toHaveLength(1);
    expect([out.width, out.height]).toEqual([700, 500]);
  });

  it("bounds a large noisy photo to 2048 px and 1,250,000 bytes with no metadata chunks", async () => {
    const pixels = Buffer.alloc(4000 * 3000 * 3);
    let seed = 7;
    for (let i = 0; i < pixels.length; i++) { seed = (seed * 1103515245 + 12345) >>> 0; pixels[i] = seed >>> 24; }
    const source = await sharp(pixels, { raw: { width: 4000, height: 3000, channels: 3 } }).jpeg({ quality: 92 })
      .withMetadata({ orientation: 1 }).toBuffer();
    const out = await normalize(new Uint8Array(source));
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(2048);
    expect(out.bytes.byteLength).toBeLessThanOrEqual(1_250_000);
    expect(webpChunks(out.bytes).filter((c) => ["EXIF", "ICCP", "XMP "].includes(c))).toEqual([]);
    const meta = await sharp(out.bytes).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([out.width, out.height, "webp"]);
  }, 30_000);

  it("applies EXIF orientation 6 once: a marker lands within 3 px and EXIF is gone", async () => {
    const marker = { x: 40, y: 30 };
    const base = await solid(600, 400, { r: 128, g: 128, b: 128 })
      .composite([{ input: await solid(20, 20, { r: 255, g: 0, b: 0 }).png().toBuffer(),
        left: marker.x - 10, top: marker.y - 10 }]).jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toBuffer();
    const out = await normalize(new Uint8Array(base));
    expect([out.width, out.height]).toEqual([400, 600]);
    const { data, info } = await sharp(out.bytes).raw().toBuffer({ resolveWithObject: true });
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (data[i]! > 200 && data[i + 1]! < 80 && data[i + 2]! < 80) { sx += x; sy += y; n++; }
    }
    // Clockwise rotation maps stored (x, y) to (H - 1 - y, x).
    expect(Math.hypot(sx / n - (400 - 1 - marker.y), sy / n - marker.x)).toBeLessThanOrEqual(3);
    expect(webpChunks(out.bytes)).not.toContain("EXIF");
  });

  it("flattens transparency onto the canvas token color, which matches tokens.css", async () => {
    const css = readFileSync(path.join(process.cwd(), "src/styles/tokens.css"), "utf8");
    const hex = /--nl-canvas:\s*#([0-9a-f]{6})/i.exec(css)?.[1] ?? "";
    expect([0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))).toEqual([CANVAS_RGB.r, CANVAS_RGB.g, CANVAS_RGB.b]);
    const clear = await sharp({ create: { width: 900, height: 600, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const out = await normalize(new Uint8Array(clear));
    const { channels } = await sharp(out.bytes).stats();
    // Lossy WebP (YUV 4:2:0) may shift a flat color by a step or two; Python allows 3 too.
    const means = channels.slice(0, 3).map((c) => c.mean);
    [CANVAS_RGB.r, CANVAS_RGB.g, CANVAS_RGB.b].forEach((v, i) => expect(Math.abs(means[i]! - v)).toBeLessThanOrEqual(3));
  });
});

describe("origin check", () => {
  const config = { appOrigin: "https://dreambike.example" } as Parameters<typeof assertSameOrigin>[1];
  const req = (origin: string | null, host = "localhost:3100") => new Request(`http://${host}/api/normalize`,
    { method: "POST", headers: origin ? { Origin: origin, Host: host } : { Host: host } });
  const allowed = (r: Request, deployed: boolean) => { try { assertSameOrigin(r, config, deployed); return true; } catch { return false; } };

  it("accepts APP_ORIGIN and, only locally, localhost ports; never trusts Host", () => {
    expect(allowed(req("https://dreambike.example"), true)).toBe(true);
    expect(allowed(req("http://localhost:3100"), false)).toBe(true);
    expect(allowed(req("http://127.0.0.1:3000"), false)).toBe(true);
    expect(allowed(req("http://localhost:3100"), true)).toBe(false);
    // DNS rebinding: attacker controls both Origin and Host.
    expect(allowed(req("http://evil.test:3000", "evil.test:3000"), false)).toBe(false);
    expect(allowed(req(null), false)).toBe(false);
  });
});

describe("POST /api/normalize", () => {
  const url = "http://localhost:3000/api/normalize";
  afterEach(() => vi.restoreAllMocks());

  async function post(form: FormData | null, headers: Record<string, string> = { Origin: "http://localhost:3000" }) {
    const res = await POST(new Request(url, { method: "POST", body: form ?? undefined, headers }));
    return { status: res.status, body: await res.json(), cache: res.headers.get("cache-control") };
  }
  const photoForm = async (bytes: Uint8Array, type = "image/webp") => {
    const form = new FormData();
    form.append("photo", new File([new Uint8Array(bytes)], "photo.webp", { type }));
    return form;
  };

  it("normalizes a valid photo without any outbound request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await post(await photoForm(new Uint8Array(await solid(1200, 900).webp().toBuffer())));
    expect(res.status).toBe(200);
    expect(res.cache).toBe("no-store");
    const parsed = NormalizeResponse.parse(res.body);
    expect([parsed.image.width, parsed.image.height]).toEqual([1200, 900]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns stable error JSON, never a 500, for bad inputs", async () => {
    const cases: [Promise<{ status: number; body: unknown }>, number, string][] = [
      [post(await photoForm(HEIC, "image/webp")), 415, "UNSUPPORTED_FORMAT"],
      [post(await photoForm(new Uint8Array([1, 2, 3]))), 415, "UNSUPPORTED_FORMAT"],
      [post(await photoForm(new Uint8Array(await solid(10, 10).gif().toBuffer()), "image/gif")), 415, "UNSUPPORTED_FORMAT"],
      [post(await photoForm(new Uint8Array(1_250_001))), 413, "TOO_LARGE"],
      [post(await photoForm(new Uint8Array(10)), ), 415, "UNSUPPORTED_FORMAT"],
      [post(await photoForm(new Uint8Array(10)), {}), 403, "FORBIDDEN"],
      [post(await photoForm(new Uint8Array(10)), { Origin: "https://evil.example" }), 403, "FORBIDDEN"],
      [post(null), 400, "INVALID_REQUEST"],
    ];
    for (const [pending, status, code] of cases) {
      const res = await pending;
      expect([res.status, ErrorResponse.parse(res.body).error.code]).toEqual([status, code]);
    }
    const heic = ErrorResponse.parse((await post(await photoForm(HEIC))).body);
    expect(heic.error.message).toBe(HEIC_MESSAGE);
    // A HEIC with its real MIME fails the MIME check first; it must still get 415 + the HEIC message.
    const real = await post(await photoForm(HEIC, "image/heic"));
    expect([real.status, ErrorResponse.parse(real.body).error.message]).toEqual([415, HEIC_MESSAGE]);
  });

  it("rejects duplicate photo parts and an oversized streamed body without Content-Length", async () => {
    const one = new Uint8Array(await solid(300, 300).webp().toBuffer());
    const form = await photoForm(one);
    form.append("photo", new File([one], "b.webp", { type: "image/webp" }));
    expect((await post(form)).status).toBe(400);
    const chunk = new Uint8Array(64 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) { if (sent >= 2_000_000) c.close(); else { sent += chunk.length; c.enqueue(chunk); } },
    });
    const res = await POST(new Request(url, { method: "POST", body: stream, duplex: "half",
      headers: { Origin: "http://localhost:3000", "Content-Type": "multipart/form-data; boundary=x" } } as RequestInit));
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(2_000_000); // reading stopped early
  });

  it("rejects extra form fields and a declared body over the envelope", async () => {
    const form = await photoForm(new Uint8Array(await solid(300, 300).webp().toBuffer()));
    form.append("note", "hi");
    expect((await post(form)).status).toBe(400);
    const big = await POST(new Request(url, { method: "POST", body: "x",
      headers: { Origin: "http://localhost:3000", "Content-Length": "4000000" } }));
    expect(big.status).toBe(413);
  });
});

// Python (Pillow) vs TypeScript (sharp) agreement on real owned photos, when
// present locally. Skips cleanly elsewhere; never sends anything anywhere.
const ownedDir = ["fixtures", "my_bike/jpeg"].map((d) => path.join(process.cwd(), d))
  .find((d) => existsSync(d) && readdirSync(d).some((f) => /\.jpe?g$/i.test(f)));
const python = path.join(process.cwd(), ".venv/bin/python");

describe.skipIf(!ownedDir || !existsSync(python))("Pillow and sharp agree on owned JPEGs", () => {
  it("same oriented size and near-identical pixels", async () => {
    const files = readdirSync(ownedDir!).filter((f) => /\.jpe?g$/i.test(f)).slice(0, 5);
    for (const file of files) {
      const source = readFileSync(path.join(ownedDir!, file));
      const ours = await normalize(new Uint8Array(source));
      const script = "import sys; sys.path.insert(0,'spike'); import imaging; n=imaging.normalize(open(sys.argv[1],'rb').read()); sys.stdout.buffer.write(n.data)";
      const theirs = execFileSync(python, ["-I", "-c", script, path.join(ownedDir!, file)], { cwd: process.cwd(), maxBuffer: 4e6 });
      const a = await sharp(ours.bytes).raw().toBuffer({ resolveWithObject: true });
      const b = await sharp(theirs).raw().toBuffer({ resolveWithObject: true });
      expect([a.info.width, a.info.height], file).toEqual([b.info.width, b.info.height]);
      let diff = 0;
      for (let i = 0; i < a.data.length; i++) diff += Math.abs(a.data[i]! - b.data[i]!);
      expect(diff / a.data.length, file).toBeLessThan(4);
    }
  }, 120_000);
});
