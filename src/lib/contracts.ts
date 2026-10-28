// Shared Zod schemas for every route, model output, mock, and persisted value
// (SPEC.md sections 4, 5, 8). Types are inferred from these in types.ts.
//
// TypeScript note: `z.object({...}).strict()` rejects unknown keys, like a
// pydantic model with extra="forbid". `.nullable()` means the key must be
// present but may be null.
import { z } from "zod";

// ---------------------------------------------------------------- primitives

export const Id = z.uuid();
export const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const Short = z.string().min(1).max(200);
export const Note = z.string().max(2000);
export const Cents = z.number().int().min(0).max(100_000_000);
export const Dimension = z.number().int().min(1).max(2048);
export const HttpsUrl = z.url().startsWith("https://").max(2048);

export const SLOT_IDS = [
  "wheel_front", "wheel_rear", "fork", "tank", "handlebar", "exhaust",
  "air_cleaner", "seat", "headlight", "fender_front", "fender_rear",
  "frame", "engine", "forward_controls", "mirrors", "turn_signals",
  "saddlebag", "fairing", "primary_cover", "sissy_bar", "grips", "custom",
] as const;
export const Slot = z.enum(SLOT_IDS);

/** [left, top, right, bottom) in image pixels; right/bottom are exclusive. */
export const Box = z.tuple([
  z.number().int().min(0), z.number().int().min(0),
  z.number().int().min(1), z.number().int().min(1),
]).refine(([l, t, r, b]) => r > l && b > t, { message: "box must have positive area" });
export const Point = z.object({
  x: z.number().int().min(0), y: z.number().int().min(0),
  label: z.enum(["positive", "negative"]),
}).strict();
export const SpecEntry = z.object({ key: Short, value: Short }).strict();
export const Approval = z.enum(["abe", "e_mark", "teilegutachten", "none", "unknown"]);
export const Intent = z.enum(["paint", "replace", "geometry"]);
export const TaxBasis = z.enum(["gross", "net", "unknown"]);
export const EditMode = z.enum(["text", "paint", "reference"]);

export const Source = z.object({
  url: HttpsUrl, title: Short, accessedAt: z.iso.datetime(), supports: Note,
}).strict();

export const Bike = z.object({
  make: Short.nullable(), model: Short.nullable(),
  family: z.enum(["sportster", "softail", "dyna", "touring", "street", "other", "unknown"]),
  engine: Short.nullable(),
  yearFrom: z.number().int().min(1900).max(2100).nullable(),
  yearTo: z.number().int().min(1900).max(2100).nullable(),
  abs: z.enum(["yes", "no", "unknown"]), style: Short.nullable(),
  facing: z.enum(["left", "right", "unknown"]),
  confidence: z.number().min(0).max(1), limitations: z.array(Note).max(12),
}).strict();

export const Product = z.object({
  id: Id, name: Short, brand: Short.nullable(), partNumber: Short.nullable(),
  url: HttpsUrl, imageUrl: HttpsUrl.nullable(), priceText: Short.nullable(),
  priceEurCents: Cents.nullable(), taxBasis: TaxBasis, approval: Approval,
  approvalText: Note.nullable(),
  fulfillmentRegion: z.enum(["eu", "outside_eu", "unknown"]),
  source: Source, linkState: z.enum(["reachable", "unchecked", "unreachable"]),
}).strict();

export const FitResult = z.object({
  itemId: Id, status: z.enum(["ok", "verify", "problem"]), approval: Approval,
  documentCoverage: z.enum(["covered", "not_covered", "unknown"]),
  inspection: z.enum(["none", "aenderungsabnahme", "einzelabnahme", "unknown"]),
  eintragung: z.enum(["required", "not_required", "unknown"]),
  carryDocuments: z.enum(["required", "not_required", "unknown"]),
  reasons: z.array(Note).min(1).max(12), toMeasure: z.array(Note).max(12),
  extraParts: z.array(Short).max(12), conditions: z.array(Note).max(12),
  sources: z.array(Source).max(8), confidence: z.number().min(0).max(1),
}).strict();

export const Instruction = z.object({
  title: Short, editPrompt: z.string().min(1).max(4000),
  spec: z.array(SpecEntry).max(20), intent: Intent, warnings: z.array(Note).max(8),
}).strict();

export const BuildItem = z.object({
  zeroLaborConfirmed: z.boolean(), mechanicNotes: Note, fitReviewedHash: Hash.nullable(),
  id: Id, slot: Slot, title: Short, spec: z.array(SpecEntry).max(20),
  intent: Intent, product: Product.nullable(),
  costKind: z.enum(["part", "labor_only"]), partPriceCents: Cents.nullable(),
  taxBasis: TaxBasis, laborMinutes: z.number().int().min(0).max(10080).nullable(),
  fit: FitResult.nullable(), fitInputHash: Hash.nullable(),
  fitCheckedAt: z.iso.datetime().nullable(), originVersionId: Id,
}).strict();

export const Fee = z.object({
  id: Id, label: Short, kind: z.enum(["aenderungsabnahme", "einzelabnahme", "other"]),
  netCents: Cents.nullable(), itemIds: z.array(Id).max(22), confirmed: z.boolean(),
}).strict();

export const InspectionReview = z.object({
  fitInputHash: Hash, decision: z.enum(["none", "fees_added", "unresolved"]),
  notes: Note, reviewedAt: z.iso.datetime(),
}).strict();

export const Settings = z.object({
  shopConfirmed: z.boolean(), shopName: Short, logoImageId: Id.nullable(),
  hourlyRateNetCents: Cents.nullable(), currency: z.literal("EUR"),
  vatBasisPoints: z.literal(1900),
  laborBySlot: z.array(z.object({
    slot: Slot, minutes: z.number().int().min(0).max(10080),
  }).strict()).max(22),
  aenderungsabnahmeNetCents: Cents.nullable(), einzelabnahmeNetCents: Cents.nullable(),
  preferredShopDomains: z.array(z.string().regex(/^[a-z0-9.-]+$/).max(253)).max(10),
  shopRules: z.array(Note).max(12), quoteNotes: Note, demoRates: z.boolean(),
}).strict().refine(
  (s) => new Set(s.laborBySlot.map((l) => l.slot)).size === s.laborBySlot.length,
  { message: "each slot may appear at most once in laborBySlot", path: ["laborBySlot"] },
);

export const WireImage = z.object({
  mime: z.literal("image/webp"),
  dataUrl: z.string().startsWith("data:image/webp;base64,").max(1_666_800),
  width: Dimension, height: Dimension, hash: Hash,
}).strict();

export const WireMask = z.object({
  encoding: z.literal("png_binary_full_image"), width: Dimension, height: Dimension,
  dataUrl: z.string().startsWith("data:image/png;base64,").max(666_800),
}).strict();

export const SegmentObject = z.object({
  objectId: z.string().regex(/^[0-9]+$/), box: Box, mask: WireMask,
  confidence: z.number().min(0).max(1).nullable(),
}).strict();

export const ImageFile = z.file().mime(["image/webp"]).max(1_250_000);
export const MaskFile = z.file().mime(["image/png"]).max(500_000);

export const ERROR_CODES = [
  "INVALID_REQUEST", "INVALID_IMAGE", "UNSUPPORTED_FORMAT", "TOO_LARGE",
  "NO_RESULT", "MASK_PLACEMENT_UNKNOWN", "UPSTREAM_TIMEOUT", "UPSTREAM_REJECTED",
  "UPSTREAM_UNAVAILABLE", "SCHEMA_INVALID", "BUDGET_EXCEEDED", "RATE_LIMITED",
  "LIVE_DISABLED", "ACCOUNTING_UNAVAILABLE", "REQUEST_IN_PROGRESS", "RESULT_NOT_CACHED",
  "FEATURE_DISABLED", "FETCH_BLOCKED", "STORAGE_FULL", "FORBIDDEN",
] as const;
export const ErrorCode = z.enum(ERROR_CODES);
export const ErrorResponse = z.object({
  error: z.object({
    code: ErrorCode, message: Short, retryable: z.boolean(), requestId: Id,
    retryAfterSeconds: z.number().int().min(0).nullable(),
  }).strict(),
}).strict();

// ---------------------------------------------------------- cross-field checks

/** Box must have positive area and lie inside a width x height image. */
export function boxInside(box: readonly number[], width: number, height: number): boolean {
  const [l, t, r, b] = box as [number, number, number, number];
  return r > l && b > t && r <= width && b <= height;
}

function yearsOrdered(b: { yearFrom: number | null; yearTo: number | null }): boolean {
  return b.yearFrom === null || b.yearTo === null || b.yearFrom <= b.yearTo;
}

/** Bike as accepted from routes and storage (adds the year-order check). */
export const BikeChecked = Bike.refine(yearsOrdered, {
  message: "yearFrom cannot exceed yearTo", path: ["yearFrom"],
});

// ------------------------------------------------------------------- routes

export const NormalizeRequest = z.object({
  photo: z.file().mime(["image/jpeg", "image/png", "image/webp"]).max(1_250_000),
}).strict();
export const NormalizeResponse = z.object({
  image: WireImage, warnings: z.array(Note).max(8),
}).strict();

export const SegmentPayload = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("concept"), width: Dimension, height: Dimension,
    phrase: z.string().min(1).max(80),
  }).strict(),
  z.object({
    mode: z.literal("points"), width: Dimension, height: Dimension,
    points: z.array(Point).min(1).max(8),
  }).strict()
    .refine((p) => p.points.every((pt) => pt.x < p.width && pt.y < p.height),
      { message: "points must lie inside the image", path: ["points"] })
    .refine((p) => p.points.some((pt) => pt.label === "positive"),
      { message: "at least one positive point is required", path: ["points"] }),
]);
export const SegmentResponse = z.object({
  width: Dimension, height: Dimension, objects: z.array(SegmentObject).max(16),
  complete: z.boolean(), warnings: z.array(Note).max(8),
}).strict();

export const IdentifyPayload = z.object({ width: Dimension, height: Dimension }).strict();
export const IdentifyResponse = z.object({ bike: BikeChecked }).strict();

export const InstructionPayload = z.object({
  slot: Slot, box: Box, bike: BikeChecked, mode: EditMode,
  text: z.string().min(1).max(2000), width: Dimension, height: Dimension,
}).strict().refine((p) => boxInside(p.box, p.width, p.height),
  { message: "box must lie inside the image", path: ["box"] });
export const InstructionResponse = z.object({ instruction: Instruction }).strict();

export const EditPayload = z.object({
  slot: Slot, prompt: z.string().min(1).max(4000), mode: EditMode, intent: Intent,
  quality: z.enum(["high", "low"]), width: Dimension, height: Dimension,
}).strict();
export const EditResponse = z.object({
  image: WireImage, generatedWidth: z.number().int().positive(),
  generatedHeight: z.number().int().positive(), warnings: z.array(Note).max(8),
}).strict();

export const COMPOSITE_REASONS = ["composited", "disabled", "geometry", "small", "aspect",
  "drift", "missing_mask", "no_outside_area"] as const;
export const CompositePayload = z.object({
  width: Dimension, height: Dimension, bikeBox: Box, intent: Intent,
  generatedWidth: z.number().int().positive(), generatedHeight: z.number().int().positive(),
}).strict().refine((p) => boxInside(p.bikeBox, p.width, p.height),
  { message: "bikeBox must lie inside the image", path: ["bikeBox"] });
export const CompositeResponse = z.object({
  image: WireImage, composed: z.boolean(), aligned: z.boolean(),
  drift: z.number().min(0).max(1).nullable(), reason: z.enum(COMPOSITE_REASONS),
}).strict();

export const ActiveBuildEntry = z.object({
  itemId: Id, slot: Slot, title: Short, spec: z.array(SpecEntry).max(20),
}).strict();
export const CheckRequest = z.object({
  bike: BikeChecked, bikeConfirmed: z.literal(true), inputHash: Hash,
  items: z.array(BuildItem).min(1).max(3), activeBuild: z.array(ActiveBuildEntry).max(22),
  shopRules: z.array(Note).max(12),
}).strict();
export const CheckResponse = z.object({
  inputHash: Hash, checkedAt: z.iso.datetime(), results: z.array(FitResult).min(1).max(3),
}).strict();

export const SearchRequest = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("query"), bike: BikeChecked, slot: Slot, query: z.string().min(1).max(500),
    preferredDomains: z.array(Short).max(10),
  }).strict(),
  z.object({
    mode: z.literal("url"), bike: BikeChecked, slot: Slot, url: HttpsUrl,
    preferredDomains: z.array(Short).max(10),
  }).strict(),
]);
export const SearchResponse = z.object({
  products: z.array(Product).max(5), searchedAt: z.iso.datetime(),
  warnings: z.array(Note).max(8),
}).strict();

export const ProductImageRequest = z.object({
  url: HttpsUrl, rightsConfirmed: z.literal(true),
}).strict();
export const ProductImageResponse = z.object({
  image: WireImage, rights: z.literal("external_runtime"),
}).strict();

export const TranscribePayload = z.object({
  sessionId: Id, durationMs: z.number().int().min(1).max(30000),
}).strict();
export const TranscribeRequest = z.object({
  payload: TranscribePayload,
  audio: z.file().mime(["audio/wav", "audio/x-wav"]).max(1_500_000),
}).strict();
export const TranscribeResponse = z.object({
  text: z.string().max(4000), audioDurationMs: z.number().int().min(0).max(30000),
}).strict();

export const EmptyRequest = z.object({}).strict();
export const HealthResponse = z.object({
  ok: z.literal(true), mode: z.enum(["demo_only", "live", "mock"]),
  accountingReady: z.boolean(), apiConfigured: z.boolean(),
}).strict();
export const BudgetResponse = z.object({
  dayET: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), resetAt: z.iso.datetime(),
  liveEnabled: z.boolean(),
  spentTodayMicroUsd: z.number().int().min(0).nullable(),
  reservedTodayMicroUsd: z.number().int().min(0).nullable(),
  dailyCapMicroUsd: z.number().int().min(0),
  visitorRemainingMicroUsd: z.number().int().min(0),
  remainingEdits: z.number().int().min(0),
  features: z.object({
    composite: z.boolean(), reference: z.boolean(), search: z.boolean(), voice: z.boolean(),
  }).strict(),
  reason: Short.nullable(),
}).strict();

/** Total encoded-byte cap for any route request or response (SPEC 4). */
export const ENVELOPE_LIMIT_BYTES = 3_800_000;

// --------------------------------------------------- model output schemas

export const IdentifyModelOutput = z.object({ bike: Bike }).strict();
export const InstructionModelOutput = z.object({ instruction: Instruction }).strict();
export const ModelSource = z.object({ url: HttpsUrl, title: Short, supports: Note }).strict();
export const ProductCandidate = z.object({
  name: Short, brand: Short.nullable(), partNumber: Short.nullable(), url: HttpsUrl,
  imageUrl: HttpsUrl.nullable(), priceText: Short.nullable(), priceEurCents: Cents.nullable(),
  taxBasis: TaxBasis, approval: Approval, approvalText: Note.nullable(),
  fulfillmentRegion: z.enum(["eu", "outside_eu", "unknown"]), source: ModelSource,
}).strict();
export const SearchModelOutput = z.object({
  products: z.array(ProductCandidate).max(5), warnings: z.array(Note).max(8),
}).strict();
export const ModelFitResult = FitResult.omit({ sources: true }).extend({
  sources: z.array(ModelSource).max(8),
}).strict();
export const FitModelOutput = z.object({
  results: z.array(ModelFitResult).min(1).max(3),
}).strict();
export const RenderDescriptor = z.object({
  slot: Slot, intent: Intent, editPrompt: z.string().min(1).max(4000),
}).strict();
export const LabelPartModelOutput = z.object({
  label: Short, slot: Slot, confidence: z.number().min(0).max(1),
}).strict();

/** Strict text.format schemas sent to Spark, keyed by their format name. */
export const MODEL_FORMATS = {
  bike_identification_v1: IdentifyModelOutput,
  edit_instruction_v1: InstructionModelOutput,
  parts_search_v1: SearchModelOutput,
  fit_check_v1: FitModelOutput,
} as const;

/** JSON Schema for a Spark text.format: every key required, no extra keys. */
export function modelJsonSchema(name: keyof typeof MODEL_FORMATS): Record<string, unknown> {
  const schema = z.toJSONSchema(MODEL_FORMATS[name], { target: "draft-2020-12" }) as Record<string, unknown>;
  delete schema.$schema;
  return dropNonStandardFormats(schema) as Record<string, unknown>;
}

const STANDARD_FORMATS = new Set(["date-time", "date", "uri", "email", "uuid"]);

/** Zod emits e.g. format "starts_with" next to a pattern; that is not JSON Schema and a
 * strict validator may reject it. The pattern still carries the rule. */
function dropNonStandardFormats(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(dropNonStandardFormats);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "format" && typeof v === "string" && !STANDARD_FORMATS.has(v)) continue;
    out[k] = dropNonStandardFormats(v);
  }
  return out;
}
