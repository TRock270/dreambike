// Regression test for the input boundary (SEC1/SEC3). Five classes: (a) route fuzzing on every /api
// route and proxy.ts, (b) schema bounds in contracts.ts, (c) IndexedDB and folder-import refusal,
// (d) hostile model answers, (e) hostile image bytes. Every case asserts a refusal (status, error
// code, no decode, no write, no fetch). Fully offline: globalThis.fetch throws, MOCK=1, no Redis.
// Cases that other test files already own (SAM limits, version tree, folder WebP signature, ...) are
// not repeated here. search-parts and instruction are only tested up to the policy code (transport,
// Origin, session, body, schema).
import "fake-indexeddb/auto";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as budgetRoute from "@/app/api/budget/route";
import * as checkRoute from "@/app/api/check/route";
import * as compositeRoute from "@/app/api/composite/route";
import * as editRoute from "@/app/api/edit/route";
import * as healthRoute from "@/app/api/health/route";
import * as identifyRoute from "@/app/api/identify/route";
import * as instructionRoute from "@/app/api/instruction/route";
import * as normalizeRoute from "@/app/api/normalize/route";
import * as productImageRoute from "@/app/api/product-image/route";
import * as searchPartsRoute from "@/app/api/search-parts/route";
import * as segmentRoute from "@/app/api/segment/route";
import { readProjectFolder } from "@/lib/browser/folderExport";
import { sha256Hex } from "@/lib/browser/renderClient";
import * as C from "@/lib/contracts";
import { ErrorResponse } from "@/lib/contracts";
import { closeDreamDb, createProject, deleteProject, getStoredImage, getStoredMask, openDreamDb, snapshotSources,
  type DreamDb } from "@/lib/db";
import { fetchImage, fetchPage } from "@/lib/server/fetch-product";
import { AppError, SESSION_RELOAD_MESSAGE } from "@/lib/errors";
import { exportPlan, newProject, newRootVersion, projectSnapshot } from "@/lib/project";
import { SESSION_COOKIE, issueSession } from "@/lib/server/http";
import { decodeRgb, normalize } from "@/lib/server/images";
import { readSparkResponse, segment } from "@/lib/server/meta";
import { resetQuotaLimitersForTests } from "@/lib/server/paid";
import { sseEvents } from "@/lib/server/sse";
import { proxy } from "@/proxy";
import type { StoredImage } from "@/lib/types";
import { bikeRevision, freshIndexedDb, uuid } from "./support/idb";
import { sessionCookie, withSession } from "./support/session";

// Pass-through spy: a refused image must never reach a full pixel decode.
vi.mock("@/lib/server/images", async (orig) => {
  const real = await orig<typeof import("@/lib/server/images")>();
  return { ...real, decodeRgb: vi.fn(real.decodeRgb) };
});

// The product fetcher uses node:dns and node:https, not globalThis.fetch. Wrap its entry points so a
// refused URL provably never reaches them (the spy would throw if it did).
vi.mock("@/lib/server/fetch-product", async (orig) => {
  const real = await orig<typeof import("@/lib/server/fetch-product")>();
  return {
    ...real,
    fetchImage: vi.fn(async () => { throw new Error("unexpected product fetch"); }),
    fetchPage: vi.fn(async () => { throw new Error("unexpected product fetch"); }),
  };
});

const ORIGIN = "http://localhost:3000";
const W = 320, H = 240;
const HASH = "b".repeat(64);
const bike = { make: "BMW", model: "R nineT", family: "other", engine: null, yearFrom: 2014, yearTo: 2016,
  abs: "yes", style: null, facing: "left", confidence: 0.9, limitations: [] };
const item = () => ({
  id: crypto.randomUUID(), slot: "handlebar", title: "Taller bar", spec: [{ key: "rise", value: "+3 cm" }], intent: "geometry",
  product: null, costKind: "part", partPriceCents: null, taxBasis: "gross", laborMinutes: null,
  fit: null, fitInputHash: null, fitCheckedAt: null, originVersionId: crypto.randomUUID(),
  zeroLaborConfirmed: false, mechanicNotes: "", fitReviewedHash: null,
});

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("MOCK", "1");
  resetQuotaLimitersForTests(); // the per-instance image-work limiter would otherwise answer 429
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    throw new Error(`unexpected network call to ${String(url)}`);
  });
  vi.mocked(decodeRgb).mockClear();
  vi.mocked(fetchImage).mockClear();
  vi.mocked(fetchPage).mockClear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

// ---------------------------------------------------------------- fixtures

const solid = (w: number, h: number, bg = { r: 90, g: 90, b: 90 }) => sharp({ create: { width: w, height: h, channels: 3,
  background: bg } });
const webpOf = async (w: number, h: number) => new Uint8Array(await solid(w, h).webp({ quality: 80 }).toBuffer());
const pngOf = async (w: number, h: number) => new Uint8Array(await solid(w, h).png().toBuffer());
const jpegOf = async (w: number, h: number) => new Uint8Array(await solid(w, h).jpeg().toBuffer());
const svgOf = (w: number, h: number) => new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"/>`);
const file = (bytes: Uint8Array, name: string, type: string) => new File([new Uint8Array(bytes)], name, { type });

type Parts = Record<string, string | File | (string | File)[]>;
function formOf(parts: Parts): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(parts)) for (const one of Array.isArray(v) ? v : [v]) form.append(k, one);
  return form;
}
/** Copy of a form with one part removed (and optionally replaced). */
function without(form: FormData, name: string, replacement?: string | File | (string | File)[]): FormData {
  const f = new FormData();
  for (const [k, v] of form.entries()) if (k !== name) f.append(k, v);
  for (const one of replacement === undefined ? [] : Array.isArray(replacement) ? replacement : [replacement]) f.append(name, one);
  return f;
}

const validPayloads = {
  segment: { mode: "concept", width: W, height: H, phrase: "wheel" },
  identify: { width: W, height: H },
  instruction: { slot: "handlebar", box: [10, 10, 100, 100], bike, mode: "text", text: "taller bar", width: W, height: H },
  edit: { slot: "handlebar", prompt: "Make the bar taller.", mode: "text", intent: "geometry", quality: "low", width: W, height: H },
  composite: { width: W, height: H, bikeBox: [10, 10, 300, 200], intent: "paint", generatedWidth: W, generatedHeight: H },
  check: { bike, bikeConfirmed: true, inputHash: HASH, items: [item()], activeBuild: [], shopRules: [] },
  search: { mode: "url", bike, slot: "exhaust", url: "https://example.com/p/1", preferredDomains: [] },
  productImage: { url: "https://example.com/a.jpg", rightsConfirmed: true },
};

type RouteCase = {
  name: string; handler: (req: Request) => Promise<Response>; meta: boolean; limit: number;
  kind: "json" | "multipart";
  /** Runs the policy code after validation, so only refusals are asserted (see header). */
  refusalsOnly?: boolean;
  valid: () => Promise<FormData | object>;
};

const ROUTES: RouteCase[] = [
  { name: "normalize", handler: normalizeRoute.POST, meta: false, kind: "multipart", limit: 1_250_000 + 50_000,
    valid: async () => formOf({ photo: file(await jpegOf(W, H), "p.jpg", "image/jpeg") }) },
  { name: "segment", handler: segmentRoute.POST, meta: true, kind: "multipart", limit: 1_300_000,
    valid: async () => formOf({ payload: JSON.stringify(validPayloads.segment), image: file(await webpOf(W, H), "i.webp",
      "image/webp") }) },
  { name: "identify", handler: identifyRoute.POST, meta: true, kind: "multipart", limit: 1_300_000,
    valid: async () => formOf({ payload: JSON.stringify(validPayloads.identify), image: file(await webpOf(W, H), "i.webp",
      "image/webp") }) },
  { name: "instruction", handler: instructionRoute.POST, meta: true, kind: "multipart", limit: 1_300_000, refusalsOnly: true,
    valid: async () => formOf({ payload: JSON.stringify(validPayloads.instruction) }) },
  { name: "edit", handler: editRoute.POST, meta: true, kind: "multipart", limit: 2 * 1_250_000 + 50_000,
    valid: async () => formOf({ payload: JSON.stringify(validPayloads.edit), base: file(await webpOf(W, H), "b.webp", "image/webp") }) },
  { name: "composite", handler: compositeRoute.POST, meta: false, kind: "multipart", limit: 2 * 1_250_000 + 2 * 500_000 + 50_000,
    valid: async () => formOf({ payload: JSON.stringify(validPayloads.composite),
      base: file(await webpOf(W, H), "b.webp", "image/webp"), edited: file(await webpOf(W, H), "e.webp", "image/webp") }) },
  { name: "check", handler: checkRoute.POST, meta: true, kind: "json", limit: 100_000, valid: async () => validPayloads.check },
  { name: "search-parts", handler: searchPartsRoute.POST, meta: true, kind: "json", limit: 20_000, refusalsOnly: true,
    valid: async () => validPayloads.search },
  { name: "product-image", handler: productImageRoute.POST, meta: true, kind: "json", limit: 8_000,
    valid: async () => validPayloads.productImage },
];
const route = (name: string) => ROUTES.find((r) => r.name === name)!;
const MULTIPART = ROUTES.filter((r) => r.kind === "multipart");
const JSON_ROUTES = ROUTES.filter((r) => r.kind === "json");
const PAYLOAD_ROUTES = MULTIPART.filter((r) => r.name !== "normalize");
const eachRoute = (rs: RouteCase[]) => rs.map((r) => [r.name, r] as const);

const baseHeaders = (r: RouteCase, extra: Record<string, string> = {}) =>
  withSession({ Origin: ORIGIN, ...(r.meta ? { "X-Request-Id": crypto.randomUUID() } : {}), ...extra });

async function send(r: RouteCase, body: BodyInit | object | null, extra: Record<string, string> = {},
  headers?: Record<string, string>): Promise<Response> {
  const init: RequestInit & { duplex?: string } = { method: "POST", headers: headers ?? baseHeaders(r, extra) };
  if (body !== null) {
    init.body = body instanceof FormData || typeof body === "string" || body instanceof Uint8Array
      || body instanceof ReadableStream ? body as BodyInit : JSON.stringify(body);
    if (body instanceof ReadableStream) init.duplex = "half";
  }
  return r.handler(new Request(`${ORIGIN}/api/${r.name}`, init));
}

/** Status and code; also asserts the safe envelope (no stack, no-store, parses as ErrorResponse). */
async function errorOf(res: Response): Promise<[number, string]> {
  expect(res.headers.get("cache-control")).toBe("no-store");
  const text = await res.text();
  expect(text).not.toMatch(/\bat .*\.ts:\d+|node_modules|stack/i);
  const parsed = ErrorResponse.safeParse(JSON.parse(text));
  if (!parsed.success) return [res.status, `NOT_AN_ERROR_RESPONSE ${text.slice(0, 200)}`];
  return [res.status, parsed.data.error.code];
}

async function encodeForm(form: FormData): Promise<{ bytes: Uint8Array; type: string }> {
  const res = new Response(form);
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get("content-type")! };
}
async function validBodyOf(r: RouteCase): Promise<{ bytes: Uint8Array; type: string }> {
  const v = await r.valid();
  if (v instanceof FormData) return encodeForm(v);
  return { bytes: new TextEncoder().encode(JSON.stringify(v)), type: "application/json" };
}
function streamOf(total: number, chunk = 64 * 1024): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(c) {
      if (sent >= total) { c.close(); return; }
      const n = Math.min(chunk, total - sent);
      sent += n;
      c.enqueue(new Uint8Array(n).fill(0x20));
    },
  });
}
const contentTypeOf = (r: RouteCase) => (r.kind === "json" ? "application/json" : "multipart/form-data; boundary=x");

// ================================================================ (a) route fuzzing

describe("(a) baseline: valid requests are accepted offline in mock mode", () => {
  it.each(eachRoute(ROUTES.filter((r) => !r.refusalsOnly)))("%s returns 200", async (_n, r) => {
    const res = await send(r, await r.valid());
    expect(res.status, await res.clone().text().then((t) => t.slice(0, 300))).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("(a) origin and session on every POST", () => {
  it.each(eachRoute(ROUTES))("%s: missing, wrong, 'null', trailing-slash and look-alike Origins give 403", async (_n, r) => {
    const noOrigin = baseHeaders(r); delete (noOrigin as Record<string, string>).Origin;
    expect(await errorOf(await send(r, await r.valid(), {}, noOrigin))).toEqual([403, "FORBIDDEN"]);
    for (const origin of ["https://evil.example", "null", `${ORIGIN}/`, "http://localhost.evil.example:3000"]) {
      expect(await errorOf(await send(r, await r.valid(), { Origin: origin })), origin).toEqual([403, "FORBIDDEN"]);
    }
  });

  it.each(eachRoute(ROUTES))("%s: missing, forged, duplicated, expired and huge cookies give 403 with the reload text", async (_n, r) => {
    const issued = issueSession(process.env)!;
    const [, id, at] = issued.value.split(".");
    const cases: Record<string, string | null> = {
      missing: null,
      forged: `${SESSION_COOKIE}=v1.${id}.${at}.${"A".repeat(43)}`,
      duplicated: `${SESSION_COOKIE}=${issued.value}; ${SESSION_COOKIE}=${issued.value}`,
      expired: sessionCookie(Date.now() - 49 * 3600_000),
      huge: `${SESSION_COOKIE}=${"v1.".repeat(20_000)}`,
    };
    for (const [label, cookie] of Object.entries(cases)) {
      const headers: Record<string, string> = { Origin: ORIGIN, ...(r.meta ? { "X-Request-Id": crypto.randomUUID() } : {}) };
      if (cookie) headers.Cookie = cookie;
      const res = await send(r, await r.valid(), {}, headers);
      const body = await res.clone().json() as { error?: { message?: string } };
      expect(await errorOf(res), label).toEqual([403, "FORBIDDEN"]);
      expect(body.error?.message, label).toBe(SESSION_RELOAD_MESSAGE);
    }
  });

  it("deployed without VISITOR_HASH_SECRET: every POST is refused even with a dev-signed cookie", async () => {
    const cookie = sessionCookie();
    vi.stubEnv("MOCK", "0");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("APP_ORIGIN", ORIGIN);
    vi.stubEnv("VISITOR_HASH_SECRET", "");
    for (const r of ROUTES) {
      const res = await send(r, await r.valid(), {}, { Origin: ORIGIN, Cookie: cookie, "X-Request-Id": crypto.randomUUID() });
      expect(await errorOf(res), r.name).toEqual([403, "FORBIDDEN"]);
    }
  });
});

describe("(a) X-Request-Id on Meta handlers", () => {
  const meta = ROUTES.filter((r) => r.meta);
  it.each(eachRoute(meta))("%s: missing, non-UUID, padded and markup ids give 400 and are never echoed", async (_n, r) => {
    expect(await errorOf(await send(r, await r.valid(), {}, withSession({ Origin: ORIGIN })))).toEqual([400, "INVALID_REQUEST"]);
    for (const id of ["", "not-a-uuid", "<script>alert(1)</script>", `${crypto.randomUUID()}x`]) {
      const res = await send(r, await r.valid(), {}, withSession({ Origin: ORIGIN, "X-Request-Id": id })); // a handler throw fails the test
      const body = await res.clone().json() as { error: { requestId: string } };
      expect(await errorOf(res), JSON.stringify(id)).toEqual([400, "INVALID_REQUEST"]);
      expect(body.error.requestId).not.toBe(id);
    }
  });
});

describe("(a) body limits", () => {
  it.each(eachRoute(ROUTES))("%s: a declared Content-Length over the limit gives 413", async (_n, r) => {
    const { bytes, type } = await validBodyOf(r);
    let req: Request;
    try {
      req = new Request(`${ORIGIN}/api/${r.name}`, { method: "POST", body: bytes as BodyInit,
        headers: { ...baseHeaders(r), "Content-Type": type, "Content-Length": String(r.limit + 1) } });
    } catch { return; } // the runtime refuses a mismatched Content-Length itself
    expect(await errorOf(await r.handler(req))).toEqual([413, "TOO_LARGE"]);
  });

  // The byte count, not the header, is the rule: a body without Content-Length is still capped.
  it.each(eachRoute(ROUTES))("%s: an oversized streamed body without Content-Length gives 413", async (_n, r) => {
    const res = await send(r, streamOf(r.limit + 10), { "Content-Type": contentTypeOf(r) });
    expect(await errorOf(res)).toEqual([413, "TOO_LARGE"]);
  });

  it.each(eachRoute(ROUTES))("%s: an empty body is 400, never a crash", async (_n, r) => {
    expect(await errorOf(await send(r, null))).toEqual([400, "INVALID_REQUEST"]);
  });
});

describe("(a) JSON routes (check, search-parts, product-image)", () => {
  const cases: [string, string | Uint8Array][] = [
    ["not JSON", "not json"], ["truncated", "{\"url\":"], ["NaN literal", "{\"x\": NaN}"], ["Infinity literal", "{\"x\": Infinity}"],
    ["top-level null", "null"], ["top-level array", "[]"], ["top-level number", "42"], ["top-level string", "\"x\""],
    ["invalid UTF-8", new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x3a, 0x31, 0x7d])],
    ["UTF-16LE", new Uint8Array([0xff, 0xfe, 0x7b, 0x00, 0x7d, 0x00])],
    ["deep nesting", `${"[".repeat(3_000)}${"]".repeat(3_000)}`],
    ["deep object nesting", `${"{\"a\":".repeat(1_000)}1${"}".repeat(1_000)}`],
  ];
  for (const r of JSON_ROUTES) {
    it.each(cases)(`${r.name}: %s gives 400`, async (_label, raw) => {
      expect(await errorOf(await send(r, raw))).toEqual([400, "INVALID_REQUEST"]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  it.each(eachRoute(JSON_ROUTES))("%s: a multipart body gives 400", async (_n, r) => {
    expect(await errorOf(await send(r, formOf({ payload: JSON.stringify(await r.valid()) })))).toEqual([400, "INVALID_REQUEST"]);
  });

  // Strict objects: prototype-pollution style keys are unknown keys like any other.
  it.each(eachRoute(JSON_ROUTES))("%s: unknown top-level keys, including __proto__ and constructor, give 400", async (_n, r) => {
    const valid = JSON.stringify(await r.valid());
    for (const extra of ['"extra":1', '"__proto__":{"x":1}', '"constructor":{"prototype":{"y":1}}', '"__proto__":null']) {
      expect(await errorOf(await send(r, `{${extra},${valid.slice(1)}`)), extra).toEqual([400, "INVALID_REQUEST"]);
    }
  });
  it("product-image: rightsConfirmed false, missing or \"true\" and http, data and file URLs give 400 with no fetch", async () => {
    const r = route("product-image");
    for (const body of [
      { url: "https://example.com/a.jpg", rightsConfirmed: false }, { url: "https://example.com/a.jpg" },
      { url: "https://example.com/a.jpg", rightsConfirmed: "true" },
      { url: "http://example.com/a.jpg", rightsConfirmed: true }, { url: "data:image/png;base64,AAAA", rightsConfirmed: true },
      { url: "file:///etc/passwd", rightsConfirmed: true }, { url: 42, rightsConfirmed: true },
    ]) {
      expect(await errorOf(await send(r, body)), JSON.stringify(body)).toEqual([400, "INVALID_REQUEST"]);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("(a) multipart routes", () => {
  it.each(eachRoute(MULTIPART))("%s: a JSON body, a missing or wrong boundary, a truncated body and other types give 400",
    async (_n, r) => {
    expect(await errorOf(await send(r, { payload: {} }, { "Content-Type": "application/json" }))).toEqual([400, "INVALID_REQUEST"]);
    const { bytes, type } = await validBodyOf(r);
    for (const [label, ct, body] of [
      ["no boundary", "multipart/form-data", bytes],
      ["wrong boundary", "multipart/form-data; boundary=nope", bytes],
      ["truncated", type, bytes.slice(0, Math.floor(bytes.length / 2))],
      ["text/plain", "text/plain", bytes],
      ["urlencoded", "application/x-www-form-urlencoded", new TextEncoder().encode("payload=%7B%7D&photo=x")],
    ] as const) {
      expect(await errorOf(await send(r, body, { "Content-Type": ct })), label).toEqual([400, "INVALID_REQUEST"]);
    }
  });

  it.each(eachRoute(MULTIPART))("%s: an unexpected extra part, text or file, gives 400", async (_n, r) => {
    const text = await r.valid() as FormData; text.append("extra", "1");
    expect(await errorOf(await send(r, text))).toEqual([400, "INVALID_REQUEST"]);
    const bin = await r.valid() as FormData; bin.append("extra", file(new Uint8Array([1]), "x.bin", "application/octet-stream"));
    expect(await errorOf(await send(r, bin))).toEqual([400, "INVALID_REQUEST"]);
  });

  it.each(eachRoute(PAYLOAD_ROUTES))("%s: bad payload parts (missing, duplicated, file, non-JSON, null, array, extra key) give 400", async (_n, r) => {
    const valid = await r.valid() as FormData;
    const payload = valid.get("payload") as string;
    const variants: [string, FormData][] = [
      ["missing", without(valid, "payload")],
      ["duplicated", without(valid, "payload", [payload, payload])],
      ["file-typed", without(valid, "payload", file(new TextEncoder().encode(payload), "p.json", "application/json"))],
      ["not json", without(valid, "payload", "{bad")],
      ["null", without(valid, "payload", "null")],
      ["array", without(valid, "payload", "[]")],
      ["extra key", without(valid, "payload", JSON.stringify({ ...JSON.parse(payload), extra: 1 }))],
      ["__proto__ key", without(valid, "payload", `{"__proto__":{"x":1},${payload.slice(1)}`)],
      ["upper-case name", (() => { const f = without(valid, "payload"); f.append("Payload", payload); return f; })()],
    ];
    for (const [label, form] of variants) expect(await errorOf(await send(r, form)), label).toEqual([400, "INVALID_REQUEST"]);
  });

});

describe("(a) image parts", () => {
  const IMAGE_PARTS = [["segment", "image"], ["identify", "image"], ["edit", "base"], ["composite", "base"], ["composite",
    "edited"]] as const;
  const eachPart = IMAGE_PARTS.map(([n, p]) => [`${n}.${p}`, route(n), p] as const);

  it.each(eachPart)("%s: missing, duplicated and string-typed image parts give 400", async (_n, r, part) => {
    const valid = await r.valid() as FormData;
    const img = file(await webpOf(W, H), "i.webp", "image/webp");
    expect(await errorOf(await send(r, without(valid, part))), "missing").toEqual([400, "INVALID_REQUEST"]);
    expect(await errorOf(await send(r, without(valid, part, [img, img]))), "dup").toEqual([400, "INVALID_REQUEST"]);
    expect(await errorOf(await send(r, without(valid, part, "UklGRg=="))), "string").toEqual([400, "INVALID_REQUEST"]);
  });

  // MIME and magic bytes must agree: a label alone never gets bytes decoded.
  it.each(eachPart)("%s: image/webp label on PNG, JPEG, SVG, garbage, RIFF/WAVE or empty bytes gives 400 INVALID_IMAGE",
    async (_n, r, part) => {
    const valid = await r.valid() as FormData;
    const riffWave = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [label, bytes] of [["png", await pngOf(W, H)], ["jpeg", await jpegOf(W, H)], ["svg", svgOf(W, H)],
      ["garbage", new Uint8Array(500).fill(7)], ["riff-wave", riffWave], ["empty", new Uint8Array(0)]] as const) {
      const res = await send(r, without(valid, part, file(bytes, "i.webp", "image/webp")));
      expect(await errorOf(res), label).toEqual([400, "INVALID_IMAGE"]);
    }
    expect(errSpy, "an expected input error is not an unexpected server fault").not.toHaveBeenCalled();
    expect(vi.mocked(decodeRgb)).not.toHaveBeenCalled();
  });

  it("segment, identify, edit: a WebP whose real size differs from the declared size gives 400", async () => {
    for (const [name, part] of [["segment", "image"], ["identify", "image"], ["edit", "base"]] as const) {
      const r = route(name);
      const res = await send(r, without(await r.valid() as FormData, part, file(await webpOf(W + 1, H), "i.webp", "image/webp")));
      expect(await errorOf(res), name).toEqual([400, "INVALID_REQUEST"]);
    }
  });

  it("composite: a base whose header size differs from the declared size is refused before any full pixel decode", async () => {
    const r = route("composite");
    const res = await send(r, without(await r.valid() as FormData, "base", file(await webpOf(W + 40, H + 40), "b.webp", "image/webp")));
    expect(await errorOf(res)).toEqual([400, "INVALID_REQUEST"]);
    expect(vi.mocked(decodeRgb)).not.toHaveBeenCalled();
  });

  it("normalize: unsupported declared types give 415, undecodable bytes behind a JPEG label are 4xx, an oversized photo 413", async () => {
    const r = route("normalize");
    const jpeg = await jpegOf(W, H);
    for (const type of ["application/octet-stream", "image/gif", "image/heic", "", "text/html"]) {
      expect(await errorOf(await send(r, formOf({ photo: file(jpeg, "p.jpg", type) }))), type).toEqual([415, "UNSUPPORTED_FORMAT"]);
    }
    for (const [label, bytes] of [["garbage", new Uint8Array(500).fill(7)], ["empty", new Uint8Array(0)], ["svg", svgOf(W, H)]] as const) {
      const [status] = await errorOf(await send(r, formOf({ photo: file(bytes, "p.jpg", "image/jpeg") })));
      expect([400, 415], label).toContain(status);
    }
    const big = new Uint8Array(1_250_001); big.set(jpeg.subarray(0, 8));
    expect(await errorOf(await send(r, formOf({ photo: file(big, "p.jpg", "image/jpeg") })))).toEqual([413, "TOO_LARGE"]);
  });

  it("composite: a garbage mask or a mask of the wrong size gives 400 INVALID_IMAGE, a webp-typed mask 400 INVALID_REQUEST", async () => {
    const r = route("composite");
    const valid = await r.valid() as FormData;
    const goodMask = file(await pngOf(W, H), "m.png", "image/png");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const attempts: [string, FormData, string][] = [
      ["garbage", without(without(valid, "oldMask", file(new Uint8Array(300).fill(9), "m.png", "image/png")), "newMask",
        goodMask), "INVALID_IMAGE"],
      ["svg", without(without(valid, "oldMask", file(svgOf(W, H), "m.png", "image/png")), "newMask", goodMask), "INVALID_IMAGE"],
      ["wrong size", without(without(valid, "oldMask", file(await pngOf(W + 1, H), "m.png", "image/png")), "newMask",
        goodMask), "INVALID_IMAGE"],
      ["webp type", without(valid, "oldMask", file(await pngOf(W, H), "m.png", "image/webp")), "INVALID_REQUEST"],
    ];
    for (const [label, form, code] of attempts) expect(await errorOf(await send(r, form)), label).toEqual([400, code]);
    expect(errSpy).not.toHaveBeenCalled();
  });
});

describe("(a) live config: bad input is refused before any reservation or Meta call", () => {
  const LIVE = { LIVE_API_ENABLED: "true", MODEL_API_KEY: "test-fake", UPSTASH_REDIS_REST_URL: "https://redis.invalid",
    UPSTASH_REDIS_REST_TOKEN: "t", PRICING_VERIFIED_AT: "2026-10-28", VISITOR_HASH_SECRET: "s".repeat(32), BUDGET_TICKET: "T9",
    MOCK: "0", VERCEL_ENV: "", SEARCH_ENABLED: "true", SEARCH_QUERY_RESERVE: "20", PUBLIC_SHOP_DOMAINS: "example.com" };
  beforeEach(() => { for (const [k, v] of Object.entries(LIVE)) vi.stubEnv(k, v); });

  it("segment, identify, edit, check, product-image: unknown key, junk body and PNG-as-WebP give 4xx with zero fetches", async () => {
    for (const r of ROUTES.filter((x) => ["segment", "identify", "edit", "check", "product-image"].includes(x.name))) {
      const valid = await r.valid();
      let bad: FormData | string;
      if (valid instanceof FormData) {
        bad = without(valid, "payload", JSON.stringify({ ...JSON.parse(valid.get("payload") as string), extra: 1 }));
      } else {
        bad = JSON.stringify({ ...valid, extra: 1 });
      }
      expect(await errorOf(await send(r, bad)), `${r.name} extra`).toEqual([400, "INVALID_REQUEST"]);
      expect(await errorOf(await send(r, "{", { "Content-Type": contentTypeOf(r) })), `${r.name} junk`).toEqual([400, "INVALID_REQUEST"]);
    }
    for (const [name, part] of [["segment", "image"], ["identify", "image"], ["edit", "base"]] as const) {
      const r = route(name);
      const res = await send(r, without(await r.valid() as FormData, part, file(await pngOf(W, H), "i.webp", "image/webp")));
      expect(await errorOf(res), `${name} png-as-webp`).toEqual([400, "INVALID_IMAGE"]);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("product-image: non-allowlisted, IP, userinfo, port and look-alike hosts are refused with 403 and no fetch", async () => {
    for (const url of ["https://evil.example/a.jpg", "https://127.0.0.1/a.jpg", "https://user:pw@example.com/a.jpg",
      "https://example.com:8443/a.jpg", "https://example.com.evil.example/a.jpg", "https://[::1]/a.jpg",
        "https://169.254.169.254/latest"]) {
      // Valid HttpsUrl, so the Zod check passes and checkShopUrl is the guard that refuses.
      expect(await errorOf(await send(route("product-image"), { url, rightsConfirmed: true })), url).toEqual([403, "FETCH_BLOCKED"]);
    }
    expect(fetchImage).not.toHaveBeenCalled();
    expect(fetchPage).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("(a) GET /api/budget and /api/health, method exports, proxy", () => {
  const gets = [["budget", budgetRoute.GET], ["health", healthRoute.GET]] as const;
  it.each(gets)("%s: any query parameter (incl. __proto__, empty name, duplicates) gives 400, a bare '?' gives 200", async (name, GET) => {
    for (const q of ["?a=1", "?__proto__=1", "?constructor=x", "?=", "?a", "?a=1&a=2", "?%00=1"]) {
      expect(await errorOf(await GET(new Request(`${ORIGIN}/api/${name}${q}`))), q).toEqual([400, "INVALID_REQUEST"]);
    }
    expect((await GET(new Request(`${ORIGIN}/api/${name}?`))).status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  const VERBS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
  const modules: [string, Record<string, unknown>, string[]][] = [
    ["budget", budgetRoute, ["GET"]], ["health", healthRoute, ["GET"]], ["check", checkRoute, ["POST"]],
    ["composite", compositeRoute, ["POST"]], ["edit", editRoute, ["POST"]], ["identify", identifyRoute, ["POST"]],
    ["instruction", instructionRoute, ["POST"]], ["normalize", normalizeRoute, ["POST"]],
    ["product-image", productImageRoute, ["POST"]], ["search-parts", searchPartsRoute, ["POST"]], ["segment", segmentRoute, ["POST"]],
  ];
  // A new verb export would be an unreviewed entry point (Next answers 405 for every other verb).
  it.each(modules)("%s exports only its documented method on the node runtime", (_n, mod, expected) => {
    expect(Object.keys(mod).filter((k) => VERBS.includes(k)).sort()).toEqual(expected);
    expect(mod.runtime).toBe("nodejs");
  });
});

describe("(a) proxy.ts session cookie", () => {
  it("issues a cookie on GET, keeps a valid one and replaces forged, duplicated and oversized ones", () => {
    const setCookie = (cookie?: string) => proxy(new Request(`${ORIGIN}/`,
      cookie ? { headers: { Cookie: cookie } } : {})).headers.get("set-cookie");
    expect(setCookie()).toMatch(new RegExp(`^${SESSION_COOKIE}=v1\\..*HttpOnly; SameSite=Lax`));
    const good = sessionCookie();
    expect(setCookie(good)).toBeNull();
    for (const cookie of [`${SESSION_COOKIE}=forged`, `${good}; ${good}`, `${SESSION_COOKIE}=${"y".repeat(100_000)}`]) {
      expect(setCookie(cookie), cookie.slice(0, 40)).toMatch(new RegExp(`^${SESSION_COOKIE}=v1\\.`));
    }
  });
});

// ================================================================ (b) schema bounds

type Leak = { schema: string; path: string; problem: string };
/** Walk a JSON Schema and list unbounded strings/arrays/numbers and objects that allow unknown keys. */
function walk(node: unknown, path: string, out: Omit<Leak, "schema">[]): void {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  const types = Array.isArray(n.type) ? n.type : n.type ? [n.type] : [];
  const fixed = "const" in n || "enum" in n;
  if (types.includes("string") && !fixed && n.maxLength === undefined) {
    const pattern = String(n.pattern ?? "");
    const bounded = n.format === "uuid" || /^\^\[a-f0-9\]\{64\}\$$/.test(pattern) || /^\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$$/.test(pattern);
    if (!bounded) out.push({ path, problem: `string without maxLength${n.format ? ` (format ${String(n.format)})` : ""}` });
  }
  if (types.includes("array") && n.maxItems === undefined && !Array.isArray(n.prefixItems)) out.push({ path,
    problem: "array without maxItems" });
  if ((types.includes("number") || types.includes("integer")) && !fixed && n.maximum === undefined && n.exclusiveMaximum === undefined) {
    out.push({ path, problem: "number without maximum" });
  }
  if (types.includes("object") && n.properties && n.additionalProperties !== false) out.push({ path,
    problem: "object allows unknown keys" });
  if (n.properties && typeof n.properties === "object") for (const [k, v] of Object.entries(n.properties)) walk(v, `${path}.${k}`, out);
  if (n.items) walk(n.items, `${path}[]`, out);
  if (Array.isArray(n.prefixItems)) n.prefixItems.forEach((v, i) => walk(v, `${path}[${i}]`, out));
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(n[key])) (n[key] as unknown[]).forEach((v, i) => walk(v, `${path}<${key}${i}>`, out));
  }
  if (n.additionalProperties && typeof n.additionalProperties === "object") walk(n.additionalProperties, `${path}{*}`, out);
}
const isSchema = (v: unknown): v is z.ZodType =>
  !!v && typeof v === "object" && "_zod" in (v as object) && typeof (v as z.ZodType).safeParse === "function";
const exported = Object.entries(C).filter(([, v]) => isSchema(v)) as [string, z.ZodType][];
function leaks(): Leak[] {
  const all: Leak[] = [];
  for (const [name, schema] of exported) {
    const out: Omit<Leak, "schema">[] = [];
    try {
      walk(z.toJSONSchema(schema, { unrepresentable: "any", io: "input" }), name, out);
    } catch (e) {
      all.push({ schema: name, path: "", problem: `toJSONSchema failed: ${(e as Error).message}` });
    }
    for (const o of out) all.push({ schema: name, ...o });
  }
  return all;
}
// Reviewed and accepted: local epoch-ms metadata and counters, server-built response numbers, point
// coordinates (refined against width/height), boxes (positional), ISO dates and
// URLs (byte caps on every inbound path), and SegmentObject.objectId (server-built index string).
const ACCEPTED_NUMBER = [/\.(createdAt|updatedAt|lastAccessedAt|expiresAt|confirmedAt|revision|area|bytes)$/,
  /\.(generatedWidth|generatedHeight)$/,
  /\.(spentTodayMicroUsd|reservedTodayMicroUsd|dailyCapMicroUsd|visitorRemainingMicroUsd|remainingEdits|retryAfterSeconds)$/,
  /\.box\[[0-3]\]$|\.bikeBox\[[0-3]\]$/, /\.(x|y)$/];

describe("(b) schema bounds in contracts.ts", () => {
  it("every exported schema converts to JSON Schema, so the walk skips none", () => {
    expect(exported.length).toBeGreaterThan(60);
    expect(leaks().filter((l) => l.problem.startsWith("toJSONSchema failed"))).toEqual([]);
  });
  it("every object is strict, every array and free string is bounded, every other number has a maximum", () => {
    const all = leaks();
    expect(all.filter((l) => l.problem === "object allows unknown keys")).toEqual([]);
    expect(all.filter((l) => l.problem === "array without maxItems")).toEqual([]);
    const freeStrings = all.filter((l) => l.problem.startsWith("string without maxLength"));
    expect(freeStrings.filter((l) => !/format (date-time|uri)/.test(l.problem) && !/\.objectId$/.test(l.path))).toEqual([]);
    expect(all.filter((l) => l.problem === "number without maximum" && !ACCEPTED_NUMBER.some((r) => r.test(l.path)))).toEqual([]);
  });
});

// ================================================================ (c) IndexedDB and folder import

type Content = Blob | string;
// Minimal in-memory folder handle: just what saveProjectToFolder and readProjectFolder call.
class FakeDir {
  files = new Map<string, Content>();
  dirs = new Map<string, FakeDir>();
  async *entries() {
    for (const name of [...this.files.keys()]) yield [name, { kind: "file" as const }] as const;
    for (const [name] of [...this.dirs]) yield [name, { kind: "directory" as const }] as const;
  }
  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) throw new DOMException("missing", "NotFoundError");
      d = new FakeDir();
      this.dirs.set(name, d);
    }
    return d as unknown as FileSystemDirectoryHandle;
  }
  async removeEntry(name: string) {
    if (this.dirs.delete(name)) return;
    if (!this.files.delete(name)) throw new DOMException("missing", "NotFoundError");
  }
  async getFileHandle(name: string, opts?: { create?: boolean }) {
    if (!this.files.has(name) && !opts?.create) throw new DOMException("missing", "NotFoundError");
    const files = this.files;
    return {
      getFile: async () => new File([files.get(name)!], name, { type: name.endsWith(".webp") ? "image/webp" : "" }),
      createWritable: async () => {
        let staged: Content | null = null;
        return { write: async (data: Content) => { staged = data; }, close: async () => { files.set(name, staged ?? ""); },
          abort: async () => {} };
      },
    } as unknown as FileSystemFileHandle;
  }
}
const asHandle = (d: FakeDir) => d as unknown as FileSystemDirectoryHandle;

describe("(c) IndexedDB records and folder import refuse damaged data", () => {
  let db: DreamDb;
  beforeEach(async () => { freshIndexedDb(); db = await openDreamDb(); });
  afterEach(() => { closeDreamDb(db); });

  const IW = 8, IH = 4;
  /** A tiny real WebP, so the folder reader's signature check passes for honest files. */
  async function storedImage(shade: number): Promise<StoredImage> {
    const bytes = new Uint8Array(await sharp({ create: { width: IW, height: IH, channels: 3, background: { r: shade, g: 10,
      b: 20 } } }).webp().toBuffer());
    const blob = new Blob([bytes], { type: "image/webp" });
    return { id: uuid(), hash: await sha256Hex(blob), width: IW, height: IH, bytes: blob.size, rights: "owner", blob, lastAccessedAt: 1 };
  }
  const refOf = (i: StoredImage) => ({ id: i.id, hash: i.hash, width: i.width, height: i.height, bytes: i.bytes,
    rights: "owner" as const });
  const dims = async () => ({ width: IW, height: IH });
  const counts = async () => ({
    projects: await db.db.count("projects"), versions: await db.db.count("versions"),
    images: await db.db.count("images"), masks: await db.db.count("masks"),
  });
  const EMPTY = { projects: 0, versions: 0, images: 0, masks: 0 };

  async function buildProject() {
    const image = await storedImage(50);
    const projectId = uuid();
    const root = newRootVersion({ id: uuid(), projectId, createdAt: 5, image: refOf(image) });
    const project = newProject({ id: projectId, rootVersionId: root.id, bikeRevision, now: new Date(2026, 9, 28, 9, 5) });
    await createProject(db, { project, rootVersion: root, image });
    return { projectId, root, image };
  }
  /** Save to a fake folder, then delete the project so the import has to recreate everything. */
  async function savedFolder() {
    const built = await buildProject();
    const src = (await snapshotSources(db, built.projectId))!;
    const plan = exportPlan({ project: src.project, versions: src.versions, headId: src.project.headVersionId, exportedAt: "t" });
    const snapshot = projectSnapshot({ ...src, plan });
    const root = new FakeDir();
    const { saveProjectToFolder } = await import("@/lib/browser/folderExport");
    await saveProjectToFolder(asHandle(root), plan, async (id) => (await getStoredImage(db, id))?.blob ?? null, undefined,
      { snapshot, readMask: async (id) => (await getStoredMask(db, id))?.pixels ?? null });
    await deleteProject(db, built.projectId);
    return { ...built, dir: root.dirs.get(plan.folderName)! };
  }
  const jsonOf = (d: FakeDir) => JSON.parse(d.files.get("project.json") as string);
  const putJson = (d: FakeDir, v: unknown) => d.files.set("project.json", JSON.stringify(v));
  const reset = async () => { freshIndexedDb(); closeDreamDb(db); db = await openDreamDb(); };

  it("a file name with path parts is refused as bad_schema and nothing is written", async () => {
    for (const bad of ["../x.webp", "/etc/x.webp", "a\\b.webp", "..", ".", "x .webp"]) {
      const { dir } = await savedFolder();
      const j = jsonOf(dir);
      j.images[0].file = bad;
      putJson(dir, j);
      expect(await readProjectFolder(asHandle(dir), { db, readDimensions: dims }),
        JSON.stringify(bad)).toMatchObject({ ok: false, reason: "bad_schema" });
      expect(await counts()).toEqual(EMPTY);
      await reset();
    }
  });

  it("damaged project.json fields (rights, hash case, sizes, unknown keys, settings id, dates) are refused with zero writes", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON edited in place
    const mutations: Array<(j: Record<string, any>) => void> = [
      (j) => {
        j.images[0].rights = "external_runtime";
        for (const v of j.versions) if (v.image.id === j.images[0].id) v.image.rights = "external_runtime";
      },
      (j) => { j.images[0].hash = String(j.images[0].hash).toUpperCase(); },
      (j) => { j.images[0].bytes = -1; },
      (j) => { j.images[0].bytes = "10"; },
      (j) => { j.project.extra = "x"; },
      (j) => { j.project.settingsId = "../default"; },
      (j) => { j.versions[0].createdAt = -1; },
      (j) => { j.versions[0].createdAt = Number.MAX_SAFE_INTEGER; }, // a Date built from it would throw on export
    ];
    for (const [n, mutate] of mutations.entries()) {
      const { dir } = await savedFolder();
      const j = jsonOf(dir);
      mutate(j);
      putJson(dir, j);
      expect((await readProjectFolder(asHandle(dir), { db, readDimensions: dims })).ok, `mutation ${n}`).toBe(false);
      expect(await counts()).toEqual(EMPTY);
      await reset();
    }
  });

});

// ================================================================ (d) hostile model answers

describe("(d) hostile Spark, SSE and SAM answers", () => {
  const msg = (text: unknown, extra: object = {}) => ({ status: "completed", output: [{ type: "message",
    content: [{ type: "output_text", text, ...extra }] }] });
  async function codeOf(work: Promise<unknown> | (() => unknown)): Promise<string> {
    try { await (typeof work === "function" ? work() : work); return "OK"; } catch (e) {
      return e instanceof AppError ? e.code : `NON_APP_ERROR:${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`;
    }
  }

  // Wrong shapes must surface as an AppError (a refusal code), never as a TypeError (a 500).
  it.each([
    ["null", null], ["array", []], ["string", "x"], ["number", 5], ["no output", { status: "completed" }],
    ["output object", { status: "completed", output: {} }], ["null item", { status: "completed", output: [null] }],
    ["string content", { status: "completed", output: [{ type: "message", content: "x" }] }],
    ["null blocks", { status: "completed", output: [{ type: "message", content: [null, 5] }] }],
    ["numeric text", msg(42)], ["not json", msg("Sure! Here is the JSON:")], ["empty text", msg("")],
    ["in progress", { ...msg("{}"), status: "in_progress" }], ["failed", { status: "failed", output: [] }],
    ["refusal", { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }],
    ["annotations junk", msg("{}", { annotations: [null, 1, { type: "url_citation", url: 5 }, { type: "url_citation",
      url: "https://x.example", title: {} }] })],
  ])("readSparkResponse(%s) throws only an AppError or returns JSON for schema checking", async (_label, body) => {
    expect(await codeOf(() => readSparkResponse(body))).not.toMatch(/^NON_APP_ERROR/);
  });

  const sse = { "Content-Type": "text/event-stream" };
  const lane = { item_id: "m1", output_index: 0, content_index: 0 };
  const frames = (events: object[]) => new TextEncoder().encode(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""));
  const oneChunk = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
  const runSegment = () => segment({ width: 320, height: 334, dataUrl: "data:image/webp;base64,AAAA" }, "wheel",
    AbortSignal.timeout(20_000));

  it("sseEvents stops an endless stream at its byte bound and cancels the upstream body", async () => {
    let pulled = 0, cancelled = false;
    const chunk = new TextEncoder().encode("data: " + "x".repeat(9_994));
    const body = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(chunk); }, cancel() { cancelled = true; } });
    let error: unknown = null;
    try { for await (const event of sseEvents(body, 100_000)) void event; } catch (e) { error = e; }
    expect(error).toBeInstanceOf(Error);
    expect(pulled).toBeLessThanOrEqual(12);
    expect(cancelled).toBe(true);
  });

  it("segment(): hostile mask records end as a refusal code or an empty result, never a raw error", async () => {
    vi.stubEnv("MODEL_API_KEY", "test-key");
    const docs = [
      "<0f>0<|box;x1=-5;y1=0;x2=999999;y2=10;w=320;h=334;c=0.9|><|mask;x=0;y=0;data=1,1,~!!!!!|>\n", // box outside the frame
      "<0f>0<|mask;x=0;y=0;data=999999999,999999999,AAAA|>\n", // raster size far past any frame
      "<0f>0<|mask;x=0;y=0;data=-1,3,AAAA|>\n",
      "<0f>0<|mask;x=NaN;y=0;data=2,2,AAAA|>\n",
    ];
    for (const doc of docs) {
      const answer = frames([{ type: "response.created" },
        { type: "response.output_text.delta", ...lane, delta: doc },
        { type: "response.content_part.done", ...lane, part: { type: "output_text", text: doc } },
        { type: "response.completed" }]);
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response(oneChunk(answer), { status: 200, headers: sse }));
      const out = await runSegment().then((r) => `OK:${r.objects.length}`,
        (e) => (e instanceof AppError ? e.code : `NON_APP_ERROR:${String(e)}`));
      expect(out, doc.slice(0, 40)).not.toMatch(/^NON_APP_ERROR/);
    }
  });
});

// ================================================================ (e) hostile image bytes

describe("(e) hostile image bytes", () => {
  async function codeOf(work: Promise<unknown>): Promise<string> {
    try { await work; return "OK"; } catch (e) { return e instanceof AppError ? e.code : `NON_APP_ERROR:${String(e)}`; }
  }

  // The header size is read before sharp decodes: a tiny PNG that claims a huge frame is TOO_LARGE.
  it("normalize: a PNG header claiming 60000x60000 is TOO_LARGE with no pixel decode", async () => {
    const png = await pngOf(64, 64);
    const view = new DataView(png.buffer, png.byteOffset);
    view.setUint32(16, 60_000); view.setUint32(20, 60_000);
    expect(await codeOf(normalize(png))).toBe("TOO_LARGE");
  });

  it("normalize: SVG, GIF, TIFF, HTML and a PNG-signature SVG polyglot are refused; HEIC gets the exact export message", async () => {
    const gif = new Uint8Array(await solid(32, 32).gif().toBuffer());
    const tiff = new Uint8Array(await solid(32, 32).tiff().toBuffer());
    const polyglot = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...svgOf(300, 300)]);
    for (const bytes of [svgOf(9_000, 9_000), gif, tiff, new TextEncoder().encode("<html></html>"), polyglot]) {
      expect(["UNSUPPORTED_FORMAT", "INVALID_IMAGE"]).toContain(await codeOf(normalize(bytes)));
    }
    const heic = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from("ftypmif1"), 0, 0, 0, 0, ...Buffer.from("mif1heic"),
      ...new Array(64).fill(0)]);
    await expect(normalize(heic)).rejects.toMatchObject({ message: expect.stringContaining("JPEG") });
  });

  it("normalize: an animated WebP is refused, also with the VP8X animation flag cleared", async () => {
    const a = await solid(32, 32, { r: 255, g: 0, b: 0 }).png().toBuffer();
    const b = await solid(32, 32, { r: 0, g: 0, b: 255 }).png().toBuffer();
    const anim = new Uint8Array(await sharp([a, b] as never, { join: { animated: true } } as never).webp().toBuffer());
    expect(await codeOf(normalize(anim))).toBe("UNSUPPORTED_FORMAT");
    const cleared = anim.slice();
    cleared[20] = cleared[20]! & ~0x02;
    expect(["UNSUPPORTED_FORMAT", "INVALID_IMAGE"]).toContain(await codeOf(normalize(cleared)));
  });
});
