// Server-side rules applied to every edit instruction (SPEC.md 5, PLAN.md 9.4).
// The model proposes; these rules decide. Pure functions, tested offline.
import { slotInfo } from "./slots";
import type { BikeData, InstructionData, SlotId } from "./types";

type Mode = "text" | "paint" | "reference";

/** Frame and engine allow paint only (PLAN 5). */
export function modeAllowed(slot: SlotId, mode: Mode): boolean {
  return !slotInfo(slot).paintOnly || mode === "paint";
}

const GEOMETRY_SLOTS = new Set<SlotId>(["fork", "wheel_front", "wheel_rear"]);
/** Words that mean a handlebar changes height, width, or shape, not just finish (English and German). */
const HANDLEBAR_GEOMETRY = /\b(apes?|hangers?|rise|risers?|taller|higher|lower|wider|narrower|drag ?bars?|flat ?bars?|t-?bars?|z-?bars?|clubman|clip-?ons?|beach ?bars?|trackers?|buckhorns?|pull ?backs?|mini ?apes?|inch(es)?|zoll|h(ö|oe)her|breiter|lenkererh(ö|oe)hung|\d+\s*(mm|cm|"))(?=\W|$)/i;
/** Words that always mean a fork or wheel is replaced or resized, even if the model calls it paint. */
const FORK_WHEEL_REPLACEMENT = /\b(replace|swap|inch(es)?|zoll|billet|wider|narrower|bigger|larger|smaller|inverted|upside[- ]down|usd|longer|shorter|rake|travel|springer|girder|\d+\s*(mm|cm|"))(?=\W|$)/i;
/** Weaker hints of a different part; they do not count when the request is clearly a finish change. */
const FORK_WHEEL_WEAK = /\b(new|spokes?|mags?|cast)(?=\W|$)/i;
const FINISH_WORDS = /\b(paint|painted|black|chrome|powder|coat(ed)?|colou?r|gloss|matte|satin|polish(ed)?|anodi[sz]ed)(?=\W|$)/i;

/** A part that is not there cannot be painted or taken from a wheel-swap reference. */
export function absentAllowed(mode: Mode): boolean {
  return mode === "text";
}

/**
 * Enforce intent: paint mode is always paint; fork and wheel replacements and
 * handlebar height or shape changes are geometry, whatever the model said.
 */
export function enforceIntent(slot: SlotId, mode: Mode, requestText: string, instruction: InstructionData, absent = false): InstructionData {
  // A part that is not on the bike yet is always added as a whole-image geometry edit.
  if (absent) return instruction.intent === "geometry" ? instruction : { ...instruction, intent: "geometry" };
  if (mode === "paint") return instruction.intent === "paint" ? instruction : { ...instruction, intent: "paint" };
  let intent = instruction.intent;
  if (mode === "reference") {
    // A reference part is rendered over the whole image, so it is never a blend into the old mask:
    // wheels and fork are geometry; other slots never stay paint, but a model "geometry" is kept.
    intent = GEOMETRY_SLOTS.has(slot) ? "geometry" : intent === "paint" ? "replace" : intent;
  } else if (GEOMETRY_SLOTS.has(slot)) {
    if (intent === "replace") intent = "geometry";
    // A size or replacement request stays geometry even if the model answers "paint".
    const replaced = FORK_WHEEL_REPLACEMENT.test(requestText)
      || (FORK_WHEEL_WEAK.test(requestText) && !FINISH_WORDS.test(requestText));
    if (intent === "paint" && replaced) intent = "geometry";
  }
  if (slot === "handlebar" && intent !== "geometry" && HANDLEBAR_GEOMETRY.test(requestText)) intent = "geometry";
  return intent === instruction.intent ? instruction : { ...instruction, intent };
}

/**
 * Unknown bike details are explicit limitations (PLAN 9.7): later fit checks
 * must say what could not be verified instead of assuming.
 */
export function bikeLimitations(bike: BikeData): string[] {
  const out: string[] = [];
  if (!bike.make || !bike.model) out.push("Make or model unknown: fit cannot be checked for this exact bike.");
  if (bike.yearFrom === null || bike.yearTo === null) out.push("Model year unknown: part applicability may differ by year.");
  if (bike.abs === "unknown") out.push("ABS unknown: wheel and brake changes need checking on the bike.");
  if (!bike.engine) out.push("Engine generation unknown.");
  if (bike.facing === "unknown") out.push("Photo direction unknown: front and rear must be labeled by hand.");
  return out;
}

/** Add instruction warnings for the bike details that are unknown (bounded to the schema's 8). */
export function withBikeWarnings(instruction: InstructionData, bike: BikeData): InstructionData {
  const warnings = [...new Set([...instruction.warnings, ...bikeLimitations(bike)])].slice(0, 8);
  return { ...instruction, warnings };
}

/** Request text the paint form sends: "Paint the <label lowercased>: <body>". */
export function paintRequestText(label: string, body: string): string {
  return `Paint the ${label.toLowerCase()}: ${body}`;
}

/**
 * Point a paint request at another part. Only the exact leading prefix is
 * swapped; any other text returns null instead of a guess.
 */
export function retargetPaintText(text: string, fromLabel: string, toLabel: string): string | null {
  const prefix = paintRequestText(fromLabel, "");
  if (!text.startsWith(prefix)) return null;
  return paintRequestText(toLabel, text.slice(prefix.length));
}
