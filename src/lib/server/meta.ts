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

// ------------------------------------------- Muse Spark (6.3), tools only when grounded

export type SparkFormat = "bike_identification_v1" | "edit_instruction_v1" | "fit_check_v1" | "parts_search_v1";

/** Trusted instructions: the versioned prompt file, read from disk (traced into the bundle). */
export function promptText(file: string): string {
  return readFileSync(path.join(process.cwd(), "prompts", file), "utf8");
}

/** A prompt file without its header paragraph (same rule as renderTemplate). */
export function promptBody(file: string): string {
  const text = promptText(file);
  const end = text.indexOf("\n\n");
  // A prompt file without its header block is a packaging error; never send a cut-off prompt.
  if (end < 0) throw new Error(`${file} has no header block`);
  return text.slice(end + 2);
}

/** Search grounding for the fit check (owner decision 1A): low context, Germany, at most 2 tool calls. */
const GROUNDED_FIELDS = {
  tools: [{ type: "web_search", search_context_size: "low", user_location: { type: "approximate", country: "DE" } }],
  max_tool_calls: 2,
  include: ["web_search_call.results"],
  // Owner decision 2026-10-29: a grounded probe spent all 4096 output tokens on reasoning and
  // ended incomplete. 3 passes x (full input context + 8192 output) = 319488 µ$, still inside
  // the spark-grounded-base reservation of 330000 (SPEC 712).
  max_output_tokens: 8192,
} as const;

/**
 * stripHeader is off by default so the identify.v1 request stays byte-identical to its live evidence.
 * grounded is off by default too: without it no tools, max_tool_calls or include are sent.
 */
export function sparkBody(model: string, promptFile: string, format: SparkFormat, task: unknown, imageUrl: string | null,
  stripHeader = false, grounded = false) {
  const content: unknown[] = [{ type: "input_text", text: JSON.stringify(task) }];
  if (imageUrl) content.push({ type: "input_image", image_url: imageUrl });
  const base = {
    model, stream: false, store: false, max_output_tokens: 4096,
    instructions: stripHeader ? promptBody(promptFile) : promptText(promptFile),
    input: [{ type: "message", role: "user", content }],
    text: { format: { type: "json_schema", name: format, strict: true, schema: modelJsonSchema(format) } },
  };
  return grounded ? { ...base, ...GROUNDED_FIELDS } : base;
}

export type SparkUsage = { input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown;
  output_tokens_details?: { reasoning_tokens?: unknown } };
export type SparkCitation = { url: string; title: string };
export type SparkSearchCall = { id: string | null; status: string | null };
export type SparkSearchHit = { url: string; title: string; snippet: string };
export type SparkOutput = {
  json: unknown;
  /** url_citation annotations from every output_text block (unchecked: the route filters them). */
  citations: SparkCitation[];
  /** Every web_search_call item with its status. */
  searchCalls: SparkSearchCall[];
  /** Result hits of the web_search_call items; empty when the shape is unknown (U02). */
  results: SparkSearchHit[];
  /** True only when at least one web_search_call has status "completed". */
  searched: boolean;
};

type SparkItem = { type?: unknown; content?: unknown };

/**
 * Read a non-streaming Responses answer: status first, then the output_text
 * of the last message item (reasoning or tool items may come before it; never
 * assume output[0]). Citations come from every message. Refusal, failure, incomplete,
 * malformed shape, and non-JSON output are safe route errors; no repair call.
 */
export function readSparkResponse(body: unknown): SparkOutput {
  if (!body || typeof body !== "object") throw new AppError("SCHEMA_INVALID");
  const r = body as { status?: unknown; output?: unknown };
  if (r.status === "failed" || r.status === "cancelled") throw new AppError("UPSTREAM_REJECTED");
  if (!Array.isArray(r.output) || !r.output.every((i) => i && typeof i === "object")) throw new AppError("SCHEMA_INVALID");
  const blocks = (r.output as SparkItem[]).flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .filter((b): b is { type?: unknown; text?: unknown; annotations?: unknown } => Boolean(b) && typeof b === "object");
  if (blocks.some((b) => b.type === "refusal")) throw new AppError("UPSTREAM_REJECTED", "The AI model declined this request.");
  if (r.status !== "completed") throw new AppError("SCHEMA_INVALID", "The AI answer was incomplete.");
  const textBlocks = blocks.filter((b) => b.type === "output_text");
  // Probe evidence 2026-10-29: a grounded answer is [reasoning, message, search, search, reasoning, message].
  // The first message is preamble; the answer is the LAST message item with output_text (joined within it only).
  const messages = (r.output as SparkItem[]).filter((i) => i.type === "message")
    .map((i) => (Array.isArray(i.content) ? i.content : []).filter((b): b is { type?: unknown; text?: unknown } =>
      Boolean(b) && typeof b === "object" && (b as { type?: unknown }).type === "output_text"
      && typeof (b as { text?: unknown }).text === "string"))
    .filter((m) => m.length > 0);
  const last = messages[messages.length - 1] ?? [];
  const text = last.map((b) => (typeof b.text === "string" ? b.text : "")).join("");
  if (!text) throw new AppError("SCHEMA_INVALID");
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new AppError("SCHEMA_INVALID");
  }
  const searchCalls = (r.output as SparkItem[]).filter((i) => i.type === "web_search_call").map(searchCallOf);
  return {
    json, citations: citationsOf(textBlocks),
    searchCalls, results: (r.output as SparkItem[]).filter((i) => i.type === "web_search_call").flatMap(hitsOf),
    searched: searchCalls.some((c) => c.status === "completed"),
  };
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);

function citationsOf(blocks: { annotations?: unknown }[]): SparkCitation[] {
  const out: SparkCitation[] = [];
  for (const b of blocks) {
    if (!Array.isArray(b.annotations)) continue;
    for (const a of b.annotations) {
      const o = obj(a);
      const url = o && o.type === "url_citation" ? str(o.url) : null;
      if (url) out.push({ url, title: str(o?.title) ?? "" });
    }
  }
  return out;
}

function searchCallOf(item: SparkItem): SparkSearchCall {
  const o = item as Record<string, unknown>;
  return { id: str(o.id), status: str(o.status) };
}

/**
 * Result hits of one web_search_call. The exact location is UNVERIFIED (U02): the
 * docs say include web_search_call.results returns title/url/snippet, so look at
 * item.results and item.action.results only; anything else yields no hits.
 */
function hitsOf(item: SparkItem): SparkSearchHit[] {
  const o = item as Record<string, unknown>;
  const list = Array.isArray(o.results) ? o.results : Array.isArray(obj(o.action)?.results) ? obj(o.action)!.results as unknown[] : [];
  const hits: SparkSearchHit[] = [];
  for (const h of list) {
    const e = obj(h);
    const url = e ? str(e.url) : null;
    if (url) hits.push({ url, title: str(e?.title) ?? "", snippet: str(e?.snippet) ?? "" });
  }
  return hits;
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

/**
 * Grounded charge: token cost plus the per-query search fee. null (unknown: keep
 * the full reservation) when usage is unusable or the query count is not a
 * known non-negative integer; a missing count is never treated as zero.
 */
export function sparkChargeGrounded(usage: unknown, searchQueries: unknown, prices: { inputMicroUsdPerMillionTokens: number;
  outputMicroUsdPerMillionTokens: number; webSearchMicroUsdPerQuery: number }): number | null {
  // searchQueries must be a count the API reports (U06), never the number of web_search_call
  // items: one tool call can run several billed queries (SPEC 712).
  const queries = count(searchQueries);
  if (queries === null || count(prices.webSearchMicroUsdPerQuery) === null) return null;
  const tokens = sparkCharge(usage, prices);
  return tokens === null ? null : tokens + queries * prices.webSearchMicroUsdPerQuery;
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
export function renderTemplate(file: "paint.v1.md" | "edit.v1.md" | "compose.v3.md", editPrompt: string): string {
  const text = promptText(file);
  const body = text.slice(text.indexOf("\n\n") + 2);
  // A replacer function inserts the text verbatim ("$&", "$`", "$$" keep their literal meaning).
  return body.replace("{{editPrompt}}", () => editPrompt.trim()).trimEnd();
}

/** The server picks the template from the request mode, never from client-sent intent. */
export function templateFor(mode: "text" | "paint" | "reference"): "paint.v1.md" | "edit.v1.md" | "compose.v3.md" {
  if (mode === "reference") return "compose.v3.md";
  return mode === "paint" ? "paint.v1.md" : "edit.v1.md";
}

/**
 * Edit body. imageUrls is ordered: the base photo first, and in compose mode the
 * reference second ("image 1" and "image 2" in compose.v3.md). Tools are always off.
 */
export function imageEditBody(prompt: string, imageUrls: string | readonly string[], width: number, height: number, quality: "high" | "low") {
  const urls = typeof imageUrls === "string" ? [imageUrls] : imageUrls;
  return {
    model: "muse-image-1.0", prompt, images: urls.map((image_url) => ({ image_url })), n: 1, size: `${width}x${height}`,
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
