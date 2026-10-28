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
