// Client calls for POST /api/edit and POST /api/composite, plus the browser
// raster helpers the render flow needs (resize to the base size, mask PNG).
import { CompositeResponse, EditResponse, ErrorResponse } from "../contracts";
import type { BinaryMask, CompositeReason, PhotoRef, SlotId } from "../types";
import { PreflightError } from "./preflight";

async function post(url: string, form: FormData, signal?: AbortSignal, requestId?: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: form, signal, headers: { "X-Request-Id": requestId ?? crypto.randomUUID() } });
  } catch {
    throw new PreflightError("UPSTREAM_UNAVAILABLE", "The app server could not be reached.");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ErrorResponse.safeParse(body);
    if (err.success) throw new PreflightError(err.data.error.code, err.data.error.message);
    throw new PreflightError(res.status >= 500 ? "UPSTREAM_UNAVAILABLE" : "INVALID_REQUEST", "The request failed.");
  }
  return body;
}

const blobOf = async (dataUrl: string) => (await fetch(dataUrl)).blob();

export type Generated = { blob: Blob; width: number; height: number; hash: string; generatedWidth: number;
  generatedHeight: number; warnings: string[] };

/**
 * One paid render. The caller passes a fresh request ID per explicit click.
 * `reference` is appended after the base, and only in reference mode (order matters: base first).
 */
export async function requestEdit(base: PhotoRef, input: { slot: SlotId; prompt: string; mode: "text" | "paint" | "reference";
  intent: "paint" | "replace" | "geometry"; quality: "high" | "low" }, requestId: string, signal?: AbortSignal,
  reference?: Blob | null): Promise<Generated> {
  const form = new FormData();
  form.append("payload", JSON.stringify({ ...input, width: base.width, height: base.height }));
  form.append("base", base.blob, "base.webp");
  if (input.mode === "reference") {
    if (!reference) throw new PreflightError("INVALID_REQUEST", "Add a reference photo first.");
    form.append("reference", reference, "reference.webp");
  }
  const parsed = EditResponse.safeParse(await post("/api/edit", form, signal, requestId));
  if (!parsed.success) throw new PreflightError("SCHEMA_INVALID", "The render answer had an unexpected shape.");
  const { image, generatedWidth, generatedHeight, warnings } = parsed.data;
  return { blob: await blobOf(image.dataUrl), width: image.width, height: image.height, hash: image.hash,
    generatedWidth, generatedHeight, warnings };
}

export type Composited = { blob: Blob; width: number; height: number; hash: string; composed: boolean;
  aligned: boolean; drift: number | null; reason: CompositeReason };

export async function requestComposite(base: PhotoRef, edited: Blob, input: { bikeBox: [number, number, number, number];
  intent: "paint" | "replace" | "geometry"; generatedWidth: number; generatedHeight: number },
  oldMask: Blob | null, newMask: Blob | null, signal?: AbortSignal): Promise<Composited> {
  const form = new FormData();
  form.append("payload", JSON.stringify({ ...input, width: base.width, height: base.height }));
  form.append("base", base.blob, "base.webp");
  form.append("edited", edited, "edited.webp");
  if (oldMask) form.append("oldMask", oldMask, "old.png");
  if (newMask) form.append("newMask", newMask, "new.png");
  const parsed = CompositeResponse.safeParse(await post("/api/composite", form, signal));
  if (!parsed.success) throw new PreflightError("SCHEMA_INVALID", "The blend answer had an unexpected shape.");
  const { image, ...rest } = parsed.data;
  return { blob: await blobOf(image.dataUrl), width: image.width, height: image.height, hash: image.hash, ...rest };
}

/**
 * Resize an image blob to an exact size in the browser and encode a WebP of at
 * most 1,250,000 bytes (the raster SAM and the blend share). Returns null when
 * the browser cannot encode WebP or the raster does not fit; the caller then
 * shows the full edit instead. Note: canvas smoothing is not Lanczos3 (recorded
 * as a SPEC 7 deviation in TASKS T5).
 */
export async function resizeTo(blob: Blob, width: number, height: number): Promise<Blob | null> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    for (const quality of [0.82, 0.76, 0.7, 0.64, 0.6]) {
      const out = await canvas.convertToBlob({ type: "image/webp", quality });
      if (out.type !== "image/webp") return null; // e.g. Safari without WebP encoding
      if (out.size <= 1_250_000) return out;
    }
    return null;
  } finally {
    bitmap.close();
  }
}

/** Encode a binary mask as a 0/255 PNG (WireMask png_binary_full_image). */
export async function maskToPngBlob(mask: BinaryMask): Promise<Blob> {
  const canvas = new OffscreenCanvas(mask.width, mask.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PreflightError("INVALID_IMAGE", "This browser cannot encode masks.");
  const img = ctx.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.pixels.length; i++) {
    const v = mask.pixels[i] ? 255 : 0;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
