// Calls POST /api/segment and decodes each WireMask PNG to 0/1 pixels at once.
import { ErrorResponse, SegmentResponse } from "../contracts";
import type { BinaryMask, PhotoRef, PointData, SegmentedObject } from "../types";
import { PreflightError } from "./preflight";

export type SegmentResult = { objects: SegmentedObject[]; complete: boolean; warnings: string[] };

export type SegmentRequest =
  | { mode: "concept"; phrase: string }
  | { mode: "points"; points: PointData[] };

export async function requestSegment(photo: Pick<PhotoRef, "blob" | "width" | "height">, request: SegmentRequest, signal?: AbortSignal): Promise<SegmentResult> {
  const form = new FormData();
  form.append("payload", JSON.stringify({ ...request, width: photo.width, height: photo.height }));
  form.append("image", photo.blob, "base.webp");
  let res: Response;
  try {
    res = await fetch("/api/segment", { method: "POST", body: form, signal,
      headers: { "X-Request-Id": crypto.randomUUID() } });
  } catch {
    throw new PreflightError("UPSTREAM_UNAVAILABLE", "The app server could not be reached.");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ErrorResponse.safeParse(body);
    if (err.success) throw new PreflightError(err.data.error.code, err.data.error.message);
    throw new PreflightError(res.status >= 500 ? "UPSTREAM_UNAVAILABLE" : "INVALID_REQUEST", "Part detection failed.");
  }
  const parsed = SegmentResponse.safeParse(body);
  if (!parsed.success || parsed.data.width !== photo.width || parsed.data.height !== photo.height) {
    throw new PreflightError("SCHEMA_INVALID", "The part detection answer had an unexpected shape.");
  }
  const objects: SegmentedObject[] = [];
  const warnings = [...parsed.data.warnings];
  let complete = parsed.data.complete;
  for (const o of parsed.data.objects) {
    if (o.mask.width !== photo.width || o.mask.height !== photo.height) {
      // Never resize a mask to fit; drop it visibly instead.
      complete = false;
      warnings.push("A part outline had the wrong size and was left out. Select it by point.");
      continue;
    }
    objects.push({ mask: await decodeMaskPng(o.mask.dataUrl, photo.width, photo.height), box: o.box, confidence: o.confidence });
  }
  return { objects, complete, warnings: [...new Set(warnings)] };
}

async function decodeMaskPng(dataUrl: string, width: number, height: number): Promise<BinaryMask> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    if (bitmap.width !== width || bitmap.height !== height) throw new PreflightError("SCHEMA_INVALID", "Mask size mismatch.");
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new PreflightError("INVALID_IMAGE", "This browser cannot read part masks.");
    ctx.drawImage(bitmap, 0, 0);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const pixels = new Uint8Array(width * height);
    for (let i = 0; i < pixels.length; i++) pixels[i] = rgba[i * 4]! > 127 ? 1 : 0;
    return { width, height, pixels };
  } finally {
    bitmap.close();
  }
}
