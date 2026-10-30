import { parseImageStream } from "@meta-sam/parser";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/segment/route";
import { ErrorResponse, SegmentResponse } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { acceptableAsPart, assignFrontRear, clipToBike, maskArea, maskBox, outlinePixels, shareOfBike, unionMasks } from "@/lib/parts";
import { runLimited } from "@/lib/queue";
import { VERIFIED_SAM_DOWNSCALED, VERIFIED_SAM_PLACEMENT, VERIFIED_SAM_POINTS, isDownscaled, maskToNormalized, maskToPng, placeSamRasters, pngToMask } from "@/lib/server/images";
import { samPointsText, samRecords, segment } from "@/lib/server/meta";
import { sseEvents } from "@/lib/server/sse";
import { withSession } from "./support/session";

// Documented record from the @meta-sam/parser 0.1.0 README (format evidence, not an
// account response): box x1..x2 = 211..270, y1..y2 = 228..254 (inclusive), 320x334 frame.
const DOC = "<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334;c=0.87|>"
  + "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>\n";
const lane = { item_id: "m1", output_index: 0, content_index: 0 };

function sseBytes(): Uint8Array {
  const events = [
    { type: "response.created" },
    { type: "response.output_text.delta", ...lane, delta: DOC.slice(0, 50) },
    { type: "response.output_text.delta", ...lane, delta: DOC.slice(50) },
    { type: "response.content_part.done", ...lane, part: { type: "output_text", text: DOC } },
    { type: "response.completed" },
  ];
  return new TextEncoder().encode(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""));
}

function streamOf(bytes: Uint8Array, cuts: number[]): ReadableStream<Uint8Array> {
  const points = [0, ...cuts, bytes.length];
  let i = 0;
  return new ReadableStream({ pull(c) {
    if (i >= points.length - 1) return c.close();
    c.enqueue(bytes.slice(points[i], points[i + 1])); i++;
  } });
}

describe("SAM stream parsing", () => {
  it("gives the same records for any byte split, pairs by object ID, keeps confidence", async () => {
    const bytes = sseBytes();
    const splits = [[], [1], [bytes.length / 2 | 0], Array.from({ length: 40 }, (_, k) => (k + 1) * 17).filter((x) => x < bytes.length)];
    for (const cuts of splits) {
      const result = await parseImageStream(sseEvents(streamOf(bytes, cuts)) as AsyncIterable<{ type: string }>).finalResult;
      const sam = samRecords(result);
      expect(sam.complete).toBe(true);
      expect(sam.objects).toHaveLength(1);
      const o = sam.objects[0]!;
      expect([o.objectId, o.maskWidth, o.maskHeight, o.confidence]).toEqual(["0", 60, 27, 0.87]);
      expect(o.bounds).toEqual({ left: 211, top: 228, right: 271, bottom: 255 }); // half-open
    }
  });

  it("treats an empty lane as zero objects, not an error", async () => {
    const bytes = new TextEncoder().encode([
      { type: "response.content_part.done", ...lane, part: { type: "output_text", text: "" } },
      { type: "response.completed" },
    ].map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""));
    const result = await parseImageStream(sseEvents(streamOf(bytes, [7])) as AsyncIterable<{ type: string }>).finalResult;
    expect(samRecords(result).objects).toEqual([]);
  });
});

describe("mask placement (U01: box-relative verified 2026-10-28)", () => {
  it("refuses a box-sized raster without a verified placement, places it inside the box when verified", async () => {
    const result = await parseImageStream(sseEvents(streamOf(sseBytes(), [])) as AsyncIterable<{ type: string }>).finalResult;
    const o = samRecords(result).objects[0]!;
    expect(VERIFIED_SAM_PLACEMENT).toBe("box_relative");
    expect(() => maskToNormalized(o.raster, o.maskWidth, o.maskHeight, o.bounds, 320, 334, null))
      .toThrow(AppError);
    const placed = maskToNormalized(o.raster, o.maskWidth, o.maskHeight, o.bounds, 320, 334, "box_relative");
    const box = maskBox(placed)!;
    expect(box[0]).toBeGreaterThanOrEqual(211);
    expect(box[2]).toBeLessThanOrEqual(271);
    expect(box[3]).toBeLessThanOrEqual(255);
    expect(maskArea(placed)).toBe(o.raster.reduce((a, v) => a + v, 0));
  });

  it("drops a downscaled raster and keeps the box-sized ones from the same answer", () => {
    const bounds = { left: 10, top: 20, right: 14, bottom: 23 };
    const boxSized = { objectId: "a", bounds, raster: new Uint8Array(12).fill(1), maskWidth: 4, maskHeight: 3, confidence: 0.9 };
    // SAM shrinks masks over 1024 px to fit their bounds: here 2x1 for a 4x3 box.
    const downscaled = { objectId: "b", bounds, raster: new Uint8Array(2).fill(1), maskWidth: 2, maskHeight: 1, confidence: 0.4 };
    const out = placeSamRasters([downscaled, boxSized], 40, 30, "box_relative");
    expect(out.dropped).toBe(1);
    expect(out.masks.map((m) => m.objectId)).toEqual(["a"]);
    expect(maskBox(out.masks[0]!.mask)).toEqual([10, 20, 14, 23]);
    expect(maskArea(out.masks[0]!.mask)).toBe(12);
    // A raster whose length does not match its declared size is a malformed answer: it throws, it is not dropped.
    expect(() => placeSamRasters([{ ...boxSized, raster: new Uint8Array(5) }], 40, 30, "box_relative"))
      .toThrow(expect.objectContaining({ code: "SCHEMA_INVALID" }));
    expect(placeSamRasters([boxSized], 40, 30, null)).toEqual({ masks: [], dropped: 1 });
  });

  it("rejects a raster whose size matches neither the box nor the image", () => {
    expect(() => maskToNormalized(new Uint8Array(12), 4, 3, { left: 0, top: 0, right: 5, bottom: 3 }, 10, 10, "box_relative"))
      .toThrow(/./);
  });

  it("round-trips a full-image mask through PNG exactly and refuses a size mismatch", async () => {
    const pixels = new Uint8Array(37 * 23).map((_, i) => (i % 7 === 0 ? 1 : 0));
    const png = await maskToPng({ width: 37, height: 23, pixels });
    expect((await pngToMask(png, 37, 23)).pixels).toEqual(pixels);
    await expect(pngToMask(png, 23, 37)).rejects.toThrow();
    expect((await sharp(png).metadata()).format).toBe("png");
  });
});

describe("part rules", () => {
  const W = 100, H = 50;
  const rect = (l: number, t: number, r: number, b: number) => {
    const pixels = new Uint8Array(W * H);
    for (let y = t; y < b; y++) for (let x = l; x < r; x++) pixels[y * W + x] = 1;
    return { width: W, height: H, pixels };
  };
  const bike = rect(10, 10, 90, 45);

  it("clips to the bike and rejects a point part covering over 60% of the bike", () => {
    expect(maskArea(clipToBike(rect(0, 0, 20, 20), bike))).toBe(10 * 10);
    expect(shareOfBike(rect(10, 10, 90, 45), bike)).toBe(1);
    expect(acceptableAsPart(rect(10, 10, 55, 45), bike)).toBe(true); // 45/80 = 56%
    expect(acceptableAsPart(rect(10, 10, 70, 45), bike)).toBe(false);
    expect(acceptableAsPart(rect(10, 10, 70, 45), null)).toBe(true); // cutout mode
    expect(() => clipToBike(rect(0, 0, 1, 1), { width: 10, height: 10, pixels: new Uint8Array(100) })).toThrow();
  });

  it("assigns front and rear by facing, and asks for help when it cannot", () => {
    const rearBox: [number, number, number, number] = [12, 25, 32, 45];
    const frontBox: [number, number, number, number] = [68, 25, 88, 45];
    const bikeBox: [number, number, number, number] = [10, 10, 90, 45];
    expect(assignFrontRear([rearBox, frontBox], "right", bikeBox)).toEqual({ kind: "assigned", front: 1, rear: 0 });
    expect(assignFrontRear([rearBox, frontBox], "left", bikeBox)).toEqual({ kind: "assigned", front: 0, rear: 1 });
    expect(assignFrontRear([rearBox, frontBox], "unknown", bikeBox)).toEqual({ kind: "needs_facing" });
    expect(assignFrontRear([[12, 25, 88, 45]], "right", bikeBox).kind).toBe("needs_point");
    expect(assignFrontRear([frontBox], "right", bikeBox)).toEqual({ kind: "assigned", front: 0, rear: null });
    expect(assignFrontRear([rearBox, frontBox, frontBox], "right", bikeBox).kind).toBe("needs_point");
  });
});

describe("request queue", () => {
  it("never runs more than 4 at once and keeps partial results after failures", async () => {
    let inFlight = 0, peak = 0;
    const jobs = Array.from({ length: 15 }, (_, i) => async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5 + (i % 3) * 3));
      inFlight--;
      if (i === 3) throw new Error("boom");
      return i;
    });
    const results = await runLimited(jobs, 4);
    expect(peak).toBeLessThanOrEqual(4);
    expect(results.filter((r) => r.ok)).toHaveLength(14);
    expect(results[3]!.ok).toBe(false);
    expect(results[14]).toEqual({ ok: true, value: 14 });
  });
});

describe("downscaled SAM rasters (U01: verified 2026-10-28, VERIFIED_SAM_DOWNSCALED)", () => {
  it("isDownscaled: 1024 long edge with the box aspect, nothing else", () => {
    expect(isDownscaled(1024, 702, 1431, 981)).toBe(true);   // motorcycle, U01 evidence
    expect(isDownscaled(1024, 808, 1539, 1214)).toBe(true);  // point click, U01 evidence
    expect(isDownscaled(1024, 650, 1431, 981)).toBe(false);  // wrong short side
    expect(isDownscaled(1024, 703, 1431, 981)).toBe(true);   // within +-1
    expect(isDownscaled(1024, 704, 1431, 981)).toBe(false);
    expect(isDownscaled(800, 622, 900, 700)).toBe(false);    // box long edge <= 1024
    expect(isDownscaled(1024, 700, 1024, 700)).toBe(false);  // box-sized, not downscaled
    expect(isDownscaled(702, 1024, 981, 1431)).toBe(true);   // portrait: height is the long side
    expect(isDownscaled(1024, 702, 981, 1431)).toBe(false);  // long side on the wrong axis
    // Huge upstream bounds only fill the part inside the image (no box-sized allocation).
    const raster = new Uint8Array(1024 * 702).fill(1);
    expect(maskArea(maskToNormalized(raster, 1024, 702, { left: -100000, top: -50000, right: 100000, bottom: 87109 }, 64, 48, "box_relative", true)))
      .toBe(64 * 48);
    expect(maskArea(maskToNormalized(raster, 1024, 702, { left: 394, top: 241, right: 1825, bottom: 1222 }, 2048, 1536, "box_relative", true)))
      .toBe(1431 * 981);
  });

  const boxW = 1431, boxH = 981, maskW = 1024, maskH = 702;
  const bounds = { left: 300, top: 400, right: 300 + boxW, bottom: 400 + boxH };
  const insideEllipse = (x: number, y: number) => ((x - 700) / 600) ** 2 + ((y - 480) / 400) ** 2 <= 1;
  // Box-local truth ellipse, and SAM-like nearest-centre shrink of it to 1024x702.
  const small = new Uint8Array(maskW * maskH);
  for (let y = 0; y < maskH; y++) for (let x = 0; x < maskW; x++) {
    small[y * maskW + x] = insideEllipse(Math.min(boxW - 1, Math.floor(((2 * x + 1) * boxW) / (2 * maskW))),
      Math.min(boxH - 1, Math.floor(((2 * y + 1) * boxH) / (2 * maskH)))) ? 1 : 0;
  }

  it("upscales onto the box: high overlap with the truth, every pixel inside the box", () => {
    const placed = maskToNormalized(small, maskW, maskH, bounds, 2048, 1536, "box_relative", true);
    let both = 0, either = 0;
    for (let y = 0; y < 1536; y++) for (let x = 0; x < 2048; x++) {
      const inBox = x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom;
      const truth = inBox && insideEllipse(x - bounds.left, y - bounds.top);
      const got = placed.pixels[y * 2048 + x] === 1;
      if (got && !inBox) throw new Error(`pixel outside box at ${x},${y}`);
      if (got && truth) both++;
      if (got || truth) either++;
    }
    expect(both / either).toBeGreaterThanOrEqual(0.98);
    expect(placed.pixels.length).toBe(2048 * 1536);
  });

  it("pins the source index at pixel centres (same vectors as spike/local_images.py)", () => {
    // Mark one source column (or row); the box columns that show it reveal the formula.
    const columns = (sourceX: number) => {
      const r = new Uint8Array(maskW * maskH);
      for (let y = 0; y < maskH; y++) r[y * maskW + sourceX] = 1;
      const m = maskToNormalized(r, maskW, maskH, bounds, 2048, 1536, "box_relative", true);
      const cols = new Set<number>();
      for (let x = 0; x < 2048; x++) if (m.pixels[(bounds.top + 5) * 2048 + x]) cols.add(x - bounds.left);
      return cols;
    };
    expect(columns(0).has(0)).toBe(true);                       // dx 0 reads source 0
    expect(columns(501).has(700)).toBe(true);                   // dx 700 reads source 501
    expect(columns(501).has(699) && columns(501).has(1430)).toBe(false);
    expect(columns(1023).has(1430)).toBe(true);                 // last dx reads the last source column
    const rows = (sourceY: number) => {
      const r = new Uint8Array(maskW * maskH);
      for (let x = 0; x < maskW; x++) r[sourceY * maskW + x] = 1;
      const m = maskToNormalized(r, maskW, maskH, bounds, 2048, 1536, "box_relative", true);
      const out = new Set<number>();
      for (let y = 0; y < 1536; y++) if (m.pixels[y * 2048 + bounds.left + 5]) out.add(y - bounds.top);
      return out;
    };
    expect(rows(0).has(0)).toBe(true);
    expect(rows(Math.floor((490.5 * 702) / 981)).has(490)).toBe(true); // = row 351
    expect(rows(701).has(980)).toBe(true);
  });

  it("clips at the image border like a box-sized raster", () => {
    const edge = { left: 1900, top: 1000, right: 1900 + boxW, bottom: 1000 + boxH };
    const placed = maskToNormalized(new Uint8Array(maskW * maskH).fill(1), maskW, maskH, edge, 2048, 1536, "box_relative", true);
    expect(maskBox(placed)).toEqual([1900, 1000, 2048, 1536]);
    expect(maskArea(placed)).toBe((2048 - 1900) * (1536 - 1000));
  });

  it("is refused when the flag argument is false, and without box_relative", () => {
    expect(() => maskToNormalized(small, maskW, maskH, bounds, 2048, 1536, "box_relative", false)).toThrow(AppError);
    expect(() => maskToNormalized(small, maskW, maskH, bounds, 2048, 1536, null, true)).toThrow(AppError);
    expect(() => maskToNormalized(new Uint8Array(1024 * 650), 1024, 650, bounds, 2048, 1536, "box_relative", true)).toThrow(AppError);
    expect(placeSamRasters([{ objectId: "m", bounds, raster: small, maskWidth: maskW, maskHeight: maskH, confidence: 0.9 }],
      2048, 1536, "box_relative", false)).toMatchObject({ dropped: 1 });
  });
});

describe("SAM request shape and the segment route", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("sends the exact SAM body and builds point prompts with the parser", async () => {
    vi.stubEnv("MODEL_API_KEY", "test-key");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(streamOf(sseBytes(), [33]),
      { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    const out = await segment({ width: 320, height: 334, dataUrl: "data:image/webp;base64,AAAA" }, "wheel", AbortSignal.timeout(5000));
    expect(out.objects).toHaveLength(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.meta.ai/v1/responses");
    const body = JSON.parse(String(init!.body));
    expect(body).toEqual({ model: "sam-3.1", stream: true, store: false,
      metadata: { include_confidence: "true", mask_encoding: "one_bit" },
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "wheel" },
        { type: "input_image", image_url: "data:image/webp;base64,AAAA" }] }] });
    expect((init!.headers as Record<string, string>).Accept).toBe("text/event-stream");
    expect(samPointsText(2048, 1536, [{ x: 100, y: 200, label: "positive" }])).toBe("<0f>1<|point;x=100;y=200;w=2048;h=1536|>");
    expect(samPointsText(2048, 1536, [{ x: 5, y: 6, label: "positive" }, { x: 7, y: 8, label: "negative" }]))
      .toBe("<0f>1<|point;x=5;y=6;w=2048;h=1536|>-<|point;x=7;y=8;w=2048;h=1536|>");
  });

  async function post(payload: unknown, image: Uint8Array, headers: Record<string, string> = {}) {
    const form = new FormData();
    form.append("payload", JSON.stringify(payload));
    form.append("image", new File([new Uint8Array(image)], "base.webp", { type: "image/webp" }));
    const res = await POST(new Request("http://localhost:3000/api/segment", { method: "POST", body: form,
      headers: withSession({ Origin: "http://localhost:3000", "X-Request-Id": crypto.randomUUID(), ...headers }) }));
    return { status: res.status, body: await res.json() };
  }
  const webp = async (w: number, h: number) => new Uint8Array(await sharp({ create: { width: w, height: h,
    channels: 3, background: { r: 80, g: 80, b: 80 } } }).webp().toBuffer());

  it("returns labeled mock masks in MOCK=1 and never calls the network", async () => {
    vi.stubEnv("MOCK", "1");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await post({ mode: "concept", width: 400, height: 300, phrase: "wheel" }, await webp(400, 300));
    expect(res.status).toBe(200);
    const parsed = SegmentResponse.parse(res.body);
    expect(parsed.objects).toHaveLength(2);
    expect(parsed.warnings.join(" ")).toMatch(/Mock/);
    expect(fetchSpy).not.toHaveBeenCalled();
    const empty = SegmentResponse.parse((await post({ mode: "concept", width: 400, height: 300, phrase: "mirror" }, await webp(400, 300))).body);
    expect(empty.objects).toEqual([]);
  });

  it("live: the motorcycle outline goes on to the budget ledger; points stay refused before any call", async () => {
    expect([VERIFIED_SAM_DOWNSCALED, VERIFIED_SAM_POINTS]).toEqual([true, false]);
    for (const [k, v] of Object.entries({ LIVE_API_ENABLED: "true", MODEL_API_KEY: "k", UPSTASH_REDIS_REST_URL: "https://redis.invalid",
      UPSTASH_REDIS_REST_TOKEN: "t", PRICING_VERIFIED_AT: "2026-10-28", VISITOR_HASH_SECRET: "s".repeat(40), BUDGET_TICKET: "T3",
      MOCK: "", VERCEL_ENV: "" })) vi.stubEnv(k, v);
    // The ledger is unreachable here, so the reservation fails closed and nothing reaches Meta.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const img = await webp(400, 300);
    const outline = await post({ mode: "concept", width: 400, height: 300, phrase: "motorcycle" }, img);
    expect(ErrorResponse.parse(outline.body).error.code).not.toBe("FEATURE_DISABLED");
    expect(fetchSpy.mock.calls.map(([url]) => String(url).startsWith("https://redis.invalid"))).toEqual([true]);
    fetchSpy.mockClear();
    const point = await post({ mode: "points", width: 400, height: 300, points: [{ x: 10, y: 10, label: "positive" }] }, img);
    expect(ErrorResponse.parse(point.body).error.code).toBe("FEATURE_DISABLED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("validates before anything else and is LIVE_DISABLED in demo mode, with no network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const img = await webp(400, 300);
    const cases: [Promise<{ status: number; body: unknown }>, number, string][] = [
      [post({ mode: "concept", width: 401, height: 300, phrase: "wheel" }, img), 400, "INVALID_REQUEST"],
      [post({ mode: "points", width: 400, height: 300, points: [{ x: 400, y: 1, label: "positive" }] }, img), 400, "INVALID_REQUEST"],
      [post({ mode: "concept", width: 400, height: 300, phrase: "wheel" }, img, { "X-Request-Id": "nope" }), 400, "INVALID_REQUEST"],
      [post({ mode: "concept", width: 400, height: 300, phrase: "wheel" }, img), 503, "LIVE_DISABLED"],
    ];
    for (const [pending, status, code] of cases) {
      const res = await pending;
      expect([res.status, ErrorResponse.parse(res.body).error.code]).toEqual([status, code]);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("SAM stream failures map to honest error codes", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  const sse = { "Content-Type": "text/event-stream" };
  const codeOf = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) {
    return e instanceof AppError ? `${e.code}${e.retryAfterSeconds !== null ? `:${e.retryAfterSeconds}` : ""}` : String(e); } };
  const run = (signal = AbortSignal.timeout(5000)) => segment({ width: 320, height: 334, dataUrl: "data:image/webp;base64,AAAA" }, "wheel", signal);

  it("eof without a terminal event, wrong content type, error events, 429 Retry-After, refusal", async () => {
    vi.stubEnv("MODEL_API_KEY", "test-key");
    const lines = (events: object[]) => new TextEncoder().encode(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(streamOf(lines([{ type: "response.output_text.delta", ...lane, delta: DOC.slice(0, 40) }]), []), { status: 200, headers: sse }));
    expect(await codeOf(run())).toBe("UPSTREAM_UNAVAILABLE");
    fetchSpy.mockResolvedValueOnce(new Response("{\"ok\":true}", { status: 200, headers: { "Content-Type": "application/json" } }));
    expect(await codeOf(run())).toBe("UPSTREAM_UNAVAILABLE");
    fetchSpy.mockResolvedValueOnce(new Response(streamOf(lines([{ type: "error", message: "boom" }]), []), { status: 200, headers: sse }));
    expect(await codeOf(run())).toBe("UPSTREAM_UNAVAILABLE");
    fetchSpy.mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "Retry-After": "3" } }));
    expect(await codeOf(run())).toBe("RATE_LIMITED:3");
    fetchSpy.mockResolvedValueOnce(new Response(streamOf(lines([{ type: "response.refusal.delta", ...lane, delta: "no" },
      { type: "response.refusal.done", ...lane, refusal: "no" }, { type: "response.completed" }]), []), { status: 200, headers: sse }));
    expect(await codeOf(run())).toBe("UPSTREAM_REJECTED");
    fetchSpy.mockResolvedValueOnce(new Response("bad", { status: 400 }));
    expect(await codeOf(run())).toBe("UPSTREAM_REJECTED");
  });

  it("a stall in the middle of the body is a timeout, not bad data", async () => {
    vi.stubEnv("MODEL_API_KEY", "test-key");
    const controller = new AbortController();
    // Like a real fetch body: it never ends on its own, and errors when the signal aborts.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      const stalled = new ReadableStream<Uint8Array>({ start(c) {
        c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: "response.created" })}\n\n`));
        init?.signal?.addEventListener("abort", () => c.error(init.signal!.reason));
      } });
      return new Response(stalled, { status: 200, headers: sse });
    });
    const pending = run(controller.signal);
    setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), 20);
    expect(await codeOf(pending)).toBe("UPSTREAM_TIMEOUT");
  });
});

describe("SSE line endings and multi-line data", () => {
  it("handles CRLF, bare CR, and data split over lines", async () => {
    const text = "data: {\"a\":\r\ndata: 1}\r\n\r\n" + "data: {\"b\":2}\r\r" + "event: x\ndata: [DONE]\n\n";
    const bytes = new TextEncoder().encode(text);
    for (const cuts of [[], [5], [16, 17, 18], Array.from({ length: bytes.length - 1 }, (_, i) => i + 1)]) {
      const out = [];
      for await (const e of sseEvents(streamOf(bytes, cuts))) out.push(e);
      expect(out).toEqual([{ a: 1 }, { b: 2 }]);
    }
  });
});

describe("more part rules", () => {
  const W = 9, H = 9;
  const square = (l: number, t: number, r: number, b: number) => {
    const pixels = new Uint8Array(W * H);
    for (let y = t; y < b; y++) for (let x = l; x < r; x++) pixels[y * W + x] = 1;
    return { width: W, height: H, pixels };
  };
  it("unions plural objects and draws an outline ring of the requested thickness", () => {
    expect(maskArea(unionMasks([square(0, 0, 2, 2), square(1, 1, 3, 3)])!)).toBe(7);
    expect(unionMasks([])).toBeNull();
    const m = square(2, 2, 7, 7);
    const sum = (a: Uint8Array) => a.reduce((s, v) => s + v, 0);
    expect(sum(outlinePixels(m, [2, 2, 7, 7], 1))).toBe(16); // 5x5 minus inner 3x3
    expect(sum(outlinePixels(m, [2, 2, 7, 7], 2))).toBe(24); // 5x5 minus center
    const edgeTouch = square(0, 0, 3, 3);
    expect(sum(outlinePixels(edgeTouch, [0, 0, 3, 3], 1))).toBe(8); // image border counts as outside
  });
  it("treats two same-side wheel candidates as duplicates", () => {
    expect(assignFrontRear([[12, 25, 30, 45], [14, 26, 32, 44]], "right", [10, 10, 90, 45]).kind).toBe("needs_point");
  });
});
