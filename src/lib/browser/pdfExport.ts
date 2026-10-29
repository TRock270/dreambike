// Browser glue for the estimate PDF (SPEC 11). It holds no quote logic: the numbers and the fit rows come from
// estimateSnapshot(), and the layout and the file come from src/lib/pdf.ts. This file only
//   - warms up (fonts, the pdf module, token colors) in idle time once a project is open, so the export click makes no
//     network request and export works offline in every order,
//   - picks and prepares the three pictures (before, after, logo) from IndexedDB,
//   - names the file and starts the download.
//
// pdf.ts (and with it pdf-lib and fontkit, about 24 MB unpacked) is reached only through `import type` and the one
// `import("@/lib/pdf")` in loadPdfModule(), so it stays out of the main bundle: it is a separate chunk that the
// warm-up loads in idle time after a project opens.
import { getStoredImage, type DreamDb } from "@/lib/db";
import type { EstimateSnapshot } from "@/lib/estimate";
import { headerSize, sniffFormat, type SniffedFormat } from "@/lib/imageFormat";
import type * as PdfModule from "@/lib/pdf";
import type { EstimatePdfInput, PdfFontBytes, PdfImage, PdfTokenName } from "@/lib/pdf";
import type { AppMode } from "@/lib/server/config";
import type { BikeRevision, ImageRef, Project, Quote, ShopSettings, StoredImage, Version } from "@/lib/types";
import { toJpeg, toPng } from "./jpeg";

// ------------------------------------------------------------------------ small helpers

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const pad = (n: number) => String(n).padStart(2, "0");

/** True when the estimate prints with totals. The same rule pdf.ts and the screen use: the flag and non-null totals. */
export function isCompleteEstimate(q: Pick<Quote, "incomplete" | "netCents" | "vatCents" | "grossCents">): boolean {
  return !q.incomplete && q.netCents !== null && q.vatCents !== null && q.grossCents !== null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "29 Oct 2026" in local time. Fixed English names, so the text does not depend on the browser's locale data. */
export function formatEstimateDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

// ---------------------------------------------------------------------------- file name

/**
 * Project name to lowercase ASCII letters, digits and hyphens, at most 60 characters. German umlauts are spelled
 * out (ä becomes ae), other accents are dropped, anything else becomes a hyphen. Empty gives "project".
 */
export function fileSlug(name: string): string {
  const ascii = name.normalize("NFC").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/\p{M}/gu, "");
  const slug = ascii.replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 60).replace(/-+$/, "");
  return slug === "" ? "project" : slug;
}

/** dreambike-estimate[-draft]-<slug>-YYYYMMDD.pdf, the date in local time. */
export function pdfFileName(projectName: string, draft: boolean, date: Date): string {
  const day = `${String(date.getFullYear()).padStart(4, "0")}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  return `dreambike-estimate${draft ? "-draft" : ""}-${fileSlug(projectName)}-${day}.pdf`;
}

// ------------------------------------------------------------------------------- download

/** Some browsers start the download a moment after click(), so the blob URL is revoked after this delay. */
export const REVOKE_DELAY_MS = 10_000;

/** Starts a download of the bytes from a blob: URL; no network is involved. */
export function downloadPdf(bytes: Uint8Array, fileName: string): void {
  // slice() copies into a plain ArrayBuffer-backed array, which is what the Blob constructor accepts.
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

// ----------------------------------------------------------------------------- warm-up

export const FONT_FILES = {
  sans: "IBMPlexSans-Regular.ttf",
  sansBold: "IBMPlexSans-SemiBold.ttf",
  mono: "IBMPlexMono-Regular.ttf",
} as const satisfies Record<keyof PdfFontBytes, string>;

/** Everything the export needs, already in memory. */
export type PdfKit = {
  pdf: typeof PdfModule;
  fonts: PdfFontBytes;
  /** The CSS color of every PDF token, as the browser computed it (rgb() or rgba()). */
  tokens: ReadonlyMap<PdfTokenName, string>;
};

/** A TrueType file starts with the bytes 00 01 00 00. A web page or an error text does not. */
export function hasTrueTypeSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00;
}

/** The bytes of one font file, or an error in words. A non-ok status or a non-font body is never embedded. */
export async function readFontResponse(res: Response, file: string): Promise<Uint8Array> {
  if (!res.ok) throw new Error(`The font ${file} could not be loaded (HTTP ${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!hasTrueTypeSignature(bytes)) {
    throw new Error(`The font ${file} is not a TrueType font file. The server may have sent a web page instead.`);
  }
  return bytes;
}

/** How long one font file, or the pdf chunk, may take before the warm-up gives up and "Prepare again" shows. */
export const WARMUP_TIMEOUT_MS = 20_000;

export type WarmupDeps = {
  /** Fetches a same-origin file; the signal is aborted when it takes too long. Defaults to the global fetch. */
  fetchFile?: (url: string, signal: AbortSignal) => Promise<Response>;
  /** Loads the pdf module. Defaults to the dynamic import. */
  loadPdf?: () => Promise<typeof PdfModule>;
  /** The computed CSS color of each token. Defaults to a hidden probe element in the page. */
  readTokens?: (names: readonly PdfTokenName[]) => Map<PdfTokenName, string>;
  /** Time allowed for each font file and for the pdf module. Defaults to WARMUP_TIMEOUT_MS. */
  timeoutMs?: number;
};

/** The one place pdf.ts is imported at run time. */
async function loadPdfModule(): Promise<typeof PdfModule> {
  try {
    return await import("@/lib/pdf");
  } catch (e) {
    throw new Error(`The PDF library could not be loaded: ${reason(e)}`);
  }
}

/**
 * Reads each token through a hidden element: `color: var(--token)` and getComputedStyle give rgb() or rgba() whatever
 * the stylesheet says (hash colors, minified forms). A missing or invalid token would silently inherit the parent's
 * color, so each token is read under two different parent colors and must give the same answer.
 */
function readTokenColors(names: readonly PdfTokenName[]): Map<PdfTokenName, string> {
  const host = document.createElement("div");
  const probe = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden";
  host.appendChild(probe);
  document.body.appendChild(host);
  try {
    const out = new Map<PdfTokenName, string>();
    for (const name of names) {
      probe.style.color = `var(${name})`;
      host.style.color = "black";
      const first = getComputedStyle(probe).color;
      host.style.color = "white";
      const second = getComputedStyle(probe).color;
      if (first === "" || first !== second) throw new Error(`The design token ${name} is missing or is not a color.`);
      out.set(name, first);
    }
    return out;
  } finally {
    host.remove();
  }
}

/** Looks up every token and checks that pdf.ts can parse it, so a bad token fails here in words and not at the click. */
function checkTokens(pdf: typeof PdfModule, values: ReadonlyMap<PdfTokenName, string>): void {
  for (const name of pdf.PDF_TOKENS) {
    const raw = values.get(name);
    if (raw === undefined || raw.trim() === "") throw new Error(`The design token ${name} has no value.`);
    try {
      pdf.parseTokenColor(raw);
    } catch (e) {
      throw new Error(`The design token ${name} is not a usable color: ${reason(e)}`);
    }
  }
}

/**
 * Settles with `work`, or rejects with `onTimeout()` after `ms`. The work itself may never finish (a stalled request,
 * a chunk that never arrives), so this races it against a timer instead of waiting for it. `abort` stops the work
 * when it can be stopped; a late result of the work is ignored.
 */
function withDeadline<T>(work: Promise<T>, ms: number, onTimeout: () => Error, abort?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { abort?.(); reject(onTimeout()); }, ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

const seconds = (ms: number) => Math.max(1, Math.round(ms / 1000));

async function fetchFont(fetchFile: (url: string, signal: AbortSignal) => Promise<Response>, file: string, ms: number): Promise<Uint8Array> {
  const controller = new AbortController();
  // The abort covers the request and the reading of the body; the race below covers a fetch that ignores the signal.
  const work = (async () => {
    let res: Response;
    try {
      res = await fetchFile(`/fonts/${file}`, controller.signal);
    } catch (e) {
      throw new Error(`The font ${file} could not be loaded: ${reason(e)}`);
    }
    return readFontResponse(res, file);
  })();
  return withDeadline(work, ms, () => new Error(`The font ${file} took longer than ${seconds(ms)} seconds to load.`), () => controller.abort());
}

/**
 * A warm-up with its own memo. The first call starts the work (three font files, the pdf module and the token
 * colors) and every later call gets the same promise. A failed attempt clears the memo, so the next call starts
 * a fresh one and a retry is possible.
 */
export function createPdfWarmup(deps: WarmupDeps = {}): () => Promise<PdfKit> {
  const fetchFile = deps.fetchFile ?? ((url: string, signal: AbortSignal) => fetch(url, { signal }));
  const loadPdf = deps.loadPdf ?? loadPdfModule;
  const readTokens = deps.readTokens ?? readTokenColors;
  const ms = deps.timeoutMs ?? WARMUP_TIMEOUT_MS;
  let memo: Promise<PdfKit> | null = null;

  async function attempt(): Promise<PdfKit> {
    const [pdf, sans, sansBold, mono] = await Promise.all([
      withDeadline(loadPdf(), ms, () => new Error(`The PDF library took longer than ${seconds(ms)} seconds to load.`)),
      fetchFont(fetchFile, FONT_FILES.sans, ms), fetchFont(fetchFile, FONT_FILES.sansBold, ms), fetchFont(fetchFile, FONT_FILES.mono, ms),
    ]);
    const tokens = readTokens(pdf.PDF_TOKENS);
    checkTokens(pdf, tokens);
    return { pdf, fonts: { sans, sansBold, mono }, tokens };
  }

  return function warmUp(): Promise<PdfKit> {
    if (!memo) {
      const started = attempt();
      memo = started;
      // Registered before any caller's handler, so the memo is already clear when a caller reacts to the failure.
      started.catch(() => { if (memo === started) memo = null; });
    }
    return memo;
  };
}

/**
 * The app's warm-up. The workspace schedules it (scheduleWarmup) once a project is open, so the fonts and the pdf
 * chunk are already in memory when the shop clicks Export, also with no network. The Estimate panel and the Export
 * button join the same memoized promise.
 */
export const warmUpPdf = createPdfWarmup();

/** The slice of the window that scheduleWarmup needs. Safari has no requestIdleCallback, so both are optional. */
export type IdleApi = {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/** Without requestIdleCallback the warm-up starts after this short delay, still after the first paint. */
export const WARMUP_FALLBACK_DELAY_MS = 500;
/** An idle callback that has not run after this long runs anyway. */
export const WARMUP_IDLE_TIMEOUT_MS = 5_000;

/**
 * Starts the warm-up when the browser is idle (or after a short delay without requestIdleCallback) and returns a
 * function that cancels a start that has not happened yet. A failure is not handled here: it clears the memo and
 * shows next to the Export button as "Prepare again".
 */
export function scheduleWarmup(start: () => Promise<unknown> = warmUpPdf, api: IdleApi = globalThis): () => void {
  const run = () => { start().catch(() => {}); };
  if (typeof api.requestIdleCallback === "function") {
    const handle = api.requestIdleCallback(run, { timeout: WARMUP_IDLE_TIMEOUT_MS });
    return () => api.cancelIdleCallback?.(handle);
  }
  const timer = setTimeout(run, WARMUP_FALLBACK_DELAY_MS);
  return () => clearTimeout(timer);
}

// ----------------------------------------------------------------------------- pictures

export type PdfSlot = "before" | "after" | "logo";
export type ImageIds = { before: string; after: string; logo: string | null };

/**
 * The only three images the PDF may read: the root version's, the head version's and the shop logo. A cutout,
 * a reference photo (kept in React state only) or a product picture has no way in.
 */
export function selectImageIds(root: Pick<ImageRef, "id">, head: { image: Pick<ImageRef, "id"> }, settings: Pick<ShopSettings, "logoImageId">): ImageIds {
  return { before: root.id, after: head.image.id, logo: settings.logoImageId };
}

export type ImagePlan =
  | { action: "use"; kind: "jpeg" | "png" }
  | { action: "convert"; to: "jpeg" | "png"; band: boolean }
  | { action: "refuse"; reason: string };

/**
 * What to do with one stored picture. Photos need rights "owner" or "visitor", the logo needs "owner". JPEG and PNG
 * go in as they are, WebP is converted (a photo to JPEG, a logo to PNG so transparency stays), anything else is refused.
 * In mock mode the after image is re-encoded as JPEG with the MOCK band whatever its format; the before photo is the
 * owner's real photo and never gets a band.
 */
export function planPdfImage(args: { slot: PdfSlot; rights: ImageRef["rights"]; format: SniffedFormat; mock: boolean }): ImagePlan {
  const { slot, rights, format, mock } = args;
  if (slot === "logo" ? rights !== "owner" : rights !== "owner" && rights !== "visitor") {
    return { action: "refuse", reason: slot === "logo" ? "the logo is not marked as the shop's own" : "it comes from an outside web source" };
  }
  if (format !== "jpeg" && format !== "png" && format !== "webp") return { action: "refuse", reason: "the PDF cannot use this image format" };
  if (slot === "after" && mock) return { action: "convert", to: "jpeg", band: true };
  if (format === "webp") return { action: "convert", to: slot === "logo" ? "png" : "jpeg", band: false };
  return { action: "use", kind: format };
}

export type ImageDeps = {
  read: (id: string) => Promise<StoredImage | null>;
  toJpeg: (blob: Blob, band: boolean) => Promise<Blob>;
  toPng: (blob: Blob) => Promise<Blob>;
};

export type PdfImages = { before: PdfImage | null; after: PdfImage | null; logo: PdfImage | null; leftOut: string[] };

const SLOT_NAME: Record<PdfSlot, string> = { before: "Before photo", after: "After image", logo: "Shop logo" };

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A prepared picture, or the reason it is left out. */
type Prepared = { image: PdfImage } | { why: string };

/** Turns one stored picture into the bytes pdf.ts embeds. Every failure becomes a "left out" reason, never another image. */
async function prepareImage(slot: PdfSlot, stored: StoredImage | null, readError: string | null, mock: boolean, deps: ImageDeps): Promise<Prepared> {
  if (readError) return { why: `it could not be read: ${readError}` };
  if (!stored) return { why: "it is not stored in this browser" };
  try {
    const source = new Uint8Array(await stored.blob.arrayBuffer());
    const plan = planPdfImage({ slot, rights: stored.rights, format: sniffFormat(source), mock });
    if (plan.action === "refuse") return { why: plan.reason };
    let bytes = source;
    let hash = stored.hash;
    if (plan.action === "convert") {
      const blob = plan.to === "png" ? await deps.toPng(stored.blob) : await deps.toJpeg(stored.blob, plan.band);
      bytes = new Uint8Array(await blob.arrayBuffer());
      hash = await sha256Hex(blob);
    }
    // Trust the bytes, not the stored numbers: pdf.ts refuses a stated size that differs from the file.
    const kind = sniffFormat(bytes);
    const size = headerSize(bytes);
    if ((kind !== "jpeg" && kind !== "png") || !size || size.width < 1 || size.height < 1) return { why: "its file could not be read as JPEG or PNG" };
    return { image: { bytes, kind, width: size.width, height: size.height, hash, rights: stored.rights } };
  } catch (e) {
    return { why: `it could not be prepared: ${reason(e)}` };
  }
}

/**
 * Reads each distinct id once and prepares the three slots. A missing, unreadable or refused picture is null and
 * listed in leftOut, so the PDF says it was left out. Nothing is ever substituted.
 *
 * When the head is the root version, the after image IS the before photo (no visual change yet): it is prepared
 * once as the before photo, gets no mock band (it is the owner's real photo) and carries the same hash, so pdf.ts
 * prints it once as the original.
 */
export async function loadPdfImages(ids: ImageIds, mock: boolean, deps: ImageDeps): Promise<PdfImages> {
  const leftOut: string[] = [];
  const settle = (slot: PdfSlot, p: Prepared): PdfImage | null => {
    if ("image" in p) return p.image;
    leftOut.push(`${SLOT_NAME[slot]}: left out (${p.why}).`);
    return null;
  };
  // One read per distinct id; a read error becomes a reason, so one bad record cannot stop the export.
  const reads = new Map<string, Promise<{ stored: StoredImage | null; error: string | null }>>();
  const readOnce = (id: string) => {
    let one = reads.get(id);
    if (!one) {
      one = deps.read(id).then((stored) => ({ stored, error: null }), (e: unknown) => ({ stored: null, error: reason(e) }));
      reads.set(id, one);
    }
    return one;
  };
  const prepare = async (slot: PdfSlot, id: string) => {
    const { stored, error } = await readOnce(id);
    return prepareImage(slot, stored, error, mock, deps);
  };
  const before = await prepare("before", ids.before);
  const after = ids.after === ids.before ? before : await prepare("after", ids.after);
  const logo = ids.logo === null ? null : await prepare("logo", ids.logo);
  // Settled in page order, so the notes read before, after, logo.
  const settled = { before: settle("before", before), after: settle("after", after), logo: logo && settle("logo", logo) };
  return { ...settled, leftOut };
}

// ------------------------------------------------------------------------------- the file

export type BuildPdfArgs = {
  h: DreamDb;
  project: Project;
  /** The saved head the snapshot was made from. */
  head: Version;
  /** The root version's image. The before photo is this one. */
  rootImage: ImageRef;
  settings: ShopSettings;
  settingsId: string;
  bikeRevision: BikeRevision | null;
  appMode: AppMode;
  /** Computed from the same head and settings, with the same `now`. */
  snapshot: EstimateSnapshot;
  /** Milliseconds: the estimate date and the file's creation date. */
  now: number;
};

export type BuiltPdf = { bytes: Uint8Array; fileName: string; draft: boolean; leftOut: string[] };

/**
 * Builds the PDF bytes from the warm kit (no network) and the three pictures in IndexedDB. Call it only after the
 * warm-up resolved; if it did not, this starts one fresh attempt and would fetch the fonts.
 */
export async function buildPdf(args: BuildPdfArgs): Promise<BuiltPdf> {
  const kit = await warmUpPdf();
  const { h, project, head, snapshot } = args;
  const ids = selectImageIds(args.rootImage, head, args.settings);
  const images = await loadPdfImages(ids, args.appMode === "mock", { read: (id) => getStoredImage(h, id), toJpeg, toPng });
  const date = new Date(args.now);
  const input: EstimatePdfInput = {
    settings: args.settings, settingsId: args.settingsId, appMode: args.appMode, projectName: project.name,
    bikeRevision: args.bikeRevision,
    // The rows hold exactly the items the quote was made from, so the pieces cannot be mixed.
    items: snapshot.rows.map((r) => r.item), fees: head.fees, inspectionReview: head.inspectionReview,
    quote: snapshot.quote, rows: snapshot.rows, currentFitInputHash: snapshot.hash,
    head: { composed: head.composed, fallbackReason: head.fallbackReason },
    before: images.before, after: images.after, logo: images.logo,
    estimateDate: formatEstimateDate(date), createdAt: date,
  };
  const bytes = await kit.pdf.buildEstimatePdf(input, kit.fonts, (name) => kit.tokens.get(name));
  const draft = !isCompleteEstimate(snapshot.quote);
  return { bytes, fileName: pdfFileName(project.name, draft, date), draft, leftOut: images.leftOut };
}
