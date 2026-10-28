// Stable slot IDs, SAM phrases, fixed colors, and illustrative labor minutes
// (PLAN.md 9.3, SPEC.md 10 and 11).
import type { SlotId } from "./types";

export type SlotInfo = {
  id: SlotId;
  label: string;
  /** First SAM phrase and one fallback; null means point selection only. */
  phrase: string | null;
  fallback: string | null;
  /** 1..8, index into --nl-series-N. Fixed by slot group, never by detection order. */
  series: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /** Illustrative default minutes; null means unset (custom). */
  defaultMinutes: number | null;
  paintOnly: boolean;
  core: boolean;
};

export const SLOTS: readonly SlotInfo[] = [
  { id: "wheel_front", label: "Front wheel", phrase: "wheel", fallback: "motorcycle wheel", series: 1, defaultMinutes: 60, paintOnly: false, core: true },
  { id: "wheel_rear", label: "Rear wheel", phrase: "wheel", fallback: "motorcycle wheel", series: 1, defaultMinutes: 60, paintOnly: false, core: true },
  { id: "fork", label: "Fork", phrase: "front fork", fallback: "motorcycle fork", series: 2, defaultMinutes: 240, paintOnly: false, core: true },
  { id: "tank", label: "Tank", phrase: "fuel tank", fallback: "motorcycle tank", series: 3, defaultMinutes: 240, paintOnly: false, core: true },
  { id: "handlebar", label: "Handlebar", phrase: "handlebar", fallback: "motorcycle handlebar", series: 4, defaultMinutes: 180, paintOnly: false, core: true },
  { id: "exhaust", label: "Exhaust", phrase: "exhaust pipe", fallback: "muffler", series: 5, defaultMinutes: 90, paintOnly: false, core: true },
  { id: "air_cleaner", label: "Air cleaner", phrase: "air cleaner", fallback: "air filter", series: 6, defaultMinutes: 60, paintOnly: false, core: true },
  { id: "seat", label: "Seat", phrase: "motorcycle seat", fallback: "saddle", series: 7, defaultMinutes: 30, paintOnly: false, core: true },
  { id: "headlight", label: "Headlight", phrase: "headlight", fallback: "motorcycle headlight", series: 8, defaultMinutes: 90, paintOnly: false, core: true },
  { id: "fender_front", label: "Front fender", phrase: "fender", fallback: "motorcycle fender", series: 3, defaultMinutes: 120, paintOnly: false, core: true },
  { id: "fender_rear", label: "Rear fender", phrase: "fender", fallback: "motorcycle fender", series: 3, defaultMinutes: 120, paintOnly: false, core: true },
  { id: "frame", label: "Frame", phrase: "motorcycle frame", fallback: "frame", series: 8, defaultMinutes: 720, paintOnly: true, core: true },
  { id: "engine", label: "Engine", phrase: "engine", fallback: "motorcycle engine", series: 6, defaultMinutes: 360, paintOnly: true, core: true },
  { id: "forward_controls", label: "Forward controls", phrase: "foot peg", fallback: "forward control", series: 4, defaultMinutes: 180, paintOnly: false, core: true },
  { id: "mirrors", label: "Mirrors", phrase: "mirror", fallback: "rearview mirror", series: 8, defaultMinutes: 30, paintOnly: false, core: true },
  { id: "turn_signals", label: "Turn signals", phrase: "turn signal", fallback: "motorcycle indicator", series: 8, defaultMinutes: 60, paintOnly: false, core: true },
  { id: "saddlebag", label: "Saddlebag", phrase: "saddlebag", fallback: "luggage bag", series: 7, defaultMinutes: 90, paintOnly: false, core: false },
  { id: "fairing", label: "Fairing", phrase: "motorcycle fairing", fallback: "windscreen", series: 8, defaultMinutes: 180, paintOnly: false, core: false },
  { id: "primary_cover", label: "Primary cover", phrase: "primary cover", fallback: "engine cover", series: 6, defaultMinutes: 150, paintOnly: false, core: false },
  { id: "sissy_bar", label: "Sissy bar", phrase: "sissy bar", fallback: "passenger backrest", series: 7, defaultMinutes: 90, paintOnly: false, core: false },
  { id: "grips", label: "Grips", phrase: "handlebar grip", fallback: "grip", series: 4, defaultMinutes: 30, paintOnly: false, core: false },
  { id: "custom", label: "Custom part", phrase: null, fallback: null, series: 8, defaultMinutes: null, paintOnly: false, core: false },
];

const BY_ID = new Map(SLOTS.map((s) => [s.id, s]));

export function slotInfo(id: SlotId): SlotInfo {
  const info = BY_ID.get(id);
  if (!info) throw new Error(`unknown slot ${id}`);
  return info;
}

/** Distinct core SAM phrases (front/rear share one request): 14 phrases. */
export const CORE_PHRASES: readonly string[] = [
  ...new Set(SLOTS.filter((s) => s.core && s.phrase).map((s) => s.phrase as string)),
];

/** CSS variable for a slot's fixed overlay color. */
export function slotColorVar(id: SlotId): string {
  return `var(--nl-series-${slotInfo(id).series})`;
}
