// Internal types (SPEC.md section 4). Transport types are inferred from the Zod
// schemas in contracts.ts so the two can never drift apart.
// `z.infer<typeof X>` is the TypeScript type a schema X accepts, like a
// generated dataclass for a pydantic model.
import type { z } from "zod";
import type {
  Bike, BuildItem, ErrorCode, Fee, FitResult, InspectionReview, Instruction, Point, Product,
  Settings, Slot, CompositeResponse, EditMode,
  ImageRef as ImageRefSchema, StoredImage as StoredImageSchema, StoredMask as StoredMaskSchema,
  Part as PartSchema, BikeRevision as BikeRevisionSchema, Version as VersionSchema,
  Project as ProjectSchema, CacheEntry as CacheEntrySchema, MetaRecord as MetaRecordSchema,
  ProjectSnapshot as ProjectSnapshotSchema, SnapshotImage as SnapshotImageSchema, SnapshotMask as SnapshotMaskSchema,
} from "./contracts";

export type EditModeId = z.infer<typeof EditMode>;
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

// Persisted types are inferred from the validators in contracts.ts (SPEC 9).
export type ImageRef = z.infer<typeof ImageRefSchema>;
export type StoredImage = z.infer<typeof StoredImageSchema>;
/** pixels holds exactly width * height bytes, each 0 or 1 (checked by the schema). */
export type StoredMask = z.infer<typeof StoredMaskSchema>;
export type Part = z.infer<typeof PartSchema>;
export type BikeRevision = z.infer<typeof BikeRevisionSchema>;
export type Version = z.infer<typeof VersionSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;
export type SnapshotImage = z.infer<typeof SnapshotImageSchema>;
export type SnapshotMask = z.infer<typeof SnapshotMaskSchema>;
/** A stored mask without its pixel bytes. */
export type MaskMeta = Omit<StoredMask, "pixels">;
export type MetaRecordData = z.infer<typeof MetaRecordSchema>;
export type PendingEdit = {
  slot: SlotId; selectedPartId: string; mode: "text" | "paint" | "reference";
  referenceImageId: string | null; requestId: string; projectId: string; expectedHeadId: string;
  preview: ImageRef | null; instruction: InstructionData;
  state: "preparing" | "generating" | "segmenting" | "compositing" | "review" | "error";
};
export type QuoteLine = {
  itemId: string; label: string; partNetCents: number | null; laborNetCents: number | null;
  netCents: number | null; unresolved: string[];
  /** True when the minutes came from the shop's slot default, not from the item. */
  defaultMinutes: boolean;
};
export type Quote = {
  lines: QuoteLine[]; feeNetCents: number | null; knownSubtotalNetCents: number;
  /** Net that VAT applies to: total net without official_fee lines. Null when incomplete. */
  taxableNetCents: number | null; officialFeeCents: number | null;
  netCents: number | null; vatCents: number | null; grossCents: number | null;
  incomplete: boolean; exclusions: string[]; staleFitItemIds: string[];
  inputHash: string; generatedAt: number;
};
export type CacheEntry = z.infer<typeof CacheEntrySchema>;
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
  box: [number, number, number, number]; source: "concept" | "point" | "box"; confidence: number | null;
  stale: boolean; imageHash: string;
  /** Box parts only: the part is not on the bike yet (for example a sissy bar), so the box marks where it goes. */
  absent?: boolean;
};
export type PhraseStatus = "pending" | "found" | "none" | "needs_point" | "needs_facing" | "error" | "stale";
