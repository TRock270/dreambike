// The render pipeline after one paid generation (SPEC.md 7, TASKS T5):
// resize to the base raster, re-segment the edited part on that exact raster,
// then blend locally. Everything here reuses the cached generation, so a
// failed segment or blend step never pays for a second render.
import { chooseCandidate, interiorPoint } from "../parts";
import { slotInfo } from "../slots";
import type { BinaryMask, MapPart, PhotoRef } from "../types";
import { PreflightError } from "./preflight";
import { maskToPngBlob, requestComposite, resizeTo, type Composited, type Generated } from "./renderClient";
import { requestSegment } from "./segmentClient";

export const ASPECT_LIMIT = 0.02;
export const SMALL_EDGE = 1024;

/** Same pre-blend checks as the server, so SAM is skipped when blending cannot happen. */
export function willSkipBlend(intent: "paint" | "replace" | "geometry", generated: { width: number; height: number },
  base: { width: number; height: number }): boolean {
  if (intent === "geometry") return true;
  if (Math.min(generated.width, generated.height) < SMALL_EDGE) return true;
  return Math.abs((generated.width / generated.height) / (base.width / base.height) - 1) > ASPECT_LIMIT;
}

export type BlendStage = "segmenting" | "compositing";

/** The full edit at its own size: used for every result that was not blended. */
function fullEdit(generated: Generated, reason: Composited["reason"], drift: number | null = null): Composited {
  return { blob: generated.blob, width: generated.width, height: generated.height, hash: generated.hash,
    composed: false, aligned: false, drift, reason };
}

/**
 * Blend a cached generation into the base. Returns the result and the edited
 * part's new mask (null when it could not be found again). A result that is
 * not blended always shows the render at its own size (SPEC 5).
 */
export async function blend(base: PhotoRef, generated: Generated, part: MapPart, bikeBox: [number, number, number, number] | null,
  intent: "paint" | "replace" | "geometry", onStage: (stage: BlendStage) => void, signal?: AbortSignal):
  Promise<{ result: Composited; newMask: BinaryMask | null }> {
  const meta = { bikeBox: bikeBox ?? [0, 0, base.width, base.height] as [number, number, number, number], intent,
    generatedWidth: generated.generatedWidth, generatedHeight: generated.generatedHeight };
  if (willSkipBlend(intent, { width: generated.generatedWidth, height: generated.generatedHeight }, base)) {
    onStage("compositing");
    const r = await requestComposite(base, generated.blob, meta, null, null, signal);
    return { result: r.composed ? r : fullEdit(generated, r.reason, r.drift), newMask: null };
  }
  // Without the bike outline the blend radius would be computed from the photo width: do not blend.
  if (!bikeBox) return { result: fullEdit(generated, "missing_mask"), newMask: null };
  // The browser makes the base-sized raster; SAM and the blend both use exactly this one.
  const edited = await resizeTo(generated.blob, base.width, base.height);
  if (!edited) return { result: fullEdit(generated, "missing_mask"), newMask: null };
  onStage("segmenting");
  let newMask: BinaryMask | null = null;
  try {
    const phrase = slotInfo(part.slot).phrase;
    const point = interiorPoint(part.mask, part.box);
    const raster = { blob: edited, width: base.width, height: base.height };
    const seg = phrase && part.source === "concept"
      ? await requestSegment(raster, { mode: "concept", phrase }, signal)
      : point ? await requestSegment(raster, { mode: "points", points: [{ ...point, label: "positive" }] }, signal) : null;
    if (seg) {
      const index = chooseCandidate(part.box, seg.objects.map((o) => o.box));
      newMask = index === null ? null : seg.objects[index]!.mask;
    }
  } catch (error) {
    // Live part detection may be switched off (U01) or budget-limited: blend without a new mask,
    // which is the documented full-image fallback. Other failures stop here for a manual retry.
    const soft = error instanceof PreflightError && ["FEATURE_DISABLED", "LIVE_DISABLED", "BUDGET_EXCEEDED"].includes(error.code);
    if (!soft) throw error;
  }
  onStage("compositing");
  const r = await requestComposite(base, edited, meta, await maskToPngBlob(part.mask),
    newMask ? await maskToPngBlob(newMask) : null, signal);
  return { result: r.composed ? r : fullEdit(generated, r.reason, r.drift), newMask };
}

/** The exact user-facing text for each full-image fallback (SPEC 7). */
export const FALLBACK_TEXT: Record<Exclude<Composited["reason"], "composited">, string> = {
  drift: "The model moved the bike. Showing the full edit.",
  geometry: "Shape change: showing the full edit.",
  small: "The rendered image was too small to blend. Showing the full edit.",
  aspect: "The rendered image has a different shape. Showing the full edit.",
  missing_mask: "The changed part could not be found again. Showing the full edit.",
  no_outside_area: "Nothing outside the part was left to protect. Showing the full edit.",
  disabled: "Blending is turned off. Showing the full edit.",
};
