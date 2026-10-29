// Client-side A4 estimate PDF (SPEC 11). Pure: no DOM, no network, no IndexedDB, no React.
//
// Two steps, so tests can check the geometry without parsing a PDF:
//   layoutEstimate()   turns the data into positioned boxes per page (text, rectangles, rules, icons, images)
//   buildEstimatePdf() embeds the fonts and images, draws those boxes with pdf-lib and returns the bytes
//
// Money arrives already computed in the Quote (integer cents); this file only formats it. It never decides
// whether the estimate is complete: that comes from quote.incomplete and the non-null totals alone. An unknown
// value is printed as "Unknown", never as 0.
//
// Colors come from the Nordlicht design tokens (src/styles/tokens.css) through a lookup the caller passes in,
// so this file holds no color values of its own.
import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument, PDFName, degrees, drawEllipse, drawImage, drawLine, drawRectangle, drawText, rgb,
  type PDFFont, type PDFImage, type PDFOperator, type PDFPage, type PDFRef,
} from "pdf-lib";
import type { AppMode } from "@/lib/server/config";
import type { FitRow } from "./estimate";
import { sniffFormat } from "./imageFormat";
import { MOCK_LABEL } from "./mocks";
import { FIT_PRECHECK_NOTE, formatEuroCents, type FitStatus } from "./project";
import { EXAMPLE_LABEL } from "./quote";
import { slotInfo } from "./slots";
import type {
  BikeRevision, BuildItemData, CompositeReason, FeeData, FitData, ImageRef, InspectionReviewData, Quote, QuoteLine,
  ShopSettings, Version,
} from "./types";

// ------------------------------------------------------------------------ theme

/** The design tokens the PDF reads. The caller supplies their values (the browser reads the stylesheet). */
export const PDF_TOKENS = [
  "--nl-text", "--nl-text-secondary", "--nl-text-muted", "--nl-hairline", "--nl-surface-2",
  "--nl-primary-ink",
  "--nl-success-soft", "--nl-success-soft-text",
  "--nl-warning-soft", "--nl-warning-soft-text",
  "--nl-danger-soft", "--nl-danger-soft-text",
  "--nl-neutral-soft", "--nl-neutral-soft-text",
] as const;
export type PdfTokenName = (typeof PDF_TOKENS)[number];

/** Channels and alpha, each between 0 and 1. */
export type PdfColor = { r: number; g: number; b: number; a: number };
export type PdfTheme = Record<PdfTokenName, PdfColor>;
/** Returns the CSS value of a token, for example from getComputedStyle in the browser. */
export type TokenLookup = (name: PdfTokenName) => string | null | undefined;

const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/** "12" with scale 255 gives 12/255, "50%" gives 0.5. Null when the text is not a plain number or percentage. */
function unitValue(text: string, scale: number): number | null {
  const percent = text.endsWith("%");
  const body = percent ? text.slice(0, -1) : text;
  if (!NUMBER.test(body)) return null;
  const n = Number(body);
  return Math.min(1, Math.max(0, percent ? n / 100 : n / scale));
}

function parseHashColor(digits: string): PdfColor | null {
  if (!/^[0-9a-f]+$/.test(digits)) return null;
  // Three and four digit forms repeat each digit.
  const full = digits.length === 3 || digits.length === 4 ? [...digits].map((d) => d + d).join("") : digits;
  if (full.length !== 6 && full.length !== 8) return null;
  const byte = (at: number) => parseInt(full.slice(at, at + 2), 16) / 255;
  return { r: byte(0), g: byte(2), b: byte(4), a: full.length === 8 ? byte(6) : 1 };
}

/** rgb() and rgba(), comma form or the modern space form with an optional "/ alpha". */
function parseFunctionColor(text: string): PdfColor | null {
  const match = /^rgba?\((.*)\)$/.exec(text);
  if (!match) return null;
  const body = match[1]!.trim();
  let channels: string[];
  let alpha: string | undefined;
  if (body.includes(",")) {
    if (body.includes("/")) return null;
    channels = body.split(",").map((s) => s.trim());
    if (channels.length === 4) alpha = channels.pop();
  } else {
    const halves = body.split("/").map((s) => s.trim());
    if (halves.length > 2) return null;
    channels = halves[0]!.split(/\s+/);
    alpha = halves[1];
  }
  if (channels.length !== 3) return null;
  const [r, g, b] = channels.map((ch) => unitValue(ch, 255));
  const a = alpha === undefined ? 1 : unitValue(alpha, 1);
  if (r === null || g === null || b === null || r === undefined || g === undefined || b === undefined || a === null) return null;
  return { r, g, b, a };
}

/**
 * One token value to a color. Accepts the 3, 4, 6 and 8 digit hash forms and rgb()/rgba() in the comma and the
 * space/slash syntax. A production stylesheet may serialize the same token in any of these. Anything else throws.
 */
export function parseTokenColor(value: string): PdfColor {
  const text = value.trim().toLowerCase();
  const parsed = text.startsWith("#") ? parseHashColor(text.slice(1)) : parseFunctionColor(text);
  if (!parsed) throw new Error(`The color value ${JSON.stringify(value)} is not a form this PDF understands.`);
  return parsed;
}

/** Looks up and parses every token. A missing or unreadable token throws, so a broken theme never prints. */
export function resolveTheme(lookup: TokenLookup): PdfTheme {
  const theme = {} as PdfTheme;
  for (const name of PDF_TOKENS) {
    const raw = lookup(name);
    if (raw === null || raw === undefined || raw.trim() === "") throw new Error(`The design token ${name} has no value.`);
    theme[name] = parseTokenColor(raw);
  }
  return theme;
}

// ------------------------------------------------------------------------ input

/** One embedded picture. kind must match the bytes; the layout never reads anything else. */
export type PdfImage = {
  bytes: Uint8Array; kind: "jpeg" | "png"; width: number; height: number; hash: string;
  rights: ImageRef["rights"];
};
export type ImageSlot = "before" | "after" | "logo";

/**
 * Everything the PDF prints. There is no other image slot: a reference photo or a product photo has no
 * way into the document (T7).
 */
export type EstimatePdfInput = {
  settings: ShopSettings;
  /** "default" or "example": goes into the file's metadata. */
  settingsId: string;
  appMode: AppMode;
  projectName: string;
  /** The saved bike, or null when none is saved. */
  bikeRevision: BikeRevision | null;
  /** Active items only (one per slot). */
  items: readonly BuildItemData[];
  fees: readonly FeeData[];
  inspectionReview: InspectionReviewData | null;
  quote: Quote;
  /** From estimateSnapshot(), for the same items. */
  rows: readonly FitRow[];
  /** The current fit input hash from the same snapshot, or null without a confirmed bike. The inspection review must match it. */
  currentFitInputHash: string | null;
  /** The version shown now. */
  head: Pick<Version, "composed" | "fallbackReason">;
  /** The root version's picture. */
  before?: PdfImage | null;
  /** The head version's picture. */
  after?: PdfImage | null;
  logo?: PdfImage | null;
  /** Already formatted for the reader, for example "29 Oct 2026". */
  estimateDate: string;
  /** Written as CreationDate and ModDate, so the same input gives the same file. */
  createdAt: Date;
};

export type PdfFontBytes = { sans: Uint8Array; sansBold: Uint8Array; mono: Uint8Array };
export type FontKey = "sans" | "sansBold" | "mono";
export type PdfFonts = Record<FontKey, PDFFont>;

/** Embeds the three fonts as subsets with ligatures off, so text, widths and glyphs are predictable. */
export async function embedFonts(doc: PDFDocument, bytes: PdfFontBytes): Promise<PdfFonts> {
  doc.registerFontkit(fontkit);
  const options = { subset: true, features: { liga: false, clig: false, calt: false } };
  // A fixed name keeps the file the same on every run (pdf-lib would add a random suffix).
  return {
    sans: await doc.embedFont(bytes.sans, { ...options, customName: "DBIKEA+IBMPlexSans-Regular" }),
    sansBold: await doc.embedFont(bytes.sansBold, { ...options, customName: "DBIKEB+IBMPlexSans-SemiBold" }),
    mono: await doc.embedFont(bytes.mono, { ...options, customName: "DBIKEC+IBMPlexMono-Regular" }),
  };
}

// --------------------------------------------------------------------- geometry

export const PDF_PAGE = { width: 595.28, height: 841.89, margin: 36 } as const;
const CONTENT_W = PDF_PAGE.width - 2 * PDF_PAGE.margin;
const M = PDF_PAGE.margin;
const EPS = 0.01;

const BODY = 10;
/** Line height in points. Integer math on the size, so 10 gives exactly 13.5. */
const lead = (size: number): number => Math.ceil((size * 135) / 50) / 2;

const ICON = 10;
const ICON_GAP = 4;
const CHIP_PAD = 4;
const SEG_GAP = 6;
const PANEL_PAD_X = 8;
const IMAGE_BOX_H = 120;
const IMAGE_GAP = 14;
const FOOTER_GAP = 8;
const RULE_THICKNESS = 0.5;

export type LayoutText = {
  kind: "text"; x: number; top: number; width: number; height: number; baseline: number;
  text: string; font: FontKey; size: number; color: PdfTokenName; role: string; group?: string;
};
export type LayoutRect = {
  kind: "rect"; x: number; top: number; width: number; height: number;
  fill: PdfTokenName | null; stroke: PdfTokenName | null; role: string; group?: string;
};
export type LayoutRule = { kind: "rule"; x: number; top: number; width: number; color: PdfTokenName; role: string; group?: string };
export type LayoutImage = { kind: "image"; slot: ImageSlot; x: number; top: number; width: number; height: number; role: string; group?: string };
export type IconShape = "warning" | "check" | "cross" | "stale" | "unchecked" | "unknown";
export type LayoutIcon = { kind: "icon"; shape: IconShape; x: number; top: number; size: number; color: PdfTokenName; role: string; group?: string };
/** `top` is the distance from the top edge of the page, in points. */
export type LayoutBox = LayoutText | LayoutRect | LayoutRule | LayoutImage | LayoutIcon;

export type PageLayout = {
  number: number; total: number; boxes: LayoutBox[];
  /** Body boxes end above this line; the footer starts below it. */
  contentBottom: number; footerTop: number;
};
export type EstimateLayout = {
  pages: PageLayout[];
  /** The pictures the pages draw. */
  images: ImageSlot[];
  /** True when the estimate prints as an incomplete draft (no grand total). */
  draft: boolean;
  /** True when a character without a glyph was replaced by "?" (a footnote says so). */
  replacedCharacters: boolean;
};

// ------------------------------------------------------------------------- text

type Style = { font: FontKey; size: number; color: PdfTokenName };
const sans = (color: PdfTokenName, size = BODY): Style => ({ font: "sans", size, color });
const bold = (color: PdfTokenName, size = BODY): Style => ({ font: "sansBold", size, color });
const mono = (color: PdfTokenName, size = BODY): Style => ({ font: "mono", size, color });

const SPACE_CODES = new Set([0x00a0, 0x1680, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x3000, 0x2000, 0x2001]);
// Zero width and formatting characters: invisible, so they are dropped.
const INVISIBLE_CODES = new Set([0x00ad, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0xfeff, 0xfe0e, 0xfe0f]);
/** ASCII stand-ins for common symbols, used only when the font has no glyph for the symbol. */
const ASCII_FOR: ReadonlyMap<number, string> = new Map([
  [0x2018, "'"], [0x2019, "'"], [0x201b, "'"], [0x2032, "'"], // single quotes, prime
  [0x201c, '"'], [0x201d, '"'], [0x201e, '"'], [0x201f, '"'], [0x2033, '"'], // double quotes
  [0x2010, "-"], [0x2011, "-"], [0x2012, "-"], [0x2212, "-"], [0x2043, "-"], // hyphens and minus
  [0x2022, "-"], [0x2023, "-"], [0x25aa, "-"], [0x25cf, "-"], [0x25e6, "-"], // bullets
  [0x2026, "..."], [0x2192, "->"], [0x2190, "<-"], [0x2264, "<="], [0x2265, ">="], // ellipsis, arrows, comparisons
  [0x00d7, "x"], [0x2248, "~"], [0x2122, "(TM)"], [0x00a9, "(c)"], [0x00ae, "(R)"],
  [0x26a0, "(!)"], [0x24d8, "(i)"], [0x2713, "ok"], [0x2714, "ok"], // warning sign, circled i, check marks
  [0x2715, "x"], [0x2717, "x"], [0x2718, "x"], [0x2716, "x"], // crosses
]);

/** Splits into clusters: a base character plus the combining marks that follow it, never a surrogate pair. */
function splitClusters(text: string): string[] {
  const clusters: string[] = [];
  for (const ch of text) { // for...of walks code points, so a surrogate pair stays whole
    if (clusters.length > 0 && /^\p{M}$/u.test(ch)) clusters[clusters.length - 1] += ch;
    else clusters.push(ch);
  }
  return clusters;
}

/** Measures and wraps text with the real fonts. One per layout run. */
class Ctx {
  /** True once any character had to be replaced by "?". */
  replaced = false;
  private readonly sets = new Map<FontKey, Set<number>>();
  private readonly widths = new Map<string, number>();
  private readonly heights = new Map<string, { ascent: number; full: number }>();

  constructor(readonly fonts: PdfFonts) {}

  private charset(font: FontKey): Set<number> {
    let set = this.sets.get(font);
    if (!set) { set = new Set(this.fonts[font].getCharacterSet()); this.sets.set(font, set); }
    return set;
  }

  hasGlyph(font: FontKey, codePoint: number): boolean {
    return this.charset(font).has(codePoint);
  }

  /**
   * Text the font can draw. NFC first (so decomposed umlauts become one letter), then code point by code point:
   * a newline stays, tab and other control characters become a space, invisible characters go, a symbol
   * without a glyph gets an ASCII stand-in, anything else becomes "?" and sets `replaced`.
   */
  clean(font: FontKey, raw: string): string {
    const set = this.charset(font);
    // Zl and Zp are the Unicode line and paragraph separators; NEL is the old mainframe newline.
    const text = raw.normalize("NFC").replace(/\r\n?|[\p{Zl}\p{Zp}]|\u0085/gu, "\n");
    let out = "";
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (ch === "\n") { out += ch; continue; }
      if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || SPACE_CODES.has(cp)) { out += " "; continue; }
      if (INVISIBLE_CODES.has(cp)) continue;
      if (set.has(cp)) { out += ch; continue; }
      const stand = ASCII_FOR.get(cp);
      if (stand !== undefined) { out += stand; continue; }
      out += "?";
      this.replaced = true;
    }
    return out;
  }

  /** Exact width in points. */
  width(style: Style, text: string): number {
    return this.fonts[style.font].widthOfTextAtSize(text, style.size);
  }

  /** Width of a word or a single character, remembered. */
  private cached(style: Style, text: string): number {
    const key = `${style.font}|${style.size}|${text}`;
    let w = this.widths.get(key);
    if (w === undefined) { w = this.width(style, text); this.widths.set(key, w); }
    return w;
  }

  /** Ascent and full height (with descender) of the font at a size. */
  private heightsOf(style: Style): { ascent: number; full: number } {
    const key = `${style.font}|${style.size}`;
    let h = this.heights.get(key);
    if (!h) {
      const font = this.fonts[style.font];
      h = { ascent: font.heightAtSize(style.size, { descender: false }), full: font.heightAtSize(style.size) };
      this.heights.set(key, h);
    }
    return h;
  }

  /**
   * A text box for `text`, vertically centered in a line of height `lineHeight` whose top is `top`.
   * Pass `width` when the text was already measured; measuring is the slow part of a long document.
   */
  textBox(text: string, style: Style, x: number, top: number, lineHeight: number, role: string, group?: string, width?: number): LayoutText {
    const own = lead(style.size);
    const h = this.heightsOf(style);
    const inset = (lineHeight - own) / 2;
    return {
      kind: "text", x, top: top + inset, width: width ?? this.width(style, text), height: own,
      baseline: (own - h.full) / 2 + h.ascent, text, font: style.font, size: style.size, color: style.color, role, group,
    };
  }

  /** Wraps cleaned text into lines no wider than maxWidth. Newlines start a new line; blank lines are kept. */
  wrap(style: Style, text: string, maxWidth: number): MeasuredLine[] {
    if (text.trim() === "") return [];
    const out: MeasuredLine[] = [];
    for (const paragraph of text.replace(/^\n+|\n+$/g, "").split("\n")) {
      if (paragraph.trim() === "") out.push({ text: "", width: 0 });
      else out.push(...this.wrapParagraph(style, paragraph, maxWidth));
    }
    return out;
  }

  private wrapParagraph(style: Style, paragraph: string, maxWidth: number): MeasuredLine[] {
    const words = paragraph.split(" ").filter((w) => w !== "");
    const space = this.cached(style, " ");
    const lines: MeasuredLine[] = [];
    let i = 0;
    while (i < words.length) {
      const lineWords: string[] = [];
      let estimate = 0;
      while (i < words.length) {
        const word = words[i]!;
        const w = this.cached(style, word);
        if (lineWords.length === 0) {
          if (w <= maxWidth) { lineWords.push(word); estimate = w; i++; continue; }
          // A word wider than the line (a long URL): cut it by character. The last piece may take more words.
          const pieces = this.breakLong(style, word, maxWidth);
          lines.push(...pieces.slice(0, -1));
          const last = pieces[pieces.length - 1]!;
          lineWords.push(last.text); estimate = last.width; i++;
          continue;
        }
        if (estimate + space + w > maxWidth) break;
        lineWords.push(word); estimate += space + w; i++;
      }
      // The estimate ignores kerning at the word joints. Measure the real line once and push words down if it is over.
      let text = lineWords.join(" ");
      let width = lineWords.length === 1 ? this.cached(style, text) : this.width(style, text);
      while (lineWords.length > 1 && width > maxWidth) {
        lineWords.pop(); i--; text = lineWords.join(" ");
        width = lineWords.length === 1 ? this.cached(style, text) : this.width(style, text);
      }
      lines.push({ text, width });
    }
    return lines;
  }

  /** Cuts one unbreakable token into pieces that each fit maxWidth. At least one cluster per piece. */
  private breakLong(style: Style, word: string, maxWidth: number): MeasuredLine[] {
    const clusters = splitClusters(word);
    const pieces: MeasuredLine[] = [];
    let start = 0;
    while (start < clusters.length) {
      let end = start;
      let estimate = 0;
      while (end < clusters.length) {
        const w = this.cached(style, clusters[end]!);
        if (end > start && estimate + w > maxWidth) break;
        estimate += w; end++;
      }
      let piece = clusters.slice(start, end).join("");
      let width = end - start === 1 ? this.cached(style, piece) : this.width(style, piece);
      while (end - start > 1 && width > maxWidth) {
        end--; piece = clusters.slice(start, end).join("");
        width = end - start === 1 ? this.cached(style, piece) : this.width(style, piece);
      }
      pieces.push({ text: piece, width });
      start = end;
    }
    return pieces;
  }
}

/** A wrapped line and its exact width in points. */
type MeasuredLine = { text: string; width: number };

// ------------------------------------------------------------- rows and columns

/** One run of text on a line, optionally with an icon and a colored chip behind it. */
type Seg = {
  text: string; style: Style; icon?: IconShape; iconColor?: PdfTokenName; chip?: PdfTokenName;
  /** Width of the text alone, filled in when it is first measured. */
  width?: number;
};
type CellLine = { segs: Seg[]; /** Left inset for wrapped lines that continue under an icon. */ indent: number };
type Column = { x: number; width: number; align?: "left" | "right"; lines: CellLine[] };
type Deco = { icon?: IconShape; iconColor?: PdfTokenName; chip?: PdfTokenName };
/** The smallest layout unit: boxes with `top` relative to the line, and the line's height. */
type FlowLine = { height: number; boxes: LayoutBox[] };

const decoWidth = (d: Deco) => (d.chip ? 2 * CHIP_PAD : 0) + (d.icon ? ICON + ICON_GAP : 0);

function segWidth(c: Ctx, seg: Seg): number {
  seg.width ??= c.width(seg.style, seg.text);
  return decoWidth(seg) + seg.width;
}

/** Wraps `raw` (cleaned for the font) into cell lines. The icon and chip go on the first line only. */
function textLines(c: Ctx, raw: string, style: Style, width: number, deco: Deco = {}): CellLine[] {
  const text = c.clean(style.font, raw);
  const lines = c.wrap(style, text, Math.max(width - decoWidth(deco), 1));
  const indent = (deco.chip ? CHIP_PAD : 0) + (deco.icon ? ICON + ICON_GAP : 0);
  return lines.map((line, i) => ({
    segs: [{ text: line.text, width: line.width, style, ...(i === 0 ? deco : {}) }], indent: i === 0 ? 0 : indent,
  }));
}

/** Chips laid left to right, starting a new line when the next one would not fit. */
function chipLines(c: Ctx, chips: Seg[], width: number): CellLine[] {
  const lines: CellLine[] = [];
  let current: Seg[] = [];
  let used = 0;
  for (const chip of chips) {
    const w = segWidth(c, chip);
    if (current.length > 0 && used + SEG_GAP + w > width) { lines.push({ segs: current, indent: 0 }); current = []; used = 0; }
    used += (current.length > 0 ? SEG_GAP : 0) + w;
    current.push(chip);
  }
  if (current.length > 0) lines.push({ segs: current, indent: 0 });
  return lines;
}

/** Places one cell line's segments (chip, icon, text) in a column. */
function placeLine(c: Ctx, line: CellLine, col: Column, height: number, boxes: LayoutBox[], role: string, group?: string): void {
  const widths = line.segs.map((s) => segWidth(c, s));
  const total = widths.reduce((a, b) => a + b, 0) + SEG_GAP * Math.max(0, line.segs.length - 1);
  let x = col.align === "right" ? col.x + col.width - total : col.x + line.indent;
  line.segs.forEach((seg, k) => {
    let cx = x;
    if (seg.chip) {
      boxes.push({ kind: "rect", x: cx, top: 1, width: widths[k]!, height: height - 2, fill: seg.chip, stroke: null, role: "chip", group });
      cx += CHIP_PAD;
    }
    if (seg.icon) {
      boxes.push({ kind: "icon", shape: seg.icon, x: cx, top: (height - ICON) / 2, size: ICON, color: seg.iconColor ?? seg.style.color, role, group });
      cx += ICON + ICON_GAP;
    }
    if (seg.text !== "") boxes.push(c.textBox(seg.text, seg.style, cx, 0, height, role, group, seg.width));
    x += widths[k]! + SEG_GAP;
  });
}

/** Merges columns into lines: line i holds line i of every column. A line is as tall as its tallest text. */
function rowLines(c: Ctx, cols: Column[], role: string, group?: string): FlowLine[] {
  const count = Math.max(0, ...cols.map((col) => col.lines.length));
  const out: FlowLine[] = [];
  for (let i = 0; i < count; i++) {
    const sizes = cols.flatMap((col) => (col.lines[i]?.segs ?? []).map((s) => lead(s.style.size)));
    const height = Math.max(lead(BODY), ...sizes);
    const boxes: LayoutBox[] = [];
    for (const col of cols) {
      const line = col.lines[i];
      if (line) placeLine(c, line, col, height, boxes, role, group);
    }
    out.push({ height, boxes });
  }
  return out;
}

/** A paragraph in one column. */
function para(c: Ctx, text: string, style: Style, x: number, width: number, role: string, group?: string, deco?: Deco): FlowLine[] {
  return rowLines(c, [{ x, width, lines: textLines(c, text, style, width, deco) }], role, group);
}

/** Bullet entries: a bullet in its own column keeps the wrapped lines aligned. */
function bulletRows(c: Ctx, texts: readonly string[], style: Style, x: number, width: number, role: string, group?: string): FlowLine[] {
  const bullet = c.hasGlyph("sans", 0x2022) ? "•" : "-";
  return texts.flatMap((text) => rowLines(c, [
    { x, width: 10, lines: [{ segs: [{ text: bullet, style }], indent: 0 }] },
    { x: x + 10, width: width - 10, lines: textLines(c, text, style, width - 10) },
  ], role, group));
}

// ----------------------------------------------------------------------- blocks

type Panel = {
  x: number; width: number; padY: number; fill: PdfTokenName | null; stroke: PdfTokenName | null;
  /** A hairline under the block, drawn on every page the block touches. */
  rule?: PdfTokenName;
};
/** A run of lines the flow places together or, when it is taller than the space left, splits line by line. */
type Block = {
  lines: FlowLine[];
  gapBefore?: number;
  /** Move the whole block to the next page when it does not fit here but fits there. */
  keepTogether?: boolean;
  /** At least this many lines stay together at the start (a heading never sits alone). */
  keepLines?: number;
  panel?: Panel;
};

const blockHeight = (b: Block): number => b.lines.reduce((s, l) => s + l.height, 0) + 2 * (b.panel?.padY ?? 0);

/** Fills pages top to bottom. Knows nothing about content: only heights, page breaks and repeated table headers. */
class Flow {
  readonly pages: LayoutBox[][] = [];
  private y: number = M;
  private pageTop: number = M;
  private header: Block | null = null;

  constructor(private readonly bottom: number) { this.newPage(); }

  private newPage(): void {
    this.pages.push([]);
    this.y = M;
    if (this.header) this.place(this.header, this.header.lines);
    this.pageTop = this.y;
  }

  /** Puts lines at the current y, with the panel behind them. The caller has checked that they fit. */
  private place(block: Block, lines: FlowLine[]): void {
    const page = this.pages[this.pages.length - 1]!;
    const panel = block.panel;
    const pad = panel?.padY ?? 0;
    const height = lines.reduce((s, l) => s + l.height, 0) + 2 * pad;
    if (panel && (panel.fill || panel.stroke)) {
      page.push({ kind: "rect", x: panel.x, top: this.y, width: panel.width, height, fill: panel.fill, stroke: panel.stroke, role: "panel" });
    }
    let top = this.y + pad;
    for (const line of lines) {
      for (const box of line.boxes) page.push({ ...box, top: box.top + top });
      top += line.height;
    }
    this.y += height;
    if (panel?.rule) page.push({ kind: "rule", x: panel.x, top: this.y, width: panel.width, color: panel.rule, role: "rule" });
  }

  add(block: Block): void {
    if (block.lines.length === 0) return;
    const total = blockHeight(block);
    const gap = this.y > this.pageTop ? (block.gapBefore ?? 0) : 0;
    if (this.y + gap + total <= this.bottom + EPS) { this.y += gap; this.place(block, block.lines); return; }
    const capacity = this.bottom - (M + (this.header ? blockHeight(this.header) : 0));
    if (block.keepTogether && total <= capacity + EPS) { this.newPage(); this.place(block, block.lines); return; }
    this.split(block);
  }

  /** A block taller than the space left: lines go to this page until it is full, the rest to the next. */
  private split(block: Block): void {
    const { lines } = block;
    const pad = block.panel?.padY ?? 0;
    const keep = Math.min(lines.length, Math.max(2, block.keepLines ?? 0));
    let i = 0;
    while (i < lines.length) {
      const gap = i === 0 && this.y > this.pageTop ? (block.gapBefore ?? 0) : 0;
      const room = this.bottom + EPS - (this.y + gap) - 2 * pad;
      let j = i;
      let used = 0;
      while (j < lines.length && used + lines[j]!.height <= room) { used += lines[j]!.height; j++; }
      const wanted = i === 0 ? keep : Math.min(2, lines.length - i);
      // Do not leave one line alone on the next page.
      if (j < lines.length && lines.length - j === 1 && j - 1 - i >= Math.max(wanted, 2)) j--;
      const atTop = this.y <= this.pageTop + EPS;
      if (j - i < wanted && !atTop) { this.newPage(); continue; }
      if (j === i) j = i + 1; // a line taller than a whole page is placed anyway
      this.y += gap;
      this.place(block, lines.slice(i, j));
      i = j;
      if (i < lines.length) this.newPage();
    }
  }

  /**
   * Starts a table: the header and the first row stay together, and later pages repeat the header. A first row that
   * is kept whole (and fits a page) must fit under the header here, else the header would sit alone at the page
   * bottom while the row moves to the next page. A row that may be split only needs its first two lines.
   */
  startTable(header: Block, firstRow: Block): void {
    const capacity = this.bottom - (M + blockHeight(header));
    const wholeRow = firstRow.keepTogether === true && blockHeight(firstRow) <= capacity + EPS;
    const first = wholeRow
      ? blockHeight(firstRow)
      : firstRow.lines.slice(0, 2).reduce((s, l) => s + l.height, 0) + 2 * (firstRow.panel?.padY ?? 0);
    const gap = this.y > this.pageTop ? (header.gapBefore ?? 0) : 0;
    if (this.y + gap + blockHeight(header) + first > this.bottom + EPS) this.newPage();
    this.add(header);
    this.header = header;
  }

  endTable(): void { this.header = null; }
}

// ----------------------------------------------------------------------- tones

type Tone = "success" | "warning" | "danger" | "neutral";
const TONES: Record<Tone, { fill: PdfTokenName; color: PdfTokenName }> = {
  success: { fill: "--nl-success-soft", color: "--nl-success-soft-text" },
  warning: { fill: "--nl-warning-soft", color: "--nl-warning-soft-text" },
  danger: { fill: "--nl-danger-soft", color: "--nl-danger-soft-text" },
  neutral: { fill: "--nl-neutral-soft", color: "--nl-neutral-soft-text" },
};

/** Words copied exactly from FitBadge.tsx; every status also has a different icon shape. */
const FIT_LOOK: Record<FitStatus, { word: string; tone: Tone; icon: IconShape }> = {
  ok: { word: "Fit ok", tone: "success", icon: "check" },
  verify: { word: "Verify fit", tone: "warning", icon: "warning" },
  problem: { word: "Fit problem", tone: "danger", icon: "cross" },
  stale: { word: "Check is stale", tone: "neutral", icon: "stale" },
  not_checked: { word: "Not checked", tone: "neutral", icon: "unchecked" },
};

/** Labels copied exactly from PaperworkSummary.tsx. "unknown" is always said out loud. */
const APPROVAL: Record<FitData["approval"], string> = {
  abe: "ABE", e_mark: "E-mark", teilegutachten: "Teilegutachten", none: "No approval", unknown: "unknown",
};
const COVERAGE: Record<FitData["documentCoverage"], string> = {
  covered: "Covers this bike", not_covered: "Does not cover this bike", unknown: "unknown",
};
const INSPECTION: Record<FitData["inspection"], string> = {
  none: "No inspection", aenderungsabnahme: "Änderungsabnahme", einzelabnahme: "Einzelabnahme", unknown: "unknown",
};
const EINTRAGUNG: Record<FitData["eintragung"], string> = { required: "Required", not_required: "Not required", unknown: "unknown" };
const CARRY: Record<FitData["carryDocuments"], string> = { required: "Carry the documents", not_required: "Not required", unknown: "unknown" };
/** Decision words copied from InspectionFees.tsx. */
const DECISION: Record<InspectionReviewData["decision"], string> = {
  none: "No inspection fee is needed", fees_added: "Inspection fees were added", unresolved: "Not decided yet",
};

const day = (iso: string) => iso.slice(0, 10);

/** "checked 2026-10-29", the same date the screen shows. A fit without a time stamp says so. */
const checkedOn = (item: BuildItemData): string => (item.fitCheckedAt ? `checked ${day(item.fitCheckedAt)}` : "check date unknown");

/** True when the mechanic reviewed the fit that is current for this bike and build. */
const reviewedNow = (row: FitRow): boolean => row.reviewed && row.hashMatches;

// --------------------------------------------------------------- derived values

type Info = {
  draft: boolean;
  mock: boolean;
  /**
   * The after image is a mock placeholder: the app runs in mock mode. A version stores no mock marker, so a project
   * made under MOCK=1 and exported in another mode is not caught here (known limit, TASKS.md T11).
   */
  mockImages: boolean;
  lines: QuoteLine[];
  itemById: Map<string, BuildItemData>;
  rowById: Map<string, FitRow>;
  ref: string;
};

/** Completeness comes only from the quote: its flag and its non-null totals. */
function isComplete(q: Quote): boolean {
  return !q.incomplete && q.netCents !== null && q.vatCents !== null && q.grossCents !== null;
}

/** Throws when the pieces do not describe the same snapshot, or an image does not match its declared kind. */
function validate(input: EstimatePdfInput): void {
  const sorted = (ids: readonly string[]) => [...ids].sort().join("|");
  const itemIds = input.items.map((i) => i.id);
  if (new Set(itemIds).size !== itemIds.length) throw new Error("The estimate data is mixed: an item appears twice.");
  const lineIds = input.quote.lines.map((l) => l.itemId);
  const rowIds = input.rows.map((r) => r.item.id);
  if (lineIds.length !== itemIds.length || rowIds.length !== itemIds.length
    || sorted(lineIds) !== sorted(itemIds) || sorted(rowIds) !== sorted(itemIds)) {
    throw new Error("The estimate data is mixed: the quote lines, fit rows and items are not the same items.");
  }
  const titles = new Map(input.items.map((i) => [i.id, i.title]));
  for (const line of input.quote.lines) {
    if (titles.get(line.itemId) !== line.label) throw new Error("The estimate data is mixed: a quote line does not match its item.");
  }
  // The fit flags must come from the same fit data as the items: same check, same review.
  const byId = new Map(input.items.map((i) => [i.id, i]));
  for (const row of input.rows) {
    const item = byId.get(row.item.id)!;
    if (row.item.fitInputHash !== item.fitInputHash || row.item.fitCheckedAt !== item.fitCheckedAt
      || row.item.fitReviewedHash !== item.fitReviewedHash) {
      throw new Error("The estimate data is mixed: a fit row was made from different fit data than its item.");
    }
  }
  // The quote sums the fee lines only when every one is confirmed and has an amount; check the fees agree.
  let feeSum = 0;
  let feesResolved = true;
  for (const fee of input.fees) {
    if (fee.netCents === null || !fee.confirmed) feesResolved = false;
    else feeSum += fee.netCents;
  }
  const feeTotal = input.quote.feeNetCents;
  if (feeTotal === null ? feesResolved : !feesResolved || feeTotal !== feeSum) {
    throw new Error("The estimate data is mixed: the fee lines are not the ones the quote was made from.");
  }
  for (const id of input.quote.staleFitItemIds) {
    if (!titles.has(id)) throw new Error("The estimate data is mixed: the stale fit list names an unknown item.");
  }
  for (const slot of ["before", "after", "logo"] as const) {
    const image = input[slot];
    if (!image) continue;
    if (!(image.width > 0 && image.height > 0) || !Number.isFinite(image.width) || !Number.isFinite(image.height)) {
      throw new Error(`The ${slot} image has no usable size.`);
    }
    const sniffed = sniffFormat(image.bytes);
    if (sniffed !== image.kind) throw new Error(`The ${slot} image says it is ${image.kind}, but its bytes are ${sniffed}.`);
  }
}

function derive(input: EstimatePdfInput): Info {
  const rowById = new Map(input.rows.map((r) => [r.item.id, r]));
  return {
    draft: !isComplete(input.quote),
    mock: input.appMode === "mock" || input.rows.some((r) => r.mock),
    mockImages: input.appMode === "mock",
    lines: input.quote.lines,
    itemById: new Map(input.items.map((i) => [i.id, i])),
    rowById,
    ref: input.quote.inputHash.slice(0, 8),
  };
}

// ------------------------------------------------------------------- the blocks

function heading(c: Ctx, text: string): FlowLine[] {
  return para(c, text, bold("--nl-text", 12), M, CONTENT_W, "heading");
}

/** A tinted panel with a title line (icon + words) and plain or bulleted lines. */
function notice(
  c: Ctx, tone: Tone, icon: IconShape, title: string, body: readonly string[], bullets: readonly string[] = [], role = "notice",
): Block {
  const t = TONES[tone];
  const x = M + PANEL_PAD_X;
  const w = CONTENT_W - 2 * PANEL_PAD_X;
  const lines = [
    ...para(c, title, bold(t.color), x, w, role, undefined, { icon }),
    ...body.flatMap((p) => para(c, p, sans(t.color), x, w, role)),
    ...bulletRows(c, bullets, sans(t.color), x, w, role),
  ];
  return { lines, gapBefore: 6, keepTogether: true, panel: { x: M, width: CONTENT_W, padY: 5, fill: t.fill, stroke: null } };
}

function plainBlock(lines: FlowLine[], gapBefore = 6): Block {
  return { lines, gapBefore, keepTogether: true };
}

/** A label column and a value column. */
function labelValue(c: Ctx, label: string, value: string, valueStyle: Style, role: string, labelW = 56): FlowLine[] {
  return rowLines(c, [
    { x: M, width: labelW, lines: textLines(c, label, sans("--nl-text-secondary"), labelW) },
    { x: M + labelW, width: CONTENT_W - labelW, lines: textLines(c, value, valueStyle, CONTENT_W - labelW) },
  ], role);
}

function bikeText(bike: BikeRevision | null): string {
  const b = bike?.bike;
  const text = (v: string | null | undefined) => (v ? v : "unknown");
  const years = !b || (b.yearFrom === null && b.yearTo === null) ? "unknown"
    : b.yearFrom !== null && b.yearTo !== null ? (b.yearFrom === b.yearTo ? `${b.yearFrom}` : `${b.yearFrom}–${b.yearTo}`)
    : b.yearFrom !== null ? `from ${b.yearFrom}` : `up to ${b.yearTo}`;
  return `Make ${text(b?.make)} · Model ${text(b?.model)} · Years ${years} · ABS ${text(b?.abs)}`;
}

type ImageUse = { slot: ImageSlot; image: PdfImage };
type ImagePlan = { use: ImageUse | null; note: string | null };

/** Only supplied pictures with owned or visitor rights are drawn. Nothing else ever takes their place. */
function planImage(slot: ImageSlot, image: PdfImage | null | undefined, name: string): ImagePlan {
  if (!image) return { use: null, note: `${name}: not supplied, left out.` };
  if (image.rights === "external_runtime") return { use: null, note: `${name}: outside web source, left out.` };
  return { use: { slot, image }, note: null };
}

/** Largest size inside the box that keeps the picture's shape. */
function aspectFit(width: number, height: number, boxW: number, boxH: number): { w: number; h: number } {
  const scale = Math.min(boxW / width, boxH / height);
  return { w: width * scale, h: height * scale };
}

function headerBlocks(c: Ctx, input: EstimatePdfInput, info: Info, used: Set<ImageSlot>): Block[] {
  const blocks: Block[] = [];
  const { settings } = input;

  // Logo and shop name share one line; the name is centered against the logo.
  const logo = planImage("logo", input.logo, "Shop logo");
  const logoSize = logo.use ? aspectFit(logo.use.image.width, logo.use.image.height, 110, 36) : null;
  const nameX = M + (logoSize ? logoSize.w + 12 : 0);
  const name = para(c, settings.shopName, bold("--nl-text", 16), nameX, CONTENT_W - (nameX - M), "shop");
  const nameH = name.reduce((s, l) => s + l.height, 0);
  const lineH = Math.max(logoSize?.h ?? 0, nameH);
  const boxes: LayoutBox[] = [];
  if (logo.use && logoSize) {
    used.add("logo");
    boxes.push({ kind: "image", slot: "logo", x: M, top: (lineH - logoSize.h) / 2, width: logoSize.w, height: logoSize.h, role: "logo" });
  }
  let top = (lineH - nameH) / 2;
  for (const l of name) { for (const b of l.boxes) boxes.push({ ...b, top: b.top + top }); top += l.height; }
  blocks.push({ lines: [{ height: lineH, boxes }], keepTogether: true });
  // A logo the settings name but the caller could not supply is worth one sentence; a shop without a logo is not.
  if ((settings.logoImageId !== null && !input.logo) || (input.logo && !logo.use)) {
    blocks.push(plainBlock(para(c, "The shop logo is not included.", sans("--nl-text-muted"), M, CONTENT_W, "meta"), 2));
  }

  // Title on the left; date and short reference on the right of the same line.
  const titleColor: PdfTokenName = info.draft ? "--nl-warning-soft-text" : "--nl-text";
  const metaW = 175;
  const refSegs: Seg[] = [
    { text: "Ref", style: sans("--nl-text-secondary") },
    { text: info.ref, style: mono("--nl-text") },
  ];
  const dateLines = textLines(c, input.estimateDate, sans("--nl-text"), metaW);
  // The usual short date shares the line with the reference; a long date wraps and the reference gets its own line.
  const oneLine: CellLine | null = dateLines.length === 1 ? { segs: [...dateLines[0]!.segs, ...refSegs], indent: 0 } : null;
  const fitsOneLine = oneLine !== null && oneLine.segs.reduce((w, s) => w + segWidth(c, s), 0) + SEG_GAP * 2 <= metaW;
  const metaLines: CellLine[] = fitsOneLine ? [oneLine!] : [...dateLines, { segs: refSegs, indent: 0 }];
  blocks.push({
    lines: rowLines(c, [
      { x: M, width: CONTENT_W - metaW - 8, lines: textLines(c, info.draft ? "Incomplete draft — costs missing" : "Estimate", bold(titleColor, 20), CONTENT_W - metaW - 8) },
      { x: M + CONTENT_W - metaW, width: metaW, align: "right", lines: metaLines },
    ], "title"),
    gapBefore: 6, keepTogether: true,
  });

  if (settings.demoRates) {
    blocks.push(notice(c, "warning", "warning", EXAMPLE_LABEL, [
      "The hourly rate, labor minutes and fee allowances are illustrative. This is not a real quote.",
    ]));
  }
  if (info.mock) {
    const why = input.appMode === "mock" ? "The app is running in mock mode, so results are placeholders." : "At least one fit result is mock data, not a real check.";
    blocks.push(notice(c, "warning", "warning", MOCK_LABEL, [why]));
  }

  // Facts: project and bike.
  const facts: FlowLine[] = labelValue(c, "Project", input.projectName, sans("--nl-text"), "meta");
  const confirmed = input.bikeRevision?.confirmed === true;
  facts.push(...labelValue(c, "Bike", bikeText(input.bikeRevision), sans("--nl-text"), "meta"));
  if (!confirmed) {
    facts.push(...rowLines(c, [{
      x: M + 56, width: CONTENT_W - 56,
      lines: textLines(c, "Bike not confirmed: these values are not verified.", sans("--nl-warning-soft-text"), CONTENT_W - 56, { icon: "warning" }),
    }], "meta"));
  }
  blocks.push({ lines: facts, gapBefore: 6, keepTogether: true });
  return blocks;
}

/**
 * Why the edit was not blended into the photo, in plain English. Keys are the composite reasons the app stores
 * (the same cases as FALLBACK_TEXT in renderFlow.ts). "composited" is not a fallback, so it has no phrase.
 */
const FALLBACK_WORDS: ReadonlyMap<string, string> = new Map<Exclude<CompositeReason, "composited">, string>([
  ["drift", "the model moved the bike"],
  ["geometry", "the shape of the part changed"],
  ["small", "the rendered image was too small to blend"],
  ["aspect", "the rendered image has a different shape"],
  ["missing_mask", "the changed part could not be found again"],
  ["no_outside_area", "nothing outside the part was left to protect"],
  ["disabled", "blending was turned off"],
]);

/** " (reason)" in words, or a generic sentence part for a code this version does not know. Never the raw code. */
function fallbackPhrase(code: string): string {
  const words = FALLBACK_WORDS.get(code);
  return words ? ` (${words})` : " (for a technical reason)";
}

function imageBlocks(c: Ctx, input: EstimatePdfInput, info: Info, used: Set<ImageSlot>): Block[] {
  const before = planImage("before", input.before, "Before photo");
  const after = planImage("after", input.after, "After image");
  const slotW = (CONTENT_W - IMAGE_GAP) / 2;
  const sameImage = before.use !== null && after.use !== null && before.use.image.hash === after.use.image.hash;
  const style = sans("--nl-text-muted");

  type Slot = { x: number; use: ImageUse | null; caption: string };
  const slots: Slot[] = sameImage
    ? [{ x: M + (CONTENT_W - slotW) / 2, use: before.use, caption: "Original photo — no visual change yet." }]
    : [
      { x: M, use: before.use, caption: before.use ? "Before: original photo." : (before.note ?? "") },
      { x: M + slotW + IMAGE_GAP, use: after.use, caption: after.use ? (info.mockImages ? "After: mock placeholder, not an AI result." : "After: AI visualization, not a photograph.") : (after.note ?? "") },
    ];
  const lines: FlowLine[] = [];
  if (slots.some((s) => s.use)) {
    const boxes: LayoutBox[] = [];
    for (const s of slots) {
      if (!s.use) continue;
      used.add(s.use.slot);
      const fit = aspectFit(s.use.image.width, s.use.image.height, slotW, IMAGE_BOX_H);
      boxes.push({ kind: "image", slot: s.use.slot, x: s.x, top: 0, width: fit.w, height: fit.h, role: "image" });
    }
    lines.push({ height: IMAGE_BOX_H + 2, boxes });
  }
  lines.push(...rowLines(c, slots.map((s) => ({ x: s.x, width: slotW, lines: textLines(c, s.caption, style, slotW) })), "caption"));

  if (!input.head.composed && input.head.fallbackReason) {
    lines.push(...para(c, `Not blended into the original photo${fallbackPhrase(input.head.fallbackReason)}. The after image replaces the whole picture.`,
      sans("--nl-warning-soft-text"), M, CONTENT_W, "caption", undefined, { icon: "warning" }));
  }
  return [{ lines, gapBefore: 6, keepTogether: true }];
}

function noticeBlocks(c: Ctx, input: EstimatePdfInput, info: Info): Block[] {
  const blocks: Block[] = [];
  const stale = input.quote.staleFitItemIds.map((id) => {
    const item = info.itemById.get(id)!;
    const row = info.rowById.get(id)!;
    const word = item.fit ? FIT_LOOK[item.fit.status].word : FIT_LOOK.not_checked.word;
    return `${item.title}: ${word} when last checked, ${row.expired ? "older than 24 h" : "out of date"}.`;
  });
  if (stale.length > 0) {
    blocks.push(notice(c, "neutral", "stale", "Stale fit check",
      ["These fit checks are older than 24 hours or no longer match the bike and parts. Check fit again before relying on them."], stale));
  }
  // Only a review of the current check counts: when the bike, parts or rules changed, the review is out of date
  // and the stale notice and the quote's exclusions say so.
  const open = input.rows.filter((r) => reviewedNow(r) && r.item.fit && (r.item.fit.status === "verify" || r.item.fit.status === "problem"));
  if (open.length > 0) {
    // One short line per item: the reasons are printed once, in the paperwork summary.
    const entries = open.map((r) => `${r.item.title}: ${FIT_LOOK[r.item.fit!.status].word}, ${checkedOn(r.item)}`);
    blocks.push(notice(c, open.some((r) => r.item.fit!.status === "problem") ? "danger" : "warning", "warning",
      "Open fit findings, acknowledged by the mechanic",
      ["The mechanic reviewed these findings. They are still open: the shop and the inspection authority must verify them. Details are in the paperwork summary."],
      entries));
  }
  return blocks;
}

// -------------------------------------------------------------------- the table

// The labor column is wider so "(shop default minutes)" stays on one line.
const AMOUNT_WIDTHS = [90, 116, 94] as const;
const COLS = (() => {
  const amountsX = M + CONTENT_W - AMOUNT_WIDTHS.reduce((a, b) => a + b, 0);
  const text = { x: M, width: amountsX - M - 8 };
  const amount = (n: 0 | 1 | 2) => {
    const x = amountsX + AMOUNT_WIDTHS.slice(0, n).reduce((a, b) => a + b, 0);
    return { x: x + 6, width: AMOUNT_WIDTHS[n] - 6, align: "right" as const };
  };
  return { text, part: amount(0), labor: amount(1), net: amount(2) };
})();

function unknownLines(c: Ctx, width: number): CellLine[] {
  return textLines(c, "Unknown", sans("--nl-warning-soft-text"), width, { icon: "unknown" });
}

function amountLines(c: Ctx, cents: number | null, width: number, color: PdfTokenName = "--nl-text"): CellLine[] {
  return cents === null ? unknownLines(c, width) : textLines(c, formatEuroCents(cents), mono(color), width);
}

function tableHeader(c: Ctx): Block {
  const style = bold("--nl-text-secondary");
  const head = (text: string, col: { x: number; width: number; align?: "left" | "right" }): Column =>
    ({ ...col, lines: textLines(c, text, style, col.width) });
  return {
    lines: rowLines(c, [
      head("Line", COLS.text), head("Part net", COLS.part), head("Labor net", COLS.labor), head("Line net", COLS.net),
    ], "table-header"),
    gapBefore: 8, keepTogether: true,
    panel: { x: M, width: CONTENT_W, padY: 3, fill: "--nl-surface-2", stroke: null, rule: "--nl-hairline" },
  };
}

const rowPanel: Panel = { x: M, width: CONTENT_W, padY: 3, fill: null, stroke: null, rule: "--nl-hairline" };

function itemRow(c: Ctx, line: QuoteLine, item: BuildItemData, row: FitRow): Block {
  const group = `item:${item.id}`;
  const look = FIT_LOOK[row.status];
  const t = TONES[look.tone];
  const slot = slotInfo(item.slot).label;
  const p = item.product;
  const detail = p ? `${slot} · ${[p.brand, p.name].filter(Boolean).join(" ")}${p.partNumber ? `, part no. ${p.partNumber}` : ""}` : slot;
  const chips: Seg[] = [{ text: look.word, style: bold(t.color), icon: look.icon, chip: t.fill }];
  if (reviewedNow(row)) chips.push({ text: "Reviewed by the mechanic", style: sans(TONES.success.color), icon: "check", chip: TONES.success.fill });
  if (row.mock) chips.push({ text: "Mock result", style: sans(TONES.warning.color), icon: "warning", chip: TONES.warning.fill });
  const laborNote = line.defaultMinutes && line.laborNetCents !== null
    ? textLines(c, "(shop default minutes)", sans("--nl-text-muted"), COLS.labor.width) : [];
  const partNote = item.costKind === "labor_only" && line.partNetCents !== null
    ? textLines(c, "(labor only)", sans("--nl-text-muted"), COLS.part.width) : [];
  return {
    lines: rowLines(c, [
      { ...COLS.text, lines: [...textLines(c, line.label, bold("--nl-text"), COLS.text.width), ...textLines(c, detail, sans("--nl-text-muted"), COLS.text.width), ...chipLines(c, chips, COLS.text.width)] },
      { ...COLS.part, lines: [...amountLines(c, line.partNetCents, COLS.part.width), ...partNote] },
      { ...COLS.labor, lines: [...amountLines(c, line.laborNetCents, COLS.labor.width), ...laborNote] },
      { ...COLS.net, lines: amountLines(c, line.netCents, COLS.net.width) },
    ], "row", group),
    keepTogether: true, panel: rowPanel,
  };
}

function feeRow(c: Ctx, fee: FeeData, info: Info): Block {
  const group = `fee:${fee.id}`;
  const kindWords = `${fee.kind === "official_fee" ? "official fee, no VAT" : "estimated"}${fee.confirmed ? "" : ", not confirmed"}`;
  const covers = fee.itemIds.flatMap((id) => { const it = info.itemById.get(id); return it ? [it.title] : []; });
  const dash = (col: { x: number; width: number; align?: "left" | "right" }): Column =>
    ({ ...col, lines: textLines(c, "–", sans("--nl-text-muted"), col.width) });
  const net: CellLine[] = fee.netCents === null
    ? [...unknownLines(c, COLS.net.width), ...textLines(c, "(not counted)", sans("--nl-text-muted"), COLS.net.width)]
    : fee.confirmed ? textLines(c, formatEuroCents(fee.netCents), mono("--nl-text"), COLS.net.width)
    : [...textLines(c, formatEuroCents(fee.netCents), mono("--nl-text-muted"), COLS.net.width), ...textLines(c, "(not counted)", sans("--nl-text-muted"), COLS.net.width)];
  return {
    lines: rowLines(c, [
      {
        ...COLS.text,
        lines: [
          ...textLines(c, fee.label, sans("--nl-text"), COLS.text.width),
          ...textLines(c, kindWords, sans("--nl-text-muted"), COLS.text.width),
          ...(covers.length > 0 ? textLines(c, `Covers: ${covers.join(", ")}`, sans("--nl-text-muted"), COLS.text.width) : []),
        ],
      },
      dash(COLS.part), dash(COLS.labor), { ...COLS.net, lines: net },
    ], "fee-row", group),
    keepTogether: true, panel: rowPanel,
  };
}

function tableRows(c: Ctx, input: EstimatePdfInput, info: Info): Block[] {
  const rows = info.lines.map((line) => itemRow(c, line, info.itemById.get(line.itemId)!, info.rowById.get(line.itemId)!));
  rows.push(...input.fees.map((fee) => feeRow(c, fee, info)));
  if (rows.length === 0) {
    rows.push({ lines: para(c, "No lines.", sans("--nl-text-muted"), M, CONTENT_W, "row"), keepTogether: true, panel: rowPanel });
  }
  return rows;
}

// ----------------------------------------------------------------------- totals

function totalsBlocks(c: Ctx, input: EstimatePdfInput, info: Info): Block[] {
  const q = input.quote;
  const width = 360;
  const x = M + CONTENT_W - width;
  const labelX = x + PANEL_PAD_X;
  const labelW = width - 2 * PANEL_PAD_X - 114;
  const amountW = 106;
  const amountX = x + width - PANEL_PAD_X - amountW;
  const row = (label: string, cents: number, strong = false): FlowLine[] => rowLines(c, [
    { x: labelX, width: labelW, lines: textLines(c, label, strong ? bold("--nl-text", 12) : sans("--nl-text-secondary"), labelW) },
    { x: amountX, width: amountW, align: "right", lines: textLines(c, formatEuroCents(cents), mono("--nl-text", strong ? 12 : BODY), amountW) },
  ], "totals");
  const lines = row("Known subtotal (net, only the costs known so far)", q.knownSubtotalNetCents);
  if (!info.draft) {
    lines.push(...row("Net total", q.netCents!));
    lines.push(...row(`VAT 19 %${q.officialFeeCents ? " (not on the official fee)" : ""}`, q.vatCents!));
    lines.push(...row("Gross total", q.grossCents!, true));
  }
  const blocks: Block[] = [{
    lines, gapBefore: 8, keepTogether: true,
    panel: { x, width, padY: 5, fill: "--nl-surface-2", stroke: null },
  }];
  if (info.draft) {
    blocks.push(notice(c, "warning", "warning", "Incomplete draft — costs missing",
      ["No net, VAT or gross total is shown, because an unknown cost is never counted as 0."]));
    if (q.exclusions.length > 0) {
      const t = TONES.warning;
      const w = CONTENT_W - 2 * PANEL_PAD_X;
      blocks.push({
        lines: [
          ...para(c, `Missing or unresolved (${q.exclusions.length})`, bold(t.color), M + PANEL_PAD_X, w, "exclusions"),
          ...bulletRows(c, q.exclusions, sans(t.color), M + PANEL_PAD_X, w, "exclusions"),
        ],
        gapBefore: 4, keepLines: 3,
        panel: { x: M, width: CONTENT_W, padY: 5, fill: t.fill, stroke: null },
      });
    }
  }
  return blocks;
}

// -------------------------------------------------------------------- paperwork

const LABEL_W = 110;

/** Two label/value pairs per line keep the five short fields compact. "unknown" gets an icon, never a plain word alone. */
function fieldPair(c: Ctx, a: [string, string], b: [string, string] | null, group: string): FlowLine[] {
  const labelStyle = sans("--nl-text-secondary");
  const label = (x: number, width: number, text: string): Column => ({ x, width, lines: textLines(c, text, labelStyle, width) });
  const value = (x: number, width: number, text: string): Column => {
    const unknown = text === "unknown";
    return {
      x, width,
      lines: textLines(c, text, sans(unknown ? "--nl-warning-soft-text" : "--nl-text"), width, unknown ? { icon: "unknown" } : {}),
    };
  };
  const cols = [label(M, LABEL_W, a[0]), value(M + LABEL_W, 140, a[1])];
  if (b) cols.push(label(M + 262, 100, b[0]), value(M + 362, CONTENT_W - 362, b[1]));
  return rowLines(c, cols, "paperwork", group);
}

function listRow(c: Ctx, label: string, entries: readonly string[], group: string): FlowLine[] {
  if (entries.length === 0) return [];
  const bullet = c.hasGlyph("sans", 0x2022) ? "•" : "-";
  const style = sans("--nl-text");
  return entries.flatMap((entry, i) => rowLines(c, [
    { x: M, width: LABEL_W, lines: i === 0 ? textLines(c, label, sans("--nl-text-secondary"), LABEL_W) : [] },
    { x: M + LABEL_W, width: 10, lines: [{ segs: [{ text: bullet, style }], indent: 0 }] },
    { x: M + LABEL_W + 10, width: CONTENT_W - LABEL_W - 10, lines: textLines(c, entry, style, CONTENT_W - LABEL_W - 10) },
  ], "paperwork", group));
}

/** Sources of one item: title and accessed date, then the full URL in Mono, cut by character where needed. */
function sourceRows(c: Ctx, fit: FitData, group: string): FlowLine[] {
  if (fit.sources.length === 0) {
    return rowLines(c, [
      { x: M, width: LABEL_W, lines: textLines(c, "Sources", sans("--nl-text-secondary"), LABEL_W) },
      { x: M + LABEL_W, width: CONTENT_W - LABEL_W, lines: textLines(c, "No sources. Without a source the result stays a pre-check to verify.", sans("--nl-text-muted"), CONTENT_W - LABEL_W) },
    ], "paperwork", group);
  }
  const indent = 12;
  const dateW = 120;
  const lines = para(c, "Sources", sans("--nl-text-secondary"), M, LABEL_W, "paperwork", group);
  for (const source of fit.sources) {
    lines.push(...rowLines(c, [
      { x: M + indent, width: CONTENT_W - indent - dateW - 8, lines: textLines(c, source.title, sans("--nl-text"), CONTENT_W - indent - dateW - 8) },
      { x: M + CONTENT_W - dateW, width: dateW, align: "right", lines: textLines(c, `accessed ${day(source.accessedAt)}`, sans("--nl-text-muted"), dateW) },
    ], "paperwork", group));
    if (source.supports.trim() !== "") {
      lines.push(...para(c, source.supports, sans("--nl-text-muted"), M + indent, CONTENT_W - indent, "paperwork", group));
    }
    lines.push(...para(c, source.url, mono("--nl-primary-ink"), M + indent, CONTENT_W - indent, "url", group));
  }
  return lines;
}

function itemPaperwork(c: Ctx, line: QuoteLine, item: BuildItemData, row: FitRow): FlowLine[] {
  const group = `paper:${item.id}`;
  const look = FIT_LOOK[row.status];
  const t = TONES[look.tone];
  const chips: Seg[] = [];
  if (row.mock) chips.push({ text: "Mock result", style: sans(TONES.warning.color), icon: "warning", chip: TONES.warning.fill });
  chips.push({ text: look.word, style: bold(t.color), icon: look.icon, chip: t.fill });
  // The check date sits in the header row, so a reader sees how old the result is before the details.
  if (item.fit) chips.push({ text: checkedOn(item), style: sans("--nl-text-muted") });
  const chipW = 220;
  const lines = rowLines(c, [
    { x: M, width: CONTENT_W - chipW - 8, lines: textLines(c, line.label, bold("--nl-text", 11), CONTENT_W - chipW - 8) },
    { x: M + CONTENT_W - chipW, width: chipW, align: "right", lines: chipLines(c, chips, chipW) },
  ], "paperwork", group);
  const fit = item.fit;
  if (!fit) {
    lines.push(...para(c, "No fit check on record. Approval, inspection and Eintragung are unknown.",
      sans("--nl-warning-soft-text"), M, CONTENT_W, "paperwork", group, { icon: "unknown" }));
    return lines;
  }
  lines.push(...fieldPair(c, ["Approval", APPROVAL[fit.approval]], ["Document coverage", COVERAGE[fit.documentCoverage]], group));
  lines.push(...fieldPair(c, ["Inspection", INSPECTION[fit.inspection]], ["Eintragung", EINTRAGUNG[fit.eintragung]], group));
  lines.push(...fieldPair(c, ["Documents to carry", CARRY[fit.carryDocuments]], null, group));
  lines.push(...listRow(c, "Reasons", fit.reasons, group));
  lines.push(...listRow(c, "Conditions", fit.conditions, group));
  lines.push(...listRow(c, "Things to measure", fit.toMeasure, group));
  lines.push(...listRow(c, "Extra parts", fit.extraParts, group));
  lines.push(...sourceRows(c, fit, group));
  return lines;
}

function paperworkBlocks(c: Ctx, info: Info): Block[] {
  const head = heading(c, "Paperwork summary");
  if (info.lines.length === 0) {
    return [{ lines: [...head, ...para(c, "No parts on the sheet.", sans("--nl-text-muted"), M, CONTENT_W, "paperwork")], gapBefore: 12, keepTogether: true }];
  }
  return info.lines.map((line, index) => {
    const body = itemPaperwork(c, line, info.itemById.get(line.itemId)!, info.rowById.get(line.itemId)!);
    return {
      lines: index === 0 ? [...head, ...body] : body,
      gapBefore: 10,
      // The heading, the item title and the first fields never sit alone at the bottom of a page.
      keepLines: (index === 0 ? head.length : 0) + 4,
    };
  });
}

// ---------------------------------------------------------------------- closing

function closingBlocks(c: Ctx, input: EstimatePdfInput, info: Info): Block[] {
  const labelStyle = sans("--nl-text-secondary");
  const valueW = CONTENT_W - LABEL_W;
  const note = (label: string, text: string): FlowLine[] => rowLines(c, [
    { x: M, width: LABEL_W, lines: textLines(c, label, labelStyle, LABEL_W) },
    { x: M + LABEL_W, width: valueW, lines: textLines(c, text, sans("--nl-text"), valueW) },
  ], "note");
  const review = input.inspectionReview;
  // A review belongs to one build. When the bike, parts or shop rules changed since, it no longer counts.
  const outOfDate = review !== null && (input.currentFitInputHash === null || review.fitInputHash !== input.currentFitInputHash);
  const rows: FlowLine[][] = [
    note("Inspection review", review
      ? `${DECISION[review.decision]} (reviewed ${day(review.reviewedAt)})${outOfDate ? " (out of date: the bike, parts or shop rules changed)" : ""}.${review.notes.trim() !== "" ? `\n${review.notes}` : ""}`
      : "No inspection review is on record."),
  ];
  if (input.settings.quoteNotes.trim() !== "") rows.push(note("Shop notes", input.settings.quoteNotes));
  rows.push(note("After image", info.mockImages
    ? "The after image is a mock placeholder made in mock mode, not an AI result."
    : "The after image is an AI visualization, not a photograph of a finished bike."));
  // The last note and the estimate disclaimer share a block, so the disclaimer never sits alone on a page.
  const spacer: FlowLine = { height: 6, boxes: [] };
  rows.push([
    ...note("Pre-check", FIT_PRECHECK_NOTE), spacer,
    ...para(c, "This is an estimate, not an invoice or road-use certificate.", bold("--nl-text"), M, CONTENT_W, "note"),
  ]);
  // One block per note; the heading travels with the first one, so it never sits alone at the bottom of a page.
  return rows.map((lines, i) => ({
    lines: i === 0 ? [...heading(c, "Notes"), ...lines] : lines, gapBefore: i === 0 ? 10 : 3, keepTogether: true,
  }));
}

// ----------------------------------------------------------------------- footer

type FooterPlan = { lines: string[]; height: number; pageNumberWidth: number };
const FOOT = sans("--nl-text-muted");

function planFooter(c: Ctx, input: EstimatePdfInput, info: Info): FooterPlan {
  const pageNumberWidth = c.width(FOOT, "Page 999 of 999");
  const leftW = CONTENT_W - pageNumberWidth - 12;
  const pieces = [
    c.clean("sans", input.settings.shopName),
    ...(input.settings.demoRates ? [EXAMPLE_LABEL] : []),
    ...(info.mock ? [MOCK_LABEL] : []),
  ].filter((p) => p.trim() !== "");
  const joined = pieces.join(" · ");
  // One line when it fits; otherwise every label on its own line, so a label is never split in two.
  const lines = c.width(FOOT, joined) <= leftW ? [joined] : pieces.flatMap((p) => c.wrap(FOOT, p, leftW).map((l) => l.text));
  return { lines, height: Math.max(1, lines.length) * lead(FOOT.size), pageNumberWidth };
}

function footerBoxes(c: Ctx, plan: FooterPlan, number: number, total: number, footerTop: number): LayoutBox[] {
  const boxes: LayoutBox[] = [{ kind: "rule", x: M, top: footerTop - 4, width: CONTENT_W, color: "--nl-hairline", role: "footer" }];
  const lineH = lead(FOOT.size);
  plan.lines.forEach((text, i) => {
    if (text !== "") boxes.push(c.textBox(text, FOOT, M, footerTop + i * lineH, lineH, "footer"));
  });
  const label = `Page ${number} of ${total}`;
  const w = c.width(FOOT, label);
  boxes.push(c.textBox(label, FOOT, M + CONTENT_W - w, footerTop, lineH, "footer"));
  return boxes;
}

// ------------------------------------------------------------------ the layout

/** Positions everything. Throws when the input mixes snapshots. Pure given the fonts. */
export function layoutEstimate(input: EstimatePdfInput, fonts: PdfFonts): EstimateLayout {
  validate(input);
  const c = new Ctx(fonts);
  const info = derive(input);
  const footer = planFooter(c, input, info);
  const footerTop = PDF_PAGE.height - M - footer.height;
  const contentBottom = footerTop - FOOTER_GAP;
  const flow = new Flow(contentBottom);
  const used = new Set<ImageSlot>();

  for (const block of headerBlocks(c, input, info, used)) flow.add(block);
  for (const block of imageBlocks(c, input, info, used)) flow.add(block);
  for (const block of noticeBlocks(c, input, info)) flow.add(block);

  const rows = tableRows(c, input, info);
  flow.startTable(tableHeader(c), rows[0]!);
  for (const row of rows) flow.add(row);
  flow.endTable();

  for (const block of totalsBlocks(c, input, info)) flow.add(block);
  for (const block of paperworkBlocks(c, info)) flow.add(block);
  for (const block of closingBlocks(c, input, info)) flow.add(block);
  if (c.replaced) {
    flow.add({
      lines: para(c, "A question mark stands for a character the PDF fonts cannot show, for example an emoji.", sans("--nl-text-muted"), M, CONTENT_W, "note"),
      gapBefore: 8, keepTogether: true,
    });
  }

  const total = flow.pages.length;
  const pages = flow.pages.map((boxes, i) => ({
    number: i + 1, total, boxes: [...boxes, ...footerBoxes(c, footer, i + 1, total, footerTop)], contentBottom, footerTop,
  }));
  const order: ImageSlot[] = ["before", "after", "logo"];
  return { pages, images: order.filter((slot) => used.has(slot)), draft: info.draft, replacedCharacters: c.replaced };
}

// --------------------------------------------------------------------- drawing
//
// pdf-lib's page.drawText() and friends add a new resource entry with a random name on every call. An estimate
// has thousands of calls, so the page resources would bloat and differ on every run. This code writes the same
// content operators itself and keeps one resource name per font, picture and opacity value.

const ICON_STROKE = 1.1;

/** The resource names of one page: fonts, pictures and opacity states are registered once and reused. */
class PageResources {
  private readonly fontNames = new Map<FontKey, PDFName>();
  private readonly stateNames = new Map<number, PDFName>();
  private readonly imageNames = new Map<ImageSlot, PDFName>();

  constructor(
    private readonly doc: PDFDocument, private readonly page: PDFPage, private readonly fonts: PdfFonts,
    private readonly images: Map<ImageSlot, PDFImage>,
    /** Opacity states are shared by all pages of the document. */
    private readonly states: Map<number, PDFRef>,
  ) {}

  font(key: FontKey): PDFName {
    let name = this.fontNames.get(key);
    if (!name) {
      name = PDFName.of(`F${this.fontNames.size + 1}`);
      this.page.node.setFontDictionary(name, this.fonts[key].ref);
      this.fontNames.set(key, name);
    }
    return name;
  }

  /** The graphics state for a color's alpha, or undefined when it is fully opaque. */
  opacity(alpha: number): PDFName | undefined {
    if (alpha >= 1) return undefined;
    let name = this.stateNames.get(alpha);
    if (!name) {
      let ref = this.states.get(alpha);
      if (!ref) {
        ref = this.doc.context.register(this.doc.context.obj({ Type: "ExtGState", ca: alpha, CA: alpha }));
        this.states.set(alpha, ref);
      }
      name = PDFName.of(`GS${this.stateNames.size + 1}`);
      this.page.node.setExtGState(name, ref);
      this.stateNames.set(alpha, name);
    }
    return name;
  }

  image(slot: ImageSlot): PDFName {
    let name = this.imageNames.get(slot);
    if (!name) {
      const image = this.images.get(slot);
      if (!image) throw new Error(`The ${slot} image was not embedded.`);
      name = PDFName.of(`Im${this.imageNames.size + 1}`);
      this.page.node.setXObject(name, image.ref);
      this.imageNames.set(slot, name);
    }
    return name;
  }
}

const flat = degrees(0);

function iconOperators(res: PageResources, box: LayoutIcon, theme: PdfTheme): PDFOperator[] {
  const c = theme[box.color];
  const color = rgb(c.r, c.g, c.b);
  const graphicsState = res.opacity(c.a);
  const px = (u: number) => box.x + u * box.size;
  const py = (v: number) => PDF_PAGE.height - (box.top + v * box.size);
  const ops: PDFOperator[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    ops.push(...drawLine({ start: { x: px(x1), y: py(y1) }, end: { x: px(x2), y: py(y2) }, thickness: ICON_STROKE, color, graphicsState }));
  };
  const path = (points: readonly (readonly [number, number])[]) => {
    for (let i = 1; i < points.length; i++) line(points[i - 1]![0], points[i - 1]![1], points[i]![0], points[i]![1]);
  };
  const circle = (u: number, v: number, r: number, filled: boolean, dashed = false) => {
    ops.push(...drawEllipse({
      x: px(u), y: py(v), xScale: r * box.size, yScale: r * box.size, graphicsState,
      color: filled ? color : undefined, borderColor: filled ? undefined : color, borderWidth: filled ? 0 : ICON_STROKE,
      borderDashArray: dashed ? [1.6, 1.4] : undefined,
    }));
  };
  switch (box.shape) {
    case "warning": // triangle with an exclamation mark
      path([[0.5, 0.08], [0.95, 0.92], [0.05, 0.92], [0.5, 0.08]]);
      line(0.5, 0.38, 0.5, 0.62);
      circle(0.5, 0.78, 0.06, true);
      break;
    case "check":
      path([[0.12, 0.55], [0.4, 0.82], [0.88, 0.22]]);
      break;
    case "cross":
      line(0.18, 0.18, 0.82, 0.82);
      line(0.82, 0.18, 0.18, 0.82);
      break;
    case "stale": // clock face
      circle(0.5, 0.5, 0.45, false);
      line(0.5, 0.5, 0.5, 0.24);
      line(0.5, 0.5, 0.72, 0.5);
      break;
    case "unchecked": // dashed circle
      circle(0.5, 0.5, 0.45, false, true);
      break;
    case "unknown": // circle with a question mark
      circle(0.5, 0.5, 0.45, false);
      path([[0.36, 0.38], [0.4, 0.28], [0.5, 0.24], [0.6, 0.28], [0.64, 0.38], [0.5, 0.52], [0.5, 0.6]]);
      circle(0.5, 0.76, 0.05, true);
      break;
  }
  return ops;
}

function boxOperators(res: PageResources, box: LayoutBox, fonts: PdfFonts, theme: PdfTheme): PDFOperator[] {
  const flip = (top: number, height: number) => PDF_PAGE.height - top - height;
  switch (box.kind) {
    case "text": {
      const c = theme[box.color];
      return drawText(fonts[box.font].encodeText(box.text), {
        color: rgb(c.r, c.g, c.b), font: res.font(box.font), size: box.size, rotate: flat, xSkew: flat, ySkew: flat,
        x: box.x, y: PDF_PAGE.height - (box.top + box.baseline), graphicsState: res.opacity(c.a),
      });
    }
    case "rect": {
      const fill = box.fill ? theme[box.fill] : null;
      const stroke = box.stroke ? theme[box.stroke] : null;
      return drawRectangle({
        x: box.x, y: flip(box.top, box.height), width: box.width, height: box.height, rotate: flat, xSkew: flat, ySkew: flat,
        color: fill ? rgb(fill.r, fill.g, fill.b) : undefined,
        borderColor: stroke ? rgb(stroke.r, stroke.g, stroke.b) : undefined,
        borderWidth: stroke ? RULE_THICKNESS : 0,
        graphicsState: res.opacity((fill ?? stroke)?.a ?? 1),
      });
    }
    case "rule": {
      const c = theme[box.color];
      const y = PDF_PAGE.height - box.top;
      return drawLine({
        start: { x: box.x, y }, end: { x: box.x + box.width, y }, thickness: RULE_THICKNESS,
        color: rgb(c.r, c.g, c.b), graphicsState: res.opacity(c.a),
      });
    }
    case "image":
      return drawImage(res.image(box.slot), {
        x: box.x, y: flip(box.top, box.height), width: box.width, height: box.height, rotate: flat, xSkew: flat, ySkew: flat,
      });
    case "icon":
      return iconOperators(res, box, theme);
  }
}

async function embedImages(doc: PDFDocument, input: EstimatePdfInput, slots: readonly ImageSlot[]): Promise<Map<ImageSlot, PDFImage>> {
  const map = new Map<ImageSlot, PDFImage>();
  for (const slot of slots) {
    const image = input[slot]!;
    const embedded = image.kind === "jpeg" ? await doc.embedJpg(image.bytes) : await doc.embedPng(image.bytes);
    // A wrong stated size would stretch the picture, so it is refused.
    if (embedded.width !== image.width || embedded.height !== image.height) {
      throw new Error(`The ${slot} image is ${embedded.width} x ${embedded.height}, not ${image.width} x ${image.height} as stated.`);
    }
    map.set(slot, embedded);
  }
  return map;
}

/** Info-dictionary text: NFC, no control characters. */
const infoText = (text: string) => text.normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");

/**
 * The whole PDF. The theme lookup returns the CSS value of each token in PDF_TOKENS. No network is used; the
 * fonts and pictures come in as bytes.
 */
export async function buildEstimatePdf(input: EstimatePdfInput, fontBytes: PdfFontBytes, theme: TokenLookup): Promise<Uint8Array> {
  const colors = resolveTheme(theme);
  const doc = await PDFDocument.create({ updateMetadata: false });
  const fonts = await embedFonts(doc, fontBytes);
  const layout = layoutEstimate(input, fonts);
  const images = await embedImages(doc, input, layout.images);
  const states = new Map<number, PDFRef>();
  for (const pageLayout of layout.pages) {
    const page = doc.addPage([PDF_PAGE.width, PDF_PAGE.height]);
    const res = new PageResources(doc, page, fonts, images, states);
    for (const box of pageLayout.boxes) page.pushOperators(...boxOperators(res, box, fonts, colors));
  }
  doc.setTitle(infoText(`${layout.draft ? "Incomplete draft" : "Estimate"} - ${input.projectName}`));
  doc.setAuthor(infoText(input.settings.shopName));
  doc.setSubject(`Estimate (settings: ${input.settingsId})`);
  doc.setProducer("DreamBike");
  doc.setCreator("DreamBike");
  doc.setLanguage("en-US");
  doc.setCreationDate(input.createdAt);
  doc.setModificationDate(input.createdAt);
  return doc.save();
}
