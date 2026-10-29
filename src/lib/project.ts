// Pure version-tree logic (SPEC 9). No IndexedDB here: the storage layer calls
// these functions to build the records it then writes in one transaction.
// The caller generates every ID before the transaction so a retry reuses them.
import type {
  BikeRevision, BuildItemData, CompositeReason, EditModeId, ImageRef, InstructionData, Part, Project,
  SlotId, Version,
} from "./types";
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
  const kept = parent.items.filter((i) => i.slot !== input.slot);
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
  const entries: Record<string, unknown>[] = [];
  const md: string[] = [`# ${oneLine(project.name)}`, "", `Exported ${exportedAt}`, ""];

  ordered.forEach((v, i) => {
    const nn = padIndex(i, ordered.length);
    const depth = pathToRoot(versions, v.id).length - 1; // errors on cycle or missing ancestor
    const step = v.parentId === null ? "Start" : `Step ${depth}`;
    const exported = v.image.rights === "owner" || v.image.rights === "visitor";
    const label = v.parentId === null ? "start" : v.change ? v.change.slot : "step";
    const file = exported ? `${nn}-${label}-${v.id.slice(0, 8)}.webp` : null;
    if (file) files.push({ name: file, versionId: v.id, imageId: v.image.id });
    const sheet = activeItems(v).map((it) => ({ slot: it.slot, title: it.title }));

    entries.push({
      id: v.id, parentId: v.parentId, step, onHeadPath: onPath.has(v.id), isHead: v.id === headId,
      createdAt: new Date(v.createdAt).toISOString(), kind: v.kind,
      slot: v.change?.slot ?? null, instruction: v.change?.instruction ?? null, mode: v.change?.mode ?? null,
      composed: v.composed, fallbackReason: v.fallbackReason, file, sheet,
    });

    let heading = `## ${nn} ${step}`;
    if (v.change) heading += ` \u2014 ${slotInfo(v.change.slot).label}`;
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
    if (sheet.length > 0) md.push("Build sheet:", ...sheet.map((s) => `- ${slotInfo(s.slot).label}: ${oneLine(s.title)}`));
    md.push("");
  });

  const historyJson = JSON.stringify(
    { project: { id: project.id, name: project.name }, exportedAt, headId, versions: entries }, null, 2);
  return { folderName: exportFolderName(project.name, project.id), files, historyJson, historyMarkdown: md.join("\n") };
}
