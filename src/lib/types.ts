// Internal types (SPEC.md section 4). Transport types are inferred from the Zod
// schemas in contracts.ts so the two can never drift apart.
// `z.infer<typeof X>` is the TypeScript type a schema X accepts, like a
// generated dataclass for a pydantic model.
import type { z } from "zod";
import type {
  Bike, BuildItem, ErrorCode, Fee, FitResult, InspectionReview, Instruction, Point, Product,
  Settings, Slot, CompositeResponse,
} from "./contracts";

export type SlotId = z.infer<typeof Slot>;
export type BikeData = z.infer<typeof Bike>;
export type ProductData = z.infer<typeof Product>;
export type FitData = z.infer<typeof FitResult>;
export type BuildItemData = z.infer<typeof BuildItem>;
export type ShopSettings = z.infer<typeof Settings>;
export type InstructionData = z.infer<typeof Instruction>;
export type FeeData = z.infer<typeof Fee>;
export type InspectionReviewData = z.infer<typeof InspectionReview>;
export type PointData = z.infer<typeof Point>;
export type ErrorCodeId = z.infer<typeof ErrorCode>;
export type CompositeReason = z.infer<typeof CompositeResponse>["reason"];

export type ImageRef = {
  id: string; hash: string; width: number; height: number; bytes: number;
  rights: "owner" | "visitor" | "external_runtime";
};
export type StoredImage = ImageRef & { blob: Blob; lastAccessedAt: number };
/** pixels holds exactly width * height bytes, each 0 or 1. */
export type StoredMask = {
  id: string; imageHash: string; width: number; height: number;
  pixels: Uint8Array; createdAt: number;
};
export type Part = {
  id: string; slot: SlotId; label: string; box: [number, number, number, number];
  maskId: string; area: number; source: "concept" | "point";
  confidence: number | null; stale: boolean;
};
export type BikeRevision = {
  id: string; bike: BikeData; confirmed: boolean; revision: number; confirmedAt: number | null;
};
export type Version = {
  id: string; projectId: string; parentId: string | null; kind: "root" | "visual" | "sheet";
  image: ImageRef; cutoutImageId: string | null; bikeMaskId: string | null; parts: Part[];
  items: BuildItemData[]; fees: FeeData[]; inspectionReview: InspectionReviewData | null;
  change: { slot: SlotId; itemId: string; instruction: string;
    mode: "text" | "paint" | "reference" } | null;
  composed: boolean; aligned: boolean; drift: number | null;
  fallbackReason: string | null; createdAt: number;
};
export type Project = {
  id: string; name: string; rootVersionId: string; headVersionId: string;
  bikeRevision: BikeRevision; settingsId: string; createdAt: number; updatedAt: number;
};
export type PendingEdit = {
  slot: SlotId; selectedPartId: string; mode: "text" | "paint" | "reference";
  referenceImageId: string | null; requestId: string; projectId: string; expectedHeadId: string;
  preview: ImageRef | null; instruction: InstructionData;
  state: "preparing" | "generating" | "segmenting" | "compositing" | "review" | "error";
};
export type QuoteLine = {
  itemId: string; partNetCents: number | null; laborNetCents: number | null;
  netCents: number | null; unresolved: string[];
};
export type Quote = {
  lines: QuoteLine[]; feeNetCents: number | null; knownSubtotalNetCents: number;
  netCents: number | null; vatCents: number | null; grossCents: number | null;
  incomplete: boolean; inputHash: string; generatedAt: number;
};
export type CacheEntry = {
  key: string; blobIds: string[]; value: unknown; bytes: number;
  createdAt: number; lastAccessedAt: number; expiresAt: number | null;
};
export type DemoManifest = {
  schemaVersion: 1; cachedAt: string; promptVersions: string[]; project: Project;
  versions: Version[]; assets: { id: string; path: string; hash: string; mime: string }[];
  quotePath: string;
};
export type BudgetReservation = {
  requestId: string; visitorHash: string; dayET: string; route: string; model: string;
  reservedMicroUsd: number; chargedMicroUsd: number;
  state: "reserved" | "settled" | "unknown"; attempts: number;
};

/** Server normalization result (SPEC 7). quality is the WebP quality that fit the byte limit. */
export type NormalizedImage = {
  bytes: Uint8Array; width: number; height: number; hash: string; quality: number; warnings: string[];
};
export type NormalizeOptions = { maxEdge?: number; maxBytes?: number };
/** A normalized photo on the client: the decoded WireImage as a Blob plus its metadata. */
export type NormalizedPhoto = { blob: Blob; width: number; height: number; hash: string; warnings: string[] };

/** A binary mask over the whole normalized image: pixels[y * width + x] is 0 or 1. */
export type BinaryMask = { width: number; height: number; pixels: Uint8Array };
/** The photo a mask or request belongs to; hash ties masks to one exact raster. */
export type PhotoRef = { blob: Blob; width: number; height: number; hash: string };
/** One decoded SAM object in full-image coordinates. */
export type SegmentedObject = { mask: BinaryMask; box: [number, number, number, number]; confidence: number | null };
/** A selectable part on one photo (PLAN 9.3). Concept parts have stable IDs "phrase:slot". */
export type MapPart = {
  id: string; slot: SlotId; label: string; mask: BinaryMask; area: number;
  box: [number, number, number, number]; source: "concept" | "point"; confidence: number | null;
  stale: boolean; imageHash: string;
};
export type PhraseStatus = "pending" | "found" | "none" | "needs_point" | "needs_facing" | "error";
