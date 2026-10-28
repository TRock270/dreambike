# DreamBike implementation specification

Contract version 1. October 27, 2026. Read PLAN.md for intent and TASKS.md for sequence. This file specifies future code; it does not contain an implementation. No model calls, fixture tests, builds, or deployments were performed during this handoff. Documentation-checked syntax and untested behavior are different evidence levels.

## 1. Repository tree

Paths below are relative to the DreamBike repo. Create files in the ticket that owns them. Preserve the existing review documents as planning evidence.

| Path | Purpose |
| --- | --- |
| PLAN.md, SPEC.md, TASKS.md, CLAUDE.md | Product decisions, contracts, execution order, session instructions |
| .env.example, .gitignore | Placeholder configuration and exclusions; never copy a real secret into an example |
| package.json, package-lock.json, tsconfig.json | npm commands, locked dependencies, strict TypeScript |
| next.config.ts, next-env.d.ts | Next configuration and generated types |
| eslint.config.mjs, postcss.config.mjs, vitest.config.ts | Lint, Tailwind/PostCSS, offline tests |
| README.md, LICENSE, CREDITS.md | Setup, MIT code terms, asset and library provenance |
| HACKATHON_GUIDELINES.md | Existing rights, spending, and submission reference |
| RULES.md | Existing private local source, gitignored |
| budget/reserve.lua, budget/settle.lua | Shared atomic Redis policy, loaded by Python and Node; bundle as server assets |
| docs/api-evidence.md | Sanitized smoke results, installed versions, timings, and U01–U10 decisions |
| docs/submission.md, docs/demo-script.md | Actual live/repo/video URLs, checklist, 3-minute recording script |
| src/app/layout.tsx, src/app/page.tsx | Font loading and desktop app shell |
| src/app/globals.css | Tailwind import and semantic token mapping |
| src/app/api/*/route.ts | Only the 12 handlers in section 5; Node runtime |
| src/components/ | Named UI components in section 10 |
| src/components/ui/ | Small accessible primitives; native controls first |
| src/lib/contracts.ts | Zod transport/model schemas in section 4 |
| src/lib/types.ts | Internal types and inferred aliases in section 4 |
| src/lib/slots.ts | Stable slot IDs, phrases, colors, and default minutes |
| src/lib/coordinates.ts | Display-to-normalized point conversion and hit testing |
| src/lib/db.ts, src/lib/project.ts | IndexedDB transactions and version/head operations |
| src/lib/cache.ts | Content hashes, derivation keys, TTL, storage eviction |
| src/lib/quote.ts, src/lib/pdf.ts | Integer estimate math and client PDF layout |
| src/lib/errors.ts | Safe shared error codes and user text |
| src/lib/server/config.ts | Server environment validation, feature flags, server-only import |
| src/lib/server/meta.ts | Bearer HTTP client and functions in section 6; server-only import |
| src/lib/server/images.ts | sharp decode/normalize/mask/composite helpers |
| src/lib/server/budget.ts | Atomic Redis reservations, limits, and content-free ledger |
| src/lib/server/fetch-product.ts | Optional allowlisted URL and image retrieval |
| src/lib/mocks/ | Labeled response JSON and pointers to cleared owned demo images |
| src/styles/tokens.css | Every Nordlicht color, type, spacing, and radius value |
| prompts/*.v1.md | Versioned prompt templates from section 8 |
| public/fonts/ | Licensed IBM Plex TTF files used by PDF; include OFL text |
| public/demo/ | Rights-cleared precomputed manifest, v0/v1/v2 WebP, masks, example PDF |
| fixtures/ | Five private owned source photos and expected.json; gitignored |
| spike/requirements.txt, spike/common.py | Python dependencies, env, HTTP, budget, and shared assertions |
| spike/run_all.py | Modes spike/smoke, fixture selection, shared ticket cap |
| spike/responses_sam.py, spike/responses_spark.py | Separate SAM and Spark profiles of POST /responses |
| spike/images_edits.py, spike/asr_transcribe.py, spike/files.py | One executable per other Meta endpoint |
| spike/local_images.py, spike/deployment.py | Offline image checks and no-paid-call deployment checks |
| spike/out/ | Local artifacts, actual call ledger, timings; gitignored |
| tests/ | Offline image/coordinates, state, quote, contract, and budget-race tests |
| consent/ | Private owner-written consent; gitignored |

No server project database, worker queue, public self-test handler, or file upload route. No photos are supplied by this handoff. Public demo assets are created only after rights review.

## 2. Dependencies and commands

Use Node 22 LTS, npm, and Python 3.11. Resolve the latest patched release inside each range at ticket 1, record it, and commit the lockfile. Ranges are deliberate major/minor bounds, not claims that an old patch is secure. No application dependencies are installed by this handoff. Check published unpacked sizes first; CLAUDE.md requires owner approval above 1 MB. Group those package decisions for the owner before installation.

| Package | Allowed range | Use |
| --- | --- | --- |
| next, eslint-config-next | >=16.4.3 <17, matching versions | App Router, Vercel build, lint rules |
| react, react-dom | >=19.2 <20, matching versions compatible with Next | UI |
| zod | >=4.1 <5 | Route validation, model validation, JSON Schema generation |
| sharp | >=0.35.5 <0.36 (was >=0.34 <0.35; owner-approved change 2026-10-27 because Next 16.4.3 depends on sharp ^0.35.5) | Server image work on Node/M1 |
| @meta-sam/parser | >=0.1.0 <0.2 | SAM parsing, confidence, prompt builder; exceeds 0.0.13 minimum |
| idb | >=8 <9 | Thin IndexedDB wrapper |
| pdf-lib | >=1.17.1 <2 | Client estimate PDF |
| @pdf-lib/fontkit | >=1.1.1 <2 | Embed Plex fonts, including German terms and EUR |
| server-only | 0.0.1 | Fail client imports of server modules |
| typescript | >=5.9 <6 | Static checks |
| @types/node | >=22 <23 | Node 22 types |
| @types/react, @types/react-dom | >=19 <20 | React types |
| eslint | >=9 <10 | ESLint CLI |
| tailwindcss, @tailwindcss/postcss | >=4.1 <5, matching versions | Token-driven CSS |
| vitest | >=4 <5 | Offline tests in Node |

Use native fetch for Meta and Redis REST. No OpenAI SDK, Redis SDK, state library, HEIC converter, UI suite, or icon package. Draw small icons with original inline SVG, labeled text, or CSS. Fonts use next/font/google for UI; obtain the same licensed TTF weights for PDF. Cache those public font files so PDF export has no network dependency. Record their license and source in CREDITS.md.

Python requirements configuration:

```text
requests>=2.32.5,<3
Pillow>=11.3,<13
numpy>=2.2,<3
meta-sam-parser>=0.1.0,<0.2
python-dotenv>=1.1,<2
```

If the parser 0.1 line is unavailable, do not silently invent its API. U01 records an available release >=0.0.13 (TS) and >=0.0.6 (Python), then explicitly revises the builder dependency and tests. Do not add pillow-heif for the chosen reject-HEIC MVP.

package.json scripts configuration:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": { "node": ">=22.9 <23" }
}
```

ESLint ignores .next, spike/out, and generated files. Tests make no live requests. Next 16 uses ESLint CLI, not next lint. Never run create-next-app in a way that overwrites the planning files. The [Next upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16) supports the major version choice; registry resolution and M1 build still belong to ticket 1.

## 3. Environment and configuration

The root .env.example is the authoritative listing. Copy it to .env.local. Existing .env is left untouched. Python loads .env.local first and falls back to .env. Never print either file. Nothing is prefixed NEXT_PUBLIC_. The browser receives only safe feature/budget fields from GET /api/budget.

| Variables | Rules |
| --- | --- |
| MODEL_API_KEY | Server-only Meta key; read in meta.ts and local Python config only |
| MUSE_MODEL | Exactly muse-spark-1.3-contributor in this scope; changing terms/model needs owner review |
| LIVE_API_ENABLED, MOCK | Defaults false and 0; local UI can use MOCK=1; production rejects MOCK=1 |
| COMPOSITE_ENABLED, REFERENCE_MODE_ENABLED | Defaults true; disable with a visible fallback |
| SEARCH_ENABLED, VOICE_ENABLED | Defaults false; optional tickets and gates must pass |
| APP_ORIGIN | Exact deployment origin; localhost:3000 in local development |
| UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN | Server-only REST endpoint and token; required for any live calls |
| VISITOR_HASH_SECRET | Server-only random secret, at least 32 bytes; HMAC visitor identifiers |
| PRICING_VERIFIED_AT | ISO date/time of owner-reviewed pricing evidence; blank disables paid calls |
| SEARCH_QUERY_RESERVE | Verified maximum billable queries per grounded request; blank disables grounded calls |
| DAILY_CAP_USD, VISITOR_DAILY_CAP_USD | Defaults 5 and 0.50; parse to exact integer microdollars |
| VISITOR_DAILY_*_LIMIT | Edit 5, SAM 80, Spark 12, ASR 3 |
| PROJECT_HARD_CAP_USD, DEVELOPMENT_STOP_USD, TICKET_CAP_USD | Defaults 100, 50, 5; cannot be overridden by client settings |
| BUDGET_PHASE | development or demo; owner reconciles ledger before demo phase |
| PUBLIC_SHOP_DOMAINS | Exact lowercase HTTPS hosts for optional fetches; blank disables remote fetching |

Production refuses live mode if a required secret, pricing gate, or Redis health check is missing. Health may still report the cached demo as healthy. Local paid scripts obey the same caps and use the same project ledger, not a separate uncounted budget.

## 4. Shared schemas and types

Create schemas once in contracts.ts. Types use z.infer in types.ts. All transport objects are strict. Dates are ISO 8601 strings; local createdAt values are epoch milliseconds. IDs are UUIDs unless stated otherwise. Hashes are lowercase SHA-256 hex. Monetary numbers are nonnegative integers: EUR cents or USD microdollars. Labor uses integer minutes.

The following are Zod schema declarations, not application implementation. Named schemas are shared by routes, prompts, mocks, and persisted migrations. Additional cross-field checks follow the declarations.

```ts
const Id = z.uuid();
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Short = z.string().min(1).max(200);
const Note = z.string().max(2000);
const Cents = z.number().int().min(0).max(100_000_000);
const Dimension = z.number().int().min(1).max(2048);
const HttpsUrl = z.url().startsWith("https://").max(2048);
const Slot = z.enum([
  "wheel_front", "wheel_rear", "fork", "tank", "handlebar", "exhaust",
  "air_cleaner", "seat", "headlight", "fender_front", "fender_rear",
  "frame", "engine", "forward_controls", "mirrors", "turn_signals",
  "saddlebag", "fairing", "primary_cover", "sissy_bar", "grips", "custom"
]);
const Box = z.tuple([z.number().int().min(0), z.number().int().min(0),
  z.number().int().min(1), z.number().int().min(1)]);
const Point = z.object({ x: z.number().int().min(0), y: z.number().int().min(0),
  label: z.enum(["positive", "negative"]) }).strict();
const SpecEntry = z.object({ key: Short, value: Short }).strict();
const Approval = z.enum(["abe", "e_mark", "teilegutachten", "none", "unknown"]);
const Source = z.object({ url: HttpsUrl, title: Short, accessedAt: z.iso.datetime(),
  supports: Note }).strict();
const Bike = z.object({
  make: Short.nullable(), model: Short.nullable(),
  family: z.enum(["sportster", "softail", "dyna", "touring", "street", "other", "unknown"]),
  engine: Short.nullable(), yearFrom: z.number().int().min(1900).max(2100).nullable(),
  yearTo: z.number().int().min(1900).max(2100).nullable(),
  abs: z.enum(["yes", "no", "unknown"]), style: Short.nullable(),
  facing: z.enum(["left", "right", "unknown"]),
  confidence: z.number().min(0).max(1), limitations: z.array(Note).max(12)
}).strict();
const Product = z.object({
  id: Id, name: Short, brand: Short.nullable(), partNumber: Short.nullable(),
  url: HttpsUrl, imageUrl: HttpsUrl.nullable(), priceText: Short.nullable(),
  priceEurCents: Cents.nullable(), taxBasis: z.enum(["gross", "net", "unknown"]),
  approval: Approval, approvalText: Note.nullable(),
  fulfillmentRegion: z.enum(["eu", "outside_eu", "unknown"]),
  source: Source, linkState: z.enum(["reachable", "unchecked", "unreachable"])
}).strict();
const FitResult = z.object({
  itemId: Id, status: z.enum(["ok", "verify", "problem"]), approval: Approval,
  documentCoverage: z.enum(["covered", "not_covered", "unknown"]),
  inspection: z.enum(["none", "aenderungsabnahme", "einzelabnahme", "unknown"]),
  eintragung: z.enum(["required", "not_required", "unknown"]),
  carryDocuments: z.enum(["required", "not_required", "unknown"]),
  reasons: z.array(Note).min(1).max(12), toMeasure: z.array(Note).max(12),
  extraParts: z.array(Short).max(12), conditions: z.array(Note).max(12),
  sources: z.array(Source).max(8), confidence: z.number().min(0).max(1)
}).strict();
const Instruction = z.object({
  title: Short, editPrompt: z.string().min(1).max(4000),
  spec: z.array(SpecEntry).max(20), intent: z.enum(["paint", "replace", "geometry"]),
  warnings: z.array(Note).max(8)
}).strict();
const BuildItem = z.object({
  zeroLaborConfirmed: z.boolean(), mechanicNotes: Note, fitReviewedHash: Hash.nullable(),
  id: Id, slot: Slot, title: Short, spec: z.array(SpecEntry).max(20),
  intent: z.enum(["paint", "replace", "geometry"]), product: Product.nullable(),
  costKind: z.enum(["part", "labor_only"]), partPriceCents: Cents.nullable(),
  taxBasis: z.enum(["gross", "net", "unknown"]), laborMinutes: z.number().int().min(0).max(10080).nullable(),
  fit: FitResult.nullable(), fitInputHash: Hash.nullable(), fitCheckedAt: z.iso.datetime().nullable(),
  originVersionId: Id
}).strict();
const Fee = z.object({ id: Id, label: Short,
  kind: z.enum(["aenderungsabnahme", "einzelabnahme", "other"]),
  netCents: Cents.nullable(), itemIds: z.array(Id).max(22), confirmed: z.boolean() }).strict();
const InspectionReview = z.object({ fitInputHash: Hash,
  decision: z.enum(["none", "fees_added", "unresolved"]), notes: Note,
  reviewedAt: z.iso.datetime() }).strict();
const Settings = z.object({
  shopConfirmed: z.boolean(), shopName: Short, logoImageId: Id.nullable(), hourlyRateNetCents: Cents.nullable(),
  currency: z.literal("EUR"), vatBasisPoints: z.literal(1900),
  laborBySlot: z.array(z.object({ slot: Slot, minutes: z.number().int().min(0).max(10080) }).strict()).max(22),
  aenderungsabnahmeNetCents: Cents.nullable(), einzelabnahmeNetCents: Cents.nullable(),
  preferredShopDomains: z.array(z.string().regex(/^[a-z0-9.-]+$/).max(253)).max(10),
  shopRules: z.array(Note).max(12), quoteNotes: Note, demoRates: z.boolean()
}).strict();
const WireImage = z.object({
  mime: z.literal("image/webp"), dataUrl: z.string().startsWith("data:image/webp;base64,").max(1_666_800),
  width: Dimension, height: Dimension, hash: Hash
}).strict();
const WireMask = z.object({
  encoding: z.literal("png_binary_full_image"), width: Dimension, height: Dimension,
  dataUrl: z.string().startsWith("data:image/png;base64,").max(666_800)
}).strict();
const SegmentObject = z.object({ objectId: z.string().regex(/^[0-9]+$/),
  box: Box, mask: WireMask, confidence: z.number().min(0).max(1).nullable() }).strict();
const ImageFile = z.file().mime(["image/webp"]).max(1_250_000);
const MaskFile = z.file().mime(["image/png"]).max(500_000);
const ErrorCode = z.enum(["INVALID_REQUEST", "INVALID_IMAGE", "UNSUPPORTED_FORMAT", "TOO_LARGE",
  "NO_RESULT", "MASK_PLACEMENT_UNKNOWN", "UPSTREAM_TIMEOUT", "UPSTREAM_REJECTED",
  "UPSTREAM_UNAVAILABLE", "SCHEMA_INVALID", "BUDGET_EXCEEDED", "RATE_LIMITED",
  "LIVE_DISABLED", "ACCOUNTING_UNAVAILABLE", "REQUEST_IN_PROGRESS", "RESULT_NOT_CACHED",
  "FEATURE_DISABLED", "FETCH_BLOCKED", "STORAGE_FULL", "FORBIDDEN"]);
const ErrorResponse = z.object({ error: z.object({ code: ErrorCode,
  message: Short, retryable: z.boolean(), requestId: Id,
  retryAfterSeconds: z.number().int().min(0).nullable() }).strict() }).strict();
```

For persisted settings, each slot occurs at most once. For boxes use [left, top, right, bottom), with positive area within the image. For points use 0 <= x < width and 0 <= y < height; at least one positive point is required. YearFrom cannot exceed yearTo. Confidence must never replace missing evidence. Decode files and verify their real MIME, dimensions, animation count, and byte length, not just the supplied MIME. Every response also passes a total encoded-byte check of 3,800,000 bytes.

Shared aliases and internal model:

```ts
type SlotId = z.infer<typeof Slot>;
type BikeData = z.infer<typeof Bike>;
type ProductData = z.infer<typeof Product>;
type FitData = z.infer<typeof FitResult>;
type BuildItemData = z.infer<typeof BuildItem>;
type ShopSettings = z.infer<typeof Settings>;
type InstructionData = z.infer<typeof Instruction>;
type ImageRef = { id: string; hash: string; width: number; height: number;
  bytes: number; rights: "owner" | "visitor" | "external_runtime" };
type StoredImage = ImageRef & { blob: Blob; lastAccessedAt: number };
type StoredMask = { id: string; imageHash: string; width: number; height: number;
  pixels: Uint8Array; createdAt: number };
type Part = { id: string; slot: SlotId; label: string;
  box: [number, number, number, number]; maskId: string; area: number;
  source: "concept" | "point"; confidence: number | null; stale: boolean };
type BikeRevision = { id: string; bike: BikeData; confirmed: boolean;
  revision: number; confirmedAt: number | null };
type Version = { id: string; projectId: string; parentId: string | null;
  kind: "root" | "visual" | "sheet"; image: ImageRef; cutoutImageId: string | null;
  bikeMaskId: string | null; parts: Part[]; items: BuildItemData[]; fees: z.infer<typeof Fee>[];
  inspectionReview: z.infer<typeof InspectionReview> | null;
  change: { slot: SlotId; itemId: string; instruction: string; mode: "text" | "paint" | "reference" } | null;
  composed: boolean; aligned: boolean; drift: number | null;
  fallbackReason: string | null; createdAt: number };
type Project = { id: string; name: string; rootVersionId: string; headVersionId: string;
  bikeRevision: BikeRevision; settingsId: string; createdAt: number; updatedAt: number };
type PendingEdit = { slot: SlotId; selectedPartId: string;
  mode: "text" | "paint" | "reference"; referenceImageId: string | null;
  requestId: string; projectId: string; expectedHeadId: string;
  preview: ImageRef | null; instruction: InstructionData;
  state: "preparing" | "generating" | "segmenting" | "compositing" | "review" | "error" };
type QuoteLine = { itemId: string; partNetCents: number | null;
  laborNetCents: number | null; netCents: number | null; unresolved: string[] };
type Quote = { lines: QuoteLine[]; feeNetCents: number | null;
  knownSubtotalNetCents: number; netCents: number | null; vatCents: number | null;
  grossCents: number | null; incomplete: boolean; inputHash: string; generatedAt: number };
type CacheEntry = { key: string; blobIds: string[]; value: unknown;
  bytes: number; createdAt: number; lastAccessedAt: number; expiresAt: number | null };
type DemoManifest = { schemaVersion: 1; cachedAt: string; promptVersions: string[];
  project: Project; versions: Version[];
  assets: { id: string; path: string; hash: string; mime: string }[]; quotePath: string };
type BudgetReservation = { requestId: string; visitorHash: string; dayET: string;
  route: string; model: string; reservedMicroUsd: number; chargedMicroUsd: number;
  state: "reserved" | "settled" | "unknown"; attempts: number };
```

Version images are blobs by reference, not copied inside JSON. Stored masks have exactly width × height bytes containing 0 or 1. Alpha masks used for display/blending are separate transient 0–255 arrays. Construct persisted validators for these internal types too; reject bad schema versions before loading a project. Runtime-only blobs never appear in prompt JSON. Demo manifests replace blob contents with relative public asset paths and validate same-origin paths under /demo/.

## 5. Route handlers

All handlers use Node runtime. POSTs require matching Origin and a same-origin session cookie. Meta handlers also require request header X-Request-Id as UUID. GET /api/budget issues a random signed HttpOnly SameSite=Lax cookie. No browser key or owner key is accepted. There is no unauthenticated bypass parameter. All responses use Cache-Control: no-store, except static public demo assets. A route validates before reserving paid usage.

For multipart requests, parse the payload part as JSON, then validate it with the named Payload schema. Validate each named file separately. These named parts form the route's request schema; unexpected fields are rejected. JSON requests use the named Request schema directly. There are no base64 images inside inbound JSON. Outbound WireImage and WireMask data URLs are decoded to browser blobs immediately.

```ts
const NormalizeRequest = z.object({ photo: z.file()
  .mime(["image/jpeg", "image/png", "image/webp"]).max(1_250_000) }).strict();
const NormalizeResponse = z.object({ image: WireImage, warnings: z.array(Note).max(8) }).strict();
const SegmentPayload = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("concept"), width: Dimension, height: Dimension,
    phrase: z.string().min(1).max(80) }).strict(),
  z.object({ mode: z.literal("points"), width: Dimension, height: Dimension,
    points: z.array(Point).min(1).max(8) }).strict()
]);
const SegmentResponse = z.object({ width: Dimension, height: Dimension,
  objects: z.array(SegmentObject).max(16), complete: z.boolean(),
  warnings: z.array(Note).max(8) }).strict();
const IdentifyPayload = z.object({ width: Dimension, height: Dimension }).strict();
const IdentifyResponse = z.object({ bike: Bike }).strict();
const InstructionPayload = z.object({ slot: Slot, box: Box, bike: Bike,
  mode: z.enum(["text", "paint", "reference"]),
  text: z.string().min(1).max(2000), width: Dimension, height: Dimension }).strict();
const InstructionResponse = z.object({ instruction: Instruction }).strict();
const EditPayload = z.object({ slot: Slot, prompt: z.string().min(1).max(4000),
  mode: z.enum(["text", "paint", "reference"]),
  intent: z.enum(["paint", "replace", "geometry"]),
  quality: z.enum(["high", "low"]), width: Dimension, height: Dimension }).strict();
const EditResponse = z.object({ image: WireImage,
  generatedWidth: z.number().int().positive(), generatedHeight: z.number().int().positive(),
  warnings: z.array(Note).max(8) }).strict();
const CompositePayload = z.object({ width: Dimension, height: Dimension,
  bikeBox: Box, intent: z.enum(["paint", "replace", "geometry"]),
  generatedWidth: z.number().int().positive(), generatedHeight: z.number().int().positive()
}).strict();
const CompositeResponse = z.object({ image: WireImage, composed: z.boolean(),
  aligned: z.boolean(), drift: z.number().min(0).max(1).nullable(),
  reason: z.enum(["composited", "disabled", "geometry", "small", "aspect", "drift",
    "missing_mask", "no_outside_area"]) }).strict();
const CheckRequest = z.object({ bike: Bike, bikeConfirmed: z.literal(true),
  inputHash: Hash, items: z.array(BuildItem).min(1).max(3),
  activeBuild: z.array(z.object({ itemId: Id, slot: Slot, title: Short,
    spec: z.array(SpecEntry).max(20) }).strict()).max(22),
  shopRules: z.array(Note).max(12) }).strict();
const CheckResponse = z.object({ inputHash: Hash, checkedAt: z.iso.datetime(),
  results: z.array(FitResult).min(1).max(3) }).strict();
const SearchRequest = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("query"), bike: Bike, slot: Slot,
    query: z.string().min(1).max(500), preferredDomains: z.array(Short).max(10) }).strict(),
  z.object({ mode: z.literal("url"), bike: Bike, slot: Slot,
    url: HttpsUrl, preferredDomains: z.array(Short).max(10) }).strict()
]);
const SearchResponse = z.object({ products: z.array(Product).max(5),
  searchedAt: z.iso.datetime(), warnings: z.array(Note).max(8) }).strict();
const ProductImageRequest = z.object({ url: HttpsUrl,
  rightsConfirmed: z.literal(true) }).strict();
const ProductImageResponse = z.object({ image: WireImage,
  rights: z.literal("external_runtime") }).strict();
const TranscribePayload = z.object({ sessionId: Id,
  durationMs: z.number().int().min(1).max(30000) }).strict();
const TranscribeRequest = z.object({ payload: TranscribePayload,
  audio: z.file().mime(["audio/wav", "audio/x-wav"]).max(1_500_000) }).strict();
const TranscribeResponse = z.object({ text: z.string().max(4000),
  audioDurationMs: z.number().int().min(0).max(30000) }).strict();
const EmptyRequest = z.object({}).strict();
const HealthResponse = z.object({ ok: z.literal(true),
  mode: z.enum(["demo_only", "live", "mock"]),
  accountingReady: z.boolean(), apiConfigured: z.boolean() }).strict();
const BudgetResponse = z.object({ dayET: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  resetAt: z.iso.datetime(), liveEnabled: z.boolean(),
  spentTodayMicroUsd: z.number().int().min(0).nullable(), reservedTodayMicroUsd: z.number().int().min(0).nullable(),
  dailyCapMicroUsd: z.number().int().min(0), visitorRemainingMicroUsd: z.number().int().min(0),
  remainingEdits: z.number().int().min(0),
  features: z.object({ composite: z.boolean(), reference: z.boolean(),
    search: z.boolean(), voice: z.boolean() }).strict(),
  reason: Short.nullable() }).strict();
```

Common successful status is 200. Missing body on the two GETs maps to EmptyRequest; query parameters are rejected. In unavailable accounting mode BudgetResponse reports liveEnabled=false, spent/reserved=null, and remaining allowance zero. Display unknown spend as unavailable, never as zero spent.

| Method and path | Request / parts | Response | Meta function and endpoint | Total route deadline / Vercel maxDuration |
| --- | --- | --- | --- | --- |
| POST /api/normalize | NormalizeRequest photo | NormalizeResponse | None | 10s / 15s |
| POST /api/segment | payload: SegmentPayload; image: ImageFile | SegmentResponse | segmentConcept or segmentPoints, SAM /responses | 40s / 45s |
| POST /api/identify | payload: IdentifyPayload; image: ImageFile | IdentifyResponse | identifyBike, Spark /responses | 40s / 45s |
| POST /api/instruction | payload: InstructionPayload; reference: ImageFile only in reference mode | InstructionResponse | buildInstruction, Spark /responses; optional reference vision input | 40s / 45s |
| POST /api/edit | payload: EditPayload; base: ImageFile; reference: ImageFile only in reference mode | EditResponse | editImage or composeImage, /images/edits | 100s / 120s |
| POST /api/composite | payload: CompositePayload; base and edited: ImageFile; oldMask and newMask: MaskFile optional | CompositeResponse | None | 15s / 20s |
| POST /api/check | CheckRequest JSON <=100 KB | CheckResponse | checkFit, Spark /responses with search | 70s / 90s |
| GET /api/budget | EmptyRequest | BudgetResponse | None; Redis only | 3s / 5s |
| GET /api/health | EmptyRequest | HealthResponse | None; no paid probe | 3s / 5s |
| POST /api/search-parts | SearchRequest JSON <=20 KB | SearchResponse | searchParts, Spark /responses with search | 70s / 90s |
| POST /api/product-image | ProductImageRequest JSON <=8 KB | ProductImageResponse | None; optional allowlisted image fetch | 10s / 15s |
| POST /api/transcribe | TranscribeRequest multipart | TranscribeResponse | transcribe, /asr/transcribe | 40s / 45s |

Reference mode requires exactly one reference; other modes reject it. instruction text in reference mode is the mechanic's description of what the reference shows; it must not be empty. The selected slot and box are in the current base image, although that image is not sent to instruction. The edit prompt is untrusted user text even if first produced by Spark; fixed server instructions and model/tool choices cannot be overridden by it. Geometry intent is enforced for fork/wheel replacements and handlebar height changes.

The server checks declared dimensions against decoded image dimensions. /api/edit stores generatedWidth/Height from the actual raw upstream bitmap before bounded encoding. Composite compares actual submitted base/edited sizes too. A client could tamper with quality metadata, so never use it for a security or cost decision. If aspect is acceptable, the edited copy is resized to base dimensions before new SAM segmentation. Otherwise skip composition and present the edited image at its own dimensions. A full fallback version uses those real dimensions and invalidates inherited masks.

All handlers can return ErrorResponse. HTTP mapping: 400 INVALID_REQUEST or INVALID_IMAGE; 403 FORBIDDEN or FETCH_BLOCKED; 413 TOO_LARGE; 415 UNSUPPORTED_FORMAT; 422 NO_RESULT or MASK_PLACEMENT_UNKNOWN; 409 REQUEST_IN_PROGRESS or RESULT_NOT_CACHED; 429 BUDGET_EXCEEDED or RATE_LIMITED; 502 UPSTREAM_REJECTED, UPSTREAM_UNAVAILABLE, or SCHEMA_INVALID; 503 LIVE_DISABLED, FEATURE_DISABLED, or ACCOUNTING_UNAVAILABLE; 504 UPSTREAM_TIMEOUT. UI-only STORAGE_FULL is never returned by the server. If segmentation PNGs would exceed the encoded response cap, return the largest-area objects that fit, complete=false, and a warning to select omitted parts by point. Never truncate an individual mask. Empty SAM detections return objects=[], and empty search returns products=[], both 200. Health returns 200 when demo is usable; it does not claim model reachability.

Normalize adds format/corrupt/size errors. Segment adds unknown placement/schema errors. Identify/instruction/check/search add schema and upstream refusal errors. Edit adds rejected/no-image/invalid-image errors. Composite adds invalid-mask errors and normal 200 fallback reasons. Product image adds blocked/timeout/fetch errors. Transcribe adds WAV-format/duration/schema errors. Budget/health report disabled state without leaking secrets or raw connection errors.

Retry policy for every handler: no client automatic retry and no retry of ambiguous upstream timeouts, network resets, 5xx, refusals, or schema failures. A definite upstream HTTP 429 may retry once, with Retry-After (or 1s plus up to 250ms jitter), only within the total deadline and a new reserved attempt. Report RATE_LIMITED otherwise. Local CPU failures and allowlisted fetch failures have no automatic retry. GETs can be refreshed manually. Aborting the browser request may not cancel upstream billing; keep its reservation.

Duplicate request IDs are tied to an HMAC of payload bytes and visitor ID in Redis. A pending duplicate returns 409 REQUEST_IN_PROGRESS; a completed duplicate returns 409 RESULT_NOT_CACHED. Do not replay a paid call. Redis never stores image/model response bodies, so a lost result cannot be recovered there. The browser retains successful results before committing the version; an explicit new attempt uses a new request ID and counts again.

## 6. Meta client and exact wire contracts

Use native fetch in server-only meta.ts. Each function receives a CallContext whose reservation was acquired before network dispatch. No Meta tool, model name, origin, key, or budget comes from the browser. Body fields not listed here are omitted. All JSON calls use Content-Type application/json and Authorization: Bearer from MODEL_API_KEY. SAM adds Accept: text/event-stream. Other JSON calls use Accept: application/json. Each deadline includes response body reading. Never log prompt or response bodies.

Function signatures:

```ts
type NormalizedInput = { bytes: Uint8Array; width: number; height: number; dataUrl: string };
type CallContext = { requestId: string; deadlineAt: number; reservation: BudgetReservation;
  signal: AbortSignal };
type Segments = z.infer<typeof SegmentResponse>;
type GeneratedImage = z.infer<typeof EditResponse>;
type EditOptions = { quality: "low" | "high"; namedProductSearch: boolean };
declare function segmentConcept(image: NormalizedInput, phrase: string, ctx: CallContext): Promise<Segments>;
declare function segmentPoints(image: NormalizedInput, points: z.infer<typeof Point>[], ctx: CallContext): Promise<Segments>;
declare function editImage(base: NormalizedInput, prompt: string, options: EditOptions, ctx: CallContext): Promise<GeneratedImage>;
declare function composeImage(base: NormalizedInput, reference: NormalizedInput, prompt: string, options: EditOptions, ctx: CallContext): Promise<GeneratedImage>;
declare function identifyBike(image: NormalizedInput, ctx: CallContext): Promise<BikeData>;
declare function buildInstruction(input: z.infer<typeof InstructionPayload>, reference: NormalizedInput | null, ctx: CallContext): Promise<InstructionData>;
declare function searchParts(input: z.infer<typeof SearchRequest>, ctx: CallContext): Promise<z.infer<typeof SearchResponse>>;
declare function checkFit(input: z.infer<typeof CheckRequest>, ctx: CallContext): Promise<FitData[]>;
declare function transcribe(wav: Uint8Array, sessionId: string, ctx: CallContext): Promise<z.infer<typeof TranscribeResponse>>;
```

### 6.1 segmentConcept and segmentPoints

POST https://api.meta.ai/v1/responses. Body has model=sam-3.1; stream=true; store=false; metadata={include_confidence:"true", mask_encoding:"one_bit"}; input is a one-element array. Its item has type=message, role=user, content ordered as input_text then input_image. The text item's text is the single phrase for segmentConcept. The image item has image_url=image.dataUrl. No file_id, instruction text, response_format, or list of concepts.

For segmentPoints the same body changes only text. Use the parser's documented buildObjectPrompt with size equal to width/height, object ID 1, frame 0, and the validated point list. One positive point (100,200) in a 2048×1536 image encodes as `<0f>1<|point;x=100;y=200;w=2048;h=1536|>`. A negative point has `-` immediately before its point token. Use the builder, not string concatenation. The app uses one object per point request and at most 8 points, below the API's 16-object limit. [SAM prompt contract](https://dev.meta.ai/docs/sam/segmenting).

Implementation note (T3, 2026-10-28): meta.ts exposes one `segment(image, text, signal)` used for both concept and point text (built by `samConceptText` / `samPointsText`), and it is only called inside `withReservation` (src/lib/server/paid.ts), which owns the CallContext role (reservation, deadline, signal). `NormalizedInput` carries width, height and dataUrl only. A stream that ends without a terminal event is UPSTREAM_UNAVAILABLE (charge unknown), not an empty success. Consume SSE frames across arbitrary byte boundaries. Aggregate only response.output_text.delta text, finish on response.completed, and detect error/failed terminal events. Parse records through the package. Select frame 0 and pair records by object ID, never array index. Decode binary raster with decodeMaskToRaster. Empty output is valid. U01 must establish box/mask placement before encoding full-image mask PNGs. [Wire grammar](https://dev.meta.ai/docs/sam/reading-segmentation), [parser helpers and minima](https://dev.meta.ai/docs/sam/client-libraries).

### 6.2 editImage and composeImage

POST https://api.meta.ai/v1/images/edits. Both use exactly these fields:

| Field | Value |
| --- | --- |
| model | muse-image-1.0 |
| prompt | Fixed edit/compose instructions followed by the bounded approved edit prompt |
| images | editImage: one item {image_url:base.dataUrl}; composeImage: base then reference, each as {image_url:...} |
| n | 1 |
| size | Base width + "x" + base height; an aspect request, not a pixel guarantee |
| response_format | b64_json |
| output_format | webp |
| reasoning_strength | options.quality, default high |
| tool_enablement | enable_image_search=false, enable_web_search=false, enable_shell=false by default |

Only explicit optional named-product text mode may set the two search booleans true. composeImage always forces them false, regardless of options. Do not send mask, transparent background, previous_response_id, or stream. Both functions decode data[0].b64_json, validate actual bitmap dimensions, and bounded-encode it as WireImage. Empty data is NO_RESULT; opaque output is expected. [Raw JSON edit endpoint](https://dev.meta.ai/docs/api-reference/images/edit-image), [all image fields and output](https://dev.meta.ai/docs/api-reference/images/schemas), [tool controls](https://dev.meta.ai/docs/image-generation).

### 6.3 Shared Spark body

identifyBike, buildInstruction, searchParts, and checkFit use POST https://api.meta.ai/v1/responses. Every body contains model=MUSE_MODEL, stream=false, store=false, max_output_tokens=4096, instructions=the selected trusted prompt file, and input=[one message]. The message has type=message, role=user, and content begins with one input_text whose text is the UTF-8 JSON serialization of the exact task input below. An optional input_image follows. text contains format with type=json_schema, name as listed below, strict=true, and schema generated from the named prompt schema in section 8.

Generate JSON Schema through Zod's JSON Schema facility with required nullable keys, no optional keys, no transforms, and additionalProperties=false on every object. Root is an object. Keep root unions out of model schemas. Do not send the route's discriminated union, Date, File, Blob, map, or typed array. [Responses parameter definitions](https://dev.meta.ai/docs/api-reference/responses/schemas), [strict structured output rules](https://dev.meta.ai/docs/structured-output).

| Function | Input_text JSON fields | Image | Format name / prompt output schema |
| --- | --- | --- | --- |
| identifyBike | width, height from normalized image | input_image with image_url=image.dataUrl | bike_identification_v1 / IdentifyModelOutput |
| buildInstruction | slot, box, bike, mode, text, width, height from InstructionPayload | Only the owned reference, if reference mode | edit_instruction_v1 / InstructionModelOutput |
| searchParts query | mode, bike, slot, query, preferredDomains | None | parts_search_v1 / SearchModelOutput |
| searchParts url | mode, bike, slot, url, preferredDomains, listingText | None; listingText is allowlisted fetched visible text, <=12,000 characters | parts_search_v1 / SearchModelOutput |
| checkFit | bike, items, activeBuild, shopRules, legalAsOf, legalSources | None | fit_check_v1 / FitModelOutput |

checkFit strips prior fit fields, review fields, mechanic notes, fit hashes/timestamps, prices, and labor from each item before sending. It retains item ID, slot, title, spec, product name/partNumber/URL/approvalText, and intent. legalAsOf is the server ET date; legalSources are the TÜV and official StVZO URLs in PLAN.md section 16. Do not send owner consent, settings logo, personal data, or internal request/budget IDs in a prompt.

identifyBike and buildInstruction omit tools, tool_choice, max_tool_calls, and include. searchParts and checkFit add tools=[{type:"web_search"}], max_tool_calls=2, and include=["web_search_call.results"]. No undocumented domain filter is sent; preferred domains are task data. The model chooses whether to search; verify an actual web_search_call and retain URL citations. A missing search result cannot be represented as a fresh researched ok check. [Grounding and result annotations](https://dev.meta.ai/docs/search-grounding). The [cookbook search recipe](https://github.com/meta-models/meta-model-cookbook/blob/main/01_api_fundamentals/10_search_grounding.ipynb) confirms that grounding belongs on Responses. Its separate [structured-output recipe](https://github.com/meta-models/meta-model-cookbook/blob/main/01_api_fundamentals/04_structured_output.ipynb) uses Chat Completions; its response_format syntax does not apply here.

Read response status first. Collect all output[].content[] blocks with type=output_text; do not assume output[0] is the answer. Parse the resulting JSON, then validate. Collect url_citation annotations and web_search_call results separately. The server attaches accessedAt and checks source URLs against actual citations/results. An unsupported URL from model JSON cannot establish ok or a verified product price. Treat failed/incomplete/refused output as a safe route error. No second model call tries to repair malformed JSON. Combined strict JSON plus search and its query-count bound remain U02/U06 until smoke-tested on this account.

### 6.4 transcribe

POST https://api.meta.ai/v1/asr/transcribe?sessionId=<UUID>. Use Authorization Bearer and Accept application/json. Let FormData set the boundary; do not set Content-Type manually. Multipart has request, JSON MIME application/json, with exactly model=muse-voice-transcribe-1.0, mode=PUSH_TO_TALK, audioEncoding=WAV. The audio part is a filename command.wav, MIME audio/wav, containing RIFF/WAVE mono signed 16-bit PCM at 24 kHz. No authorization field is put inside request, no language/keyword fields are guessed, and no WebSocket is used.

Accept at most 30 seconds and verify the WAV header and actual sample count. Read transcript and audioDurationMs from the upstream JSON. Normalize to text and audioDurationMs. A blank transcript is a valid empty state. Browser recording must resample and encode PCM WAV in the optional ticket; WebM/Opus is not supported directly. [Speech file contract and format restrictions](https://dev.meta.ai/docs/speech-to-text).

### 6.5 Files endpoint smoke profile

The app does not call Files. The spike tests POST https://api.meta.ai/v1/files as multipart purpose=user_data, then file=<owned normalized WebP>. Bearer auth; let requests set the boundary. Assert returned id and uploaded status. If cleanup is tested, DELETE /v1/files/{id} has no body, then confirm it is no longer retrievable. The spike records whether the delete contract succeeds; it never assumes deleting restores spent inference credit. [Upload/reference lifecycle](https://dev.meta.ai/docs/file-handling), [delete contract](https://dev.meta.ai/docs/api-reference/files/delete-file). Do not implement an app file_id path without adding its route, ownership, cleanup, and payload contracts.

## 7. Image utilities

These signatures define module boundaries, not implementations. Server helpers use Uint8Array so tests and sharp agree about byte ownership. Browser adapters load blobs and masks through canvas. Sharp never receives unbounded raw inputs. Parameter defaults below are requirements for ticket 5, not claimed benchmarks.

```ts
type BinaryMask = { width: number; height: number; pixels: Uint8Array };
type AlphaMask = { width: number; height: number; alpha: Uint8Array };
type NormalizeOptions = { maxEdge?: number; maxBytes?: number; quality?: number;
  maxInputPixels?: number; background?: string };
type NormalizedImage = { bytes: Uint8Array; width: number; height: number;
  hash: string; warnings: string[] };
type ParsedSamMask = { raster: Uint8Array; maskWidth: number; maskHeight: number;
  box: [number, number, number, number]; imageWidth: number; imageHeight: number };
type CompositeResult = { image: NormalizedImage; composed: boolean;
  aligned: boolean; drift: number | null; reason: z.infer<typeof CompositeResponse>["reason"] };
declare function preflightPhoto(file: File, options?: NormalizeOptions): Promise<Blob>;
declare function normalize(bytes: Uint8Array, options?: NormalizeOptions): Promise<NormalizedImage>;
declare function decodeSamMask(record: unknown, imageWidth: number, imageHeight: number): ParsedSamMask;
declare function maskToNormalized(mask: ParsedSamMask): BinaryMask;
declare function maskToAlpha(mask: BinaryMask): AlphaMask;
declare function dilate(mask: BinaryMask, radiusPx: number): BinaryMask;
declare function feather(mask: BinaryMask, sigmaPx?: number): AlphaMask;
declare function unionMasks(a: BinaryMask, b: BinaryMask): BinaryMask;
declare function clipMask(part: BinaryMask, bike: BinaryMask): BinaryMask;
declare function driftCheck(base: Uint8Array, edited: Uint8Array,
  excluded: BinaryMask): Promise<{ score: number | null; outsidePixels: number }>;
declare function composite(base: NormalizedImage, edited: NormalizedImage,
  oldMask: BinaryMask | null, newMask: BinaryMask | null, bikeWidth: number,
  intent: "paint" | "replace" | "geometry", enabled?: boolean): Promise<CompositeResult>;
declare function screenToImage(point: { x: number; y: number },
  container: DOMRect, imageSize: { width: number; height: number }): { x: number; y: number } | null;
```

Normalize defaults: maxEdge=2048, maxBytes=1,250,000, quality=82, maxInputPixels=40,000,000, background=the neutral canvas token from PLAN.md. Flatten transparency, apply orientation once, convert sRGB, strip metadata, keep aspect, and never upscale. Reduce quality in steps to 60, then reduce dimensions until the byte limit fits. The final width/height/hash refer to actual encoded output. Unsupported/corrupt/animated formats get distinct errors. HEIC message: "HEIC is not supported in this demo. On your Mac, open the photo in Preview and export it as JPEG, then upload that file."

preflightPhoto detects HEIC/HEIF by MIME and file signature before decode. It rejects those formats locally. For supported files decode with orientation applied, then encode a fresh WebP; do not pass original EXIF through. Reject huge/corrupt images before canvas allocation where header dimensions are available; cap source file at 25 MB. The authoritative server applies the same limit and verifies orientation/dimensions. U05 compares browser, Pillow, and sharp on the EXIF fixture. The public server receives only the bounded preflight output, never the 25 MB source.

SAM box conversion uses parser half-open box coordinates. The raw token's x2/y2 may be inclusive; do not add 1 twice. U01 fixes one placement mode in maskToNormalized with real off-origin fixtures. If raster size equals full image, use it directly. If verified box-relative, copy raster at the verified top-left with clipping. Otherwise raise MASK_PLACEMENT_UNKNOWN. Do not resize a box mask to the full canvas to hide a mismatch. x/y fields in raw mask tokens alone are not proof of global placement.

maskToAlpha maps 0 to 0 and 1 to 255. dilate uses a disk structuring element; binary output stays 0/1. feather uses Gaussian sigma=1.5 for cutout display. Composite uses radius=round(clamp(0.015×bikeWidth,6,24)), sigma=clamp(0.005×bikeWidth,3,8). bikeWidth is right-left of the bike mask box, not the whole photo. Reuse this math in Python and TS. All operands must share dimensions; no silent mask resize.

Composition sequence: preserve generated source dimensions; reject the small/aspect/geometry cases before attempting a blend. Relative aspect difference is abs((generatedWidth/generatedHeight)/(baseWidth/baseHeight)-1); limit=0.02. Where allowed, align dimensions in the browser with canvas high-quality smoothing (owner-accepted deviation from Lanczos3, 2026-10-28; normalization still uses Lanczos3), then SAM the edited slot on that exact resized raster. Union old/new masks, dilate, measure grayscale drift outside the dilated region, feather, and blend straight alpha. Grayscale uses the same 0.299R+0.587G+0.114B weights in both languages. Divide mean absolute difference by 255. No outside pixels means score=null and full-image fallback. Threshold >0.05 means fallback. The blend must preserve base pixels where alpha is zero. Feathering can alter pixels beyond the hard union; the test's protected region must include the Gaussian support.

If output is unaligned, show "The model moved the bike. Showing the full edit." If only geometry intent prevented composition, show "Shape change: showing the full edit." Before/after for differing dimensions uses contain-fit side-by-side or a fit-to-frame slider with a warning; it never promises pixel alignment. Cache successful generated output before SAM so a failed segment/composite step can resume without generation. For multiple new SAM candidates, choose the one with greatest box IoU against the old selection, then closest center. Do not match IDs across separate SAM requests. If two plausible candidates remain ambiguous, use missing_mask fallback. The browser makes the bounded base-sized raster used for this SAM call and submits that same raster as edited to composite; the original generated dimensions remain separate metadata. When aspect fails, skip both part SAM and composition.

screenToImage computes the actual contain-fit displayed width/height from container and image aspect, centers it, removes the letterbox offset, rejects outside points, scales to image pixels, floors (correction 2026-10-27: floor selects the containing pixel, as the SAM parser documentation does; it replaces "rounds"), and clamps. Test both vertical and horizontal letterboxes at browser zoom and CSS resize. Do not assume the container equals the displayed image rectangle.

## 8. Prompt files and model output schemas

Each file starts with a version and purpose, lists trusted inputs, marks user/product data as untrusted, forbids invented facts, and names its output schema. The server supplies model/source timestamps and generated IDs. JSON is required for Spark tasks. Compose/paint are deterministic templates consumed by Muse Image; they produce images, not JSON. Their app-side prompt descriptors still have the declared schema below.

```ts
const IdentifyModelOutput = z.object({ bike: Bike }).strict();
const InstructionModelOutput = z.object({ instruction: Instruction }).strict();
const ModelSource = z.object({ url: HttpsUrl, title: Short, supports: Note }).strict();
const ProductCandidate = z.object({ name: Short, brand: Short.nullable(),
  partNumber: Short.nullable(), url: HttpsUrl, imageUrl: HttpsUrl.nullable(),
  priceText: Short.nullable(), priceEurCents: Cents.nullable(),
  taxBasis: z.enum(["gross", "net", "unknown"]), approval: Approval,
  approvalText: Note.nullable(), fulfillmentRegion: z.enum(["eu", "outside_eu", "unknown"]),
  source: ModelSource }).strict();
const SearchModelOutput = z.object({ products: z.array(ProductCandidate).max(5),
  warnings: z.array(Note).max(8) }).strict();
const ModelFitResult = FitResult.omit({ sources: true }).extend({
  sources: z.array(ModelSource).max(8) }).strict();
const FitModelOutput = z.object({ results: z.array(ModelFitResult).min(1).max(3) }).strict();
const RenderDescriptor = z.object({ slot: Slot, intent: z.enum(["paint", "replace", "geometry"]),
  editPrompt: z.string().min(1).max(4000) }).strict();
const LabelPartModelOutput = z.object({ label: Short, slot: Slot,
  confidence: z.number().min(0).max(1) }).strict();
```

| File | Inputs | Required behavior and expected output |
| --- | --- | --- |
| identify.v1.md | Normalized photo, width, height | IdentifyModelOutput; suggest family/engine/year/ABS/facing; unknown/null when hidden; no VIN or exact-year claim from insufficient evidence |
| instruction.v1.md | Slot, normalized box/size, Bike, mode, text, optional owned reference | InstructionModelOutput; English instruction names part and screen position, preserves rest, extracts spec, title, and geometry intent |
| compose.v1.md | Slot, intent, description, base as image 1, owned reference as image 2 | App RenderDescriptor; reference replaces only target, preserve perspective/light/scale; Muse output is one opaque image |
| edit.v1.md (added T5, 2026-10-28) | One slot, approved text-mode edit prompt, base image | App RenderDescriptor for intent replace/geometry; change only the described part, keep angle/scale/lighting and everything else; the server picks edit.v1 or paint.v1 from the request mode, never from client intent |
| paint.v1.md | One slot, color/finish request, base image | App RenderDescriptor; change finish only, retain geometry and all other parts; Muse output is one image |
| search-parts.v1.md | Confirmed bike, slot, query or allowlisted URL text, preferred domains | SearchModelOutput; 3–5 when evidence supports it, 0–2 allowed; exact listed price only; no invented approval, EUR conversion, stock, or fulfillment region |
| fit-check.v1.md | Confirmed bike, <=3 target items, whole build summary, shop rules, legalAsOf and legal URLs | FitModelOutput; each requested item ID exactly once; include approval, documentCoverage, inspection, eintragung, carryDocuments, conditions, reasons, measurements, extraParts, evidence |
| label-part.v1.md (stretch) | Owned crop and crop-to-image metadata | LabelPartModelOutput; only after a separate approved route/signature ticket; MVP uses the mechanic's manual label |

Paint and compose can reuse instruction output; their template expansion is deterministic and adds no Spark call. Hash the final expanded prompt in edit cache keys. Search URL mode requires the same allowlist rules as product-image. Both allow HTTPS port 443 only, no userinfo, at most 3 redirects, a 5-second fetch budget, 1 MB visible-page input, and 2 MB source-image input (then normalize to 1.25 MB). HEAD is advisory: 405/403 does not prove a dead product page. A bounded GET may establish reachability; otherwise linkState=unchecked. Reject loopback, private, link-local, multicast, and reserved IPv4/IPv6 resolutions. Resolve and validate all addresses before every connection; pin the chosen public address with Node HTTPS lookup while retaining the original Host and TLS server name, including after redirects. Do not rely on a DNS check followed by an unpinned fetch. Send no cookies, credentials, or browser headers. Treat fetched HTML as inert text; never run scripts. No new HTTP dependency is needed. If fetching is blocked, explain that the mechanic can enter the product details and source link manually.

Fit post-validation is server policy. Check IDs match the request exactly; duplicate/missing IDs fail the batch. Attach checkedAt and the caller's inputHash after success. Strip sources unsupported by actual grounding evidence. Any unresolved critical measurement, missing exact vehicle/product coverage, unknown inspection/registration need, or absent applicable primary source downgrades ok to verify. Keep problems explicit. A general StVZO link alone does not prove product fit or approval. Never turn inspection:"none" into approval by inference. Preserve any limitation about interacting exhaust/intake, wheel/fender, handlebar/cable, and lighting changes. The UI and PDF say "Pre-check only. The shop and inspection authority must verify fit and road-use requirements."

The handlebar fixture must test an unknown model/year and throttle type: request clamp measurements and cable/hose/wiring reach, rather than universally asserting 1-inch bars or throttle cables. US exhaust with absent vehicle papers must return verify/problem and inspector review; do not assert that Einzelabnahme will succeed. ABE with an inspection condition must not be reduced to inspection:none. Wheel/ABS uncertainty must not return ok. These are offline schema/policy tests plus one owned-bike live review in ticket 9.

## 9. Client storage, history, and invalidation

IndexedDB database dreambike, version 1. No localStorage for projects or large data. Use one explicit migration and transaction layer through idb. Unknown future schema versions open read-only with a clear message; never silently delete projects. No server-side project recovery is promised.

| Store / key | Value and indexes |
| --- | --- |
| projects / id | Project; updatedAt index |
| versions / id | Version semantic snapshot; projectId and parentId indexes |
| images / id | StoredImage with Blob; hash and lastAccessedAt indexes |
| masks / id | StoredMask, full binary raster; imageHash index |
| settings / id | ShopSettings and updatedAt |
| cache / key | CacheEntry; lastAccessedAt and expiresAt indexes |
| meta / key | schema version, byte ledger, last-open project, demo import version |

Photo bytes are hashed after normalization. Derivation keys include normalized hash, prompt version, model ID, parameters, and algorithm version. Required families: norm:<sourceHash>:normalize-v1; cut:<imageHash>:sam-3.1:mask-v1; parts:<imageHash>:<phrase>:mask-v1; points:<imageHash>:<pointHash>:mask-v1; id:<imageHash>:identify-v1; instruction:<inputHash>:instruction-v1; edit:<baseHash>:<referenceHash-or-none>:<promptHash>:<quality>:tools-v1; fit:<fitInputHash>:fit-check-v1; search:<inputHash>:search-parts-v1. The norm sourceHash uses local bytes only and is never sent as identity.

Search cache expires in 1 hour, fit research in 24 hours, and displayed prices retain their retrieved timestamp. Expired checks show stale and cannot authorize a complete estimate without recheck or explicit mechanic review. Image/mask caches persist while their project exists. Reuse cached responses without spending. Cached results display their original checkedAt; opening a cache never fabricates a fresh date. Cache entries contain schema-validated data only.

The version graph is a tree. Roots have no parent. Editing a prior node creates a child. Head selection and accepted image + build-item snapshot commit in one transaction after all referenced blobs exist. Generate version/item IDs before the transaction. Retry a storage transaction with the same IDs to avoid duplicate lines. A failure leaves the previous head and active sheet unchanged. Semantic snapshots are immutable; derived mask/cutout caches may be filled only under their exact image hash. Display associations may be updated atomically without rewriting historical semantic data.

Undo selects parent; redo selects an existing child, asking which branch if needed. There is no new node for undo/redo. Each visual operation has a change record for history. The active items array contains at most one item per slot (including custom in MVP). Accepting another variant replaces that slot item, keeping the old item in ancestor versions. Removing/readding a sheet item is explicit. Multi-part paint and multiple independent custom parts are stretch schema changes, not hidden exceptions.

Sheet-only metadata revisions share the image reference and use kind=sheet. Fit results are attached to the exact input hash; their completion updates derived check data, not the image head. A late result with a different hash is retained as stale cache and cannot overwrite current fit. A pending visual result checks projectId and expectedHeadId before acceptance; switching project, undoing, or changing the active sheet invalidates automatic acceptance.

| Change | Invalidate / retain |
| --- | --- |
| Accepted composited edit | New cutout; new target mask; inherited other masks stale and refreshed on click; retain confirmed bike |
| Accepted full-image fallback | New dimensions, all part masks and cutout invalid; old overlays disabled; retain bike with review notice if frame/engine |
| Bike correction or confirmation revision | All active fit hashes/results and estimate stale; images/masks stay |
| Add/replace/remove a part, spec, or product approval/identity | All active fit results stale because combinations matter; estimate stale |
| Shop rule or dated legal seed change | All fit results and estimate stale |
| Price, labor, rate, VAT display, or manual fee edit | Estimate stale; fit retained if no physical/product change |
| Prompt/model/algorithm version change | Only matching derived caches miss; never silently rerender history |

fitInputHash includes confirmed bike revision, ordered active physical specs/products/approval text, shop rules, legal seed version/date. quote inputHash also includes prices/tax bases, labor/rate, fees, and fit statuses. Canonicalize key ordering and item order before hashing.

Storage target is 200 MB, not a guaranteed browser quota. Evict unreferenced transient caches by LRU first. Never evict a saved project, root image, current/ancestor image, or required mask behind the user. Deleting a project removes only blobs no other project references. If protected content alone exceeds the limit, pause new writes and offer project deletion; keep the current view in memory and explain that it is unsaved. Do not implement an extra archive/export format in this schedule. Catch QuotaExceededError, retry once after safe cache cleanup, then show STORAGE_FULL.

The read-only demo uses a manifest and same-origin static assets directly. Try editing imports a fresh independent project transactionally. Do not modify public assets or share browser edits among visitors. A demo can be reset without deleting private local projects.

## 10. Desktop screens and components

One page, minimum supported viewport 1280×800. At smaller widths show a desktop recommendation; no mobile implementation. Header has project name, budget state, undo/redo, and Settings. Main area uses a flexible image canvas (about 2/3) and a 360 px edit panel. Bottom/tabs expose Build sheet and Estimate. Avoid separate navigation infrastructure. Keyboard focus and labels are required.

| Screen / components | Content and required states |
| --- | --- |
| Start: ProjectList, UploadDropzone, UploadNotice, DemoBanner | Loading IndexedDB, no projects, owned-photo notice, invalid/HEIC/large upload, low-resolution warning, retry, open demo, local storage unavailable |
| Editor: ImageCanvas, PartOverlay, BikeConfirm, PartSelector | Visible normalized image while masks/ID load independently; no bike/part found; cluttered result; unknown facing; manual bike correction; cutout failure; partial map; stale masks disabled |
| Edit panel: DescribeForm, PaintForm, ReferenceDropzone, ProgressStatus | No selection, text validation, missing reference, disabled feature, instruction preparing, generating, segmenting, compositing, timeout, rejected image, cap reached |
| Preview: EditReview, BeforeAfter, VersionStrip | Accept/reject; no accepted changes; pending result tied to original head; branch chooser; aligned slider; unaligned side-by-side; never overwrite a newer head |
| Build sheet: BuildSheet, ProductFields, FitBadge, EvidenceLinks, PaperworkSummary | Empty sheet; manual product entry; optional search loading/empty/blocked; per-batch check progress; failed batch retains others; stale fit; missing measurements; source links |
| Estimate: EstimatePreview, MissingCosts, InspectionFees, ExportButton | Missing shop setup, unknown costs/tax basis/hours/fees, complete estimate, incomplete draft, stale check notice, PDF building, export failure, long multi-page notes |
| Settings: ShopSettingsForm | Empty required real values, labeled demo defaults, invalid logo/rate/domain, unsaved changes, saved locally, storage quota failure |
| BudgetBanner, ErrorNotice | Distinguish visitor cap, global cap, disabled live mode, accounting outage; link to cached demo; retain all existing local work |

Persist only explicit accepted changes. A render button is disabled while the same edit is pending. Model errors have a visible manual retry with estimated cost; selecting Retry does not accept a prior preview. No endlessly spinning loading state. Provide cancel for UI work, with text that an already submitted AI call may still incur cost.

Use PLAN.md 8.4 exactly for Nordlicht values, Plex typography, sentence case, flat surfaces, fixed slot colors, 35% overlay fill, and 2 px outlines. Fixed mapping: wheel group series1; fork series2; tank/fenders series3; handlebar/controls/grips series4; exhaust series5; air cleaner/engine/primary cover series6; seat/luggage/sissy bar series7; headlight/mirrors/signals/frame/fairing/custom series8. Colors do not depend on detection order. Badges always have words and icons. One Polarnacht accent action per view: Render change. Use token values in the PDF theme too.

## 11. Shop settings and estimate rules

Real settings begin with shopConfirmed=false, shopName="DreamBike workshop", no logo, rate/inspection fees=null, currency=EUR, VAT=1900 basis points, preferred domains=[], rules=[], and demoRates=false. Prompt the owner to enter actual identity. Demo mode has an isolated settings record with demoRates=true, rate=10,000 net cents/hour, Änderungsabnahme=10,000 net cents, Einzelabnahme=25,000 net cents. Label these illustrative values in UI and PDF. Do not copy demo values into real settings silently.

Default minutes, explicitly illustrative: each wheel 60; fork 240; tank paint 240; handlebar 180; exhaust 90; air cleaner 60; seat 30; headlight 90; each fender 120; frame paint 720; engine paint 360; forward controls 180; mirrors 30; turn signals 60; saddlebag 90; fairing 180; primary cover 150; sissy bar 90; grips 30; custom unset. A slot's minutes are a starting point, not an automatic mechanical promise. For custom, missing minutes stays null; the schema's laborBySlot list can omit a slot. A zero-minute item needs zeroLaborConfirmed=true and nonempty mechanicNotes.

Owned logo: PNG/WebP/JPEG, at most 500 KB and 512 px; normalize locally and store as a blob; no SVG or remote logo URL. Preferred domains are used for ranking only. They cannot broaden PUBLIC_SHOP_DOMAINS, which is server configuration. Shop rules are plain text data and cannot override trusted prompts, evidence policy, server caps, or safety checks.

Each active item is quantity one. A pair/set must be described and priced as a set; unit multiplication is outside MVP. Monetary calculations use integer cents and round half up for nonnegative amounts. Part net is entered net price or round(grossCents×100/119). Unknown tax basis stays unresolved even with a numeric listed price. Labor net is round(rateNetCents×minutes/60). Line net is part net + labor net. A labor_only item has an explicitly confirmed zero part amount; all other absent part amounts stay null.

Mechanic adds build-level inspection allowance lines and associates items. Do not charge the same inspection once per item automatically. Required-but-unpriced inspection means incomplete; unknown inspection also means incomplete until the mechanic reviews it. Inspection allowances are treated as shop net service allowances under this simplified 19% estimate model, not claims about official fee taxation. Mark them estimated. Owner confirms this convention before real quotes.

Complete totals: sum rounded net lines and confirmed net allowances; VAT=round(totalNet×19/100); gross=net+VAT. Unknown fields produce incomplete=true and null net/VAT/gross, alongside knownSubtotalNetCents and a list of exclusions. A draft may export with "Incomplete draft — costs missing" and no grand total. A real complete estimate requires shopConfirmed=true, known amounts/bases/minutes, reviewed fit statuses, and confirmed fee treatment. fitReviewedHash must equal the hash of the current validated FitResult, fitInputHash, and fitCheckedAt; a recheck clears that acknowledgment. InspectionReview must match the current build fitInputHash and have decision none or fees_added; unresolved or stale review stays incomplete. A fees_added decision requires confirmed fee lines. Store these reviews with the sheet revision. Known verify/problem findings may remain if the mechanic explicitly acknowledges them; they print prominently. The PDF is an estimate, not an invoice or road-use certificate.

Required money test: a €119.00 gross part becomes €100.00 net; 90 minutes at €100.00 net/hour adds €150.00; one €100.00 net allowance gives €350.00 net, €66.50 VAT, €416.50 gross. A second unknown part leaves the known subtotal €350.00 but sets total fields null. Add rounding-edge, zero-hours confirmation, duplicate-slot replacement, fee deduplication, and draft export checks.

PDF: A4, margins 36 pt, body >=10 pt, local Plex Sans and Mono TTF. Page 1 has shop, estimate date, confirmed bike, before/after images, and item table; continue the table as needed. Add inspection allowances, totals/unknowns, paperwork summary, sources, visualization note, and pre-check note. Repeat headers, wrap URLs/notes, preserve item/source association, and put page numbers on every page. Use image blobs already in the project. No network at export and no external product/reference photos. Human-review at least a 1-page and 3-page PDF before ticket 11 is done.

## 12. Fixtures and runnable spike specification

The owner supplies the following in gitignored /fixtures. Do not download substitutes, invent bike identities, or use people. A second view can show the same owned bike. expected.json contains actual make/model/year/engine/ABS if known, facing, selected test click and target box, visible slots, photographer/date, identifier review, and consent-record reference. Keep consent itself private. Public assets are separately cleared derivatives under /public/demo, with actual credits.

| File | Expected result |
| --- | --- |
| plain-wall-right.jpg | Main baseline; upright normalized raster; motorcycle mask on bike; visible exhaust/air cleaner checked by owner; correct facing; confirmed truth can be entered manually |
| plain-wall-left.jpg | Reverse facing; front/rear assignment follows facing; hidden right-side parts are absent/unknown, never fabricated |
| cluttered.jpg | Partial map acceptable; correct bike can be selected; point fallback handles a visible missed slot; other bikes do not silently become the chosen bike |
| exif-rotated.jpg | Owner's own photo with Orientation=6; same final orientation in browser, Pillow, sharp; no residual EXIF; drawn test coordinate lands within 3 px |
| heic.heic | Clear UNSUPPORTED_FORMAT in browser/server; no paid API dispatch and no generic 500 |

The EXIF fixture may be an owned duplicate with a controlled EXIF tag. Record that derivation. The HEIC fixture is a format-rejection test, not a requirement to buy or install a decoder. If unavailable, record a skipped owned-HEIC case under U09 and test the rejection logic with headers; do not claim an actual HEIC passed. No machine vision detector is assumed to certify that photos lack people; owner reviews them.

macOS setup, run each inline command from the repo root:

1. Check `python3.11 --version` and `node --version`. If missing, owner installs Python 3.11/Node 22 using their chosen manager.
2. Run `python3.11 -m venv .venv`, then `source .venv/bin/activate`.
3. Run `python -m pip install --upgrade pip`, then `python -m pip install -r spike/requirements.txt`.
4. Copy .env.example to .env.local; fill values privately; check Billing cap and fixture consent. Scripts do not shell-source or echo secret files.
5. Run `python spike/local_images.py --fixture-set all` before paid calls.
6. Run the individual profiles below, then `python spike/run_all.py --mode spike --fixture-set all` as a cached orchestrator. It skips already-passed identical profiles unless --force is supplied.

Commands are contracts for scripts created by ticket 0. They are not runnable in this planning-only repo until that ticket implements them. One endpoint script can have multiple profiles; avoid cloning HTTP logic across scripts.

| Command | Endpoint/model and checks |
| --- | --- |
| python spike/responses_sam.py --fixture-set plain --mode concept | POST /responses, sam-3.1; motorcycle/wheel, confidence, zero-match phrase, record pairing, full-resolution mask overlay |
| python spike/responses_sam.py --fixture-set plain --mode points | Same endpoint; off-origin wheel positive/negative points; builder grammar and dimensions; compare parser box and raster placement; no assumed centroid-at-click test |
| python spike/responses_sam.py --fixture-set all --mode parts | Core phrases with concurrency 4, alternate only for misses; owner marks useful/absent/merged; record requests and costs |
| python spike/responses_spark.py --fixture-set plain --mode identify | POST /responses, Contributor Spark; exact strict schema and image input; parse output across non-message items; unknowns allowed |
| python spike/responses_spark.py --fixture-set plain --mode instruction | Same endpoint; text, paint, owned reference profiles; plain JSON, title/spec/geometry intent |
| python spike/responses_spark.py --fixture-set plain --mode grounded | Same endpoint; fit schema + web_search and search schema; citation extraction, actual search, bounded output, usage; U06 must permit dispatch first |
| python spike/images_edits.py --fixture-set plain --mode edit | POST /images/edits; one paint change; no mask parameter; opaque WebP decode; dimensions, metadata, and byte limits |
| python spike/images_edits.py --fixture-set plain --mode compose | Same endpoint; base and an owner's own part crop as reference; image order and tool flags |
| python spike/images_edits.py --fixture-set plain --mode compare | Same endpoint; one low and one high render only if remaining ticket budget allows; report timings and drift, not a latency promise; compare original vs flat cutout only if extra budget remains |
| python spike/asr_transcribe.py --audio fixtures/command.wav | POST /asr/transcribe; optional owner voice saying a part request; WAV settings, transcript field, actual duration; not a required bike-photo fixture |
| python spike/files.py --image fixtures/plain-wall-right.jpg | POST /files then optional DELETE /files/{id}; normalize first, purpose, file reference shape, cleanup result |
| python spike/local_images.py --fixture-set all | No Meta calls; EXIF, decode/PNG masks, dilation/feather/blend, contain-clicks; golden masks can be original synthetic arrays |
| python spike/deployment.py --origin http://localhost:3000 | No paid calls; health/budget, origin rejection, disabled flags, bounded-body rejection, demo asset integrity; repeat on actual live origin in T14 |

run_all smoke mode executes one SAM concept/point pair, one identify/instruction pair, and one high paint edit, reusing the selected owned baseline and cached masks. Grounded, compose, Files, and ASR are opt-in profiles with separate recorded gates. run_all spike mode visits all supported fixture cases but reuses identical passed calls. Each script supports --dry-run to validate configuration/body shape without HTTP, and --force to repeat cached work explicitly. A smoke run is not a load test.

Common behavior: read the key privately; validate rights/budget gates first; use the same reservations as the app; max $5 cumulative across ticket 0, including separate command invocations. The runner stores a local durable audit in spike/out/ledger.jsonl and updates the shared project ledger. If no shared ledger is configured, it can do offline work only. Each paid script requires --ticket T0 (default for day 0); later ticket IDs are explicit. Every ledger entry records timestamp, ticket, route/profile, model, attempts, duration, counts, reserved/settled cost, and status. No content, raw IDs containing personal data, or secrets.

Private response artifacts and contact sheets stay in spike/out. Publish only sanitized aggregate evidence in docs/api-evidence.md. Exit codes: 0 passed; 1 assertion failed; 2 missing configuration/fixtures/rights; 3 budget or unknown accounting; 4 upstream failure; 5 skipped optional capability. The orchestrator reports skipped profiles clearly and cannot treat them as passed.

Required day 0 acceptance is one owned photo proving concept+point mask placement, Spark strict JSON, image edit decode, and a safe local fallback path. Test all five fixture cases as inputs, but do not repeat every paid endpoint on every photo. Broader part recognition and quality review can continue in later tickets. Grounded fit evidence is mandatory before T9 completes; Files and voice failures do not block the chosen MVP transport.

## 13. Public live URL, durable budgets, and demo

The live URL is assigned during Vercel deployment and recorded in README.md and docs/submission.md. Do not invent a hostname. First page load reads /public/demo/project.json, v0/v1/v2 images, mask assets, and quote.pdf. The manifest records real generation dates, prompt/model versions, and source rights. Banner: "Demo project — precomputed results. Live changes use the daily budget." Original uploaded bike and generated derivatives are owned/cleared; no retailer product photo is included. Fit results retain real citations and timestamps, and demo prices are visibly illustrative when they are not real listings.

API budget is USD; shop quotes are EUR. Do not convert them. Defaults are $5/day globally, $0.50/day per visitor, $100 project hard cap, and $50 development stop. Days and reset timestamps use America/New_York, including the November 1 daylight saving change. Compute the next ET midnight using timezone-aware APIs, not a fixed 24-hour addition. TTL is cleanup only; it cannot define the day boundary. Development and demo phases share the same project hard cap.

Meta's [price schedule](https://dev.meta.ai/docs/pricing-rate-limits) currently lists SAM at $0.0025 per image, Muse Image at $0.01 per returned image, Spark Contributor at $0.10/M uncached input and $0.20/M output tokens, web search at $0.0025 per query, and ASR at $0.18/hour. Price verification must be dated. Do not use the reviewer's fixed $0.005 Spark or $0.001 ASR assumptions.

Conservative reservations: SAM=2,500 microdollars; one image=10,000; ungrounded Spark=110,000 (covers its whole 1,048,576-token input context plus 4,096 output tokens at these rates); grounded Spark reserves 330,000 plus 2,500×SEARCH_QUERY_RESERVE (up to three model passes for two tool calls); ASR reserves 1,500 for 30 seconds. The input context bound, output cap, and two-tool-call maximum must remain fixed. U06 must confirm cumulative token billing fits this pass bound; a single-context input estimate is insufficient for a tool loop. Actual charges settle from reported usage without assuming cache discounts. A built-in tool call can issue multiple queries; max_tool_calls=2 is not proof of a two-query billing bound. U06 must establish a safe bound and a reported count or retain the whole grounded reservation. If that cannot be established, stop grounded paid calls and use labeled cached fit results only. T9 remains gated for fresh checking.

Use Redis REST with a fixed namespace dreambike:hackathon-2026, written as the hash tag `{dreambike:hackathon-2026}` so every key of one EVAL maps to one Redis slot (T0 note). Ticket 0 creates shared budget/reserve.lua and budget/settle.lua for Python. Ticket 1 wraps the same files for Node before enabling any live app handler. Include budget/*.lua in Next server output tracing for API routes. Ticket 13 adds public identity buckets, production integration, and the demo, rather than deferring all accounting until the end. One Lua EVAL operation atomically checks and increments project total, development/ticket total, global ET day, visitor ET day, model count, and an in-flight request marker. Check spent + outstanding reservations + requested reservation <= every cap before dispatch. Integers only. No check-then-INCR race. All upstream attempts use this path, including recuts, lazy masks, retries, instruction calls, and spike commands.

Visitor key is HMAC(secret, signed random cookie). Add a second HMAC bucket for the trusted platform-provided client IP per ET day to resist cookie clearing. Do not trust client-provided forwarded headers from outside Vercel; local development uses a fixed local bucket. Cap both buckets and the global budget. IP sharing can limit multiple people on one network; the global cap remains the final bound. Never retain raw IPs. Session/IP identifiers and per-request markers expire after 48 hours; day aggregates remain at least through the event; lifetime and ticket totals persist until the owner archives the event. Redis must not reset on deployment.

Before dispatch, reserve and record route/model/request ID, ticket, day, count, and amount, without images/prompts/results. Mark request pending for the route deadline plus 30 seconds; this marker expiring must not release money. On success atomically settle actual known cost, refund only the difference, and mark completed. Keep model count limits as attempt counts. A definite unbilled 429 can release its money reservation before a new reserved retry, but still consumes the attempt counter. Unknown outcomes keep the full reservation charged. Unknown pricing or an observed cost over reservation stops further calls and requires reconciliation. Do not automatically refund on disconnect, timeout, missing usage, or process death.

Redis REST calls have a 2-second timeout and fail closed. No in-memory fallback. Initialize lifetime totals only after the owner reconciles any earlier manual calls with the Billing page; a missing lifetime key on an already-used project is an accounting failure, not a free reset. Set the provider Billing spend limit too. The shared ledger accounts for this app and scripts; unrelated calls using the same key must be reconciled or use a separate key/project.

Budget denial message: "Daily budget reached. Try again tomorrow, or explore the demo project. The demo uses cached results and makes no AI calls." Visitor-only denial says "Your live allowance for today is used up. You can keep exploring the cached demo." An accounting outage says "Live AI is temporarily unavailable. Your project is saved locally; the cached demo still works." Show reset time in the visitor's browser locale, while keys stay ET. Do not suggest opening a new browser to bypass a cap.

Mandatory tests: concurrent reservations cannot exceed any cap; duplicate request IDs dispatch once; retries reserve again; timeout/crash does not refund; ET midnight and DST boundary are correct; lifetime total survives simulated deployment; missing ledger fails closed; no paid fetch occurs when disabled; cached demo makes zero Meta requests. Use a controllable Redis test adapter offline, then one integration exercise of the real atomic script without any Meta calls.

## 14. Verification register and handoff gates

Ten open items are marked UNVERIFIED below. A doc link verifies a format; it cannot verify account access, rights, latency, visual quality, or shop assumptions. Track status/evidence in docs/api-evidence.md. Do not remove a marker without a dated result. A ticket may proceed on its documented fallback; dependent live claims remain disabled.

| ID / status | Open point | Proof required and owner | Fallback / affected ticket |
| --- | --- | --- | --- |
| U01 UNVERIFIED | SAM mask placement, inclusive/half-open mapping, installed parser API/version | T0 concept+off-origin point overlays on owned photo in Python and TS; raster area and border checks; record package versions | No composition until fixed; cutout/part overlays blocked rather than guessed; T3/T5 |
| U02 UNVERIFIED | Spark strict text.format with image and with web_search on Contributor account | T0 identify/instruction/grounded profiles; schema, output traversal, citation extraction, incomplete/refusal cases | UI mock work and manual bike entry continue; T9 fresh checks gated |
| U03 UNVERIFIED | Account-enabled models, effective quotas, supported image sizes | First controlled profiles record model access, headers, actual payloads; no load test | Use bounded input; unavailable core model is a reported blocker, not a silent model switch |
| U04 UNVERIFIED | Edit/reference quality, low/high latency, drift thresholds, original-vs-cutout base | T0/T5 real edit + owned reference, owner compares before/after; measure drift and fallback; no claimed sub-150ms performance | Full-image preview and acceptance; cut reference only under PLAN cut rule; T5/T7 |
| U05 UNVERIFIED | Browser EXIF preflight, encoded-byte envelopes, real HEIC rejection | T0/T2 local fixtures; compare browser/Pillow/sharp; maximum route envelope and output checks | JPEG export and lower-size upload; no Files API shortcut; T2/T14 |
| U06 UNVERIFIED | Bound on billable search queries and usage, ledger reservations and project cost reconciliation | Before any grounded dispatch, verify current tool billing/count bounds with primary docs/account evidence; test atomic accounting; owner sets Billing limit | Unknown cost stops paid grounded calls; live URL demo-only if needed; T0/T9/T13 |
| U07 UNVERIFIED | Real shops, product sources, fetch reachability, photo permissions | Owner supplies domains; T12 tests source-backed EUR price and safe redirects; no inferred image license | Manual product title/price/link; optional search/fetch off |
| U08 UNVERIFIED | Actual Vercel project plan/runtime/durations and deployed payload handling | T14 deployment health + one explicitly budgeted edit under real timeout; verify Node 22 and limits in dashboard | Cached demo deployment; no unsupported timeout promise |
| U09 UNVERIFIED | Five owned fixture files, true bike details, consent, identifier removal | Owner supplies/reviews files and private dated consent; T0 records availability and skips truthfully | Offline synthetic mask/math tests and scaffold; no invented public bike/photo |
| U10 UNVERIFIED | Shop labor/rates/fees/rules, model-specific legal applicability, §19 retrieval, missing official submission details, Friday hours | Owner/mechanic review; retrieve current primary law and actual product papers; check official CV platform; approve >1MB dependency installs | Labeled demo rates, verify fit status, conservative scope, no real quote/submission claims |

The intended coding handoff is ready for ticket 0 once the owner supplies fixture/consent/Billing/shared-ledger prerequisites and any needed package-size approvals. Configuring the ledger and offline dry runs do not require a model call. Tickets that only use offline mock data can proceed independently. No decision is required to retain Next.js/Vercel, the JPEG-only MVP path, or the fixed public demo fallback. Decisions still needed are concrete inputs listed in PLAN.md section 15; do not turn them into repeated general permission requests.
