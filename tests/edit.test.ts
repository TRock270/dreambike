import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as compositePOST } from "@/app/api/composite/route";
import { POST as editPOST } from "@/app/api/edit/route";
import { CompositeResponse, EditResponse, ErrorResponse } from "@/lib/contracts";
import * as images from "@/lib/server/images";
const { maskToPng } = images;
const renderTemplate = (images as Record<string, unknown>).renderTemplate;
import { readJsonLimited, renderTemplate as rt } from "@/lib/server/meta";

const W = 1536, H = 1152;
const solid = (w: number, h: number, c: { r: number; g: number; b: number }) => sharp({ create: { width: w, height: h, channels: 3, background: c } });
async function webp(img: ReturnType<typeof sharp>) { return new Uint8Array(await img.webp({ quality: 95 }).toBuffer()); }
function rectMask(l: number, t: number, r: number, b: number) {
  const pixels = new Uint8Array(W * H);
  for (let y = t; y < b; y++) for (let x = l; x < r; x++) pixels[y * W + x] = 1;
  return { width: W, height: H, pixels };
}
const headers = () => ({ Origin: "http://localhost:3000", "X-Request-Id": crypto.randomUUID() });
const errorOf = async (res: Response) => [res.status, ErrorResponse.parse(await res.json()).error.code];

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function composite(payload: object, files: Record<string, Uint8Array>) {
  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  for (const [name, bytes] of Object.entries(files)) {
    form.append(name, new File([new Uint8Array(bytes)], name, { type: name.endsWith("Mask") ? "image/png" : "image/webp" }));
  }
  return compositePOST(new Request("http://localhost:3000/api/composite", { method: "POST", body: form, headers: headers() }));
}

describe("POST /api/composite", () => {
  const payload = { width: W, height: H, bikeBox: [100, 100, 1100, 1000], intent: "paint", generatedWidth: W, generatedHeight: H };

  it("blends a paint edit inside the part and keeps the background", async () => {
    const base = await webp(solid(W, H, { r: 90, g: 90, b: 90 }));
    const edited = await webp(solid(W, H, { r: 90, g: 90, b: 90 }).composite([{ input: await solid(400, 300, { r: 200, g: 30, b: 30 }).png().toBuffer(), left: 500, top: 400 }]));
    const m = rectMask(500, 400, 900, 700);
    const res = await composite(payload, { base, edited, oldMask: await maskToPng(m), newMask: await maskToPng(m) });
    const body = CompositeResponse.parse(await res.json());
    expect([body.composed, body.aligned, body.reason]).toEqual([true, true, "composited"]);
    const { data, info } = await sharp(Buffer.from(body.image.dataUrl.split(",")[1]!, "base64")).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3));
    expect(px(5, 5).every((v, i) => Math.abs(v - [90, 90, 90][i]!) <= 3)).toBe(true);
    expect(px(700, 550)[0]).toBeGreaterThan(170);
  });

  it("returns the full edit for geometry, aspect, and disabled composition; refuses an unresized edit otherwise", async () => {
    const base = await webp(solid(W, H, { r: 90, g: 90, b: 90 }));
    const sameSize = await webp(solid(W, H, { r: 10, g: 200, b: 10 }));
    const m = await maskToPng(rectMask(500, 400, 900, 700));
    const geo = CompositeResponse.parse(await (await composite({ ...payload, intent: "geometry" }, { base, edited: sameSize, oldMask: m, newMask: m })).json());
    expect([geo.composed, geo.reason]).toEqual([false, "geometry"]);
    // 2000×1250 is large enough (short edge ≥ 1024) but 1.6:1 instead of 4:3, so aspect decides.
    const wide = await webp(solid(2000, 1250, { r: 10, g: 200, b: 10 }));
    const aspect = CompositeResponse.parse(await (await composite({ ...payload, generatedWidth: 2000, generatedHeight: 1250 }, { base, edited: wide })).json());
    expect([aspect.reason, aspect.image.width, aspect.image.height]).toEqual(["aspect", 2000, 1250]);
    expect(await errorOf(await composite(payload, { base, edited: wide }))).toEqual([400, "INVALID_REQUEST"]);
    const missing = CompositeResponse.parse(await (await composite(payload, { base, edited: sameSize })).json());
    expect(missing.reason).toBe("missing_mask");
    vi.stubEnv("COMPOSITE_ENABLED", "false");
    const off = CompositeResponse.parse(await (await composite(payload, { base, edited: sameSize, oldMask: m, newMask: m })).json());
    expect(off.reason).toBe("disabled");
  });

  it("checks the real image format, not the declared MIME", async () => {
    const png = new Uint8Array(await solid(W, H, { r: 1, g: 1, b: 1 }).png().toBuffer());
    const base = await webp(solid(W, H, { r: 90, g: 90, b: 90 }));
    expect(await errorOf(await composite(payload, { base, edited: png }))).toEqual([400, "INVALID_IMAGE"]);
  });

  it("rejects a mask of the wrong size", async () => {
    const base = await webp(solid(W, H, { r: 90, g: 90, b: 90 }));
    const small = await maskToPng({ width: 100, height: 100, pixels: new Uint8Array(10_000) });
    expect((await composite(payload, { base, edited: base, oldMask: small, newMask: small })).status).toBe(400);
  });
});

describe("POST /api/edit", () => {
  const p = { slot: "tank", prompt: "Gloss black fuel tank in the upper middle.", mode: "paint", intent: "paint", quality: "high", width: 400, height: 300 };
  async function edit(payload: object, extra: Record<string, Uint8Array> = {}) {
    const form = new FormData();
    form.append("payload", JSON.stringify(payload));
    form.append("base", new File([new Uint8Array(await webp(solid(400, 300, { r: 80, g: 80, b: 80 })))], "b.webp", { type: "image/webp" }));
    for (const [n, b] of Object.entries(extra)) form.append(n, new File([new Uint8Array(b)], n, { type: "image/webp" }));
    return editPOST(new Request("http://localhost:3000/api/edit", { method: "POST", body: form, headers: headers() }));
  }

  it("mock is labeled; demo is LIVE_DISABLED (also for reference); frame text is refused; no network", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await errorOf(await edit(p))).toEqual([503, "LIVE_DISABLED"]);
    expect(await errorOf(await edit({ ...p, slot: "frame", mode: "text", intent: "replace" }))).toEqual([400, "INVALID_REQUEST"]);
    expect(await errorOf(await edit({ ...p, mode: "reference" }, { reference: await webp(solid(400, 300, { r: 1, g: 1, b: 1 })) }))).toEqual([503, "LIVE_DISABLED"]);
    vi.stubEnv("MOCK", "1");
    const mock = EditResponse.parse(await (await edit(p)).json());
    expect([mock.generatedWidth, mock.generatedHeight]).toEqual([400, 300]);
    expect(mock.warnings.join(" ")).toMatch(/Mock/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("live: exact body, server-chosen template, per-image charge, empty data and malformed answers", async () => {
    const REDIS = "https://redis.invalid";
    for (const [k, v] of Object.entries({ LIVE_API_ENABLED: "true", MODEL_API_KEY: "k", UPSTASH_REDIS_REST_URL: REDIS,
      UPSTASH_REDIS_REST_TOKEN: "t", PRICING_VERIFIED_AT: "2026-10-28", VISITOR_HASH_SECRET: "s".repeat(32), BUDGET_TICKET: "T5", MOCK: "0", VERCEL_ENV: "" })) vi.stubEnv(k, v);
    const settles: string[][] = []; const bodies: Record<string, unknown>[] = [];
    let answer: unknown;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url) === REDIS) {
        const a = JSON.parse(String(init!.body)) as string[];
        const settle = a[1]!.includes("budget settlement");
        if (settle) settles.push([a[12]!, a[13]!]);
        return Response.json({ result: settle ? ["OK"] : ["OK", "10000"] });
      }
      bodies.push(JSON.parse(String(init!.body)));
      return Response.json(answer);
    });
    const out = Buffer.from(await solid(400, 300, { r: 5, g: 5, b: 5 }).webp().toBuffer()).toString("base64");
    answer = { data: [{ b64_json: out }] };
    const ok = EditResponse.parse(await (await edit({ ...p, mode: "text", intent: "paint" })).json());
    expect([ok.generatedWidth, ok.generatedHeight]).toEqual([400, 300]);
    const b = bodies[0]!;
    expect(Object.keys(b).sort()).toEqual(["images", "model", "n", "output_format", "prompt", "reasoning_strength", "response_format", "size", "tool_enablement"]);
    expect([b.model, b.n, b.size, b.response_format, b.output_format, b.reasoning_strength]).toEqual(["muse-image-1.0", 1, "400x300", "b64_json", "webp", "high"]);
    expect(b.tool_enablement).toEqual({ enable_image_search: false, enable_web_search: false, enable_shell: false });
    // Text mode uses edit.v1 even though the client said intent "paint".
    expect(b.prompt).toBe(rt("edit.v1.md", p.prompt));
    expect(settles[0]).toEqual(["settled", "10000"]);
    answer = { data: [{ b64_json: out }, { b64_json: out }] };
    await edit(p);
    expect(settles[1]).toEqual(["settled", "20000"]); // over the 10,000 reservation: settle.lua halts the ledger
    settles.splice(1, 1);
    answer = { data: [] };
    expect(await errorOf(await edit(p))).toEqual([422, "NO_RESULT"]);
    expect(settles[1]).toEqual(["settled", "0"]);
    answer = { error: "odd" };
    expect(await errorOf(await edit(p))).toEqual([422, "NO_RESULT"]);
    expect(settles[2]).toEqual(["unknown", "0"]);
  });
  describe("reference mode", () => {
    const rp = { slot: "wheel_front", prompt: "Gold multi-spoke wheel with chrome hub on the front wheel.", mode: "reference", intent: "geometry", quality: "high", width: 400, height: 300 };
    const refBytes = () => webp(solid(400, 300, { r: 200, g: 20, b: 20 }));
    // Several named parts, so the helper can send duplicates too.
    async function send(payload: object, parts: [string, Uint8Array, string?][]) {
      const form = new FormData();
      form.append("payload", JSON.stringify(payload));
      form.append("base", new File([new Uint8Array(await webp(solid(400, 300, { r: 80, g: 80, b: 80 })))], "b.webp", { type: "image/webp" }));
      for (const [n, b, type] of parts) form.append(n, new File([new Uint8Array(b)], n, { type: type ?? "image/webp" }));
      return editPOST(new Request("http://localhost:3000/api/edit", { method: "POST", body: form, headers: headers() }));
    }
    const pixel = async (dataUrl: string) => {
      const { data } = await sharp(Buffer.from(dataUrl.split(",")[1]!, "base64")).resize(1, 1).raw().toBuffer({ resolveWithObject: true });
      return Array.from(data);
    };
    const REDIS = "https://redis.invalid";
    function live() {
      for (const [k, v] of Object.entries({ LIVE_API_ENABLED: "true", MODEL_API_KEY: "k", UPSTASH_REDIS_REST_URL: REDIS,
        UPSTASH_REDIS_REST_TOKEN: "t", PRICING_VERIFIED_AT: "2026-10-28", VISITOR_HASH_SECRET: "s".repeat(32), BUDGET_TICKET: "T7", MOCK: "0", VERCEL_ENV: "" })) vi.stubEnv(k, v);
      const redis: string[] = []; const metaBodies: Record<string, unknown>[] = [];
      let answer: unknown = {};
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
        if (String(url) === REDIS) {
          const a = JSON.parse(String(init!.body)) as string[];
          const settle = a[1]!.includes("budget settlement");
          redis.push(settle ? "settle" : "reserve");
          return Response.json({ result: settle ? ["OK"] : ["OK", "10000"] });
        }
        metaBodies.push(JSON.parse(String(init!.body)));
        return Response.json(answer);
      });
      return { redis, metaBodies, spy, answer: (a: unknown) => { answer = a; } };
    }

    it("sends [base, reference] in one request with tools off and the compose template", async () => {
      const env = live();
      const out = Buffer.from(await solid(400, 300, { r: 5, g: 5, b: 5 }).webp().toBuffer()).toString("base64");
      env.answer({ data: [{ b64_json: out }] });
      const res = await send(rp, [["reference", await refBytes()]]);
      expect(res.status).toBe(200);
      EditResponse.parse(await res.json());
      expect(env.metaBodies).toHaveLength(1);
      expect(env.redis).toEqual(["reserve", "settle"]);
      const b = env.metaBodies[0] as { images: { image_url: string }[]; prompt: string; tool_enablement: unknown };
      expect(b.images).toHaveLength(2);
      const [basePx, refPx] = [await pixel(b.images[0]!.image_url), await pixel(b.images[1]!.image_url)];
      expect(Math.abs(basePx[0]! - 80)).toBeLessThan(6);   // grey base first
      expect(refPx[0]!).toBeGreaterThan(150);              // red reference second
      expect(b.tool_enablement).toEqual({ enable_image_search: false, enable_web_search: false, enable_shell: false });
      expect(b.prompt).toBe(rt("compose.v1.md", rp.prompt));
      expect(b.prompt).toContain("brake discs");
    });

    it("refuses bad reference sets before any fetch", async () => {
      const spy = vi.spyOn(globalThis, "fetch");
      const ref = await refBytes();
      expect(await errorOf(await send(rp, []))).toEqual([400, "INVALID_REQUEST"]);
      expect(await errorOf(await send({ ...rp, mode: "text", intent: "replace" }, [["reference", ref]]))).toEqual([400, "INVALID_REQUEST"]);
      expect(await errorOf(await send({ ...p }, [["reference", ref]]))).toEqual([400, "INVALID_REQUEST"]);
      expect(await errorOf(await send(rp, [["reference", ref], ["reference", ref]]))).toEqual([400, "INVALID_REQUEST"]);
      const png = new Uint8Array(await solid(400, 300, { r: 1, g: 1, b: 1 }).png().toBuffer());
      expect(await errorOf(await send(rp, [["reference", png, "image/png"]]))).toEqual([400, "INVALID_REQUEST"]);
      expect(spy).not.toHaveBeenCalled();
    });

    it("REFERENCE_MODE_ENABLED=false gives FEATURE_DISABLED, live or mock, with no fetch", async () => {
      vi.stubEnv("REFERENCE_MODE_ENABLED", "false");
      const spy = vi.spyOn(globalThis, "fetch");
      const ref = await refBytes();
      expect(await errorOf(await send(rp, [["reference", ref]]))).toEqual([503, "FEATURE_DISABLED"]);
      vi.stubEnv("MOCK", "1");
      expect(await errorOf(await send(rp, [["reference", ref]]))).toEqual([503, "FEATURE_DISABLED"]);
      expect(spy).not.toHaveBeenCalled();
    });

    it("mock reference render is labeled and offline", async () => {
      vi.stubEnv("MOCK", "1");
      const spy = vi.spyOn(globalThis, "fetch");
      const res = EditResponse.parse(await (await send(rp, [["reference", await refBytes()]])).json());
      expect(res.warnings.join(" ")).toMatch(/Mock.*reference mode/);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});

it("templates drop their header and insert the prompt", () => {
  expect(renderTemplate).toBeUndefined(); // template expansion lives in meta.ts, not images.ts
  const t = rt("paint.v1.md", "  Red tank  ");
  expect(t.startsWith("Edit this photo of a motorcycle.")).toBe(true);
  expect(t.endsWith("Red tank")).toBe(true);
  expect(t).not.toContain("{{editPrompt}}");
  // Untrusted text is inserted verbatim: no special "$" replacement patterns.
  expect(rt("compose.v1.md", "Gold wheel").endsWith("Gold wheel")).toBe(true);
  expect(rt("edit.v1.md", "x $` y $$ z $&").endsWith("x $` y $$ z $&")).toBe(true);
});

describe("upstream and upload guards", () => {
  it("refuses an upstream body over the cap by Content-Length or by streamed size", async () => {
    await expect(readJsonLimited(new Response("{}", { headers: { "Content-Length": "50000000" } }))).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    const big = new Response(JSON.stringify({ data: "x".repeat(5000) }));
    await expect(readJsonLimited(big, 1000)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    expect(await readJsonLimited(new Response("{\"a\":1}"))).toEqual({ a: 1 });
  });
  it("refuses an animated WebP in composite", async () => {
    const frame = (r: number) => sharp({ create: { width: W, height: H, channels: 3, background: { r, g: 0, b: 0 } } }).png().toBuffer();
    const anim = new Uint8Array(await sharp([await frame(0), await frame(255)], { join: { animated: true } }).webp().toBuffer());
    const base = await webp(solid(W, H, { r: 90, g: 90, b: 90 }));
    expect(await errorOf(await composite({ width: W, height: H, bikeBox: [100, 100, 1100, 1000], intent: "paint",
      generatedWidth: W, generatedHeight: H }, { base, edited: anim }))).toEqual([400, "INVALID_IMAGE"]);
  });
});
