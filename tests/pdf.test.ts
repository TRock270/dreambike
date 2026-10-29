// Estimate PDF (SPEC 11): layout geometry, the written file, its content streams and its wording.
// The fonts are the real Plex files from public/fonts and the colors come from src/styles/tokens.css, so a
// width, a missing glyph or a bad token shows up here the same way it would in the browser.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream } from "pdf-lib";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  FONT_FILES, REVOKE_DELAY_MS, WARMUP_FALLBACK_DELAY_MS, WARMUP_IDLE_TIMEOUT_MS, WARMUP_TIMEOUT_MS, createPdfWarmup,
  downloadPdf, fileSlug, formatEstimateDate, hasTrueTypeSignature, isCompleteEstimate, loadPdfImages, pdfFileName,
  planPdfImage, readFontResponse, scheduleWarmup, selectImageIds, type ImageDeps,
} from "@/lib/browser/pdfExport";
import { mismatchText } from "@/components/ExportButton";
import { BuildItem, COMPOSITE_REASONS, Fee } from "@/lib/contracts";
import { estimateSnapshot } from "@/lib/estimate";
import { MOCK_LABEL } from "@/lib/mocks";
import { FIT_PRECHECK_NOTE, FIT_TTL_MS, LEGAL_SEED, fitInputHash, fitReviewHash, newRootVersion } from "@/lib/project";
import { EXAMPLE_LABEL, EXAMPLE_SETTINGS, REAL_SETTINGS_DEFAULT } from "@/lib/quote";
import {
  PDF_PAGE, PDF_TOKENS, buildEstimatePdf, embedFonts, layoutEstimate, parseTokenColor, resolveTheme,
  type EstimateLayout, type EstimatePdfInput, type LayoutBox, type PdfFontBytes, type PdfFonts, type PdfImage, type PdfTokenName,
} from "@/lib/pdf";
import * as pdfModule from "@/lib/pdf";
import { SLOTS } from "@/lib/slots";
import type { BikeRevision, BuildItemData, FeeData, FitData, ProductData, ShopSettings, SlotId, StoredImage } from "@/lib/types";

// ------------------------------------------------------------------ fixtures

const FONT_DIR = new URL("../public/fonts/", import.meta.url);
const FONT_BYTES: PdfFontBytes = {
  sans: new Uint8Array(readFileSync(new URL("IBMPlexSans-Regular.ttf", FONT_DIR))),
  sansBold: new Uint8Array(readFileSync(new URL("IBMPlexSans-SemiBold.ttf", FONT_DIR))),
  mono: new Uint8Array(readFileSync(new URL("IBMPlexMono-Regular.ttf", FONT_DIR))),
};

// Token values come from the stylesheet itself, so the test needs no color literal of its own.
const CSS = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const TOKEN_VALUES = new Map<string, string>();
for (const m of CSS.matchAll(/(--nl-[a-z0-9-]+)\s*:\s*([^;]+);/g)) if (!TOKEN_VALUES.has(m[1]!)) TOKEN_VALUES.set(m[1]!, m[2]!.trim());
const lookup = (name: string) => TOKEN_VALUES.get(name);

const id = () => crypto.randomUUID();
const NOW = Date.parse("2026-10-29T16:00:00.000Z");
const CHECKED = "2026-10-29T15:00:00.000Z";
const CREATED = new Date("2026-10-29T16:00:00.000Z");
// Every address in the fixtures is on a reserved example domain: no fixture points at a real authority page.
const SOURCE_URL = "https://example.com/test-source";
const FIXTURE_WORDS = "Test fixture — not a real check";
// The QA files show this on page 1: the bike line, the fit results and the sources are all test data.
const FIXTURE_LABEL = `${FIXTURE_WORDS}. Bike, fit results and sources in this file are test data.`;
const M = PDF_PAGE.margin;
const CONTENT_W = PDF_PAGE.width - 2 * M;
const EPS = 0.05;

const BIKE: BikeRevision = {
  id: id(), confirmed: true, revision: 2, confirmedAt: 1,
  bike: {
    make: "Harley-Davidson", model: "Sportster 883", family: "sportster", engine: null, yearFrom: 2012, yearTo: 2018,
    abs: "no", style: null, facing: "right", confidence: 0.8, limitations: [],
  },
};

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** A JPEG with a few shapes on it, drawn from an SVG that uses rgb() colors. */
async function jpeg(width: number, height: number, tint: number): Promise<PdfImage> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="rgb(${tint}, ${180 - tint / 2}, ${255 - tint})"/>
    <circle cx="${width / 3}" cy="${(height * 2) / 3}" r="${height / 6}" fill="rgb(40, 40, 50)"/>
    <circle cx="${(width * 2) / 3}" cy="${(height * 2) / 3}" r="${height / 6}" fill="rgb(40, 40, 50)"/>
    <rect x="${width / 3}" y="${height / 3}" width="${width / 3}" height="${height / 10}" fill="rgb(200, 60, 40)"/>
  </svg>`;
  const bytes = new Uint8Array(await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer());
  return { bytes, kind: "jpeg", width, height, hash: sha(bytes), rights: "owner" };
}
async function png(width: number, height: number): Promise<PdfImage> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="rgb(20, 90, 120)"/><circle cx="${width / 2}" cy="${height / 2}" r="${height / 3}" fill="rgb(250, 250, 250)"/></svg>`;
  const bytes = new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
  return { bytes, kind: "png", width, height, hash: sha(bytes), rights: "owner" };
}
type Photos = { before: PdfImage; after: PdfImage; logo: PdfImage };
async function syntheticPhotos(width = 400, height = 300): Promise<Photos> {
  return { before: await jpeg(width, height, 100), after: await jpeg(width, height, 160), logo: await png(300, 100) };
}

type ItemSpec = {
  slot: SlotId; title?: string; price?: number | null; basis?: BuildItemData["taxBasis"]; minutes?: number | null;
  fit?: Partial<FitData> | null; product?: ProductData | null; reviewed?: boolean; costKind?: BuildItemData["costKind"];
  checkedAt?: string;
};

function fitFor(itemId: string, over: Partial<FitData> = {}): FitData {
  return {
    itemId, status: "ok", approval: "abe", documentCoverage: "covered", inspection: "none", eintragung: "not_required",
    carryDocuments: "not_required",
    reasons: [`${FIXTURE_WORDS}. The ABE covers this bike.`], toMeasure: [], extraParts: [], conditions: [],
    sources: [{ url: SOURCE_URL, title: "Source address (test)", accessedAt: "2026-10-29T14:00:00.000Z", supports: "approval" }],
    confidence: 0.6, ...over,
  };
}

const PRODUCT: ProductData = {
  id: id(), name: "Steel tank", brand: "Acme", partNumber: "T-100", url: "https://example.com/tank",
  imageUrl: "https://example.com/tank.jpg", priceText: "119 EUR", priceEurCents: 11900, taxBasis: "gross",
  approval: "abe", approvalText: null, fulfillmentRegion: "eu",
  source: { url: "https://example.com/tank", title: "Tank", accessedAt: "2026-10-29T14:00:00.000Z", supports: "price" },
  linkState: "reachable",
};

type ScenarioSpec = {
  items: ItemSpec[];
  settings?: ShopSettings;
  fees?: (items: BuildItemData[]) => FeeData[];
  review?: "none" | "fees_added" | "unresolved" | null;
  reviewNotes?: string;
  confirmedBike?: boolean;
  bike?: BikeRevision | null;
  /** The bike when the snapshot is made, if it differs from the bike the fits were checked against (the build changed since). */
  snapshotBike?: BikeRevision | null;
  now?: number;
  appMode?: EstimatePdfInput["appMode"];
  projectName?: string;
  images?: Partial<Pick<EstimatePdfInput, "before" | "after" | "logo">>;
  head?: EstimatePdfInput["head"];
};

/** Builds a consistent snapshot through estimateSnapshot, the same path the app uses. */
async function scenario(spec: ScenarioSpec): Promise<EstimatePdfInput> {
  const settings = spec.settings ?? EXAMPLE_SETTINGS;
  const now = spec.now ?? NOW;
  const bike = spec.bike === undefined ? { ...BIKE, confirmed: spec.confirmedBike ?? true } : spec.bike;
  const bare = spec.items.map((s): BuildItemData => {
    const itemId = id();
    return {
      id: itemId, slot: s.slot, title: s.title ?? `${s.slot} item`, spec: [], intent: "paint", product: s.product ?? null,
      costKind: s.costKind ?? "part", partPriceCents: s.price === undefined ? 11900 : s.price, taxBasis: s.basis ?? "gross",
      laborMinutes: s.minutes === undefined ? 90 : s.minutes,
      fit: null, fitInputHash: null, fitCheckedAt: null, zeroLaborConfirmed: false, mechanicNotes: "", fitReviewedHash: null,
      originVersionId: id(),
    };
  });
  // The fit hash only depends on the physical item data, so it can be computed before the fits are attached.
  // It is made for the scenario's own bike, so a different confirmed bike keeps its fits current.
  const hash = await fitInputHash(bike ?? BIKE, bare, settings.shopRules, LEGAL_SEED.version);
  const items: BuildItemData[] = [];
  for (const [i, item] of bare.entries()) {
    const s = spec.items[i]!;
    if (s.fit === null) { items.push(item); continue; }
    const checkedAt = s.checkedAt ?? CHECKED;
    const withFit: BuildItemData = { ...item, fit: fitFor(item.id, s.fit), fitInputHash: hash, fitCheckedAt: checkedAt };
    const expired = now - Date.parse(checkedAt) > FIT_TTL_MS;
    items.push(s.reviewed === false ? withFit : { ...withFit, fitReviewedHash: await fitReviewHash(withFit, expired) });
  }
  const fees = spec.fees ? spec.fees(items) : [];
  const review = spec.review === undefined ? "none" : spec.review;
  const root = newRootVersion({
    id: id(), projectId: id(), createdAt: 0, image: { id: id(), hash: "a".repeat(64), width: 10, height: 10, bytes: 1, rights: "owner" },
  });
  const head = {
    ...root, items, fees,
    inspectionReview: review === null ? null : { fitInputHash: hash, decision: review, notes: spec.reviewNotes ?? "", reviewedAt: CHECKED },
  };
  const settingsId = settings.demoRates ? "example" : "default";
  const shownBike = spec.snapshotBike === undefined ? bike : spec.snapshotBike;
  const snapshot = await estimateSnapshot({ head, settings, settingsId, bikeRevision: shownBike, now });
  return {
    settings, settingsId, appMode: spec.appMode ?? "demo_only", projectName: spec.projectName ?? "Sportster tank test",
    bikeRevision: shownBike, items, fees, inspectionReview: head.inspectionReview, quote: snapshot.quote, rows: snapshot.rows,
    currentFitInputHash: snapshot.hash,
    head: spec.head ?? { composed: true, fallbackReason: null },
    before: spec.images?.before, after: spec.images?.after, logo: spec.images?.logo,
    estimateDate: "29 Oct 2026", createdAt: CREATED,
  };
}

const coverAll = (items: BuildItemData[]): FeeData[] => [{
  id: id(), label: "Allowance", kind: "other", netCents: 10000, itemIds: items.map((i) => i.id), confirmed: true,
}];

/** One tank and one allowance: the required SPEC fixture (EUR 416.50 gross). Fits on exactly one page. */
function completeScenario(photos?: Partial<Photos>, settings: ShopSettings = EXAMPLE_SETTINGS): Promise<EstimatePdfInput> {
  return scenario({
    settings, items: [{ slot: "tank", title: "Blue metallic tank paint" }], fees: coverAll,
    projectName: `${FIXTURE_LABEL} Sportster tank`, images: photos,
  });
}

const SENTENCE = "The part has no approval that names this model, so the mechanic compares the part number with the papers and measures the mounting points before the order is placed.";
const LONG_URL = "https://example.com/test-source/long-address/with%20percent%2Dencoded/segments/that%20need%20to%20wrap/by/character/because/no/space/exists/in/this/address/at/all/test-only/?a=1&b=2";

/** Five parts with real paperwork text and three fee lines. Fills exactly three pages. */
function longScenario(photos?: Partial<Photos>): Promise<EstimatePdfInput> {
  const reasons = (n: number) => Array.from({ length: n }, (_, i) => `${FIXTURE_WORDS} (${i + 1}). ${SENTENCE}`);
  const short = { url: SOURCE_URL, title: "Source address (test)", accessedAt: "2026-10-29T14:00:00.000Z", supports: "x" };
  const long = { url: LONG_URL, title: "Long source address (test)", accessedAt: "2026-10-28T09:30:00.000Z", supports: "y" };
  const checked = (slot: SlotId, title: string, over: Partial<FitData>, extra: Partial<ItemSpec> = {}): ItemSpec => ({
    slot, title, fit: { sources: [short], reasons: [`${FIXTURE_WORDS}. ${SENTENCE}`], ...over }, ...extra,
  });
  return scenario({
    settings: { ...EXAMPLE_SETTINGS, quoteNotes: "Payment: half of the amount when the parts are ordered.\nThe rest is due on pick-up.\nParts are ordered only after your written confirmation." },
    items: [
      checked("tank", "Candy red tank paint", { status: "verify", sources: [short, long], reasons: reasons(1), toMeasure: ["Tank mounting bolts: length and thread"] }, { price: 11900 }),
      checked("wheel_front", "Spoked front wheel, 21 inch", { status: "problem", sources: [long], inspection: "einzelabnahme", eintragung: "required", carryDocuments: "required", reasons: reasons(1), conditions: ["Wheel papers must name this bike."], extraParts: ["Brake disc adapter", "Axle spacer"] }, { price: 54900, minutes: null }),
      checked("exhaust", "Slip-on exhaust with ABE", { status: "verify", inspection: "aenderungsabnahme", eintragung: "required", carryDocuments: "required", reasons: reasons(1), toMeasure: ["Sound level at the standing test"] }, { price: 38900 }),
      checked("handlebar", "Drag bars, 1 inch", { inspection: "aenderungsabnahme", approval: "teilegutachten" }, { price: 8900, minutes: null }),
      checked("seat", "Solo seat", { reasons: reasons(1), approval: "e_mark" }, { price: 24900, basis: "net" }),
    ],
    fees: (items) => {
      const by = (slot: SlotId) => items.find((i) => i.slot === slot)!.id;
      return [
        { id: id(), label: "Änderungsabnahme (estimated) — example rate", kind: "aenderungsabnahme", netCents: 5042, itemIds: [by("exhaust"), by("handlebar")], confirmed: true },
        { id: id(), label: "Einzelabnahme (estimated) — example rate", kind: "einzelabnahme", netCents: 15126, itemIds: [by("wheel_front")], confirmed: true },
        { id: id(), label: "Zulassungsstelle fee (official fee, no VAT)", kind: "official_fee", netCents: 1500, itemIds: [by("wheel_front"), by("exhaust")], confirmed: true },
      ];
    },
    review: "fees_added", reviewNotes: "Both inspections are booked for the same day.",
    projectName: `${FIXTURE_LABEL} Sportster custom build`, images: photos,
  });
}

/** A part without a price: the estimate stays a draft with a known subtotal and no grand total. */
function draftScenario(photos?: Partial<Photos>): Promise<EstimatePdfInput> {
  return scenario({
    items: [{ slot: "tank", title: "Blue tank paint" }, { slot: "seat", title: "Solo seat", price: null }],
    fees: coverAll, projectName: `${FIXTURE_LABEL} Draft with an unknown price`, images: photos,
  });
}

function longText(words: number): string {
  return Array.from({ length: words }, (_, i) => (i % 7 === 0 ? "Änderungsabnahme" : "Teilegutachten")).join(" ");
}

// ------------------------------------------------------------------ helpers

let fonts: PdfFonts;
let photos: Photos;
beforeAll(async () => {
  fonts = await embedFonts(await PDFDocument.create(), FONT_BYTES);
  photos = await syntheticPhotos();
});

const build = (input: EstimatePdfInput) => buildEstimatePdf(input, FONT_BYTES, lookup);
const layoutOf = (input: EstimatePdfInput) => layoutEstimate(input, fonts);
type TextBox = Extract<LayoutBox, { kind: "text" }>;
const textBoxes = (layout: EstimateLayout, page?: number): TextBox[] =>
  layout.pages.filter((p) => page === undefined || p.number === page)
    .flatMap((p) => p.boxes.filter((b): b is TextBox => b.kind === "text"));
const textOf = (layout: EstimateLayout, page?: number) => textBoxes(layout, page).map((b) => b.text).join("\n");

type Extent = { left: number; right: number; top: number; bottom: number };
function extent(b: LayoutBox): Extent {
  switch (b.kind) {
    case "icon": return { left: b.x, right: b.x + b.size, top: b.top, bottom: b.top + b.size };
    case "rule": return { left: b.x, right: b.x + b.width, top: b.top, bottom: b.top };
    default: return { left: b.x, right: b.x + b.width, top: b.top, bottom: b.top + b.height };
  }
}
const overlaps = (a: Extent, b: Extent) =>
  a.left < b.right - EPS && b.left < a.right - EPS && a.top < b.bottom - EPS && b.top < a.bottom - EPS;
/** Boxes that carry ink the reader sees as content (not backgrounds or hairlines). */
const inked = (boxes: LayoutBox[]) => boxes.filter((b) => b.kind === "text" || b.kind === "icon" || b.kind === "image");

/** What a written PDF contains, read back from its content streams and font maps. */
type PageInfo = {
  width: number; height: number; fontSizes: number[]; positions: { x: number; y: number }[]; texts: string[];
  glyphIds: number[]; imageRefs: string[]; imageDraws: number;
};
function parseCmap(source: string): Map<number, string> {
  const map = new Map<number, string>();
  const body = source.slice(source.indexOf("beginbfchar"), source.indexOf("endbfchar"));
  for (const m of body.matchAll(/<([0-9a-fA-F]{4})>\s*<([0-9a-fA-F]+)>/g)) {
    const units = m[2]!.match(/.{4}/g)!.map((h) => parseInt(h, 16));
    map.set(parseInt(m[1]!, 16), String.fromCharCode(...units));
  }
  return map;
}
const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);
// Without updateMetadata:false pdf-lib stamps the current time into the loaded copy.
const load = (bytes: Uint8Array) => PDFDocument.load(bytes, { updateMetadata: false });

async function inspect(bytes: Uint8Array): Promise<{ pages: PageInfo[]; text: string; pageText: string[] }> {
  const pdf = await load(bytes);
  const pages: PageInfo[] = [];
  for (const page of pdf.getPages()) {
    const node = page.node.Contents();
    const streams = node instanceof PDFArray
      ? Array.from({ length: node.size() }, (_, i) => pdf.context.lookup(node.get(i), PDFStream) as PDFRawStream)
      : [node as PDFRawStream];
    const content = streams.map((s) => latin1(decodePDFRawStream(s).decode())).join("\n");
    const resources = page.node.Resources()!;
    const fontMaps = new Map<string, Map<number, string>>();
    const fontDict = resources.lookup(PDFName.of("Font"), PDFDict);
    for (const [name, ref] of fontDict.entries()) {
      const font = pdf.context.lookup(ref, PDFDict);
      const toUnicode = font.lookup(PDFName.of("ToUnicode"), PDFStream) as PDFRawStream;
      fontMaps.set(name.toString().slice(1), parseCmap(latin1(decodePDFRawStream(toUnicode).decode())));
    }
    const xobjects = resources.lookupMaybe(PDFName.of("XObject"), PDFDict);
    const imageRefs = xobjects ? xobjects.entries().map(([, ref]) => (ref as PDFRef).toString()) : [];
    const info: PageInfo = { ...page.getSize(), fontSizes: [], positions: [], texts: [], glyphIds: [], imageRefs, imageDraws: 0 };
    let font = "";
    const num = "(-?[\\d.e+-]+)";
    const ops = new RegExp(`/(F\\d+)\\s+([\\d.]+)\\s+Tf|${num} ${num} ${num} ${num} ${num} ${num} Tm|<([0-9A-Fa-f]+)>\\s*Tj|/(Im\\d+)\\s+Do`, "g");
    for (const m of content.matchAll(ops)) {
      if (m[1]) { font = m[1]; info.fontSizes.push(Number(m[2])); }
      else if (m[3]) info.positions.push({ x: Number(m[7]), y: Number(m[8]) });
      else if (m[9]) {
        const ids = m[9].match(/.{4}/g)!.map((h) => parseInt(h, 16));
        info.glyphIds.push(...ids);
        info.texts.push(ids.map((g) => fontMaps.get(font)?.get(g) ?? "\x00").join(""));
      } else if (m[10]) info.imageDraws++;
    }
    pages.push(info);
  }
  return { pages, text: pages.flatMap((p) => p.texts).join("\n"), pageText: pages.map((p) => p.texts.join("\n")) };
}

const uniqueImages = (pages: PageInfo[]) => new Set(pages.flatMap((p) => p.imageRefs)).size;

/** True when every surrogate half has its partner. */
function wellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++; else return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}

// ------------------------------------------------------------------ theme

describe("theme tokens", () => {
  const hex = TOKEN_VALUES.get("--nl-text")!;           // a 6 digit value from the stylesheet
  const white = TOKEN_VALUES.get("--nl-text-on-fill")!; // all pairs repeat, so the short forms exist
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

  it("every token the PDF reads exists in the stylesheet and resolves", () => {
    for (const name of PDF_TOKENS) expect(TOKEN_VALUES.has(name), name).toBe(true);
    const theme = resolveTheme(lookup);
    expect(Object.keys(theme).sort()).toEqual([...PDF_TOKENS].sort());
    expect(theme["--nl-hairline"].a).toBeLessThan(1); // the hairline is translucent: drawn with opacity
    expect(theme["--nl-text"].a).toBe(1);
  });

  it("accepts the hash forms (3, 4, 6, 8 digits), any case, and trims", () => {
    const six = parseTokenColor(hex);
    expect(six).toEqual({ r: r / 255, g: g / 255, b: b / 255, a: 1 });
    expect(parseTokenColor(`  ${hex}\n`)).toEqual(six);
    const short = `#${white[1]}${white[3]}${white[5]}`;
    expect(parseTokenColor(short)).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(parseTokenColor(`${short}8`).a).toBeCloseTo(0x88 / 255, 6);
    expect(parseTokenColor(`${hex}80`)).toEqual({ ...six, a: 0x80 / 255 });
    expect(parseTokenColor(hex.toUpperCase())).toEqual(six);
  });

  it("accepts rgb() and rgba() in the comma form and the space/slash form", () => {
    const six = parseTokenColor(hex);
    for (const text of [
      `rgb(${r}, ${g}, ${b})`, `rgb(${r},${g},${b})`, `RGB( ${r} ${g} ${b} )`, `rgb(${r} ${g} ${b})`,
      `rgba(${r}, ${g}, ${b}, 1)`, `rgb(${r} ${g} ${b} / 1)`, `  rgb(${r} ${g} ${b} / 100%) `,
    ]) expect(parseTokenColor(text), text).toEqual(six);
    for (const text of [`rgba(${r}, ${g}, ${b}, 0.13)`, `rgba(${r},${g},${b},.13)`, `rgb(${r} ${g} ${b} / 0.13)`, `rgb(${r} ${g} ${b} / 13%)`, `rgba(${r} ${g} ${b} / .13)`]) {
      expect(parseTokenColor(text), text).toEqual({ ...six, a: 0.13 });
    }
    expect(parseTokenColor("rgb(100% 0% 50%)")).toEqual({ r: 1, g: 0, b: 0.5, a: 1 });
    expect(parseTokenColor(TOKEN_VALUES.get("--nl-hairline")!).a).toBeCloseTo(0.13, 6);
  });

  it("throws on anything else", () => {
    for (const bad of [
      "", "  ", "red", "transparent", hex.slice(0, 3), hex.slice(0, 6), `${hex}f`, `${hex.slice(0, 1)}ggg`, "#", "rgb(1, 2)", "rgb(1, 2, 3, 4, 5)", "rgb(a, b, c)",
      "rgb(1 2 3 / )", "rgb(1, 2, 3 / 0.5)", "rgb(1 2 3 / 0.5 / 0.5)", "rgb(1, 2, 3", "hsl(0 0% 0%)", "oklch(0.5 0.1 200)",
      "color(srgb 1 0 0)", "var(--nl-text)", "rgb(-1, 2, 3)", "rgb(none 2 3)", "rgb(1e2, 2, 3)",
    ]) expect(() => parseTokenColor(bad), JSON.stringify(bad)).toThrow();
  });

  it("a missing or broken token stops the build before anything is drawn", async () => {
    expect(() => resolveTheme((name) => (name === "--nl-text" ? undefined : lookup(name)))).toThrow(/--nl-text/);
    expect(() => resolveTheme((name) => (name === "--nl-text" ? "red" : lookup(name)))).toThrow();
    await expect(buildEstimatePdf(await completeScenario(), FONT_BYTES, () => "")).rejects.toThrow(/no value/);
  });

  // The only modules pdf.ts may import. Anything else (react, a component, a .tsx file, the browser glue) fails the test,
  // so a new import has to be added here on purpose.
  const PDF_IMPORT_ALLOWLIST = [
    "@pdf-lib/fontkit", "pdf-lib",
    "@/lib/server/config", // type only
    "./estimate", "./imageFormat", "./mocks", "./project", "./quote", "./slots", "./types",
  ];
  /** Every module specifier of an import, side-effect import, re-export, dynamic import or require in the code. */
  function importedModules(code: string): string[] {
    const found = [...code.matchAll(/\b(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]!);
    found.push(...[...code.matchAll(/^\s*import\s*["']([^"']+)["']/gm)].map((m) => m[1]!));
    found.push(...[...code.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']/g)].map((m) => m[1]!));
    return found;
  }

  it("pdf.ts carries no color literal, no network call, and imports only the allowed modules", () => {
    const full = readFileSync(new URL("../src/lib/pdf.ts", import.meta.url), "utf8");
    // Comments may mention the words; code may not use them.
    const source = full.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\brgba?\(\s*\d/);
    expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|indexedDB|\bdocument\.|\bwindow\./);
    const modules = importedModules(source);
    expect(modules.length).toBeGreaterThanOrEqual(9); // the scan finds the imports at all
    expect(modules.filter((m) => !PDF_IMPORT_ALLOWLIST.includes(m))).toEqual([]);
    // Every `from` clause was seen by the scan: nothing hides in a form the scan does not read.
    expect(modules).toHaveLength([...source.matchAll(/\bfrom\s*["']/g)].length);
    expect(source).not.toMatch(/\brequire\s*\(|\bimport\s*\(/);
    // The server config is a type here: a value import would pull server code into the browser bundle.
    expect(source).toMatch(/import type \{ AppMode \} from "@\/lib\/server\/config"/);
    expect(source).not.toMatch(/^import \{[^}]*\} from "@\/lib\/server\/config"/m);
  });

  it("the import scan sees every form, so a forbidden module cannot slip past the allowlist", () => {
    const sample = [
      'import React from "react";', 'import { A } from "../components/Foo.tsx";', 'import type { B } from "@/components/Bar";',
      'import "side-effect";', 'export { C } from "./other";', 'const d = await import("lazy");', 'const e = require("old");',
      'import {\n  X,\n  Y,\n} from "multi-line";',
    ].join("\n");
    expect(importedModules(sample).sort()).toEqual(
      ["../components/Foo.tsx", "@/components/Bar", "./other", "lazy", "multi-line", "old", "react", "side-effect"].sort(),
    );
  });
});

// ------------------------------------------------------------------ layout geometry

function expectInsideMargins(layout: EstimateLayout): void {
  for (const page of layout.pages) {
    expect(page.footerTop).toBeGreaterThan(page.contentBottom);
    expect(page.footerTop + 13.5).toBeLessThanOrEqual(PDF_PAGE.height - M + EPS);
    for (const box of page.boxes) {
      const e = extent(box);
      expect(e.left, `${box.role} left`).toBeGreaterThanOrEqual(M - EPS);
      expect(e.right, `${box.role} right`).toBeLessThanOrEqual(PDF_PAGE.width - M + EPS);
      expect(e.top, `${box.role} top`).toBeGreaterThanOrEqual(M - EPS);
      if (box.role === "footer") expect(e.top, "footer").toBeGreaterThanOrEqual(page.footerTop - 4 - EPS);
      else expect(e.bottom, `${box.role} bottom`).toBeLessThanOrEqual(page.contentBottom + EPS);
      if (box.kind === "text") expect(box.size).toBeGreaterThanOrEqual(10);
    }
  }
}

function expectNoOverlap(layout: EstimateLayout): void {
  for (const page of layout.pages) {
    const boxes = inked(page.boxes);
    for (let i = 0; i < boxes.length; i++) {
      const a = extent(boxes[i]!);
      for (let j = i + 1; j < boxes.length; j++) {
        if (overlaps(a, extent(boxes[j]!))) {
          throw new Error(`page ${page.number}: ${JSON.stringify(boxes[i])} overlaps ${JSON.stringify(boxes[j])}`);
        }
      }
    }
    // Rows: the vertical span of each group on a page is disjoint from every other group's span.
    const spans = new Map<string, { top: number; bottom: number }>();
    for (const box of boxes) {
      if (!box.group || !/^(item|fee|paper):/.test(box.group)) continue;
      const e = extent(box);
      const s = spans.get(box.group);
      spans.set(box.group, s ? { top: Math.min(s.top, e.top), bottom: Math.max(s.bottom, e.bottom) } : { top: e.top, bottom: e.bottom });
    }
    const sorted = [...spans.values()].sort((a, b) => a.top - b.top);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.top).toBeGreaterThanOrEqual(sorted[i - 1]!.bottom - EPS);
  }
}

async function manyItems(count: number): Promise<EstimatePdfInput> {
  const slots = SLOTS.map((s) => s.id).slice(0, count);
  return scenario({ items: slots.map((slot) => ({ slot, title: `Part ${slot}` })), fees: coverAll, images: photos });
}

describe("layout geometry", () => {
  const fixtures: [string, () => Promise<EstimatePdfInput>][] = [
    ["complete", () => completeScenario(photos)],
    ["long", () => longScenario(photos)],
    ["draft", () => draftScenario(photos)],
    ["many rows", () => manyItems(16)],
  ];

  for (const [name, make] of fixtures) {
    it(`${name}: every box lies inside the margins and above the footer`, async () => {
      expectInsideMargins(layoutOf(await make()));
    });
    it(`${name}: no two pieces of content overlap and rows do not interleave`, async () => {
      expectNoOverlap(layoutOf(await make()));
    });
  }

  it("stays sound with a long date, long shop and project names, a three-line footer and unbreakable text", async () => {
    const longName = "Nordwerk Customs und Fahrzeugtechnik für Sonderumbauten GmbH & Co. KG ".repeat(2).trim().slice(0, 200);
    const input = await scenario({
      settings: { ...EXAMPLE_SETTINGS, shopName: longName, quoteNotes: "x".repeat(900) },
      items: [{ slot: "tank", title: "T".repeat(200), fit: { reasons: ["y".repeat(1500)] } }, { slot: "seat", price: null }],
      fees: coverAll, appMode: "mock", projectName: "P".repeat(200), confirmedBike: false,
      images: photos, head: { composed: false, fallbackReason: "z".repeat(300) },
    });
    const layout = layoutOf({ ...input, estimateDate: "Thursday, 29 October 2026, 16:00 Eastern Daylight Time (UTC-4)" });
    expectInsideMargins(layout);
    expectNoOverlap(layout);
    // The footer needed more than one line, and every page still has its page number.
    expect(layout.pages[0]!.contentBottom).toBeLessThan(PDF_PAGE.height - M - 13.5 - 8);
    layout.pages.forEach((page, i) => expect(page.boxes.some((b) => b.kind === "text" && b.text === `Page ${i + 1} of ${layout.pages.length}`)).toBe(true));
    // Nothing is cut: the long shop name and the long word come out whole.
    expect(textBoxes(layout, 1).filter((b) => b.role === "shop").map((b) => b.text).join(" ")).toBe(longName);
    expect(textBoxes(layout).filter((b) => b.role === "note" && /^x+$/.test(b.text)).map((b) => b.text).join("")).toBe("x".repeat(900));
  });

  it("repeats the table header on every page that holds table rows, and the table really spans pages", async () => {
    const layout = layoutOf(await manyItems(16));
    expect(layout.pages.length).toBeGreaterThanOrEqual(2);
    const withRows = layout.pages.filter((p) => p.boxes.some((b) => b.role === "row" || b.role === "fee-row"));
    expect(withRows.length).toBeGreaterThanOrEqual(2);
    for (const page of withRows) {
      const headers = page.boxes.filter((b): b is TextBox => b.role === "table-header" && b.kind === "text").map((b) => b.text);
      expect(headers, `page ${page.number}`).toEqual(["Line", "Part net", "Labor net", "Line net"]);
      // The header sits above the first row of its page.
      const headerTop = Math.min(...page.boxes.filter((b) => b.role === "table-header").map((b) => b.top));
      const rowTop = Math.min(...page.boxes.filter((b) => b.role === "row" || b.role === "fee-row").map((b) => b.top));
      expect(headerTop).toBeLessThan(rowTop);
    }
    // Every item row appears exactly once.
    const groups = textBoxes(layout).filter((b) => b.role === "row" && b.group?.startsWith("item:")).map((b) => b.group);
    expect(new Set(groups).size).toBe(16);
  });

  it("keeps every URL line inside its column at the real font width", async () => {
    const layout = layoutOf(await longScenario(photos));
    const urls = textBoxes(layout).filter((b) => b.role === "url");
    expect(urls.length).toBeGreaterThan(1);
    for (const box of urls) {
      const real = fonts.mono.widthOfTextAtSize(box.text, box.size);
      expect(real).toBeLessThanOrEqual(CONTENT_W - 12 + EPS);
      expect(box.x).toBeGreaterThanOrEqual(M + 12 - EPS);
      expect(box.x + real).toBeLessThanOrEqual(PDF_PAGE.width - M + EPS);
      expect(box.font).toBe("mono");
    }
    // The long address is cut by character and nothing is lost: the pieces join back to the full address.
    expect(urls.map((b) => b.text).join("")).toContain(LONG_URL);
  });

  it("wraps a 2048-character URL by character without losing or reordering anything", async () => {
    const url = `https://example.com/${"abcdefghij".repeat(202)}12345678`;
    expect(url).toHaveLength(2048);
    const input = await scenario({ items: [{ slot: "tank", fit: { sources: [{ url, title: "Long", accessedAt: CHECKED, supports: "x" }] } }] });
    const pieces = textBoxes(layoutOf(input)).filter((b) => b.role === "url");
    expect(pieces.length).toBeGreaterThan(20);
    expect(pieces.map((b) => b.text).join("")).toBe(url);
    for (const piece of pieces) expect(fonts.mono.widthOfTextAtSize(piece.text, 10)).toBeLessThanOrEqual(CONTENT_W - 12 + EPS);
  });

  it("a block taller than the space left splits line by line and the next page continues it", async () => {
    const input = await scenario({
      items: [{ slot: "tank", fit: { reasons: Array.from({ length: 12 }, (_, i) => `${i}. ${longText(130)}`) } }], images: photos,
    });
    const layout = layoutOf(input);
    expect(layout.pages.length).toBeGreaterThan(2);
    const lines = textBoxes(layout).filter((b) => b.group?.startsWith("paper:") && b.x >= M + 120 - EPS && b.role === "paperwork");
    expect(lines.length).toBeGreaterThan(60);
    // The text of the 12 reasons is complete and in order across the page breaks.
    const joined = lines.map((b) => b.text).join(" ");
    expect(joined.match(/Änderungsabnahme/g)!.length).toBeGreaterThanOrEqual(12 * 19);
  });
});

// ------------------------------------------------------------------ the written file

describe("written PDF", () => {
  it("round-trips through PDFDocument.load as A4 with exact page counts", async () => {
    const complete = await build(await completeScenario(photos));
    const long = await build(await longScenario(photos));
    const draft = await build(await draftScenario(photos));
    for (const bytes of [complete, long, draft]) {
      expect(new TextDecoder("latin1").decode(bytes.subarray(0, 5))).toBe("%PDF-");
      const pdf = await load(bytes);
      for (const page of pdf.getPages()) {
        const { width, height } = page.getSize();
        expect(width).toBeCloseTo(595.28, 2);
        expect(height).toBeCloseTo(841.89, 2);
      }
    }
    expect((await load(complete)).getPageCount()).toBe(1);
    expect((await load(long)).getPageCount()).toBe(3);
    expect((await load(draft)).getPageCount()).toBe(2);
    // The layout agrees with the file.
    expect(layoutOf(await completeScenario(photos)).pages).toHaveLength(1);
    expect(layoutOf(await longScenario(photos)).pages).toHaveLength(3);
  });

  it("sets a fixed creation date and metadata; the same input gives the same bytes", async () => {
    const input = await completeScenario(photos);
    const a = await build(input);
    const b = await build(input);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const pdf = await load(a);
    expect(pdf.getCreationDate()?.toISOString()).toBe(CREATED.toISOString());
    expect(pdf.getModificationDate()?.toISOString()).toBe(CREATED.toISOString());
    expect(pdf.getTitle()).toContain("Estimate");
    expect(pdf.getAuthor()).toBe("Nordwerk Customs");
    expect(pdf.getProducer()).toBe("DreamBike");
  });

  it("does not depend on the time zone of the machine", async () => {
    const input = await completeScenario(photos);
    const zone = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati";
      const hoursEast = CREATED.getHours();
      const east = await build(input);
      process.env.TZ = "America/Los_Angeles";
      const hoursWest = CREATED.getHours();
      const west = await build(input);
      expect(hoursEast).not.toBe(hoursWest); // the zone switch really took effect
      expect(Buffer.from(east).equals(Buffer.from(west))).toBe(true);
      expect((await load(east)).getCreationDate()?.toISOString()).toBe(CREATED.toISOString());
    } finally {
      if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone;
    }
  });

  it("content streams: every text is 10 pt or more, inside the margins, with no missing-glyph id", async () => {
    for (const input of [await completeScenario(photos), await longScenario(photos), await draftScenario(photos)]) {
      const { pages } = await inspect(await build(input));
      for (const page of pages) {
        expect(page.texts.length).toBeGreaterThan(5);
        expect(Math.min(...page.fontSizes)).toBeGreaterThanOrEqual(10);
        for (const p of page.positions) {
          expect(p.x).toBeGreaterThanOrEqual(M - EPS);
          expect(p.x).toBeLessThanOrEqual(PDF_PAGE.width - M + EPS);
          expect(p.y).toBeGreaterThanOrEqual(M - EPS); // baselines stay above the bottom margin
          expect(p.y).toBeLessThanOrEqual(PDF_PAGE.height - M + EPS);
        }
        expect(page.glyphIds.length).toBeGreaterThan(0);
        expect(page.glyphIds.every((g) => g > 0)).toBe(true); // glyph 0 is the font's "missing character" box
        expect(page.texts.every((t) => !t.includes("\x00"))).toBe(true); // every glyph maps back to text
      }
    }
  });

  it("every page draws exactly the text runs the layout planned", async () => {
    const input = await longScenario(photos);
    const layout = layoutOf(input);
    const { pages } = await inspect(await build(input));
    expect(pages).toHaveLength(layout.pages.length);
    pages.forEach((page, i) => {
      expect(page.texts).toEqual(layout.pages[i]!.boxes.flatMap((b) => (b.kind === "text" ? [b.text] : [])));
    });
  });

  it("registers fonts and opacity states once per page, not once per draw call", async () => {
    const pdf = await load(await build(await longScenario(photos)));
    for (const page of pdf.getPages()) {
      const fontDict = page.node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
      expect(fontDict.keys().length).toBeLessThanOrEqual(3);
      const states = page.node.Resources()!.lookupMaybe(PDFName.of("ExtGState"), PDFDict);
      expect(states?.keys().length ?? 0).toBeLessThanOrEqual(4);
    }
  });
});

// ------------------------------------------------------------------ pictures

describe("pictures", () => {
  it("draws exactly the supplied before, after and logo images", async () => {
    const info = await inspect(await build(await completeScenario(photos)));
    expect(uniqueImages(info.pages)).toBe(3);
    expect(info.pages.reduce((n, p) => n + p.imageDraws, 0)).toBe(3);
    const none = await inspect(await build(await completeScenario()));
    expect(uniqueImages(none.pages)).toBe(0);
    const logoOnly = await inspect(await build(await completeScenario({ logo: photos.logo })));
    expect(uniqueImages(logoOnly.pages)).toBe(1);
  });

  it("a product with an imageUrl adds no picture and never prints that address", async () => {
    const input = await scenario({ items: [{ slot: "tank", product: PRODUCT }], fees: coverAll });
    expect(layoutOf(input).images).toEqual([]);
    const info = await inspect(await build(input));
    expect(uniqueImages(info.pages)).toBe(0);
    expect(info.text).not.toContain("tank.jpg");
    expect(info.text).toContain("Acme Steel tank, part no. T-100");
  });

  it("a stray reference image on the input has no way into the file (T7)", async () => {
    const base = await completeScenario({ before: photos.before });
    const input = { ...base, referenceImage: photos.after, reference: photos.after, productImage: photos.after };
    const info = await inspect(await build(input as unknown as EstimatePdfInput));
    expect(uniqueImages(info.pages)).toBe(1);
  });

  it("an external_runtime image is skipped with a note in words", async () => {
    const outside = { ...photos.after, rights: "external_runtime" as const };
    const input = await completeScenario({ before: photos.before, after: outside, logo: { ...photos.logo, rights: "external_runtime" } });
    const layout = layoutOf(input);
    expect(layout.images).toEqual(["before"]);
    expect(textOf(layout)).toContain("After image: outside web source, left out.");
    expect(textOf(layout)).toContain("The shop logo is not included.");
    expect(uniqueImages((await inspect(await build(input))).pages)).toBe(1);
  });

  it("a picture the caller did not supply is left out with a note, and nothing replaces it", async () => {
    const layout = layoutOf(await completeScenario({ before: photos.before }));
    expect(layout.images).toEqual(["before"]);
    expect(textOf(layout)).toContain("After image: not supplied, left out.");
    const noBefore = layoutOf(await completeScenario({ after: photos.after }));
    expect(noBefore.images).toEqual(["after"]);
    expect(textOf(noBefore)).toContain("Before photo: not supplied, left out.");
  });

  it("head equal to root gives one photo captioned 'no visual change yet'", async () => {
    const input = await completeScenario({ before: photos.before, after: { ...photos.before } });
    const layout = layoutOf(input);
    expect(layout.images).toEqual(["before"]);
    expect(textOf(layout)).toContain("no visual change yet");
    expect(textOf(layout)).not.toContain("AI visualization, not a photograph.");
    expect(uniqueImages((await inspect(await build(input))).pages)).toBe(1);
  });

  it("two different pictures are captioned as original and AI visualization", async () => {
    const text = textOf(layoutOf(await completeScenario(photos)));
    expect(text).toContain("Before: original photo.");
    expect(text).toContain("After: AI visualization, not a photograph.");
  });

  it("the page count does not depend on the aspect ratio of the photos", async () => {
    const shapes: [number, number][] = [[400, 300], [300, 400], [1200, 200], [200, 1200], [50, 50]];
    for (const [w, h] of shapes) {
      const shaped = { before: await jpeg(w, h, 100), after: await jpeg(w, h, 160), logo: photos.logo };
      expect(layoutOf(await completeScenario(shaped)).pages, `${w}x${h}`).toHaveLength(1);
      expect(layoutOf(await longScenario(shaped)).pages, `${w}x${h}`).toHaveLength(3);
    }
  });

  it("keeps each picture's aspect ratio inside a fixed box", async () => {
    const layout = layoutOf(await completeScenario({ before: await jpeg(1200, 200, 100), after: await jpeg(200, 1200, 160), logo: photos.logo }));
    const images = layout.pages[0]!.boxes.filter((b): b is Extract<LayoutBox, { kind: "image" }> => b.kind === "image");
    const by = (slot: string) => images.find((b) => b.slot === slot)!;
    expect(by("before").width / by("before").height).toBeCloseTo(6, 3);
    expect(by("after").width / by("after").height).toBeCloseTo(1 / 6, 3);
    expect(by("logo").width / by("logo").height).toBeCloseTo(3, 3);
    for (const slot of ["before", "after"]) expect(by(slot).height).toBeLessThanOrEqual(120 + EPS);
  });

  it("prints the fallback reason only when the head is not composed and a reason exists", async () => {
    const text = async (head: EstimatePdfInput["head"]) => textOf(layoutOf(await scenario({ items: [{ slot: "tank" }], head, images: photos })));
    expect(await text({ composed: false, fallbackReason: "geometry" })).toContain("Not blended into the original photo (the shape of the part changed).");
    expect(await text({ composed: true, fallbackReason: "geometry" })).not.toContain("Not blended");
    expect(await text({ composed: false, fallbackReason: null })).not.toContain("Not blended");
  });

  it("says every fallback reason in words and never prints the raw code, also for a code it does not know", async () => {
    const text = async (code: string) => textOf(layoutOf(await scenario({ items: [{ slot: "tank" }], head: { composed: false, fallbackReason: code }, images: photos })));
    const phrases = new Set<string>();
    for (const code of COMPOSITE_REASONS.filter((c) => c !== "composited")) {
      const printed = await text(code);
      const sentence = /Not blended into the original photo \(([^)]+)\)\./.exec(printed.replace(/\n/g, " "));
      expect(sentence, code).not.toBeNull();
      expect(sentence![1], code).not.toBe("for a technical reason"); // a known code has its own phrase
      expect(printed, code).not.toContain(`(${code})`);
      expect(printed, code).not.toMatch(/missing_mask|no_outside_area/);
      phrases.add(sentence![1]!);
    }
    expect(phrases.size).toBe(COMPOSITE_REASONS.length - 1); // one phrase per code
    const unknown = await text("future_reason_v2");
    expect(unknown).toContain("Not blended into the original photo (for a technical reason). The after image replaces the whole picture.");
    expect(unknown).not.toContain("future_reason_v2");
  });
});

// ------------------------------------------------------------------ behavior

describe("estimate behavior", () => {
  it("a complete estimate shows known subtotal, net, VAT and gross and is not a draft", async () => {
    const input = await completeScenario(photos);
    expect(input.quote).toMatchObject({ incomplete: false, netCents: 35000, vatCents: 6650, grossCents: 41650 });
    const layout = layoutOf(input);
    expect(layout.draft).toBe(false);
    const text = textOf(layout);
    for (const expected of ["Estimate", "Known subtotal (net, only the costs known so far)", "Net total", "VAT 19 %", "Gross total", "€416.50", "€66.50", "€350.00", "€100.00", "€150.00"]) {
      expect(text, expected).toContain(expected);
    }
    expect(text).not.toContain("Incomplete draft");
    expect(text).not.toContain("(not on the official fee)");
  });

  it("an official fee changes the VAT line label and stays out of the VAT base", async () => {
    const input = await scenario({
      items: [{ slot: "tank" }],
      fees: (items) => [...coverAll(items), { id: id(), label: "Zulassungsstelle fee (official fee, no VAT)", kind: "official_fee", netCents: 1500, itemIds: [], confirmed: true }],
    });
    expect(input.quote).toMatchObject({ netCents: 36500, vatCents: 6650, grossCents: 43150 });
    const text = textOf(layoutOf(input));
    expect(text).toContain("VAT 19 % (not on the official fee)");
    expect(text).toContain("official fee, no VAT");
    expect(text).toContain("€431.50");
    expect(text).toContain("€365.00");
  });

  it("a draft shows the warning, the known subtotal and the exclusions, and no grand total", async () => {
    const input = await draftScenario(photos);
    expect(input.quote.incomplete).toBe(true);
    const layout = layoutOf(input);
    expect(layout.draft).toBe(true);
    const text = textOf(layout);
    expect(text).toContain("Incomplete draft — costs missing");
    expect(text).toContain("No net, VAT or gross total is shown, because an unknown cost is never counted as 0.");
    expect(text).toContain("Known subtotal (net, only the costs known so far)");
    expect(text).toContain("€350.00");
    expect(text).toContain("Missing or unresolved");
    expect(text).toContain("Solo seat: part price unknown");
    for (const absent of ["Net total", "Gross total", "VAT 19 %"]) expect(text).not.toContain(absent);
    // The written file says the same, and its title names the draft.
    const bytes = await build(input);
    const written = await inspect(bytes);
    expect(written.text).toContain("Incomplete draft — costs missing");
    expect(written.text).not.toContain("Gross total");
    expect((await load(bytes)).getTitle()).toContain("Incomplete draft");
  });

  it("a null price prints 'Unknown', never EUR 0.00", async () => {
    const input = await scenario({ items: [{ slot: "tank", price: null }, { slot: "seat", minutes: null }] });
    const text = textOf(layoutOf(input));
    expect(text).toContain("Unknown");
    expect(text).not.toContain("€0.00");
    // A second, fully known item keeps the known subtotal above zero, so any "0.00" would be a wrongly printed unknown.
    const unknownBasis = textOf(layoutOf(await scenario({ items: [{ slot: "tank", basis: "unknown" }, { slot: "seat" }] })));
    expect(unknownBasis).toContain("Unknown");
    expect(unknownBasis).not.toContain("€0.00");
  });

  it("an otherwise complete quote with one unreviewed fit renders as a draft: a complete export needs mechanic review", async () => {
    const input = await scenario({ items: [{ slot: "tank" }, { slot: "seat", reviewed: false }], fees: coverAll });
    expect(input.quote.exclusions.join()).toMatch(/not reviewed/);
    const layout = layoutOf(input);
    expect(layout.draft).toBe(true);
    expect(textOf(layout)).not.toContain("Gross total");
    expect(textOf(layout)).toContain("seat item: fit not reviewed by the mechanic");
  });

  it("an item whose fit was never checked says so and has no paperwork values", async () => {
    const input = await scenario({ items: [{ slot: "tank", fit: null }], fees: coverAll });
    const layout = layoutOf(input);
    const text = textOf(layout);
    expect(text).toContain("Not checked");
    expect(text).toContain("No fit check on record. Approval, inspection and Eintragung are unknown.");
    expect(text).not.toContain("Document coverage");
    expect(layout.draft).toBe(true);
  });

  it("an expired but reviewed fit gives a complete PDF that still shows the stale notice and the verify word", async () => {
    const input = await scenario({
      items: [{ slot: "tank", fit: { status: "verify", reasons: ["The exact model year is not confirmed."] }, checkedAt: "2026-10-28T10:00:00.000Z" }],
      fees: coverAll,
    });
    expect(input.quote).toMatchObject({ incomplete: false, staleFitItemIds: [input.items[0]!.id] });
    expect(input.rows[0]).toMatchObject({ expired: true, reviewed: true, status: "stale" });
    const layout = layoutOf(input);
    expect(layout.draft).toBe(false);
    const text = textOf(layout);
    expect(text).toContain("Gross total");
    expect(text).toContain("Stale fit check");
    expect(text).toContain("tank item: Verify fit when last checked, older than 24 h.");
    expect(text).toContain("Check is stale");
    // The reviewed finding still prints prominently: one line with the title, the fit word and the check date.
    expect(text).toContain("Open fit findings, acknowledged by the mechanic");
    expect(text).toContain("tank item: Verify fit, checked 2026-10-28");
    // The reason is printed once, in the paperwork summary, not repeated in the notice.
    expect(text.split("The exact model year is not confirmed.")).toHaveLength(2);
    const written = await inspect(await build(input));
    expect(written.text).toContain("Gross total");
    expect(written.text).toContain("Stale fit check");
  });

  it("an out-of-date fit (the build changed) says 'out of date', not 'older than 24 h'", async () => {
    const input = await scenario({ items: [{ slot: "tank" }], fees: coverAll });
    const stale = {
      ...input,
      quote: { ...input.quote, staleFitItemIds: [input.items[0]!.id] },
      rows: input.rows.map((r) => ({ ...r, hashMatches: false, expired: false, status: "stale" as const })),
    };
    expect(textOf(layoutOf(stale))).toContain("tank item: Fit ok when last checked, out of date.");
  });

  it("verify and problem findings the mechanic acknowledged print in a prominent notice", async () => {
    const text = textOf(layoutOf(await longScenario(photos)));
    expect(text).toContain("Open fit findings, acknowledged by the mechanic");
    expect(text).toContain("Candy red tank paint: Verify fit, checked 2026-10-29");
    expect(text).toContain("Spoked front wheel, 21 inch: Fit problem, checked 2026-10-29");
    expect(text).toContain("Reviewed by the mechanic");
    expect(text).toContain("Gross total");
  });

  it("an unconfirmed fee is not counted and says so; an unknown fee amount says 'Unknown'", async () => {
    const input = await scenario({
      items: [{ slot: "tank" }],
      fees: (items) => [
        { id: id(), label: "Änderungsabnahme (estimated)", kind: "aenderungsabnahme", netCents: 5042, itemIds: [items[0]!.id], confirmed: false },
        { id: id(), label: "Zulassungsstelle fee (official fee, no VAT)", kind: "official_fee", netCents: null, itemIds: [], confirmed: false },
      ],
    });
    const layout = layoutOf(input);
    const text = textOf(layout);
    expect(input.quote.knownSubtotalNetCents).toBe(25000);
    expect(text).toContain("€50.42");
    expect(text).toContain("(not counted)");
    expect(text).toContain("estimated, not confirmed");
    expect(text).toContain("official fee, no VAT, not confirmed");
    expect(text).toContain("Covers: tank item");
    expect(text).toContain("Unknown");
    expect(text).toContain("€250.00"); // the known subtotal does not include the unconfirmed fee
    expect(text).not.toContain("€300.42");
    expect(text).not.toContain("€0.00");
    expect(layout.draft).toBe(true);
  });

  it("flags shop default minutes and labor-only parts", async () => {
    const input = await scenario({
      items: [{ slot: "tank", minutes: null }, { slot: "seat", costKind: "labor_only", price: 0, basis: "net" }], fees: coverAll,
    });
    const text = textOf(layoutOf(input));
    expect(text).toContain("(shop default minutes)");
    expect(text).toContain("(labor only)");
  });

  it("the fit words and chips are copied from the build sheet", async () => {
    const input = await scenario({
      items: [{ slot: "tank" }, { slot: "seat", fit: { status: "verify" } }, { slot: "mirrors", fit: { status: "problem" } }, { slot: "grips", fit: null }],
      fees: coverAll,
    });
    const layout = layoutOf(input);
    const text = textOf(layout);
    for (const word of ["Fit ok", "Verify fit", "Fit problem", "Not checked", "Reviewed by the mechanic"]) expect(text, word).toContain(word);
    const shapes = new Set(layout.pages.flatMap((p) => p.boxes.flatMap((b) => (b.kind === "icon" ? [b.shape] : []))));
    for (const shape of ["check", "warning", "cross", "unchecked"]) expect(shapes.has(shape as never), shape).toBe(true);
  });

  it("the paperwork summary uses the labels of the build sheet, then that item's own sources", async () => {
    const layout = layoutOf(await longScenario(photos));
    const text = textOf(layout);
    for (const label of ["Paperwork summary", "Approval", "Document coverage", "Inspection", "Eintragung", "Documents to carry", "Reasons", "Conditions", "Things to measure", "Extra parts", "Sources"]) {
      expect(text, label).toContain(label);
    }
    for (const word of ["ABE", "E-mark", "Teilegutachten", "Covers this bike", "Änderungsabnahme", "Einzelabnahme", "Required", "Not required", "Carry the documents"]) expect(text, word).toContain(word);
    expect(text).toContain("accessed 2026-10-29");
    // Each item's sources come after that item's own fields, and no other item sits in between.
    const boxes = textBoxes(layout).filter((b) => b.group?.startsWith("paper:"));
    const groups = [...new Set(boxes.map((b) => b.group))];
    expect(groups).toHaveLength(5);
    for (const group of groups) {
      const own = boxes.filter((b) => b.group === group);
      const reasons = own.findIndex((b) => b.text === "Reasons");
      const sources = own.findIndex((b) => b.text === "Sources");
      const firstUrl = own.findIndex((b) => b.role === "url");
      expect(reasons).toBeGreaterThan(-1);
      expect(sources).toBeGreaterThan(reasons);
      expect(firstUrl).toBeGreaterThan(sources);
      const span = boxes.slice(boxes.indexOf(own[0]!), boxes.indexOf(own.at(-1)!) + 1);
      expect(span.every((b) => b.group === group)).toBe(true);
    }
  });

  it("an item without sources says so instead of leaving a gap", async () => {
    const input = await scenario({ items: [{ slot: "tank", fit: { sources: [] } }], fees: coverAll });
    expect(textOf(layoutOf(input))).toContain("No sources. Without a source the result stays a pre-check to verify.");
  });

  it("closing blocks: inspection review, shop notes, visualization note, pre-check note, estimate disclaimer", async () => {
    const input = await scenario({
      settings: { ...EXAMPLE_SETTINGS, quoteNotes: "Payment on pick-up.\nNo warranty on paint." }, items: [{ slot: "tank" }], fees: coverAll,
      review: "fees_added", reviewNotes: "Both fees checked with the inspector.",
    });
    const text = textOf(layoutOf(input));
    for (const expected of [
      "Notes", "Inspection review", "Inspection fees were added (reviewed 2026-10-29).", "Both fees checked with the inspector.",
      "Shop notes", "Payment on pick-up.", "No warranty on paint.", "The after image is an AI visualization, not a photograph of a finished bike.",
      FIT_PRECHECK_NOTE.slice(0, 40), "This is an estimate, not an invoice or road-use certificate.",
    ]) expect(text, expected).toContain(expected);
    const missing = layoutOf(await scenario({ items: [{ slot: "tank" }], fees: coverAll, review: null }));
    expect(textOf(missing)).toContain("No inspection review is on record.");
    expect(missing.draft).toBe(true);
  });

  it("the example label shows for demo rates, in the body and in every footer; real settings never print it", async () => {
    const layout = layoutOf(await longScenario(photos));
    expect(textOf(layout, 1)).toContain(EXAMPLE_LABEL);
    for (const page of layout.pages) {
      expect(page.boxes.some((b) => b.kind === "text" && b.role === "footer" && b.text.includes(EXAMPLE_LABEL)), `page ${page.number}`).toBe(true);
    }
    const real = layoutOf(await completeScenario(photos, { ...REAL_SETTINGS_DEFAULT, shopConfirmed: true, hourlyRateNetCents: 10000, shopName: "Real Shop GmbH" }));
    expect(textOf(real)).not.toContain(EXAMPLE_LABEL);
    expect(textOf(real)).toContain("Real Shop GmbH");
  });

  it("the mock label shows for appMode 'mock' and for a mock fit result", async () => {
    const mockMode = layoutOf(await scenario({ items: [{ slot: "tank" }], fees: coverAll, appMode: "mock", images: photos }));
    expect(textOf(mockMode, 1)).toContain(MOCK_LABEL);
    expect(mockMode.pages[0]!.boxes.some((b) => b.kind === "text" && b.role === "footer" && b.text.includes(MOCK_LABEL))).toBe(true);
    const live = layoutOf(await scenario({ items: [{ slot: "tank" }], fees: coverAll, appMode: "live" }));
    expect(textOf(live)).not.toContain(MOCK_LABEL);
    const mockFit = await scenario({ items: [{ slot: "tank", fit: { reasons: [`${MOCK_LABEL}. No research was done.`] } }], fees: coverAll });
    const layout = layoutOf(mockFit);
    expect(textOf(layout)).toContain(MOCK_LABEL);
    expect(textOf(layout)).toContain("Mock result");
    expect(layout.draft).toBe(true);
  });

  it("in mock mode the after image is captioned as a mock placeholder, never as an AI visualization", async () => {
    const mock = layoutOf(await scenario({ items: [{ slot: "tank" }], fees: coverAll, appMode: "mock", images: photos }));
    expect(textOf(mock, 1)).toContain("After: mock placeholder, not an AI result.");
    expect(textOf(mock)).not.toContain("AI visualization");
    const live = layoutOf(await scenario({ items: [{ slot: "tank" }], fees: coverAll, appMode: "live", images: photos }));
    expect(textOf(live, 1)).toContain("After: AI visualization, not a photograph.");
  });

  it("prints what each source supports under its title, as the build sheet does", async () => {
    const source = { url: SOURCE_URL, title: "Fixture ABE (test)", accessedAt: CHECKED, supports: "Backs the ABE coverage for this model" };
    const layout = layoutOf(await scenario({ items: [{ slot: "tank", fit: { sources: [source] } }], fees: coverAll }));
    const boxes = layout.pages.flatMap((p) => p.boxes.filter((b) => b.kind === "text"));
    const at = (text: string) => boxes.findIndex((b) => b.kind === "text" && b.text.includes(text));
    expect(at("Backs the ABE coverage for this model")).toBeGreaterThan(at("Fixture ABE (test)"));
    expect(at(SOURCE_URL)).toBeGreaterThan(at("Backs the ABE coverage for this model"));
  });

  it("the export button's complete rule and the PDF's draft flag agree on every kind of quote", async () => {
    const inputs = [
      await completeScenario(),
      await draftScenario(),
      await scenario({ items: [{ slot: "tank" }, { slot: "seat", reviewed: false }], fees: coverAll }),
      await scenario({ items: [{ slot: "tank" }], fees: coverAll, review: null }),
      await scenario({ items: [{ slot: "tank" }], fees: coverAll, now: Date.parse(CHECKED) + FIT_TTL_MS + 60_000 }),
    ];
    const verdicts = inputs.map((input) => [isCompleteEstimate(input.quote), !layoutOf(input).draft]);
    for (const [button, pdf] of verdicts) expect(button).toBe(pdf);
    expect(verdicts.map(([button]) => button)).toContain(true);
    expect(verdicts.map(([button]) => button)).toContain(false);
  });

  it("an unconfirmed or missing bike says 'Bike not confirmed' and prints 'unknown' for null fields", async () => {
    const unconfirmed = textOf(layoutOf(await scenario({ items: [{ slot: "tank" }], fees: coverAll, confirmedBike: false })));
    expect(unconfirmed).toContain("Bike not confirmed: these values are not verified.");
    expect(unconfirmed).toContain("Make Harley-Davidson · Model Sportster 883 · Years 2012–2018 · ABS no");
    const none = textOf(layoutOf(await scenario({ items: [{ slot: "tank" }], fees: coverAll, bike: null })));
    expect(none).toContain("Make unknown · Model unknown · Years unknown · ABS unknown");
    expect(none).toContain("Bike not confirmed");
    expect(textOf(layoutOf(await completeScenario()))).not.toContain("Bike not confirmed");
    const partial = textOf(layoutOf(await scenario({
      items: [{ slot: "tank" }], fees: coverAll,
      bike: { ...BIKE, bike: { ...BIKE.bike, make: null, model: null, yearTo: null, abs: "unknown" } },
    })));
    expect(partial).toContain("Make unknown · Model unknown · Years from 2012 · ABS unknown");
  });

  it("the project name, date, short reference and shop name are on page one", async () => {
    const input = await completeScenario(photos);
    const text = textOf(layoutOf(input), 1);
    expect(text).toContain(input.projectName);
    expect(text).toContain("29 Oct 2026");
    expect(text).toContain(input.quote.inputHash.slice(0, 8));
    expect(text).toContain("Nordwerk Customs");
  });

  it("every page carries 'Page n of N' and the shop name in the footer", async () => {
    const input = await longScenario(photos);
    const layout = layoutOf(input);
    expect(layout.pages).toHaveLength(3);
    layout.pages.forEach((page, i) => {
      const footer = page.boxes.filter((b): b is TextBox => b.role === "footer" && b.kind === "text").map((b) => b.text);
      expect(footer).toContain(`Page ${i + 1} of 3`);
      expect(footer.join(" ")).toContain("Nordwerk Customs");
    });
    const written = await inspect(await build(input));
    written.pageText.forEach((t, i) => expect(t).toContain(`Page ${i + 1} of 3`));
  });

  it("never touches the network", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    try {
      await build(await longScenario(photos));
      await build(await draftScenario());
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
});

// ------------------------------------------------------------------ fit notices, paperwork header, table start

/** The page that holds the first table header, and whether a table row sits on that same page. */
function firstTablePage(layout: EstimateLayout): { page: PageLayoutOf; hasRow: boolean } {
  const page = layout.pages.find((pg) => pg.boxes.some((b) => b.role === "table-header"))!;
  return { page, hasRow: page.boxes.some((b) => b.role === "row" || b.role === "fee-row") };
}
type PageLayoutOf = EstimateLayout["pages"][number];
/** Space left on a page above the footer, below everything that was placed before the table. */
const freeSpace = (page: PageLayoutOf) =>
  page.contentBottom - Math.max(...page.boxes.filter((b) => b.role !== "footer").map((b) => extent(b).bottom));

describe("open fit findings notice", () => {
  const CHECKED_OLD = "2026-10-28T10:00:00.000Z"; // 30 h before NOW: the check is stale, and was reviewed on the stale check

  it("many acknowledged findings and stale checks keep the table header on page 1, one short line per item", async () => {
    const input = await scenario({
      items: SLOTS.slice(0, 8).map((sl) => ({
        slot: sl.id, title: `Part ${sl.id} (finding)`, checkedAt: CHECKED_OLD,
        fit: { status: "verify" as const, reasons: [`${FIXTURE_WORDS}. ${SENTENCE}`] },
      })),
      fees: coverAll, images: photos,
    });
    expect(input.quote.staleFitItemIds).toHaveLength(8);
    expect(input.rows.every((r) => r.reviewed && r.hashMatches && r.expired)).toBe(true);
    const layout = layoutOf(input);
    const { page, hasRow } = firstTablePage(layout);
    expect(page.number, "the table starts on page 1").toBe(1);
    expect(hasRow, "and its first row is there too").toBe(true);
    const notice = textBoxes(layout, 1).filter((b) => b.role === "notice").map((b) => b.text);
    const lines = notice.filter((t) => /\(finding\): Verify fit, checked 2026-10-28$/.test(t));
    expect(lines).toHaveLength(8); // each item is one line with its title, the fit word and the check date
    expect(notice.some((t) => t.includes("compares the part number"))).toBe(false); // the reason stays in the paperwork summary
    expect(textOf(layout, 1)).toContain("Stale fit check");
    expect(textOf(layout).split("compares the part number")).toHaveLength(8 + 1); // once per item, in the paperwork
  });

  it("the Reviewed chip and the notice need a review of the current check, not one for an older build", async () => {
    const items: ItemSpec[] = [{ slot: "tank", title: "Tank paint", fit: { status: "verify", reasons: [`${FIXTURE_WORDS}. Check the tank mounting.`] } }, { slot: "seat", title: "Solo seat" }];
    const current = await scenario({ items, fees: coverAll });
    expect(current.rows.every((r) => r.reviewed && r.hashMatches)).toBe(true);
    const now = textOf(layoutOf(current));
    expect(now).toContain("Reviewed by the mechanic");
    expect(now).toContain("Open fit findings, acknowledged by the mechanic");
    // The bike was changed after the review: the review still matches the old check, but it reviews nothing current.
    const changed = await scenario({ items, fees: coverAll, snapshotBike: { ...BIKE, revision: 3 } });
    expect(changed.rows.every((r) => r.reviewed && !r.hashMatches)).toBe(true);
    const layout = layoutOf(changed);
    expect(layout.draft).toBe(true);
    for (const text of [textOf(layout), (await inspect(await build(changed))).text]) {
      expect(text).not.toContain("Reviewed by the mechanic");
      expect(text).not.toContain("Open fit findings, acknowledged by the mechanic");
      expect(text).toContain("Stale fit check");
    }
    // An expired but otherwise current check still counts as reviewed (the stale notice says it is old).
    const expired = await scenario({ items, fees: coverAll, now: NOW + 30 * 3_600_000 });
    expect(expired.rows.every((r) => r.expired && r.hashMatches && r.reviewed)).toBe(true);
    const expiredText = textOf(layoutOf(expired));
    expect(expiredText).toContain("Reviewed by the mechanic");
    expect(expiredText).toContain("Open fit findings, acknowledged by the mechanic");
    expect(expiredText).toContain("Stale fit check");
  });
});

describe("inspection review in the notes", () => {
  const items: ItemSpec[] = [{ slot: "tank" }];
  const flat = (input: EstimatePdfInput) => textOf(layoutOf(input)).replace(/\n/g, " ");

  it("marks a review made for another build as out of date, and says nothing for a current one", async () => {
    const current = await scenario({ items, fees: coverAll, review: "fees_added", reviewNotes: "Booked." });
    expect(current.currentFitInputHash).toBe(current.inspectionReview!.fitInputHash);
    expect(flat(current)).toContain("Inspection fees were added (reviewed 2026-10-29).");
    expect(flat(current)).not.toContain("out of date");
    // The bike changed: the saved review keeps the old hash.
    const changed = await scenario({ items, fees: coverAll, review: "fees_added", reviewNotes: "Booked.", snapshotBike: { ...BIKE, revision: 3 } });
    expect(changed.currentFitInputHash).not.toBeNull();
    expect(changed.currentFitInputHash).not.toBe(changed.inspectionReview!.fitInputHash);
    expect(flat(changed)).toContain("Inspection fees were added (reviewed 2026-10-29) (out of date: the bike, parts or shop rules changed). Booked.");
    expect((await inspect(await build(changed))).text.replace(/\n/g, " ")).toContain("(out of date: the bike, parts or shop rules changed)");
    // No confirmed bike: there is no current build for the review to match.
    const noBike = await scenario({ items, fees: coverAll, review: "none", snapshotBike: null });
    expect(noBike.currentFitInputHash).toBeNull();
    expect(flat(noBike)).toContain("No inspection fee is needed (reviewed 2026-10-29) (out of date:");
    // Without a review there is nothing to mark.
    expect(flat(await scenario({ items, fees: coverAll, review: null }))).not.toContain("out of date: the bike");
  });
});

describe("paperwork header row", () => {
  it("prints the fit check date, the same day the screen shows, next to each checked item's title", async () => {
    const input = await scenario({
      items: [
        { slot: "tank", title: "Fresh check" },
        { slot: "seat", title: "Older check", checkedAt: "2026-10-28T10:00:00.000Z" },
        { slot: "grips", title: "No check", fit: null },
      ],
      fees: coverAll,
    });
    const boxes = textBoxes(layoutOf(input)).filter((b) => b.group?.startsWith("paper:"));
    const title = (text: string) => boxes.find((b) => b.role === "paperwork" && b.text === text)!;
    const date = (text: string) => boxes.find((b) => b.group === title(text).group && b.text.startsWith("checked "));
    expect(date("Fresh check")?.text).toBe(`checked ${CHECKED.slice(0, 10)}`);
    expect(date("Older check")?.text).toBe("checked 2026-10-28");
    expect(date("No check")).toBeUndefined(); // nothing was checked, so no date is invented
    for (const name of ["Fresh check", "Older check"]) {
      // Same line as the title and to the right of it, in the header row.
      expect(Math.abs(date(name)!.top - title(name).top)).toBeLessThan(15);
      expect(date(name)!.x).toBeGreaterThan(title(name).x + title(name).width);
    }
  });
});

describe("table start", () => {
  it("never leaves the table header alone at the bottom of a page", async () => {
    // Longer project names push the table down by one line (13.5 pt) each, so one of them leaves exactly
    // enough room for the header and the first two lines of the first row but not for the whole row.
    let windowHits = 0;
    for (let lines = 1; lines <= 45; lines++) {
      const name = Array.from({ length: lines }, (_, i) => `Line ${i + 1}`).join("\n");
      const layout = layoutOf(await scenario({ items: [{ slot: "tank", title: "Blue tank paint" }], fees: coverAll, images: photos, projectName: name }));
      const { page, hasRow } = firstTablePage(layout);
      expect(hasRow, `${lines} lines: the header on page ${page.number} has its first row`).toBe(true);
      // Room for the 27.5 pt header plus two lines of the row (33 pt) was left on page 1, yet the table moved to page 2.
      if (page.number === 2 && freeSpace(layout.pages[0]!) >= 27.5 + 33 + 2) windowHits++;
    }
    expect(windowHits, "the sweep reached the case this test is about").toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ text handling

describe("text handling", () => {
  it("keeps German terms and the euro sign, also from decomposed input", async () => {
    const terms = ["Änderungsabnahme", "Einzelabnahme", "Eintragung", "Zulassungsstelle", "Größe", "Prüfung", "Fußraste"];
    const decomposed = terms.map((t) => t.normalize("NFD"));
    expect(decomposed[0]).not.toBe(terms[0]); // the input really is decomposed
    const input = await scenario({
      items: [{ slot: "tank", title: decomposed.join(" "), fit: { reasons: [decomposed.join(" · ")] } }], fees: coverAll,
      projectName: `${decomposed[0]} €`,
    });
    const layout = layoutOf(input);
    expect(layout.replacedCharacters).toBe(false);
    const text = textOf(layout);
    for (const term of terms) expect(text, term).toContain(term);
    expect(text).toContain("€416.50");
    expect(text).not.toContain("?");
    const written = await inspect(await build(input));
    for (const term of terms) expect(written.text, term).toContain(term);
    expect(written.text).not.toContain("?");
    expect(written.text).toContain("€");
    expect(written.pages.every((p) => p.glyphIds.every((g) => g > 0))).toBe(true);
  });

  it("breaks lines at newlines without a question mark; a tab becomes a space", async () => {
    const input = await scenario({
      settings: { ...EXAMPLE_SETTINGS, quoteNotes: "First line\nSecond line\r\nThird\tline\r\n\r\nAfter a blank line" },
      items: [{ slot: "tank" }], fees: coverAll,
    });
    const layout = layoutOf(input);
    const notes = textBoxes(layout).filter((b) => b.role === "note");
    const lines = ["First line", "Second line", "Third line", "After a blank line"].map((t) => notes.find((b) => b.text === t));
    expect(lines.every(Boolean)).toBe(true);
    const tops = lines.map((b) => b!.top);
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    expect(new Set(tops).size).toBe(4);
    expect(tops[3]! - tops[2]!).toBeGreaterThan(tops[2]! - tops[1]!); // the blank line leaves a gap
    expect(textOf(layout)).not.toContain("?");
    expect(layout.replacedCharacters).toBe(false);
    expect((await inspect(await build(input))).text).not.toContain("?");
  });

  it("replaces an emoji and a lone surrogate by one question mark each and adds a footnote", async () => {
    const emoji = String.fromCodePoint(0x1f6b2);
    const lone = String.fromCharCode(0xd83d);
    const input = await scenario({
      items: [{ slot: "tank", title: `Tank ${emoji} paint ${lone} done` }], fees: coverAll, projectName: `Bike ${emoji}`,
    });
    const layout = layoutOf(input);
    expect(layout.replacedCharacters).toBe(true);
    const text = textOf(layout);
    expect(text).toContain("Tank ? paint ? done");
    expect(text).toContain("A question mark stands for a character the PDF fonts cannot show, for example an emoji.");
    expect(text).not.toContain(emoji);
    expect(text).not.toContain(lone);
    const written = await inspect(await build(input));
    expect(written.text).toContain("Tank ? paint ? done");
    expect(written.pages.every((p) => p.glyphIds.every((g) => g > 0))).toBe(true);
    // Without such characters there is no footnote.
    expect(textOf(layoutOf(await completeScenario()))).not.toContain("A question mark stands for");
  });

  it("a long run of emoji wraps without splitting a pair: one question mark per emoji", async () => {
    const emoji = String.fromCodePoint(0x1f6b2);
    const layout = layoutOf(await scenario({ items: [{ slot: "tank", title: emoji.repeat(300) }], fees: coverAll }));
    const pieces = textBoxes(layout).filter((b) => b.role === "row" && /^\?+$/.test(b.text));
    expect(pieces.map((b) => b.text).join("")).toBe("?".repeat(300));
    for (const b of textBoxes(layout)) expect(wellFormed(b.text)).toBe(true);
  });

  it("maps common symbols without a glyph to ASCII and drops invisible characters", async () => {
    const warn = String.fromCodePoint(0x26a0);
    const zeroWidth = String.fromCodePoint(0x200b);
    const layout = layoutOf(await scenario({ items: [{ slot: "tank", title: `Check${zeroWidth}ed ${warn} tank` }], fees: coverAll }));
    expect(textOf(layout)).toContain("Checked (!) tank");
    expect(layout.replacedCharacters).toBe(false);
  });

  it("wraps a very long word by character inside its column", async () => {
    const title = "x".repeat(400);
    const layout = layoutOf(await scenario({ items: [{ slot: "tank", title }], fees: coverAll }));
    const pieces = textBoxes(layout).filter((b) => b.role === "row" && b.text.startsWith("x"));
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.map((b) => b.text).join("")).toBe(title);
    for (const b of pieces) expect(b.x + b.width).toBeLessThanOrEqual(M + (CONTENT_W - 300 - 8) + EPS);
  });
});

// ------------------------------------------------------------------ errors

describe("refuses bad input", () => {
  it("throws on a mixed snapshot: quote lines, fit rows and items must be the same items", async () => {
    const a = await completeScenario(photos);
    const b = await scenario({ items: [{ slot: "seat", title: "Other part" }], fees: coverAll });
    expect(() => layoutOf({ ...a, quote: b.quote })).toThrow(/mixed/);
    expect(() => layoutOf({ ...a, rows: b.rows })).toThrow(/mixed/);
    expect(() => layoutOf({ ...a, items: b.items })).toThrow(/mixed/);
    expect(() => layoutOf({ ...a, rows: [] })).toThrow(/mixed/);
    expect(() => layoutOf({ ...a, items: [...a.items, ...a.items] })).toThrow(/mixed/);
    expect(() => layoutOf({ ...a, quote: { ...a.quote, staleFitItemIds: [id()] } })).toThrow(/mixed/);
    // Same ids but a title that changed after the quote was made.
    expect(() => layoutOf({ ...a, items: a.items.map((i) => ({ ...i, title: "Renamed" })) })).toThrow(/mixed/);
    await expect(build({ ...a, quote: b.quote })).rejects.toThrow(/mixed/);
  });

  it("throws when the fit rows or the fee lines are not the ones the quote was made from", async () => {
    const a = await completeScenario(photos);
    // Rows made from other fit data: before the review, or before a recheck.
    const unreviewed = a.rows.map((r) => ({ ...r, item: { ...r.item, fitReviewedHash: null } }));
    expect(() => layoutOf({ ...a, rows: unreviewed })).toThrow(/fit row/);
    const rechecked = a.rows.map((r) => ({ ...r, item: { ...r.item, fitCheckedAt: "2026-10-29T15:30:00.000Z" } }));
    expect(() => layoutOf({ ...a, rows: rechecked })).toThrow(/fit row/);
    // Fee lines that differ from the quote: another amount, unconfirmed, missing, doubled.
    const fee = a.fees[0]!;
    for (const fees of [[{ ...fee, netCents: 10001 }], [{ ...fee, confirmed: false }], [], [fee, fee], [{ ...fee, netCents: null }]]) {
      expect(() => layoutOf({ ...a, fees }), JSON.stringify(fees.map((f) => [f.netCents, f.confirmed]))).toThrow(/fee lines/);
    }
    // A quote that counted no fee (one was unconfirmed) cannot be printed with all fees confirmed.
    const open = await scenario({ items: [{ slot: "tank" }], fees: (items) => coverAll(items).map((f) => ({ ...f, confirmed: false })) });
    expect(open.quote.feeNetCents).toBeNull();
    expect(() => layoutOf({ ...open, fees: coverAll([...open.items]) })).toThrow(/fee lines/);
    expect(() => layoutOf(open)).not.toThrow();
  });

  it("throws when an image's bytes do not match its declared kind", async () => {
    const a = await completeScenario(photos);
    expect(() => layoutOf({ ...a, before: { ...photos.before, kind: "png" } })).toThrow(/before image says it is png, but its bytes are jpeg/);
    expect(() => layoutOf({ ...a, after: { ...photos.logo, kind: "jpeg" } })).toThrow(/after image says it is jpeg, but its bytes are png/);
    expect(() => layoutOf({ ...a, logo: { ...photos.logo, bytes: new Uint8Array([1, 2, 3]) } })).toThrow(/logo image says it is png, but its bytes are unknown/);
    await expect(build({ ...a, before: { ...photos.before, kind: "png" } })).rejects.toThrow(/bytes are jpeg/);
  });

  it("refuses a picture whose stated size is not its real size", async () => {
    const a = await completeScenario(photos);
    await expect(build({ ...a, before: { ...photos.before, width: photos.before.width + 1 } })).rejects.toThrow(/not 401 x 300/);
    expect(() => layoutOf({ ...a, before: { ...photos.before, height: 0 } })).toThrow(/no usable size/);
  });
});

// ------------------------------------------------------------------ the largest valid input

describe("size", () => {
  it("the largest schema-valid input builds in time, with every page numbered", { timeout: 120_000 }, async () => {
    const slots = SLOTS.map((s) => s.id); // 22 slots, one item each
    const reason = (n: number) => `${n}. ${longText(140)}`.slice(0, 2000);
    const url = `https://example.com/${"abcdefghij".repeat(204)}`.slice(0, 2048);
    const items: ItemSpec[] = slots.map((slot) => ({
      slot, title: `${slot} ${"x".repeat(150)}`.slice(0, 200),
      fit: {
        reasons: Array.from({ length: 12 }, (_, i) => reason(i)),
        sources: Array.from({ length: 8 }, (_, i) => ({ url: `${url.slice(0, -1)}${i}`, title: `Source ${i}`, accessedAt: CHECKED, supports: "x" })),
        status: "verify" as const,
      },
    }));
    const input = await scenario({
      items,
      fees: (made) => Array.from({ length: 40 }, (_, i) => ({
        id: id(), label: `Allowance ${i}`, kind: "other" as const, netCents: 1000 + i, itemIds: made.map((it) => it.id), confirmed: true,
      })),
      images: photos,
    });
    // The fixture sits at the schema limits and really is valid.
    for (const item of input.items) expect(BuildItem.safeParse(item).success, item.slot).toBe(true);
    for (const fee of input.fees) expect(Fee.safeParse(fee).success).toBe(true);
    expect(input.items).toHaveLength(22);
    expect(input.fees).toHaveLength(40);
    expect(input.items[0]!.fit!.reasons).toHaveLength(12);
    expect(input.items[0]!.fit!.reasons.every((r) => r.length === 2000)).toBe(true);
    expect(input.items[0]!.fit!.sources).toHaveLength(8);
    expect(input.items[0]!.fit!.sources.every((s) => s.url.length === 2048)).toBe(true);

    const started = Date.now();
    const bytes = await build(input);
    expect((Date.now() - started) / 1000).toBeLessThan(90);
    const written = await inspect(bytes);
    const total = written.pages.length;
    expect(total).toBeGreaterThan(50);
    written.pageText.forEach((t, i) => expect(t, `page ${i + 1}`).toContain(`Page ${i + 1} of ${total}`));
    expect(written.pages.every((p) => Math.min(...p.fontSizes) >= 10)).toBe(true);
    expect(written.pages.every((p) => p.glyphIds.every((g) => g > 0))).toBe(true);
  });
});

// ------------------------------------------------------------------ human QA files

// Runs only when PDF_QA_DIR is set. It writes the three PDFs a person opens to check the look; nothing is
// ever written outside PDF_QA_DIR. With PDF_QA_IMAGES the owner's own pictures are used (WebP is converted to
// JPEG here), otherwise synthetic ones.
const QA_DIR = process.env.PDF_QA_DIR;
/** Pages of draft-unknown.pdf, pinned so a layout change that moves it shows up in the QA run. */
const DRAFT_QA_PAGES = 2;
const QA_IMAGES = process.env.PDF_QA_IMAGES;

/** A picture file as a PdfImage: PNG stays PNG; WebP and JPEG become an upright JPEG (the PDF reads no EXIF). */
async function imageFromFile(file: Uint8Array): Promise<PdfImage> {
  const meta = await sharp(file).metadata();
  if (meta.format === "png") {
    const bytes = new Uint8Array(file);
    return { bytes, kind: "png", width: meta.width!, height: meta.height!, hash: sha(bytes), rights: "owner" };
  }
  const { data, info } = await sharp(file).rotate().jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
  const bytes = new Uint8Array(data);
  return { bytes, kind: "jpeg", width: info.width, height: info.height, hash: sha(bytes), rights: "owner" };
}

async function qaImage(name: string): Promise<PdfImage | undefined> {
  return QA_IMAGES ? imageFromFile(readFileSync(path.join(QA_IMAGES, name))) : undefined;
}

describe("QA picture conversion", () => {
  it("turns a WebP into a JPEG of the same size that the PDF accepts, and keeps a PNG as it is", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="100%" height="100%" fill="rgb(60, 90, 140)"/></svg>`;
    const webp = new Uint8Array(await sharp(Buffer.from(svg)).webp().toBuffer());
    const converted = await imageFromFile(webp);
    expect(converted).toMatchObject({ kind: "jpeg", width: 320, height: 200 });
    const same = await imageFromFile(photos.logo.bytes);
    expect(same).toMatchObject({ kind: "png", width: photos.logo.width, height: photos.logo.height, hash: photos.logo.hash });
    const input = await completeScenario({ before: converted, after: photos.after, logo: same });
    expect((await load(await build(input))).getPageCount()).toBe(1);
  });
});

// QA-only scenarios: the owner's own BMW R nineT photos go with them, so bike, items and fit texts match those photos
// and agree with each other. Only the QA block below uses them; the regular tests keep their own fixtures.
// Everything here is test data: the label sits on page 1, every reason starts with FIXTURE_WORDS, every address is example.com.
const QA_BIKE: BikeRevision = {
  id: id(), confirmed: true, revision: 1, confirmedAt: 1,
  bike: {
    make: "BMW", model: "R nineT", family: "other", engine: null, yearFrom: 2014, yearTo: 2016, abs: "yes",
    style: null, facing: "unknown", confidence: 0.8, limitations: [],
  },
};
const qaSource = (title: string, supports: string, url: string) => ({ url, title, accessedAt: "2026-10-29T14:00:00.000Z", supports });
/** The two conditions the server adds to every wheel on a bike with ABS (fitPolicy.ts), so the fixture reads like a real result. */
const WHEEL_CONDITIONS = [
  "Check that the ABS ring and sensor fit the new wheel.",
  "Check tire and fender clearance and the brake and drive fit after the wheel swap.",
];

/** ok: the fixture ABE names this bike, nothing is left to measure, no inspection and no entry in the papers. */
const carbonFrontWheel = (price: number | null, conditions: string[]): ItemSpec => ({
  slot: "wheel_front", title: "Carbon front wheel (test item)", price, basis: "gross", minutes: 60,
  fit: {
    status: "ok", approval: "abe", documentCoverage: "covered", inspection: "none", eintragung: "not_required", carryDocuments: "required",
    reasons: [`${FIXTURE_WORDS}. The fixture ABE names this bike.`],
    conditions, toMeasure: [], extraParts: [],
    sources: [qaSource("Fixture ABE document, front wheel (test)", "approval", "https://example.com/test/bmw-r-ninet/front-wheel-abe")],
  },
});
// A build-level allowance: it is one line on the estimate, not a charge per item.
const allowance = (): FeeData[] => [{ id: id(), label: "Workshop allowance (example rate)", kind: "other", netCents: 10000, itemIds: [], confirmed: true }];

const QA_SETTINGS = (quoteNotes: string): ShopSettings => ({ ...EXAMPLE_SETTINGS, quoteNotes });
const qaProject = (what: string) => `${FIXTURE_LABEL} BMW R nineT, ${what}`;

/** One carbon front wheel, fit ok, one confirmed allowance: a complete estimate on one page. */
function qaOnePage(photos: Partial<Photos>): Promise<EstimatePdfInput> {
  return scenario({
    bike: QA_BIKE, settings: QA_SETTINGS(""), items: [carbonFrontWheel(89900, [WHEEL_CONDITIONS[0]!])],
    fees: allowance, review: "none", projectName: qaProject("front wheel change"), images: photos,
  });
}

/** The same wheel without a price and one allowance: an incomplete draft with a known subtotal and no grand total. */
function qaDraft(photos: Partial<Photos>): Promise<EstimatePdfInput> {
  return scenario({
    bike: QA_BIKE, settings: QA_SETTINGS(""), items: [carbonFrontWheel(null, [WHEEL_CONDITIONS[0]!])],
    fees: allowance, review: "none", projectName: qaProject("front wheel change, price still unknown"), images: photos,
  });
}

/**
 * Green wheels, a green tank and a chrome fork: one item of each status (ok, verify, verify, problem), an Änderungsabnahme, an
 * Einzelabnahme and the official fee, quote notes, every fit reviewed. Fills exactly three pages.
 */
function qaThreePages(photos: Partial<Photos>): Promise<EstimatePdfInput> {
  const forkPapers = qaSource("Fixture fork papers (test)", "conflict", "https://example.com/test/bmw-r-ninet/fork-papers");
  return scenario({
    bike: QA_BIKE,
    settings: QA_SETTINGS("Payment: half of the amount when the parts are ordered.\nThe rest is due on pick-up.\nParts are ordered only after your written confirmation."),
    items: [
      { ...carbonFrontWheel(64900, WHEEL_CONDITIONS), title: "Candy green front wheel (test item)" },
      {
        // verify: a document and some measurements still have to be checked.
        slot: "wheel_rear", title: "Candy green rear wheel (test item)", price: 69900, basis: "gross", minutes: 75,
        fit: {
          status: "verify", approval: "teilegutachten", documentCoverage: "unknown", inspection: "aenderungsabnahme", eintragung: "required", carryDocuments: "required",
          reasons: [
            `${FIXTURE_WORDS}. A fixture Teilegutachten for this rear wheel is on file, but nobody has checked yet that it lists the BMW R nineT, 2014 to 2016.`,
            `${FIXTURE_WORDS}. The mechanic compares the document with the registration papers before the order is placed.`,
          ],
          toMeasure: ["Rear axle diameter and hub width", "Seat of the ABS ring on the new wheel", "Gap between the tire and the swingarm"],
          conditions: [...WHEEL_CONDITIONS, "The Teilegutachten must be carried and the wheel entered in the registration papers."],
          extraParts: ["Axle spacer set (test item)", "Rear brake disc adapter (test item)"],
          sources: [
            qaSource("Fixture Teilegutachten, rear wheel (test)", "document", "https://example.com/test/bmw-r-ninet/rear-wheel-teilegutachten"),
            qaSource("Fixture wheel table with a very long address (test)", "measurements", LONG_URL),
          ],
        },
      },
      {
        // verify: paint is not an approved part, so a document (the colour entry in the papers) has to be checked.
        slot: "tank", title: "Green tank paint (test item)", costKind: "labor_only", price: 0, basis: "net", minutes: 240,
        fit: {
          status: "verify", approval: "none", documentCoverage: "unknown", inspection: "unknown", eintragung: "required", carryDocuments: "not_required",
          reasons: [
            `${FIXTURE_WORDS}. Paint on the tank is not an approved part, so no approval document exists for it.`,
            `${FIXTURE_WORDS}. The fixture check cannot say whether the new colour needs an inspection. The mechanic decides.`,
          ],
          toMeasure: [], conditions: ["Check the colour entry in the registration papers; the new colour is entered at the Zulassungsstelle."], extraParts: [],
          sources: [qaSource("Fixture note on colour changes (test)", "registration", "https://example.com/test/bmw-r-ninet/colour-change")],
        },
      },
      {
        // problem: the fixture papers state a conflict.
        slot: "fork", title: "Chrome fork paint (test item)", price: 18000, basis: "net", minutes: null,
        fit: {
          status: "problem", approval: "none", documentCoverage: "not_covered", inspection: "einzelabnahme", eintragung: "required", carryDocuments: "required",
          reasons: [`${FIXTURE_WORDS}. The fixture fork papers state that the fork tubes must not be re-coated, because the sealing surface would change. This conflicts with the chrome paint.`],
          toMeasure: [], conditions: ["Einzelabnahme at the inspection authority; approval is not guaranteed.", "The fork papers must be carried."],
          extraParts: ["Fork seal set (test item)"], sources: [forkPapers],
        },
      },
    ],
    fees: (items) => {
      const by = (slot: SlotId) => items.find((i) => i.slot === slot)!.id;
      return [
        { id: id(), label: "Änderungsabnahme (estimated) — example rate", kind: "aenderungsabnahme", netCents: 5042, itemIds: [by("wheel_rear")], confirmed: true },
        { id: id(), label: "Einzelabnahme (estimated) — example rate", kind: "einzelabnahme", netCents: 15126, itemIds: [by("fork")], confirmed: true },
        { id: id(), label: "Zulassungsstelle fee (official fee, no VAT) — example rate", kind: "official_fee", netCents: 1500, itemIds: [by("wheel_rear"), by("tank"), by("fork")], confirmed: true },
      ];
    },
    review: "fees_added",
    reviewNotes: "Fixture note: the rear wheel needs an Änderungsabnahme and the fork an Einzelabnahme. The tank paint needs only the entry in the papers (Eintragung), no inspection.",
    projectName: qaProject("green wheels, green tank, chrome fork"), images: photos,
  });
}

/** Problems in a fit result whose words and status do not agree (ok, verify, problem). Empty when they agree. */
function fitTextProblems(fit: FitData): string[] {
  const problems: string[] = [];
  const approved = fit.approval === "abe" || fit.approval === "e_mark" || fit.approval === "teilegutachten";
  if (fit.status === "ok") {
    if (!approved || fit.documentCoverage !== "covered") problems.push("ok needs an approval that covers this bike");
    if (fit.toMeasure.length > 0 || fit.inspection !== "none" || fit.eintragung !== "not_required") problems.push("ok leaves nothing to measure, inspect or enter");
    if (!fit.reasons.some((r) => /names this bike/.test(r))) problems.push("an ok reason says the approval names this bike");
  }
  if (fit.status === "verify" && fit.toMeasure.length === 0 && fit.documentCoverage !== "unknown") problems.push("verify needs something to measure or a document to check");
  if (fit.status === "problem") {
    if (fit.documentCoverage !== "not_covered") problems.push("a problem states a conflict: the papers do not cover this bike");
    if (!fit.reasons.some((r) => /conflict/.test(r))) problems.push("a problem reason names the conflict");
  }
  if (!fit.reasons.every((r) => r.startsWith(FIXTURE_WORDS))) problems.push("every reason starts with the fixture words");
  if (fit.reasons.some((r) => /\(\d+\)/.test(r))) problems.push("no numbering in the reasons");
  if (!fit.sources.every((src) => src.url.startsWith("https://example.com/"))) problems.push("every address is on example.com");
  return problems;
}

describe.skipIf(!QA_DIR)("QA files for the human check", () => {
  it("writes complete-1page.pdf, long-3page.pdf and draft-unknown.pdf with the expected page counts", { timeout: 60_000 }, async () => {
    const dir = QA_DIR!;
    mkdirSync(dir, { recursive: true });
    const synthetic = await syntheticPhotos();
    const logo = (await qaImage("logo.png")) ?? synthetic.logo;
    const one = { before: (await qaImage("one-before.webp")) ?? synthetic.before, after: (await qaImage("one-after.webp")) ?? synthetic.after, logo };
    const long = { before: (await qaImage("long-before.webp")) ?? synthetic.before, after: (await qaImage("long-after.webp")) ?? synthetic.after, logo };
    const files: { name: string; input: EstimatePdfInput; pages: number; draft: boolean }[] = [
      { name: "complete-1page.pdf", input: await qaOnePage(one), pages: 1, draft: false },
      { name: "long-3page.pdf", input: await qaThreePages(long), pages: 3, draft: false },
      { name: "draft-unknown.pdf", input: await qaDraft(one), pages: DRAFT_QA_PAGES, draft: true },
    ];
    for (const { name, input, pages, draft } of files) {
      const bytes = await build(input);
      writeFileSync(path.join(dir, name), bytes);
      expect((await load(bytes)).getPageCount(), name).toBe(pages);
      // The estimate is complete or a draft as the file name says, and every fit is current and reviewed.
      expect(layoutOf(input).draft, `${name} draft`).toBe(draft);
      expect(input.quote.incomplete, `${name} incomplete`).toBe(draft);
      expect(input.rows.every((r) => r.hashMatches && r.reviewed), `${name} fits are current and reviewed`).toBe(true);
    }
    // All three files say on page one that bike, fit and sources are test data, and show the bike the photos are of.
    // They are layout evidence only, never evidence of a real fit check.
    for (const { name, input } of files) {
      const page1 = textOf(layoutOf(input), 1);
      expect(page1.replace(/\n/g, " "), `${name} page 1`).toContain(FIXTURE_LABEL);
      expect(page1, `${name} page 1`).toContain("Make BMW · Model R nineT · Years 2014–2016 · ABS yes");
      expect(page1, `${name} no unconfirmed bike`).not.toContain("Bike not confirmed");
      for (const item of input.items) {
        expect(item.fit, `${name} ${item.title}`).not.toBeNull();
        expect(fitTextProblems(item.fit!), `${name} ${item.title}`).toEqual([]);
        expect(item.title, name).toMatch(/\(test item\)$/);
      }
    }
    // The long file shows every status, all three fee kinds and the shop's notes; the one-page file is a plain ok.
    const longInput = files[1]!.input;
    expect(new Set(longInput.items.map((i) => i.fit!.status))).toEqual(new Set(["ok", "verify", "problem"]));
    expect(new Set(longInput.fees.map((f) => f.kind))).toEqual(new Set(["aenderungsabnahme", "einzelabnahme", "official_fee"]));
    expect(longInput.items.map((i) => i.title)).toEqual([
      "Candy green front wheel (test item)", "Candy green rear wheel (test item)", "Green tank paint (test item)", "Chrome fork paint (test item)",
    ]);
    expect(textOf(layoutOf(longInput))).toContain("Shop notes");
    expect(files[0]!.input.items.map((i) => [i.slot, i.title, i.fit!.status])).toEqual([["wheel_front", "Carbon front wheel (test item)", "ok"]]);
  });
});


// ======================================================================================
// Browser glue (src/lib/browser/pdfExport.ts): file name, warm-up, which pictures are read and how they are prepared.
// The click itself (canvas, IndexedDB, the download) runs in a browser; what can run in Node is checked here.

describe("export file name", () => {
  it("spells umlauts out, drops accents, and turns slashes and symbols into single hyphens", () => {
    expect(fileSlug("Müller & Söhne: Straßen/Bike")).toBe("mueller-soehne-strassen-bike");
    expect(fileSlug("Müller")).toBe("mueller"); // an umlaut typed as letter plus combining mark
    expect(fileSlug("Crème brûlée ÄÖÜ")).toBe("creme-brulee-aeoeue");
    expect(fileSlug("  ../../etc/passwd  ")).toBe("etc-passwd");
    expect(fileSlug("Tank_2026 (v2)")).toBe("tank-2026-v2");
  });

  it("falls back to 'project' when nothing usable is left", () => {
    for (const name of ["", "   ", "///", "..", "日本語", "—"]) expect(fileSlug(name), JSON.stringify(name)).toBe("project");
  });

  it("cuts a long name at 60 characters without a trailing hyphen", () => {
    expect(fileSlug("a".repeat(200))).toBe("a".repeat(60));
    expect(fileSlug(`${"a".repeat(59)} bbb`)).toBe("a".repeat(59)); // the cut lands on the hyphen, which is trimmed
    const slug = fileSlug("ab ".repeat(100));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("builds dreambike-estimate[-draft]-<slug>-YYYYMMDD.pdf from the local date", () => {
    const day = new Date(2026, 9, 29, 23, 59); // local time, so the test does not depend on the time zone
    expect(pdfFileName("Müller/Tank", false, day)).toBe("dreambike-estimate-mueller-tank-20261029.pdf");
    expect(pdfFileName("Müller/Tank", true, day)).toBe("dreambike-estimate-draft-mueller-tank-20261029.pdf");
    expect(pdfFileName("", false, new Date(2026, 0, 5))).toBe("dreambike-estimate-project-20260105.pdf");
    const name = pdfFileName("x".repeat(200), true, day);
    expect(name).toMatch(/^dreambike-estimate-draft-x{60}-20261029\.pdf$/);
  });

  it("prints the estimate date in fixed English names and tells complete from draft by the flag and the totals", () => {
    expect(formatEstimateDate(new Date(2026, 8, 3))).toBe("3 Sep 2026");
    expect(formatEstimateDate(new Date(2026, 9, 29))).toBe("29 Oct 2026");
    const totals = { incomplete: false, netCents: 35000, vatCents: 6650, grossCents: 41650 };
    expect(isCompleteEstimate(totals)).toBe(true);
    expect(isCompleteEstimate({ ...totals, incomplete: true })).toBe(false);
    expect(isCompleteEstimate({ ...totals, grossCents: null })).toBe(false); // a number is never replaced by 0
  });
});

describe("font files for the export", () => {
  const html = "<!doctype html><html><head><title>404</title></head><body>Not found</body></html>";

  it("accepts the real Plex files and checks the TrueType signature", () => {
    for (const bytes of Object.values(FONT_BYTES)) expect(hasTrueTypeSignature(bytes)).toBe(true);
    expect(hasTrueTypeSignature(new TextEncoder().encode(html))).toBe(false);
    expect(hasTrueTypeSignature(new Uint8Array([0, 1, 0, 0]))).toBe(false); // too short to be a font
    expect(hasTrueTypeSignature(new Uint8Array(40))).toBe(false); // zeros are not the signature
  });

  it("refuses an HTML page that came back with status 200", async () => {
    await expect(readFontResponse(new Response(html, { status: 200 }), "IBMPlexSans-Regular.ttf"))
      .rejects.toThrow(/IBMPlexSans-Regular\.ttf is not a TrueType font file/);
  });

  it("refuses a response that is not ok, even when its body looks like a font", async () => {
    await expect(readFontResponse(new Response(FONT_BYTES.sans.slice(), { status: 404 }), "IBMPlexSans-Regular.ttf"))
      .rejects.toThrow(/could not be loaded \(HTTP 404\)/);
    await expect(readFontResponse(new Response("", { status: 500 }), "x.ttf")).rejects.toThrow(/HTTP 500/);
  });

  it("returns the bytes of a good response unchanged", async () => {
    const bytes = await readFontResponse(new Response(FONT_BYTES.mono.slice()), "IBMPlexMono-Regular.ttf");
    expect(bytes.length).toBe(FONT_BYTES.mono.length);
    expect(sha(bytes)).toBe(sha(FONT_BYTES.mono));
  });
});

describe("export warm-up", () => {
  const FILE_BYTES: Record<string, Uint8Array> = {
    [`/fonts/${FONT_FILES.sans}`]: FONT_BYTES.sans,
    [`/fonts/${FONT_FILES.sansBold}`]: FONT_BYTES.sansBold,
    [`/fonts/${FONT_FILES.mono}`]: FONT_BYTES.mono,
  };
  /** A fresh Response per call (a body can be read once). Unknown URLs answer with an HTML page, as a bad host would. */
  const answer = (url: string) => (FILE_BYTES[url] ? new Response(FILE_BYTES[url].slice()) : new Response("<html>not found</html>", { status: 200 }));
  // The page's computed colors; in Node there is no DOM, so the token values come from the stylesheet itself.
  const tokenMap = (names: readonly PdfTokenName[]) => new Map<PdfTokenName, string>(names.map((n) => [n, lookup(n)!]));
  const goodTokens = tokenMap;

  afterEach(() => { vi.unstubAllGlobals(); });

  it("fetches the three fonts and loads the module once, and every later call gets the same kit", async () => {
    const fetchFile = vi.fn(async (url: string) => answer(url));
    const warm = createPdfWarmup({ fetchFile, readTokens: goodTokens });
    const [first, second] = await Promise.all([warm(), warm()]);
    expect(second).toBe(first);
    expect(await warm()).toBe(first);
    expect(fetchFile.mock.calls.map((c) => c[0]).sort()).toEqual(Object.keys(FILE_BYTES).sort());
    expect(first.fonts.sans.length).toBe(FONT_BYTES.sans.length);
    expect([...first.tokens.keys()].sort()).toEqual([...PDF_TOKENS].sort());
    // The kit is enough to write a PDF: no other file is needed at click time.
    const input = await completeScenario(photos);
    const bytes = await first.pdf.buildEstimatePdf(input, first.fonts, (name) => first.tokens.get(name));
    expect((await load(bytes)).getPageCount()).toBe(1);
  });

  it("starts a fresh attempt after a failed fetch, and a failure does not stay in the memo", async () => {
    let broken = true;
    const fetchFile = vi.fn(async (url: string) =>
      broken && url.endsWith(FONT_FILES.mono) ? new Response("Not found", { status: 404 }) : answer(url));
    const warm = createPdfWarmup({ fetchFile, readTokens: goodTokens });
    await expect(warm()).rejects.toThrow(/IBMPlexMono-Regular\.ttf could not be loaded \(HTTP 404\)/);
    expect(fetchFile).toHaveBeenCalledTimes(3);
    broken = false;
    const kit = await warm(); // the retry
    expect(fetchFile).toHaveBeenCalledTimes(6);
    expect(kit.fonts.mono.length).toBe(FONT_BYTES.mono.length);
    expect(await warm()).toBe(kit);
    expect(fetchFile).toHaveBeenCalledTimes(6); // memoized again
  });

  it("uses the global fetch by default, one call per font", async () => {
    const fetchMock = vi.fn(async (url: string) => answer(url));
    vi.stubGlobal("fetch", fetchMock);
    await createPdfWarmup({ readTokens: goodTokens })();
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual(Object.keys(FILE_BYTES).sort());
  });

  it("fails in words for an HTML page, a network error and a broken token, and each failure can be retried", async () => {
    const htmlFirst = createPdfWarmup({
      fetchFile: async (url) => (url.endsWith(FONT_FILES.sans) ? new Response("<html></html>") : answer(url)), readTokens: goodTokens,
    });
    await expect(htmlFirst()).rejects.toThrow(/IBMPlexSans-Regular\.ttf is not a TrueType font file/);
    const offline = createPdfWarmup({ fetchFile: async () => { throw new TypeError("Failed to fetch"); }, readTokens: goodTokens });
    await expect(offline()).rejects.toThrow(/could not be loaded: Failed to fetch/);
    let bad = true;
    const tokenRead = vi.fn((names: readonly PdfTokenName[]) => {
      const map = tokenMap(names);
      if (bad) map.set("--nl-warning-soft", "oklch(0.9 0.1 90)");
      return map;
    });
    const tokens = createPdfWarmup({ fetchFile: async (url) => answer(url), readTokens: tokenRead });
    await expect(tokens()).rejects.toThrow(/design token --nl-warning-soft is not a usable color/);
    bad = false;
    await expect(tokens()).resolves.toBeDefined();
    expect(tokenRead).toHaveBeenCalledTimes(2);
  });

  it("names a token with no value", async () => {
    const warm = createPdfWarmup({
      fetchFile: async (url) => answer(url),
      readTokens: (names) => tokenMap(names.filter((n) => n !== "--nl-text")),
    });
    await expect(warm()).rejects.toThrow(/design token --nl-text has no value/);
  });

  describe("time limit", () => {
    // Plain objects instead of Response, so nothing here depends on Node's stream timers while the clock is fake.
    const okAnswer = (url: string) => ({ ok: true, status: 200, arrayBuffer: async () => FILE_BYTES[url]!.slice().buffer }) as unknown as Response;
    afterEach(() => { vi.useRealTimers(); });

    it("gives up on a font request that never answers after 20 s, aborts it, says so in words, and a retry starts fresh", async () => {
      vi.useFakeTimers();
      const signals = new Map<string, AbortSignal>();
      let stalled = true;
      const fetchFile = vi.fn((url: string, signal: AbortSignal) => {
        signals.set(url, signal);
        return stalled && url.endsWith(FONT_FILES.sansBold) ? new Promise<Response>(() => {}) : Promise.resolve(okAnswer(url));
      });
      const warm = createPdfWarmup({ fetchFile, loadPdf: async () => pdfModule, readTokens: goodTokens });
      const outcome = warm().then(() => "ready", (e: Error) => e.message);
      expect(WARMUP_TIMEOUT_MS).toBe(20_000);
      await vi.advanceTimersByTimeAsync(WARMUP_TIMEOUT_MS - 1);
      expect(await Promise.race([outcome, Promise.resolve("still waiting")])).toBe("still waiting"); // not before 20 s
      await vi.advanceTimersByTimeAsync(1);
      expect(await outcome).toBe("The font IBMPlexSans-SemiBold.ttf took longer than 20 seconds to load.");
      expect(signals.get(`/fonts/${FONT_FILES.sansBold}`)!.aborted).toBe(true); // the stalled request is cancelled
      expect(signals.get(`/fonts/${FONT_FILES.sans}`)!.aborted).toBe(false); // the others were done
      // The memo is clear: "Prepare again" runs a new attempt, with new requests.
      stalled = false;
      const kit = await warm();
      expect(fetchFile).toHaveBeenCalledTimes(6);
      expect(kit.fonts.mono.length).toBe(FONT_BYTES.mono.length);
      expect(await warm()).toBe(kit);
      expect(vi.getTimerCount()).toBe(0); // no timer is left running
    });

    it("gives up on a font request that ignores the abort signal too", async () => {
      vi.useFakeTimers();
      const warm = createPdfWarmup({
        fetchFile: (url) => (url.endsWith(FONT_FILES.mono) ? new Promise<Response>(() => {}) : Promise.resolve(okAnswer(url))),
        loadPdf: async () => pdfModule, readTokens: goodTokens, timeoutMs: 3_000,
      });
      const outcome = warm().then(() => "ready", (e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(await outcome).toBe("The font IBMPlexMono-Regular.ttf took longer than 3 seconds to load.");
    });

    it("gives up when the pdf chunk never loads, and the next call tries again", async () => {
      vi.useFakeTimers();
      let hangs = true;
      const loadPdf = vi.fn(() => (hangs ? new Promise<typeof pdfModule>(() => {}) : Promise.resolve(pdfModule)));
      const warm = createPdfWarmup({ fetchFile: async (url) => okAnswer(url), loadPdf, readTokens: goodTokens });
      const outcome = warm().then(() => "ready", (e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(WARMUP_TIMEOUT_MS);
      expect(await outcome).toBe("The PDF library took longer than 20 seconds to load.");
      hangs = false;
      await expect(warm()).resolves.toBeDefined();
      expect(loadPdf).toHaveBeenCalledTimes(2);
    });

    it("does not time out an attempt that finishes in time, and leaves no timer behind", async () => {
      vi.useFakeTimers();
      const warm = createPdfWarmup({ fetchFile: async (url) => okAnswer(url), loadPdf: async () => pdfModule, readTokens: goodTokens });
      await warm();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(WARMUP_TIMEOUT_MS * 2);
      await expect(warm()).resolves.toBeDefined(); // still the memoized kit
    });
  });
});

describe("warm-up start (idle time once a project is open)", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("starts in idle time when the browser has requestIdleCallback, with a bound, and cancels a start not yet made", () => {
    const start = vi.fn(async () => undefined);
    const queued: (() => void)[] = [];
    const cancelIdleCallback = vi.fn();
    const requestIdleCallback = vi.fn((callback: () => void, options?: { timeout?: number }) => { queued.push(callback); void options; return queued.length; });
    const cancel = scheduleWarmup(start, { requestIdleCallback, cancelIdleCallback });
    expect(start).not.toHaveBeenCalled(); // nothing starts at once: the page paints first
    expect(requestIdleCallback.mock.calls[0]![1]).toEqual({ timeout: WARMUP_IDLE_TIMEOUT_MS });
    queued[0]!();
    expect(start).toHaveBeenCalledTimes(1);
    cancel();
    expect(cancelIdleCallback).toHaveBeenCalledWith(1);
  });

  it("without requestIdleCallback (Safari) starts after a short timer, and cancel stops it", () => {
    vi.useFakeTimers();
    const start = vi.fn(async () => undefined);
    scheduleWarmup(start, {});
    vi.advanceTimersByTime(WARMUP_FALLBACK_DELAY_MS - 1);
    expect(start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(start).toHaveBeenCalledTimes(1);

    const cancelled = vi.fn(async () => undefined);
    const cancel = scheduleWarmup(cancelled, {});
    cancel(); // the project closed or the page unmounted before the timer fired
    vi.advanceTimersByTime(WARMUP_FALLBACK_DELAY_MS * 4);
    expect(cancelled).not.toHaveBeenCalled();
  });

  it("a failed start does not raise an unhandled rejection: the Export button shows it and offers a retry", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); // setImmediate stays real, so the wait below works
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      scheduleWarmup(() => Promise.reject(new Error("offline")), {});
      await vi.advanceTimersByTimeAsync(WARMUP_FALLBACK_DELAY_MS);
      await new Promise<void>((resolve) => setImmediate(resolve)); // let Node report a rejection nobody handled
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});

describe("export button wording", () => {
  it("names a mismatch between the screen and the file in words, in all four cases", () => {
    expect(mismatchText(true, false)).toBeNull(); // complete on screen, complete file
    expect(mismatchText(false, true)).toBeNull(); // draft on screen, draft file
    const lost = mismatchText(true, true)!; // the screen said complete, the file is a draft (for example after the 24 h expiry)
    expect(lost).toContain("The screen showed a complete estimate, but the PDF is an incomplete draft with no grand total");
    expect(lost).toContain("24 hours");
    const gained = mismatchText(false, false)!; // the screen said draft, the file is complete
    expect(gained).toContain("The screen showed an incomplete draft, but the PDF came out complete");
  });
});

describe("pictures for the export", () => {
  const rootId = id();
  const headId = id();
  const logoId = id();
  const cutoutId = id();

  function stored(bytes: Uint8Array, rights: StoredImage["rights"] = "owner", imageId = id()): StoredImage {
    const blob = new Blob([bytes.slice()]);
    // The stored width and height are wrong on purpose: the export trusts the file header, not these numbers.
    return { id: imageId, hash: sha(bytes), width: 1, height: 1, bytes: blob.size, rights, blob, lastAccessedAt: 0 };
  }
  const webp = async (w: number, h: number) => new Uint8Array(await sharp({
    create: { width: w, height: h, channels: 4, background: { r: 60, g: 90, b: 140, alpha: 0.5 } },
  }).webp().toBuffer());

  /** Converters made with sharp, recording how each was asked. */
  function fakes(records: Record<string, StoredImage | Error | null>) {
    const reads: string[] = [];
    const jpegCalls: boolean[] = [];
    let pngCalls = 0;
    const deps: ImageDeps = {
      read: async (imageId) => {
        reads.push(imageId);
        if (!(imageId in records)) throw new Error(`unexpected read of ${imageId}`);
        const r = records[imageId]!;
        if (r instanceof Error) throw r;
        return r;
      },
      toJpeg: async (blob, band) => {
        jpegCalls.push(band);
        return new Blob([new Uint8Array(await sharp(Buffer.from(await blob.arrayBuffer())).flatten({ background: "white" }).jpeg().toBuffer())]);
      },
      toPng: async (blob) => {
        pngCalls++;
        return new Blob([new Uint8Array(await sharp(Buffer.from(await blob.arrayBuffer())).png().toBuffer())]);
      },
    };
    return { deps, reads, jpegCalls, pngCalls: () => pngCalls };
  }

  it("selects only the root, head and logo ids, never a cutout or any other id", () => {
    const head = { ...newRootVersion({ id: id(), projectId: id(), createdAt: 0, image: { id: headId, hash: "b".repeat(64), width: 10, height: 10, bytes: 1, rights: "owner" } }), cutoutImageId: cutoutId };
    const ids = selectImageIds({ id: rootId }, head, { logoImageId: logoId });
    expect(ids).toEqual({ before: rootId, after: headId, logo: logoId });
    expect(Object.values(ids)).not.toContain(cutoutId);
    expect(selectImageIds({ id: rootId }, head, { logoImageId: null }).logo).toBeNull();
  });

  it("decides by rights and format: external sources and non-owner logos are refused, WebP is converted", () => {
    const plan = (slot: "before" | "after" | "logo", rights: StoredImage["rights"], format: Parameters<typeof planPdfImage>[0]["format"], mock = false) =>
      planPdfImage({ slot, rights, format, mock });
    expect(plan("before", "external_runtime", "jpeg")).toMatchObject({ action: "refuse" });
    expect(plan("after", "external_runtime", "png")).toMatchObject({ action: "refuse" });
    expect(plan("logo", "visitor", "png")).toMatchObject({ action: "refuse" }); // the logo must be the shop's own
    expect(plan("logo", "external_runtime", "png")).toMatchObject({ action: "refuse" });
    expect(plan("before", "visitor", "jpeg")).toEqual({ action: "use", kind: "jpeg" });
    expect(plan("before", "owner", "png")).toEqual({ action: "use", kind: "png" });
    expect(plan("logo", "owner", "png")).toEqual({ action: "use", kind: "png" });
    expect(plan("before", "owner", "webp")).toEqual({ action: "convert", to: "jpeg", band: false });
    expect(plan("after", "visitor", "webp")).toEqual({ action: "convert", to: "jpeg", band: false });
    expect(plan("logo", "owner", "webp")).toEqual({ action: "convert", to: "png", band: false }); // PNG keeps transparency
    expect(plan("before", "owner", "heic")).toMatchObject({ action: "refuse" });
    expect(plan("logo", "owner", "unknown")).toMatchObject({ action: "refuse" });
  });

  it("in mock mode only the after image gets the band, whatever its format; the before photo and the logo never do", () => {
    const plan = (slot: "before" | "after" | "logo", format: Parameters<typeof planPdfImage>[0]["format"]) =>
      planPdfImage({ slot, rights: "owner", format, mock: true });
    for (const format of ["jpeg", "png", "webp"] as const) expect(plan("after", format)).toEqual({ action: "convert", to: "jpeg", band: true });
    expect(plan("before", "jpeg")).toEqual({ action: "use", kind: "jpeg" });
    expect(plan("before", "png")).toEqual({ action: "use", kind: "png" });
    expect(plan("before", "webp")).toEqual({ action: "convert", to: "jpeg", band: false });
    expect(plan("logo", "png")).toEqual({ action: "use", kind: "png" });
    expect(plan("logo", "webp")).toEqual({ action: "convert", to: "png", band: false });
    // A refused picture stays refused in mock mode too.
    expect(planPdfImage({ slot: "after", rights: "external_runtime", format: "jpeg", mock: true })).toMatchObject({ action: "refuse" });
  });

  it("reads exactly the three ids, passes JPEG and PNG through, and takes the size from the file", async () => {
    const f = fakes({ [rootId]: stored(photos.before.bytes, "owner"), [headId]: stored(photos.after.bytes, "visitor"), [logoId]: stored(photos.logo.bytes, "owner") });
    const out = await loadPdfImages({ before: rootId, after: headId, logo: logoId }, false, f.deps);
    expect([...f.reads].sort()).toEqual([rootId, headId, logoId].sort());
    expect(out.leftOut).toEqual([]);
    expect(out.before).toMatchObject({ kind: "jpeg", width: photos.before.width, height: photos.before.height, hash: photos.before.hash, rights: "owner" });
    expect(out.after).toMatchObject({ kind: "jpeg", hash: photos.after.hash, rights: "visitor" });
    expect(out.logo).toMatchObject({ kind: "png", width: photos.logo.width, height: photos.logo.height });
    expect(out.before!.bytes).toEqual(photos.before.bytes); // untouched
    expect(f.jpegCalls).toEqual([]);
    expect(f.pngCalls()).toBe(0);
    // pdf.ts accepts exactly what comes out.
    const input = await completeScenario({ before: out.before!, after: out.after!, logo: out.logo! });
    expect((await load(await build(input))).getPageCount()).toBe(1);
  });

  it("converts a WebP photo to JPEG and a WebP logo to PNG, and hashes the converted file", async () => {
    const photo = await webp(320, 200);
    const logo = await webp(120, 40);
    const f = fakes({ [rootId]: stored(photo), [headId]: stored(photos.after.bytes), [logoId]: stored(logo) });
    const out = await loadPdfImages({ before: rootId, after: headId, logo: logoId }, false, f.deps);
    expect(out.before).toMatchObject({ kind: "jpeg", width: 320, height: 200 });
    expect(out.logo).toMatchObject({ kind: "png", width: 120, height: 40 });
    expect(out.before!.hash).toBe(sha(out.before!.bytes));
    expect(out.before!.hash).not.toBe(sha(photo));
    expect(f.jpegCalls).toEqual([false]); // only the before photo, and without a band
    expect(f.pngCalls()).toBe(1);
    const input = await completeScenario({ before: out.before!, after: out.after!, logo: out.logo! });
    expect((await load(await build(input))).getPageCount()).toBe(1);
  });

  it("in mock mode re-encodes the after image with the band, even a PNG, and never the before photo", async () => {
    const f = fakes({ [rootId]: stored(photos.before.bytes), [headId]: stored(photos.logo.bytes), [logoId]: stored(photos.logo.bytes) });
    const out = await loadPdfImages({ before: rootId, after: headId, logo: logoId }, true, f.deps);
    expect(f.jpegCalls).toEqual([true]); // one call: the after image, with the band
    expect(out.before!.bytes).toEqual(photos.before.bytes);
    expect(out.after).toMatchObject({ kind: "jpeg" });
    expect(out.after!.hash).not.toBe(out.before!.hash);
    expect(out.logo).toMatchObject({ kind: "png", hash: photos.logo.hash });
  });

  it("refuses pictures from an outside source and a logo that is not the shop's own, and says so", async () => {
    const f = fakes({
      [rootId]: stored(photos.before.bytes, "external_runtime"), [headId]: stored(photos.after.bytes, "external_runtime"),
      [logoId]: stored(photos.logo.bytes, "visitor"),
    });
    const out = await loadPdfImages({ before: rootId, after: headId, logo: logoId }, false, f.deps);
    expect(out).toMatchObject({ before: null, after: null, logo: null });
    expect(out.leftOut).toHaveLength(3);
    expect(out.leftOut[0]).toMatch(/^Before photo: left out \(it comes from an outside web source\)\.$/);
    expect(out.leftOut[1]).toMatch(/^After image: left out/);
    expect(out.leftOut[2]).toMatch(/^Shop logo: left out \(the logo is not marked as the shop's own\)\.$/);
  });

  it("passes a missing, unreadable or unusable picture as absent and never substitutes another image", async () => {
    const f = fakes({
      [rootId]: stored(photos.before.bytes), [headId]: null,
      [logoId]: stored(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])),
    });
    const missing = await loadPdfImages({ before: rootId, after: headId, logo: logoId }, false, f.deps);
    expect(missing.before).not.toBeNull();
    expect(missing.after).toBeNull(); // the before photo does not stand in for it
    expect(missing.logo).toBeNull();
    expect(missing.leftOut).toEqual([
      "After image: left out (it is not stored in this browser).",
      "Shop logo: left out (the PDF cannot use this image format).",
    ]);
    const broken = fakes({ [rootId]: new Error("damaged record"), [headId]: stored(photos.after.bytes), [logoId]: null });
    const out = await loadPdfImages({ before: rootId, after: headId, logo: logoId }, false, broken.deps);
    expect(out.before).toBeNull();
    expect(out.after).not.toBeNull();
    expect(out.leftOut[0]).toBe("Before photo: left out (it could not be read: damaged record).");
    // A converter that fails leaves the picture out; it does not stop the export.
    const bad = fakes({ [rootId]: stored(await webp(40, 30)), [headId]: stored(photos.after.bytes), [logoId]: null });
    bad.deps.toJpeg = async () => { throw new Error("no canvas"); };
    const failed = await loadPdfImages({ before: rootId, after: headId, logo: null }, false, bad.deps);
    expect(failed.before).toBeNull();
    expect(failed.leftOut).toEqual(["Before photo: left out (it could not be prepared: no canvas)."]);
  });

  it("reads the picture once when the head is the root, adds no band to the real photo, and prints it as one original", async () => {
    const f = fakes({ [rootId]: stored(photos.before.bytes) });
    const out = await loadPdfImages({ before: rootId, after: rootId, logo: null }, true, f.deps);
    expect(f.reads).toEqual([rootId]);
    expect(f.jpegCalls).toEqual([]);
    expect(out.after).toBe(out.before);
    const input = await completeScenario({ before: out.before!, after: out.after!, logo: undefined });
    expect(textOf(layoutOf(input))).toContain("Original photo — no visual change yet.");
  });

  it("downloads from a blob URL and revokes it only after the delay", () => {
    vi.useFakeTimers();
    try {
      const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
      const append = vi.fn();
      vi.stubGlobal("document", { createElement: () => link, body: { appendChild: append } });
      const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-url");
      const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      downloadPdf(new Uint8Array([37, 80, 68, 70]), "dreambike-estimate-project-20261029.pdf");
      expect(link).toMatchObject({ href: "blob:test-url", download: "dreambike-estimate-project-20261029.pdf" });
      expect(link.click).toHaveBeenCalledTimes(1);
      expect((create.mock.calls[0]![0] as Blob).type).toBe("application/pdf");
      expect(REVOKE_DELAY_MS).toBeGreaterThanOrEqual(10_000);
      vi.advanceTimersByTime(REVOKE_DELAY_MS - 1);
      expect(revoke).not.toHaveBeenCalled(); // an immediate revoke can cancel the download
      vi.advanceTimersByTime(1);
      expect(revoke).toHaveBeenCalledWith("blob:test-url");
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

describe("export code boundaries", () => {
  const root = new URL("../src/", import.meta.url);
  const sources = (dir: URL): { file: string; text: string }[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const child = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
      return e.isDirectory() ? sources(child) : /\.tsx?$/.test(e.name) ? [{ file: path.relative(root.pathname, child.pathname), text: readFileSync(child, "utf8") }] : [];
    });
  const all = sources(root);

  it("keeps pdf-lib out of the main bundle: pdf.ts is reached by 'import type' and exactly one dynamic import", () => {
    const uses = all.filter((s) => s.file !== "lib/pdf.ts").flatMap((s) =>
      s.text.split("\n").map((line) => line.trim()).filter((line) => !/^(\/\/|\/?\*)/.test(line)) // comments may name the module
        .filter((line) => /@\/lib\/pdf["']/.test(line) || /from "\.\/pdf"/.test(line)).map((line) => ({ file: s.file, line })));
    const dynamic = uses.filter((u) => /\bimport\(/.test(u.line));
    expect(dynamic.map((u) => u.file)).toEqual(["lib/browser/pdfExport.ts"]);
    expect(dynamic).toHaveLength(1);
    for (const u of uses.filter((x) => !dynamic.includes(x))) expect(u.line, u.file).toMatch(/^import type /);
    expect(all.some((s) => /from "(pdf-lib|@pdf-lib\/fontkit)"/.test(s.text) && s.file !== "lib/pdf.ts")).toBe(false);
  });

  it("never reads a product picture or the reference photo, and the click makes no request of its own", () => {
    const source = (name: string) => all.find((s) => s.file === name)!.text;
    for (const name of ["lib/browser/pdfExport.ts", "components/ExportButton.tsx", "lib/pdf.ts"]) {
      const text = source(name);
      expect(text, name).not.toMatch(/imageUrl|referenceImage|refState|ReferenceDropzone/);
    }
    expect(source("components/ExportButton.tsx")).not.toMatch(/\bfetch\(/);
    // The only fetch in the export module is the font warm-up default.
    expect(source("lib/browser/pdfExport.ts").match(/\bfetch\(/g)).toHaveLength(1);
    expect(source("lib/browser/pdfExport.ts").match(/getStoredImage\(/g)).toHaveLength(1);
  });

  it("keeps the Export button mounted while a new version is calculated, and starts the warm-up once a project is open", () => {
    const source = (name: string) => all.find((s) => s.file === name)!.text;
    const preview = source("components/EstimatePreview.tsx");
    expect(preview.match(/<ExportButton\b/g)).toHaveLength(1);
    const at = preview.indexOf("<ExportButton");
    // Only the saved version gates it, not the calculated estimate, so its outcome note survives a head change.
    expect(preview.slice(Math.max(0, at - 40), at)).toMatch(/\{head && \(\s*$/);
    // While the estimate is being calculated the button is told "nothing on screen yet" (null), not a guess.
    expect(preview).toContain("shownComplete={quote ? isCompleteEstimate(quote) : null}");
    // The workspace starts the warm-up in idle time when a session opens and cancels it on cleanup.
    const workspace = source("components/Workspace.tsx");
    expect(workspace.match(/scheduleWarmup\(\)/g)).toHaveLength(1);
    expect(workspace).toMatch(/useEffect\(\(\) => \{\s*if \(!projectOpen\) return;\s*return scheduleWarmup\(\);[^\n]*\n\s*\}, \[projectOpen\]\);/);
    expect(source("lib/browser/pdfExport.ts")).not.toMatch(/never earlier/);
  });

  it("hands the client only the reference flag and the mode, and holds no color literal outside tokens.css", () => {
    const page = all.find((s) => s.file === "app/page.tsx")!.text;
    expect(page.match(/<Workspace ([^>]*)\/>/)![1]!.trim()).toBe("referenceEnabled={config.features.reference} appMode={config.mode}");
    for (const name of ["lib/browser/pdfExport.ts", "components/ExportButton.tsx", "lib/browser/jpeg.ts"]) {
      const text = all.find((s) => s.file === name)!.text;
      expect(text, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
