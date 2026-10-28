// The only module that reads MODEL_API_KEY and talks to the Meta API (SPEC.md 6).
// Server only: importing this from a client component fails the build.
// T1 provides the boundary and mock dispatch; the wire functions arrive with
// their tickets (segment T3, identify/instruction T4, edit T5, check T9).
import "server-only";
import {
  ResponsesStreamEventError, ResponsesStreamFailedError, ResponsesStreamRefusalError, ResponsesStreamSourceError,
  buildObjectPrompt, decodeMaskToRaster,
  frameIndexOf, parseImageStream, recordsOfKind, type ImageSegmentationResult,
} from "@meta-sam/parser";
import { readFileSync } from "node:fs";
import path from "node:path";
import { modelJsonSchema } from "../contracts";
import { AppError } from "../errors";
import { MOCKS, type MockName } from "../mocks";
import { loadConfig } from "./config";
import { sseEvents } from "./sse";

export const META_BASE = "https://api.meta.ai/v1";

/** Bearer header for one request. The key never leaves this module. */
export function authHeader(): { Authorization: string } {
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new AppError("LIVE_DISABLED");
  return { Authorization: `Bearer ${key}` };
}

/**
 * Mock dispatch for local UI work (MOCK=1, never production). Returns a
 * labeled fixture; it never touches the network or the budget ledger.
 */
export function mockResponse<N extends MockName>(name: N): (typeof MOCKS)[N] {
  if (loadConfig().mode !== "mock") throw new AppError("LIVE_DISABLED");
  return MOCKS[name];
}

// -------------------------------------------------------------- SAM 3.1 (6.1)

export type NormalizedInput = { width: number; height: number; dataUrl: string };
export type SamObject = {
  objectId: string; bounds: { left: number; top: number; right: number; bottom: number };
  raster: Uint8Array; maskWidth: number; maskHeight: number; confidence: number | null;
};
export type SamResult = { objects: SamObject[]; complete: boolean; diagnostics: string[] };

function samBody(text: string, image: NormalizedInput) {
  return {
    model: "sam-3.1", stream: true, store: false,
    metadata: { include_confidence: "true", mask_encoding: "one_bit" },
    input: [{ type: "message", role: "user", content: [
      { type: "input_text", text },
      { type: "input_image", image_url: image.dataUrl },
    ] }],
  };
}

/** Map a non-200 upstream status to a stable error. Only 429 is definite "not billed". */
export function upstreamError(status: number, retryAfter: string | null = null): AppError {
  if (status === 429) {
    const seconds = retryAfter !== null && /^\d{1,4}$/.test(retryAfter) ? Number(retryAfter) : null;
    return new AppError("RATE_LIMITED", undefined, seconds);
  }
  if (status >= 500) return new AppError("UPSTREAM_UNAVAILABLE");
  return new AppError("UPSTREAM_REJECTED");
}

/** One phrase per request (SPEC 6.1); the phrase is a short noun phrase, never a command. */
export function samConceptText(phrase: string): string {
  return phrase;
}

/** Object prompt for point selection: one object (id 1), frame 0, via the parser's builder. */
export function samPointsText(width: number, height: number,
  points: readonly { x: number; y: number; label: "positive" | "negative" }[]): string {
  return buildObjectPrompt({ size: { width, height }, objects: [{ id: 1, prompts: [{ frame: 0, points }] }] });
}

export async function segment(image: NormalizedInput, text: string, signal: AbortSignal): Promise<SamResult> {
  let res: Response;
  try {
    res = await fetch(`${META_BASE}/responses`, {
      method: "POST", signal, redirect: "error",
      headers: { ...authHeader(), "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(samBody(text, image)),
    });
  } catch (error) {
    throw new AppError(signal.aborted || isAbort(error) ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE");
  }
  if (res.status !== 200 || !res.body) {
    await res.body?.cancel().catch(() => {});
    throw upstreamError(res.status, res.headers.get("retry-after"));
  }
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    await res.body.cancel().catch(() => {});
    throw new AppError("UPSTREAM_UNAVAILABLE");
  }
  let result: ImageSegmentationResult;
  try {
    result = await parseImageStream(sseEvents(res.body) as AsyncIterable<{ type: string }>).finalResult;
  } catch (error) {
    // The deadline covers body reading; a mid-stream abort is a timeout, not bad data.
    if (signal.aborted) throw new AppError("UPSTREAM_TIMEOUT");
    if (error instanceof ResponsesStreamRefusalError || error instanceof ResponsesStreamFailedError) {
      throw new AppError("UPSTREAM_REJECTED");
    }
    if (error instanceof ResponsesStreamEventError) throw new AppError("UPSTREAM_UNAVAILABLE");
    if (error instanceof ResponsesStreamSourceError && !(error.cause instanceof SyntaxError)) {
      throw new AppError("UPSTREAM_UNAVAILABLE");
    }
    throw new AppError("SCHEMA_INVALID");
  }
  // A stream that just stops (no response.completed or .incomplete) is an
  // upstream failure with an unknown charge, not an empty success.
  if (result.outcome.status === "incomplete" && result.outcome.reason === "eof") {
    throw new AppError("UPSTREAM_UNAVAILABLE");
  }
  return samRecords(result);
}

/** Pair box and mask records by object ID (never by array index) and decode rasters. */
export function samRecords(result: ImageSegmentationResult): SamResult {
  // An image is frame 0; image records carry no frame (frameIndexOf is undefined).
  const inFrame0 = (r: Parameters<typeof frameIndexOf>[0]) => (frameIndexOf(r) ?? 0) === 0;
  const boxes = new Map(recordsOfKind(result.records, "box").filter(inFrame0).map((b) => [b.objectId, b]));
  const masks = recordsOfKind(result.records, "mask").filter(inFrame0);
  const objects: SamObject[] = [];
  // A later mask revision for the same object replaces the earlier one.
  const latest = new Map<string, (typeof masks)[number]>();
  for (const m of masks) latest.set(m.objectId, m);
  for (const m of latest.values()) {
    let raster: Uint8Array;
    try {
      raster = decodeMaskToRaster(m.mask);
    } catch {
      throw new AppError("SCHEMA_INVALID");
    }
    const box = boxes.get(m.objectId);
    objects.push({
      objectId: m.objectId, raster, maskWidth: m.mask.width, maskHeight: m.mask.height,
      bounds: { left: m.bounds.left, top: m.bounds.top, right: m.bounds.right, bottom: m.bounds.bottom },
      confidence: m.confidence ?? box?.confidence ?? null,
    });
  }
  return {
    objects, complete: result.outcome.status === "completed",
    diagnostics: result.diagnostics.map((d) => d.code),
  };
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

// ------------------------------------------------- Muse Spark (6.3), no tools

export type SparkFormat = "bike_identification_v1" | "edit_instruction_v1";

/** Trusted instructions: the versioned prompt file, read from disk (traced into the bundle). */
export function promptText(file: string): string {
  return readFileSync(path.join(process.cwd(), "prompts", file), "utf8");
}

export function sparkBody(model: string, promptFile: string, format: SparkFormat, task: unknown, imageUrl: string | null) {
  const content: unknown[] = [{ type: "input_text", text: JSON.stringify(task) }];
  if (imageUrl) content.push({ type: "input_image", image_url: imageUrl });
  return {
    model, stream: false, store: false, max_output_tokens: 4096,
    instructions: promptText(promptFile),
    input: [{ type: "message", role: "user", content }],
    text: { format: { type: "json_schema", name: format, strict: true, schema: modelJsonSchema(format) } },
  };
}

export type SparkUsage = { input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown;
  output_tokens_details?: { reasoning_tokens?: unknown } };
export type SparkOutput = { json: unknown };

type SparkItem = { type?: unknown; content?: unknown };

/**
 * Read a non-streaming Responses answer: status first, then every
 * output_text block across all output items (reasoning or tool items may come
 * before the message; never assume output[0]). Refusal, failure, incomplete,
 * malformed shape, and non-JSON output are safe route errors; no repair call.
 */
export function readSparkResponse(body: unknown): SparkOutput {
  if (!body || typeof body !== "object") throw new AppError("SCHEMA_INVALID");
  const r = body as { status?: unknown; output?: unknown };
  if (r.status === "failed" || r.status === "cancelled") throw new AppError("UPSTREAM_REJECTED");
  if (!Array.isArray(r.output) || !r.output.every((i) => i && typeof i === "object")) throw new AppError("SCHEMA_INVALID");
  const blocks = (r.output as SparkItem[]).flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .filter((b): b is { type?: unknown; text?: unknown } => Boolean(b) && typeof b === "object");
  if (blocks.some((b) => b.type === "refusal")) throw new AppError("UPSTREAM_REJECTED", "The AI model declined this request.");
  if (r.status !== "completed") throw new AppError("SCHEMA_INVALID", "The AI answer was incomplete.");
  const text = blocks.filter((b) => b.type === "output_text").map((b) => (typeof b.text === "string" ? b.text : "")).join("");
  if (!text) throw new AppError("SCHEMA_INVALID");
  try {
    return { json: JSON.parse(text) as unknown };
  } catch {
    throw new AppError("SCHEMA_INVALID");
  }
}

const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

/**
 * Charge from reported usage without cache discounts. null (unknown: keep the
 * full reservation) when usage is missing or does not add up, for example
 * reasoning tokens that are not inside output_tokens.
 */
export function sparkCharge(usage: unknown, prices: { inputMicroUsdPerMillionTokens: number;
  outputMicroUsdPerMillionTokens: number }): number | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as SparkUsage;
  const input = count(u.input_tokens), output = count(u.output_tokens);
  if (input === null || output === null) return null;
  const total = u.total_tokens === undefined ? null : count(u.total_tokens);
  if (u.total_tokens !== undefined && (total === null || total > input + output)) return null;
  const reasoning = u.output_tokens_details?.reasoning_tokens;
  if (reasoning !== undefined && (count(reasoning) === null || count(reasoning)! > output)) return null;
  return Math.ceil((input * prices.inputMicroUsdPerMillionTokens + output * prices.outputMicroUsdPerMillionTokens) / 1_000_000);
}

/** The usage object of a raw answer, if any (read before the answer is judged). */
export function usageOf(body: unknown): unknown {
  return body && typeof body === "object" ? (body as { usage?: unknown }).usage : undefined;
}

/** Upstream answers larger than this are refused (charge unknown) before they fill memory. */
export const MAX_UPSTREAM_BYTES = 40_000_000;

/** Read a JSON body with a byte cap, so a runaway answer cannot exhaust memory. */
export async function readJsonLimited(res: Response, maxBytes = MAX_UPSTREAM_BYTES): Promise<unknown> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes || !res.body) {
    await res.body?.cancel().catch(() => {});
    throw new AppError("UPSTREAM_UNAVAILABLE");
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => {}); throw new AppError("UPSTREAM_UNAVAILABLE"); }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new AppError("UPSTREAM_UNAVAILABLE");
  }
}

/**
 * POST /v1/responses for Spark (no tools); returns the raw JSON body. The
 * caller settles the charge from its usage first and judges the answer with
 * readSparkResponse afterwards, so a refused or invalid answer still settles
 * its real cost instead of the whole reservation.
 */
export async function fetchSparkJson(body: unknown, signal: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${META_BASE}/responses`, {
      method: "POST", signal, redirect: "error",
      headers: { ...authHeader(), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new AppError(signal.aborted || isAbort(error) ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE");
  }
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => {});
    throw upstreamError(res.status, res.headers.get("retry-after"));
  }
  try {
    return await readJsonLimited(res);
  } catch (error) {
    if (signal.aborted) throw new AppError("UPSTREAM_TIMEOUT");
    throw error;
  }
}

// ------------------------------------------------------- Muse Image (6.2)

/** Expand a versioned template: drop the header paragraph, insert the edit prompt. */
export function renderTemplate(file: "paint.v1.md" | "edit.v1.md" | "compose.v1.md", editPrompt: string): string {
  const text = promptText(file);
  const body = text.slice(text.indexOf("\n\n") + 2);
  // A replacer function inserts the text verbatim ("$&", "$`", "$$" keep their literal meaning).
  return body.replace("{{editPrompt}}", () => editPrompt.trim()).trimEnd();
}

/** The server picks the template from the request mode, never from client-sent intent. */
export function templateFor(mode: "text" | "paint"): "paint.v1.md" | "edit.v1.md" {
  return mode === "paint" ? "paint.v1.md" : "edit.v1.md";
}

export function imageEditBody(prompt: string, imageUrl: string, width: number, height: number, quality: "high" | "low") {
  return {
    model: "muse-image-1.0", prompt, images: [{ image_url: imageUrl }], n: 1, size: `${width}x${height}`,
    response_format: "b64_json", output_format: "webp", reasoning_strength: quality,
    tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
  };
}

/** POST /v1/images/edits; returns the raw JSON body (the caller counts returned images for the charge). */
export async function fetchImageEdit(body: unknown, signal: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${META_BASE}/images/edits`, {
      method: "POST", signal, redirect: "error",
      headers: { ...authHeader(), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new AppError(signal.aborted || isAbort(error) ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE");
  }
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => {});
    throw upstreamError(res.status, res.headers.get("retry-after"));
  }
  try {
    return await readJsonLimited(res);
  } catch (error) {
    if (signal.aborted) throw new AppError("UPSTREAM_TIMEOUT");
    throw error;
  }
}

/** Number of returned images, or null when the answer has no data array (unknown charge). */
export function returnedImages(body: unknown): number | null {
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : undefined;
  return Array.isArray(data) ? data.length : null;
}

/** The first returned image's bytes; NO_RESULT when there is none. */
export function firstImageBytes(body: unknown): Uint8Array {
  const data = (body as { data?: { b64_json?: unknown }[] }).data;
  const b64 = Array.isArray(data) ? data[0]?.b64_json : undefined;
  if (typeof b64 !== "string" || b64.length === 0) throw new AppError("NO_RESULT");
  return new Uint8Array(Buffer.from(b64, "base64"));
}
