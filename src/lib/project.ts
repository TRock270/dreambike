// Pure version-tree logic (SPEC 9). No IndexedDB here: the storage layer calls
// these functions to build the records it then writes in one transaction.
// The caller generates every ID before the transaction so a retry reuses them.
import type {
  BikeRevision, BuildItemData, CompositeReason, EditModeId, FeeData, ImageRef, InstructionData, Part,
  MaskMeta, ProductData, Project, SlotId, Version,
} from "./types";
import { BuildItem, Cents, Product, ProjectSnapshot } from "./contracts";
import { slotInfo } from "./slots";

/** Same values as the contracts EditMode enum (one source of truth). */
export type EditMode = EditModeId;

/** "Bike photo 2026-10-28 14:05" in the visitor's local time. */
export function defaultProjectName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `Bike photo ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ` +
    `${p(now.getHours())}:${p(now.getMinutes())}`;
}

export function newRootVersion(input: {
  id: string; projectId: string; image: ImageRef; createdAt: number;
}): Version {
  return {
    id: input.id, projectId: input.projectId, parentId: null, kind: "root", image: input.image,
    cutoutImageId: null, bikeMaskId: null, parts: [], items: [], fees: [],
    inspectionReview: null, change: null, composed: false, aligned: false, drift: null,
    fallbackReason: null, createdAt: input.createdAt,
  };
}

export function newProject(input: {
  id: string; rootVersionId: string; bikeRevision: BikeRevision; now: Date;
}): Project {
  const t = input.now.getTime();
  return {
    id: input.id, name: defaultProjectName(input.now), rootVersionId: input.rootVersionId,
    headVersionId: input.rootVersionId, bikeRevision: input.bikeRevision,
    settingsId: "default", createdAt: t, updatedAt: t,
  };
}

export type VisualChildInput = {
  versionId: string;
  itemId: string;
  createdAt: number;
  slot: SlotId;
  mode: EditMode;
  instruction: InstructionData;
  /** The accepted picture (the composite result or the full generated image). */
  image: ImageRef;
  composite: { composed: boolean; aligned: boolean; drift: number | null; reason: CompositeReason };
  /** Fresh mask of the edited part under the new image hash; null if none was cut. */
  refreshedPart: Part | null;
};

/** The item a new visual version adds; everything the mechanic must still enter is null/unknown. */
export function newBuildItem(input: VisualChildInput): BuildItemData {
  return {
    id: input.itemId, slot: input.slot, title: input.instruction.title,
    spec: input.instruction.spec, intent: input.instruction.intent, product: null,
    costKind: "part", partPriceCents: null, taxBasis: "unknown", laborMinutes: null,
    fit: null, fitInputHash: null, fitCheckedAt: null, zeroLaborConfirmed: false,
    mechanicNotes: "", fitReviewedHash: null, originVersionId: input.versionId,
  };
}

/**
 * Part masks of a child version (SPEC 9 invalidation table).
 * Composited edit on a same-size image: the refreshed target part is fresh, every other
 * parent part is kept with stale:true and its old maskId (refreshed again on click).
 * Full-image fallback or size change: all masks belong to a different raster, so none.
 */
function childParts(parent: Version, input: VisualChildInput): Part[] {
  const sameSize = parent.image.width === input.image.width && parent.image.height === input.image.height;
  if (!input.composite.composed || !sameSize) return [];
  const refreshed = input.refreshedPart;
  if (refreshed && refreshed.slot !== input.slot) {
    throw new Error(`The refreshed part is for slot ${refreshed.slot}, but the edit is for slot ${input.slot}.`);
  }
  const inherited = parent.parts
    .filter((p) => !(refreshed && p.slot === input.slot))
    .map((p) => ({ ...p, stale: true }));
  return refreshed ? [{ ...refreshed, stale: false }, ...inherited] : inherited;
}

/**
 * New visual version under `parent`. If parent is not the head this is a branch: a
 * sibling of whatever children parent already has. The parent is never modified.
 */
export function visualChild(parent: Version, input: VisualChildInput): Version {
  // Adding or replacing a part is a physical change: every other item's fit is stale (SPEC 9).
  const kept = parent.items.filter((i) => i.slot !== input.slot).map(clearFit);
  const removedIds = new Set(parent.items.filter((i) => i.slot === input.slot).map((i) => i.id));
  const composed = input.composite.composed;
  return {
    id: input.versionId, projectId: parent.projectId, parentId: parent.id, kind: "visual",
    image: input.image,
    // The parent outline and cutout belong to the old image hash: a new cutout is needed.
    cutoutImageId: null, bikeMaskId: null,
    parts: childParts(parent, input),
    items: [...kept, newBuildItem(input)],
    // A replaced item can no longer be charged for an inspection.
    fees: parent.fees.map((f) => ({ ...f, itemIds: f.itemIds.filter((id) => !removedIds.has(id)) })),
    inspectionReview: parent.inspectionReview,
    change: {
      slot: input.slot, itemId: input.itemId,
      // The short title for the history strip; the long editPrompt stays out of the version record.
      instruction: input.instruction.title, mode: input.mode,
    },
    composed, aligned: input.composite.aligned, drift: input.composite.drift,
    fallbackReason: composed ? null : input.composite.reason, createdAt: input.createdAt,
  };
}

// ------------------------------------------------------------- sheet versions

/** The item with every fit field cleared; the fit must be checked again. */
function clearFit(item: BuildItemData): BuildItemData {
  return { ...item, fit: null, fitInputHash: null, fitCheckedAt: null, fitReviewedHash: null };
}

/**
 * A sheet-only version: same picture, parts and review as the parent, new items/fees.
 * inspectionReview is tied to fitInputHash, so it goes stale by itself after a physical change.
 */
export function sheetChild(
  parent: Version,
  input: { versionId: string; createdAt: number; items: BuildItemData[]; fees: FeeData[] },
): Version {
  return {
    id: input.versionId, projectId: parent.projectId, parentId: parent.id, kind: "sheet",
    image: { ...parent.image }, cutoutImageId: parent.cutoutImageId, bikeMaskId: parent.bikeMaskId,
    parts: parent.parts.map((p) => ({ ...p })),
    items: input.items, fees: input.fees,
    inspectionReview: parent.inspectionReview ? { ...parent.inspectionReview } : null,
    change: null, composed: parent.composed, aligned: parent.aligned, drift: parent.drift,
    fallbackReason: parent.fallbackReason, createdAt: input.createdAt,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Short history text such as "Tank: price, Rear wheel removed"; at most 80 characters. */
export function sheetChangeLabel(parent: Version, child: Version): string {
  const parts: string[] = [];
  const old = new Map(parent.items.map((i) => [i.id, i]));
  const now = new Set(child.items.map((i) => i.id));
  for (const it of child.items) {
    const label = slotInfo(it.slot).label;
    const prev = old.get(it.id);
    if (!prev) { parts.push(`${label}: added`); continue; }
    if (prev.title !== it.title) parts.push(`${label}: title`);
    if (!same(prev.spec, it.spec)) parts.push(`${label}: details`);
    if (prev.costKind !== it.costKind) parts.push(`${label}: cost type`);
    if (!same(prev.product, it.product)) parts.push(`${label}: product`);
    if (prev.partPriceCents !== it.partPriceCents || prev.taxBasis !== it.taxBasis) parts.push(`${label}: price`);
    if (prev.laborMinutes !== it.laborMinutes || prev.zeroLaborConfirmed !== it.zeroLaborConfirmed) {
      parts.push(`${label}: labor`);
    }
    if (prev.mechanicNotes !== it.mechanicNotes) parts.push(`${label}: notes`);
  }
  for (const it of parent.items) if (!now.has(it.id)) parts.push(`${slotInfo(it.slot).label} removed`);
  if (!same(parent.fees, child.fees)) parts.push("Fees");
  if (parts.length === 0) return "No change";
  const text = parts.join(", ");
  const chars = Array.from(text);
  return chars.length <= 80 ? text : chars.slice(0, 79).join("") + "\u2026";
}

export type ItemPatch = Partial<Pick<BuildItemData,
  "title" | "spec" | "product" | "costKind" | "partPriceCents" | "taxBasis" | "laborMinutes" |
  "zeroLaborConfirmed" | "mechanicNotes">>;
export type EditResult =
  | { ok: true; items: BuildItemData[]; fitsCleared: boolean }
  | { ok: false; message: string };

/** Product fields that change what the part physically is (the fit depends on them). */
function sameProductIdentity(a: ProductData | null, b: ProductData | null): boolean {
  if (a === null || b === null) return a === b;
  return a.name === b.name && a.brand === b.brand && a.partNumber === b.partNumber && a.url === b.url &&
    a.approval === b.approval && a.approvalText === b.approvalText;
}

function clearAllFits(items: BuildItemData[]): { items: BuildItemData[]; fitsCleared: boolean } {
  return { items: items.map(clearFit), fitsCleared: items.some((i) => i.fit !== null) };
}

/** Apply a mechanic's edit to one item. Never throws for user input. */
export function editItem(items: readonly BuildItemData[], itemId: string, patch: ItemPatch): EditResult {
  const old = items.find((i) => i.id === itemId);
  if (!old) return { ok: false, message: "That build item no longer exists." };
  const next: BuildItemData = { ...old };
  // Only defined keys apply (null is a real value for price and product).
  for (const k of Object.keys(patch) as (keyof ItemPatch)[]) {
    if (patch[k] !== undefined) (next as Record<string, unknown>)[k] = patch[k];
  }
  // Same name/brand/number/link: it is still the same product, keep its id.
  if (next.product && old.product && patch.product &&
      next.product.name === old.product.name && next.product.brand === old.product.brand &&
      next.product.partNumber === old.product.partNumber && next.product.url === old.product.url) {
    next.product = { ...next.product, id: old.product.id };
  }
  if (next.costKind === "labor_only") {
    if (patch.partPriceCents !== undefined && patch.partPriceCents !== 0) {
      return { ok: false, message: "Labor only means no part cost. Switch to Part to enter a price." };
    }
    if (patch.product) return { ok: false, message: "Labor only has no product. Switch to Part to add one." };
    next.partPriceCents = 0; next.product = null; next.taxBasis = "net";
  } else if (old.costKind === "labor_only") {
    // Back to a part: never invent a price.
    next.partPriceCents = patch.partPriceCents ?? null;
    next.taxBasis = patch.taxBasis ?? "unknown";
  }
  if (next.costKind === "part" && patch.partPriceCents === 0) {
    return { ok: false, message: "Use Labor only for no part cost." };
  }
  if (next.laborMinutes === 0 && !(next.zeroLaborConfirmed && next.mechanicNotes.trim() !== "")) {
    return { ok: false, message: "Zero labor needs the confirmation box and a note saying why." };
  }
  const parsed = BuildItem.safeParse(next);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: `Invalid ${issue?.path.join(".") || "item"}: ${issue?.message ?? "not allowed"}.` };
  }
  const physical = old.title !== next.title || !same(old.spec, next.spec) || old.costKind !== next.costKind ||
    !sameProductIdentity(old.product, next.product);
  const list = items.map((i) => (i.id === itemId ? parsed.data : i));
  if (!physical) return { ok: true, items: list, fitsCleared: false };
  return { ok: true, ...clearAllFits(list) };
}

export type RemoveResult =
  | { ok: true; items: BuildItemData[]; fees: FeeData[]; fitsCleared: boolean }
  | { ok: false; message: string };

/** Explicit removal: drops the item from every fee and clears all fits. */
export function removeItem(items: readonly BuildItemData[], fees: readonly FeeData[], itemId: string): RemoveResult {
  if (!items.some((i) => i.id === itemId)) return { ok: false, message: "That build item no longer exists." };
  const cleared = clearAllFits(items.filter((i) => i.id !== itemId));
  return {
    ok: true, ...cleared,
    fees: fees.map((f) => ({ ...f, itemIds: f.itemIds.filter((id) => id !== itemId) })),
  };
}

export type ManualProductInput = {
  name: string; brand?: string | null; partNumber?: string | null; url: string;
  priceText?: string | null; approval?: ProductData["approval"]; approvalText?: string | null;
};

/** A product typed in by the mechanic. The price that counts stays on the item. */
export function manualProduct(
  input: ManualProductInput, ctx: { id: string; now: Date },
): { ok: true; product: ProductData } | { ok: false; message: string } {
  const orNull = (t: string | null | undefined) => (t && t.trim() !== "" ? t.trim() : null);
  const name = input.name.trim();
  if (name === "") return { ok: false, message: "A product needs a name." };
  const url = input.url.trim();
  if (!/^https:\/\//i.test(url)) return { ok: false, message: "A product needs an https link." };
  const parsed = Product.safeParse({
    id: ctx.id, name, brand: orNull(input.brand), partNumber: orNull(input.partNumber), url,
    imageUrl: null, priceText: orNull(input.priceText), priceEurCents: null, taxBasis: "unknown",
    approval: input.approval ?? "unknown", approvalText: orNull(input.approvalText),
    fulfillmentRegion: "unknown",
    source: { url, title: name, accessedAt: ctx.now.toISOString(), supports: "Entered by the mechanic" },
    linkState: "unchecked",
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: `Invalid ${issue?.path.join(".") || "product"}: ${issue?.message ?? "not allowed"}.` };
  }
  return { ok: true, product: parsed.data };
}

// ------------------------------------------------------------ money text

/** Parse typed euros to integer cents. No rounding: anything unclear is refused. */
export function parseEuroInput(text: string): { ok: true; cents: number } | { ok: false; message: string } {
  const bad = (message: string) => ({ ok: false as const, message });
  let t = text.trim();
  for (let i = 0; i < 2; i++) t = t.replace(/^(€|EUR)\s*/i, "").replace(/\s*(€|EUR)$/i, "").trim();
  if (t === "") return bad("Enter an amount.");
  if (t.startsWith("-")) return bad("The amount cannot be negative.");
  if (!/^[\d.,]+$/.test(t)) return bad("Use digits only, for example 1.234,56.");
  let whole: string; let frac = "";
  if (t.includes(",")) {
    const m = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d*)$/.exec(t);
    if (!m) return bad("Write 1234 or 1.234,00");
    whole = m[1]!.replace(/\./g, ""); frac = m[2]!;
    if (frac === "") return bad("Add the cents after the comma, or leave the comma out.");
  } else if (/^\d+$/.test(t)) {
    whole = t;
  } else {
    const m = /^(\d+)\.(\d+)$/.exec(t);
    if (!m) return bad("Write 1234 or 1.234,00");
    if (m[2]!.length === 3) return bad("Write 1234 or 1.234,00");
    whole = m[1]!; frac = m[2]!;
  }
  if (frac.length > 2) return bad("Use at most 2 decimals; cents are not rounded.");
  if (whole.replace(/^0+(?=\d)/, "").length > 9) return bad("That amount is too large.");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Cents.safeParse(cents).success) return bad("That amount is too large.");
  return { ok: true, cents };
}

const euro = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
export function formatEuroCents(cents: number): string {
  return euro.format(cents / 100);
}

/** What the sheet and history.md show for the part price. Unknown is never shown as 0. */
export function priceDisplay(item: BuildItemData): string {
  if (item.costKind === "labor_only") return "Labor only, no part cost";
  if (item.partPriceCents === null) return "Price unknown";
  const basis = item.taxBasis === "gross" ? " gross" : item.taxBasis === "net" ? " net" : " (tax basis unknown)";
  return formatEuroCents(item.partPriceCents) + basis;
}

export function laborDisplay(item: BuildItemData): string {
  return item.laborMinutes === null ? "Labor unknown" : `${item.laborMinutes} min`;
}

// ------------------------------------------------------------------- queries

/** The sheet for a version: at most one item per slot. */
export function activeItems(version: Version): BuildItemData[] {
  const seen = new Set<string>();
  for (const item of version.items) {
    if (seen.has(item.slot)) throw new Error(`Version ${version.id} has two items for slot ${item.slot}.`);
    seen.add(item.slot);
  }
  return version.items;
}

function byId(versions: readonly Version[]): Map<string, Version> {
  return new Map(versions.map((v) => [v.id, v]));
}

/** [head, parent, ..., root]. Throws on a missing ancestor or a cycle. */
export function pathToRoot(versions: readonly Version[], headId: string): Version[] {
  const map = byId(versions);
  const path: Version[] = [];
  const seen = new Set<string>();
  let cur: string | null = headId;
  while (cur !== null) {
    if (seen.has(cur)) throw new Error("Version tree has a cycle.");
    seen.add(cur);
    const v = map.get(cur);
    if (!v) throw new Error(`Version ${cur} is missing from the project.`);
    path.push(v);
    cur = v.parentId;
  }
  return path;
}

/** [root, ..., head], the order the VersionStrip shows. */
export function pathFromRoot(versions: readonly Version[], headId: string): Version[] {
  return pathToRoot(versions, headId).reverse();
}

/** Existing children, oldest first (ID breaks ties) so branch lists are stable. */
export function children(versions: readonly Version[], id: string): Version[] {
  return versions.filter((v) => v.parentId === id)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** Newest createdAt anywhere in the subtree under (and including) v. The visited set stops cycles. */
function newestInSubtree(versions: readonly Version[], v: Version): number {
  let newest = v.createdAt;
  const seen = new Set<string>([v.id]);
  const stack = [v.id];
  while (stack.length > 0) {
    for (const c of children(versions, stack.pop()!)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      newest = Math.max(newest, c.createdAt);
      stack.push(c.id);
    }
  }
  return newest;
}

/**
 * The steps after the head that the History strip keeps showing, so going back does not hide them.
 * At a fork we follow the child whose subtree holds the most recently created version, not simply
 * the newest direct child: with A->B, A->D (newer) and later B->C, the work the mechanic just did
 * (B, C) stays visible after undo to A. Ties go to the later createdAt, then the later id.
 * otherBranches[i] is how many other children the node before steps[i] had.
 */
export function laterSteps(versions: readonly Version[], headId: string): { steps: Version[]; otherBranches: number[] } {
  const steps: Version[] = [];
  const otherBranches: number[] = [];
  const visited = new Set<string>([headId]);
  let cur = headId;
  for (;;) {
    const kids = children(versions, cur);
    if (kids.length === 0) break;
    let best = kids[0]!;
    let bestNewest = newestInSubtree(versions, best);
    for (const k of kids.slice(1)) {
      const n = newestInSubtree(versions, k);
      // kids are sorted oldest first, so on a full tie the later one wins.
      if (n >= bestNewest) { best = k; bestNewest = n; }
    }
    if (visited.has(best.id)) break; // corrupt tree: never loop
    visited.add(best.id);
    steps.push(best);
    otherBranches.push(kids.length - 1);
    cur = best.id;
  }
  return { steps, otherBranches };
}

/** Undo selects the parent; null at the root. Never creates a node. */
export function undoTarget(version: Version): string | null {
  return version.parentId;
}

/** Redo candidates: every existing child. More than one means the UI asks which branch. */
export function redoTargets(versions: readonly Version[], id: string): Version[] {
  return children(versions, id);
}

export type PendingRef = { projectId: string; expectedHeadId: string };
export type AcceptCheck = { ok: true } | { ok: false; reason: "wrong_project" | "stale_head" };

/** A pending preview may only be accepted on the project and head it was rendered for. */
export function canAcceptPending(project: Project, pending: PendingRef): AcceptCheck {
  if (pending.projectId !== project.id) return { ok: false, reason: "wrong_project" };
  if (pending.expectedHeadId !== project.headVersionId) return { ok: false, reason: "stale_head" };
  return { ok: true };
}

// -------------------------------------------------------------- folder export
// Pure plan for "Save project to folder". The caller writes the files; nothing here
// touches IndexedDB, the DOM or the clock (exportedAt is passed in).

export type ExportPlan = {
  folderName: string;
  files: { name: string; versionId: string; imageId: string }[];
  historyJson: string;
  historyMarkdown: string;
};

/** Free text on one line, so a newline in a name or instruction cannot fake a heading in history.md. */
const oneLine = (text: string) => text.replace(/[\r\n]+/g, " ");

/** Filesystem-safe folder name plus the first 8 id characters so same-name projects differ. */
function exportFolderName(name: string, projectId: string): string {
  let safe = name
    .replace(/[\/\\:*?"<>|\u0000-\u001F\u007F]/g, "-")
    .replace(/\s+/g, " ");
  const trim = (t: string) => t.replace(/^[. ]+|[. ]+$/g, "");
  // Array.from counts characters, not UTF-16 units, so an emoji is never cut in half.
  safe = trim(Array.from(trim(safe)).slice(0, 80).join(""));
  if (safe === "") safe = "Project";
  return `${safe} (${projectId.slice(0, 8)})`;
}

/** Fixed-width index: two digits, three once there are more than 100 versions. */
function padIndex(i: number, total: number): string {
  return String(i).padStart(total > 100 ? 3 : 2, "0");
}

export function exportPlan(input: {
  project: { id: string; name: string };
  versions: readonly Version[];
  headId: string;
  exportedAt: string;
}): ExportPlan {
  const { project, versions, headId, exportedAt } = input;
  const onPath = new Set(pathToRoot(versions, headId).map((v) => v.id));
  const ordered = [...versions].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const files: ExportPlan["files"] = [];
  const fileByImage = new Map<string, string>(); // a sheet version shares its image's file
  const byVersionId = byId(versions);
  const entries: Record<string, unknown>[] = [];
  const md: string[] = [`# ${oneLine(project.name)}`, "", `Exported ${exportedAt}`, ""];

  ordered.forEach((v, i) => {
    const nn = padIndex(i, ordered.length);
    const depth = pathToRoot(versions, v.id).length - 1; // errors on cycle or missing ancestor
    const step = v.parentId === null ? "Start" : `Step ${depth}`;
    const exported = v.image.rights === "owner" || v.image.rights === "visitor";
    const label = v.parentId === null ? "start" : v.change ? v.change.slot : "step";
    let file: string | null = null;
    if (exported) {
      file = fileByImage.get(v.image.id) ?? `${nn}-${label}-${v.id.slice(0, 8)}.webp`;
      if (!fileByImage.has(v.image.id)) {
        fileByImage.set(v.image.id, file);
        files.push({ name: file, versionId: v.id, imageId: v.image.id });
      }
    }
    const sheet = activeItems(v).map((it) => ({ slot: it.slot, title: it.title }));

    entries.push({
      id: v.id, parentId: v.parentId, step, onHeadPath: onPath.has(v.id), isHead: v.id === headId,
      createdAt: new Date(v.createdAt).toISOString(), kind: v.kind,
      slot: v.change?.slot ?? null, instruction: v.change?.instruction ?? null, mode: v.change?.mode ?? null,
      composed: v.composed, fallbackReason: v.fallbackReason, file, sheet,
    });

    let heading = `## ${nn} ${step}`;
    if (v.change) heading += ` \u2014 ${slotInfo(v.change.slot).label}`;
    const sheetParent = v.parentId === null ? undefined : byVersionId.get(v.parentId);
    if (v.kind === "sheet") {
      heading += ` \u2014 Sheet change: ${sheetParent ? sheetChangeLabel(sheetParent, v) : "unknown"}`;
    }
    if (v.id === headId) heading += " (shown now)";
    if (!onPath.has(v.id)) heading += " (other branch)";
    md.push(heading, "");
    if (v.change) {
      md.push(`Instruction: ${oneLine(v.change.instruction)}`, `Mode: ${v.change.mode}`);
      if (v.kind === "visual" && !v.composed) {
        md.push(`Full image, not blended${v.fallbackReason ? ` (${v.fallbackReason})` : ""}`);
      }
    }
    md.push(file ? `File: ${file}` : "File: image not exported (external image)");
    if (sheet.length > 0) {
      md.push("Build sheet:", ...activeItems(v).map((it) =>
        `- ${slotInfo(it.slot).label}: ${oneLine(it.title)} (${priceDisplay(it)}; ${laborDisplay(it)})`));
    }
    md.push("");
  });

  const historyJson = JSON.stringify(
    { project: { id: project.id, name: project.name }, exportedAt, headId, versions: entries }, null, 2);
  return { folderName: exportFolderName(project.name, project.id), files, historyJson, historyMarkdown: md.join("\n") };
}

// ------------------------------------------------------------ project snapshot
// project.json for "Open project from folder" (OF1). Pure: the caller reads the stored records
// (db.snapshotSources) and writes the files. Incomplete when anything it points to cannot be
// written, so a folder never claims to be restorable when it is not.

export type SnapshotResult =
  | {
    complete: true;
    json: string;
    /** Every image the snapshot lists (version images and cutouts): file name in the folder + image id. */
    imageFiles: { name: string; imageId: string }[];
    /** One file per mask, written to masks/<name>. */
    maskFiles: { name: string; maskId: string }[];
  }
  | { complete: false; reason: string };

/**
 * `plan.files` names the version images (same names as the saved pictures). Cutouts get
 * "cutout-<id>.webp". `cutouts` are the stored cutout image refs and `masks` the stored mask
 * metadata, both read from the database, not from React state.
 */
export function projectSnapshot(input: {
  project: Project;
  versions: readonly Version[];
  cutouts: readonly ImageRef[];
  masks: readonly MaskMeta[];
  plan: Pick<ExportPlan, "files">;
}): SnapshotResult {
  const { project, versions } = input;
  const nameByImage = new Map(input.plan.files.map((f) => [f.imageId, f.name]));
  const cutoutById = new Map(input.cutouts.map((c) => [c.id, c]));
  const maskById = new Map(input.masks.map((m) => [m.id, m]));
  const images = new Map<string, ImageRef & { file: string }>();
  const masks = new Map<string, MaskMeta & { file: string }>();
  const fail = (reason: string): SnapshotResult => ({ complete: false, reason });
  const writable = (r: ImageRef) => r.rights === "owner" || r.rights === "visitor";

  for (const v of versions) {
    if (!writable(v.image)) return fail("An image from the web is not saved to the folder, so the project cannot be restored from it.");
    const file = nameByImage.get(v.image.id);
    if (!file) return fail(`The picture of version ${v.id} has no file in the export.`);
    images.set(v.image.id, { ...v.image, file });
    if (v.cutoutImageId) {
      const cut = cutoutById.get(v.cutoutImageId);
      if (!cut) return fail(`The cutout image ${v.cutoutImageId} is not stored.`);
      if (!writable(cut)) return fail("A cutout from the web is not saved to the folder, so the project cannot be restored from it.");
      images.set(cut.id, { ...cut, file: `cutout-${cut.id}.webp` });
    }
    const maskIds = [...v.parts.map((p) => p.maskId), ...(v.bikeMaskId ? [v.bikeMaskId] : [])];
    for (const id of maskIds) {
      const m = maskById.get(id);
      if (!m) return fail(`Mask ${id} is not stored.`);
      masks.set(id, { ...m, file: `${id}.bin` });
    }
  }
  const parsed = ProjectSnapshot.safeParse({
    formatVersion: 1, project, versions: [...versions], images: [...images.values()], masks: [...masks.values()],
  });
  if (!parsed.success) return fail(`The project is too large or invalid for a snapshot: ${parsed.error.issues[0]?.message ?? "invalid"}.`);
  return {
    complete: true,
    json: JSON.stringify(parsed.data, null, 2),
    imageFiles: [...images.values()].map((i) => ({ name: i.file, imageId: i.id })),
    maskFiles: [...masks.values()].map((m) => ({ name: m.file, maskId: m.id })),
  };
}
