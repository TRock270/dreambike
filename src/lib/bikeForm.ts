// Bike confirmation form logic (PLAN.md 6 step 3, 9.7). Pure and tested.
// The mechanic can type before identification finishes; a late suggestion
// fills only fields the mechanic has not touched and never overwrites a
// correction or a confirmed bike.
import { BikeChecked } from "./contracts";
import { bikeLimitations } from "./editPolicy";
import type { BikeData, BikeRevision } from "./types";

export type BikeField = "make" | "model" | "family" | "engine" | "yearFrom" | "yearTo" | "abs" | "style" | "facing";
export const BIKE_FIELDS: readonly BikeField[] = ["make", "model", "family", "engine", "yearFrom", "yearTo", "abs", "style", "facing"];

export type BikeFormState = {
  bike: BikeData;
  touched: ReadonlySet<BikeField>;
  /** Where the untouched values came from, for the UI label. */
  suggested: boolean;
  confirmed: boolean;
  revision: number;
};

export function unknownBike(): BikeData {
  return { make: null, model: null, family: "unknown", engine: null, yearFrom: null, yearTo: null,
    abs: "unknown", style: null, facing: "unknown", confidence: 0, limitations: [] };
}

export function emptyBikeForm(): BikeFormState {
  return { bike: unknownBike(), touched: new Set(), suggested: false, confirmed: false, revision: 0 };
}

/** The mechanic edits one field: it is now theirs, and any confirmation must be repeated. */
export function editField<K extends BikeField>(state: BikeFormState, field: K, value: BikeData[K]): BikeFormState {
  const touched = new Set(state.touched);
  touched.add(field);
  return { ...state, bike: { ...state.bike, [field]: value }, touched, confirmed: false };
}

/**
 * Apply an identification suggestion to untouched fields only. Once the
 * mechanic has confirmed even once, every value (including "unknown") is
 * theirs, so a late suggestion is ignored.
 */
export function applySuggestion(state: BikeFormState, suggestion: BikeData): BikeFormState {
  if (state.confirmed || state.revision > 0) return state;
  const bike = { ...state.bike };
  for (const field of BIKE_FIELDS) {
    if (!state.touched.has(field)) (bike as Record<BikeField, unknown>)[field] = suggestion[field];
  }
  return { ...state, bike: { ...bike, confidence: suggestion.confidence, limitations: suggestion.limitations }, suggested: true };
}

/**
 * Confirm the bike as the mechanic sees it now. Unknown values are valid; they
 * become explicit limitations. Returns null when the values are inconsistent.
 */
export function confirmBike(state: BikeFormState): BikeFormState | null {
  const limitations = [...new Set([...bikeLimitations(state.bike)])].slice(0, 12);
  const bike: BikeData = { ...state.bike, confidence: 1, limitations };
  if (!BikeChecked.safeParse(bike).success) return null;
  return { ...state, bike, confirmed: true, revision: state.revision + 1, touched: new Set(BIKE_FIELDS) };
}

/** Parse a year input: blank means unknown; anything else must be a plausible year. */
export function parseYear(text: string): number | null | "invalid" {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d{4}$/.test(t)) return "invalid";
  const y = Number(t);
  return y >= 1900 && y <= 2100 ? y : "invalid";
}

/**
 * The form for a reopened project. A confirmed (or revised) bike is the mechanic's own, so every
 * field counts as touched and a late AI suggestion can never overwrite it. A project that was
 * never confirmed (revision 0) stays open to a cached suggestion.
 */
export function bikeFormFromRevision(rev: BikeRevision): BikeFormState {
  const theirs = rev.confirmed || rev.revision > 0;
  return {
    bike: rev.bike, touched: new Set(theirs ? BIKE_FIELDS : []), suggested: false,
    confirmed: rev.confirmed, revision: rev.revision,
  };
}

/** The persisted record for a confirmed form; `id` stays the project's existing bike revision id. */
export function bikeRevisionFromForm(state: BikeFormState, id: string, now: number): BikeRevision {
  return { id, bike: state.bike, confirmed: state.confirmed, revision: state.revision,
    confirmedAt: state.confirmed ? now : null };
}
