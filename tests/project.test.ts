// Version tree logic and persisted validators, on hand-built trees.
import { describe, expect, it } from "vitest";
import {
  BikeRevision, ImageRef, Project as ProjectSchema, StoredImage, StoredMask, Version as VersionSchema,
} from "@/lib/contracts";
import {
  activeItems, canAcceptPending, children, defaultProjectName, laterSteps, newProject, newRootVersion,
  exportPlan, pathFromRoot, redoTargets, undoTarget, visualChild, type VisualChildInput,
} from "@/lib/project";
import type { Part, Version } from "@/lib/types";

const id = () => crypto.randomUUID();
const hash = (c: string) => c.repeat(64);
const PID = id();
const img = (c: string, w = 100, h = 50): Version["image"] =>
  ({ id: id(), hash: hash(c), width: w, height: h, bytes: 10, rights: "owner" });
const part = (slot: Part["slot"], maskId = id()): Part => ({
  id: `p:${slot}`, slot, label: slot, box: [0, 0, 10, 10], maskId, area: 50,
  source: "concept", confidence: 0.9, stale: false,
});
const instruction = (title: string) => ({
  title, editPrompt: `prompt ${title}`, spec: [{ key: "finish", value: "matte" }],
  intent: "paint" as const, warnings: [],
});
function input(over: Partial<VisualChildInput> & { slot: Part["slot"]; title?: string }): VisualChildInput {
  return {
    versionId: id(), itemId: id(), createdAt: 1, mode: "text", instruction: instruction(over.title ?? "t"),
    image: img("b"), composite: { composed: true, aligned: true, drift: 0.01, reason: "composited" },
    refreshedPart: null, ...over,
  };
}
const root = newRootVersion({ id: id(), projectId: PID, image: img("a"), createdAt: 0 });
const rootWithParts: Version = { ...root, parts: [part("tank"), part("exhaust"), part("seat")] };

describe("visualChild", () => {
  it("same slot twice: one active item, two change records, old item kept in the ancestor", () => {
    const v1 = visualChild(rootWithParts, input({ slot: "tank", title: "Red tank" }));
    const v2 = visualChild(v1, input({ slot: "tank", title: "Blue tank", createdAt: 2 }));
    expect(activeItems(v2).map((i) => i.title)).toEqual(["Blue tank"]);
    expect(activeItems(v1).map((i) => i.title)).toEqual(["Red tank"]);
    expect([v1.change?.instruction, v2.change?.instruction]).toEqual(["Red tank", "Blue tank"]);
    expect(v2.items[0]!.originVersionId).toBe(v2.id);
    expect(v1.items[0]!.originVersionId).toBe(v1.id);
  });

  it("new item has null/unknown cost defaults; other slots are kept; parent is untouched", () => {
    const before = JSON.stringify(rootWithParts);
    const a = visualChild(rootWithParts, input({ slot: "tank" }));
    const b = visualChild(a, input({ slot: "exhaust" }));
    expect(b.items.map((i) => i.slot).sort()).toEqual(["exhaust", "tank"]);
    const it = b.items.find((i) => i.slot === "exhaust")!;
    expect(it).toMatchObject({
      product: null, costKind: "part", partPriceCents: null, taxBasis: "unknown", laborMinutes: null,
      fit: null, fitInputHash: null, fitCheckedAt: null, zeroLaborConfirmed: false,
      mechanicNotes: "", fitReviewedHash: null,
    });
    expect(JSON.stringify(rootWithParts)).toBe(before);
    expect(b.parentId).toBe(a.id);
  });

  it("composited same-size accept: target fresh, others stale with old maskId, no cutout/bike mask", () => {
    const parent: Version = { ...rootWithParts, cutoutImageId: id(), bikeMaskId: id() };
    const fresh = { ...part("tank"), stale: true };
    const child = visualChild(parent, input({ slot: "tank", refreshedPart: fresh }));
    expect(child.parts.map((p) => [p.slot, p.stale])).toEqual([["tank", false], ["exhaust", true], ["seat", true]]);
    const old = parent.parts.find((p) => p.slot === "exhaust")!;
    expect(child.parts.find((p) => p.slot === "exhaust")!.maskId).toBe(old.maskId);
    expect(child.parts.find((p) => p.slot === "tank")!.maskId).toBe(fresh.maskId);
    expect(child.cutoutImageId).toBeNull();
    expect(child.bikeMaskId).toBeNull();
    expect(child.fallbackReason).toBeNull();
  });

  it("refreshedPart for another slot is refused", () => {
    expect(() => visualChild(rootWithParts, input({ slot: "tank", refreshedPart: part("seat") }))).toThrow(/slot/);
  });

  it("refreshedPart null on a composited same-size accept keeps the target part stale with its old mask", () => {
    const child = visualChild(rootWithParts, input({ slot: "tank", refreshedPart: null }));
    const oldTank = rootWithParts.parts.find((p) => p.slot === "tank")!;
    expect(child.parts).toHaveLength(3);
    expect(child.parts.find((p) => p.slot === "tank")).toMatchObject({ stale: true, maskId: oldTank.maskId });
  });

  it("the change record stores the short title, not the long edit prompt", () => {
    const child = visualChild(root, input({ slot: "tank", title: "Red tank" }));
    expect(child.change?.instruction).toBe("Red tank");
  });

  it("fallback or size change clears parts, cutout and bike mask", () => {
    const parent: Version = { ...rootWithParts, cutoutImageId: id(), bikeMaskId: id() };
    const fb = visualChild(parent, input({
      slot: "tank", composite: { composed: false, aligned: false, drift: null, reason: "geometry" },
    }));
    expect(fb.parts).toEqual([]);
    expect(fb.bikeMaskId).toBeNull();
    expect(fb.cutoutImageId).toBeNull();
    expect(fb.fallbackReason).toBe("geometry");
    expect(fb.composed).toBe(false);
    const resized = visualChild(parent, input({ slot: "tank", image: img("c", 120, 60), refreshedPart: part("tank") }));
    expect(resized.parts).toEqual([]);
  });

  it("branch from an earlier node is a sibling; undo/redo create nothing", () => {
    const v1 = visualChild(root, input({ slot: "tank", createdAt: 1 }));
    const v2 = visualChild(v1, input({ slot: "seat", createdAt: 2 }));
    const branch = visualChild(v1, input({ slot: "exhaust", createdAt: 3 }));
    const all = [root, v1, v2, branch];
    expect(branch.parentId).toBe(v1.id);
    expect(children(all, v1.id).map((v) => v.id)).toEqual([v2.id, branch.id]);
    expect(redoTargets(all, v1.id)).toHaveLength(2);
    expect(redoTargets(all, branch.id)).toEqual([]);
    expect(undoTarget(branch)).toBe(v1.id);
    expect(undoTarget(root)).toBeNull();
    expect(pathFromRoot(all, branch.id).map((v) => v.id)).toEqual([root.id, v1.id, branch.id]);
    expect(activeItems(branch).map((i) => i.slot).sort()).toEqual(["exhaust", "tank"]);
    expect(all).toHaveLength(4);
  });

  it("a replaced item id is dropped from fee item lists", () => {
    const v1 = visualChild(root, input({ slot: "tank" }));
    const fee = { id: id(), label: "Abnahme", kind: "aenderungsabnahme" as const, netCents: 100,
      itemIds: [v1.items[0]!.id], confirmed: true };
    const v2 = visualChild({ ...v1, fees: [fee] }, input({ slot: "tank" }));
    expect(v2.fees[0]!.itemIds).toEqual([]);
  });
});

describe("roots, projects, pending", () => {
  const bike = BikeRevision.parse({
    id: id(), confirmed: false, revision: 0, confirmedAt: null,
    bike: { make: null, model: null, family: "unknown", engine: null, yearFrom: null, yearTo: null,
      abs: "unknown", style: null, facing: "unknown", confidence: 0, limitations: [] },
  });
  it("newProject uses fixed defaults and a local-time name", () => {
    const now = new Date(2026, 9, 28, 9, 5);
    const p = newProject({ id: PID, rootVersionId: root.id, bikeRevision: bike, now });
    expect(p.name).toBe("Bike photo 2026-10-28 09:05");
    expect(defaultProjectName(now)).toBe(p.name);
    expect(p).toMatchObject({ settingsId: "default", headVersionId: root.id, rootVersionId: root.id });
    expect(ProjectSchema.safeParse(p).success).toBe(true);
    expect(VersionSchema.safeParse(root).success).toBe(true);
  });

  it("canAcceptPending checks project and head", () => {
    const p = newProject({ id: PID, rootVersionId: root.id, bikeRevision: bike, now: new Date(0) });
    expect(canAcceptPending(p, { projectId: PID, expectedHeadId: root.id })).toEqual({ ok: true });
    expect(canAcceptPending(p, { projectId: id(), expectedHeadId: root.id }))
      .toEqual({ ok: false, reason: "wrong_project" });
    const moved = { ...p, headVersionId: id() };
    expect(canAcceptPending(moved, { projectId: PID, expectedHeadId: root.id }))
      .toEqual({ ok: false, reason: "stale_head" });
  });

  it("activeItems and pathToRoot reject broken trees", () => {
    const v1 = visualChild(root, input({ slot: "tank" }));
    expect(() => activeItems({ ...v1, items: [v1.items[0]!, { ...v1.items[0]!, id: id() }] })).toThrow();
    expect(() => pathFromRoot([v1], v1.id)).toThrow(/missing/);
  });
});

describe("persisted validators", () => {
  const maskBase = { id: id(), imageHash: hash("a"), width: 4, height: 3, createdAt: 0 };
  it("accepts a correct mask and rejects wrong length or a byte of 2", () => {
    expect(StoredMask.safeParse({ ...maskBase, pixels: new Uint8Array(12).fill(1) }).success).toBe(true);
    expect(StoredMask.safeParse({ ...maskBase, pixels: new Uint8Array(11) }).success).toBe(false);
    const bad = new Uint8Array(12); bad[7] = 2;
    expect(StoredMask.safeParse({ ...maskBase, pixels: bad }).success).toBe(false);
    expect(StoredMask.safeParse({ ...maskBase, width: 5000, pixels: new Uint8Array(15000) }).success).toBe(false);
  });

  it("stores images as Blob only: base64 and extra keys are rejected", () => {
    const ref = img("a");
    const ok = { ...ref, blob: new Blob(["x"]), lastAccessedAt: 1 };
    expect(StoredImage.safeParse(ok).success).toBe(true);
    expect(StoredImage.safeParse({ ...ok, blob: "data:image/webp;base64,AAAA" }).success).toBe(false);
    expect(StoredImage.safeParse({ ...ok, dataUrl: "x" }).success).toBe(false);
    expect(ImageRef.safeParse({ ...ref, extra: 1 }).success).toBe(false);
  });

  it("rejects a version with two items in one slot or an extra key", () => {
    const v1 = visualChild(root, input({ slot: "tank" }));
    const dup = { ...v1, items: [v1.items[0]!, { ...v1.items[0]!, id: id() }] };
    expect(VersionSchema.safeParse(v1).success).toBe(true);
    expect(VersionSchema.safeParse(dup).success).toBe(false);
    expect(VersionSchema.safeParse({ ...v1, extra: true }).success).toBe(false);
  });

  const v1 = visualChild(root, input({ slot: "tank" }));
  it.each([
    ["a non-root version without a parent", { ...v1, parentId: null }],
    ["a root version with a parent", { ...root, parentId: id() }],
    ["a visual version without a change", { ...v1, change: null }],
    ["a change that points to an unknown item", { ...v1, change: { ...v1.change!, itemId: id() } }],
    ["a change whose slot differs from its item", { ...v1, change: { ...v1.change!, slot: "seat" as const } }],
    ["duplicate item ids", { ...v1, items: [v1.items[0]!, { ...v1.items[0]!, slot: "seat" as const }] }],
    ["a fee that lists an unknown item", { ...v1, fees: [{ id: id(), label: "x", kind: "other" as const, netCents: 1, itemIds: [id()], confirmed: true }] }],
  ])("rejects %s", (_name, bad) => {
    expect(VersionSchema.safeParse(v1).success).toBe(true);
    expect(VersionSchema.safeParse(bad).success).toBe(false);
  });
});

describe("laterSteps", () => {
  const ids = (vs: Version[]) => vs.map((v) => v.id);

  it("returns a straight chain after the head, in order", () => {
    const v1 = visualChild(root, input({ slot: "tank", createdAt: 1 }));
    const v2 = visualChild(v1, input({ slot: "seat", createdAt: 2 }));
    const r = laterSteps([root, v1, v2], root.id);
    expect(ids(r.steps)).toEqual([v1.id, v2.id]);
    expect(r.otherBranches).toEqual([0, 0]);
  });

  it("is empty when the head is a leaf", () => {
    const v1 = visualChild(root, input({ slot: "tank", createdAt: 1 }));
    expect(laterSteps([root, v1], v1.id)).toEqual({ steps: [], otherBranches: [] });
  });

  it("a fork with no deeper work follows the newest direct child and reports the other branch", () => {
    const b = visualChild(root, input({ slot: "tank", createdAt: 1 }));
    const d = visualChild(root, input({ slot: "seat", createdAt: 2 }));
    const r = laterSteps([root, b, d], root.id);
    expect(ids(r.steps)).toEqual([d.id]);
    expect(r.otherBranches).toEqual([1]);
  });

  it("follows the subtree with the newest work: A->B->C beats a newer sibling D", () => {
    const b = visualChild(root, input({ slot: "tank", createdAt: 1 }));
    const d = visualChild(root, input({ slot: "seat", createdAt: 2 }));
    const c = visualChild(b, input({ slot: "exhaust", createdAt: 3 }));
    const r = laterSteps([root, b, d, c], root.id);
    expect(ids(r.steps)).toEqual([b.id, c.id]);
    expect(r.otherBranches).toEqual([1, 0]);
  });

  it("terminates on a corrupt parent cycle", () => {
    const a = { ...root, id: id(), parentId: null as string | null, createdAt: 1 };
    const b = { ...root, id: id(), parentId: a.id as string | null, createdAt: 2 };
    a.parentId = b.id;
    const r = laterSteps([a, b], a.id);
    expect(ids(r.steps)).toEqual([b.id]);
  });
});

describe("exportPlan", () => {
  const P = { id: "abcdef12-0000-4000-8000-000000000000", name: "My Bike" };
  const vid = (n: string) => `${n.repeat(8)}-0000-4000-8000-000000000000`;
  const mk = (n: string, parent: Version | null, createdAt: number, slot: Part["slot"] = "tank", over: Partial<Version> = {}) => {
    const base = parent ? visualChild(parent, input({ slot, versionId: vid(n), createdAt, title: `T-${n}` })) : root;
    return { ...base, ...over };
  };
  const r0: Version = { ...root, id: vid("0"), createdAt: 0 };
  const plan = (versions: Version[], headId: string, name = P.name) =>
    exportPlan({ project: { ...P, name }, versions, headId, exportedAt: "2026-10-28T10:00:00.000Z" });

  it("orders by createdAt with id tie-break, numbers from 00, names root start and visual by slot", () => {
    const b = mk("b", r0, 5, "tank");
    const a = mk("a", r0, 5, "seat");
    const p = plan([b, a, r0], b.id);
    expect(p.files.map((f) => f.name)).toEqual([
      "00-start-00000000.webp", "01-seat-aaaaaaaa.webp", "02-tank-bbbbbbbb.webp",
    ]);
    expect(p.files[1]).toEqual({ name: "01-seat-aaaaaaaa.webp", versionId: a.id, imageId: a.image.id });
  });

  it("makes folder names filesystem safe", () => {
    const f = (n: string) => plan([r0], r0.id, n).folderName;
    expect(f("a/b\\c")).toBe("a-b-c (abcdef12)");
    expect(f("12:30")).toBe("12-30 (abcdef12)");
    expect(f("x\u0000y\u007Fz\u001F")).toBe("x-y-z- (abcdef12)");
    expect(f("  . .  ")).toBe("Project (abcdef12)");
    expect(f("..")).toBe("Project (abcdef12)");
    expect(f("a   b\u00A0 c")).toBe("a b c (abcdef12)");
    expect(f("n".repeat(200))).toBe(`${"n".repeat(80)} (abcdef12)`);
    expect(f("n".repeat(79) + " " + "m".repeat(20))).toBe(`${"n".repeat(79)} (abcdef12)`);
    const other = exportPlan({ project: { id: "99999999-x", name: P.name }, versions: [r0], headId: r0.id, exportedAt: "t" });
    expect(other.folderName).toBe("My Bike (99999999)");
    expect(plan([r0], r0.id).folderName).toBe("My Bike (abcdef12)");
  });

  it("excludes external_runtime images from files and marks them", () => {
    const ext = mk("e", r0, 1, "tank", { image: { ...img("c"), rights: "external_runtime" } });
    const vis = mk("f", ext, 2, "seat", { image: { ...img("d"), rights: "visitor" } });
    const p = plan([r0, ext, vis], vis.id);
    expect(p.files.map((x) => x.versionId)).toEqual([r0.id, vis.id]);
    const j = JSON.parse(p.historyJson);
    expect(j.versions[1].file).toBeNull();
    expect(j.versions[2].file).toBe("02-seat-ffffffff.webp");
    expect(p.historyMarkdown).toContain("File: image not exported (external image)");
  });

  it("includes both branches, marks the off-path branch and the head, echoes exportedAt", () => {
    const a = mk("a", r0, 1, "tank");
    const b = mk("b", a, 2, "seat");
    const d = mk("d", r0, 3, "exhaust", { composed: false, fallbackReason: "no_mask" as never });
    const p = plan([r0, a, b, d], b.id);
    expect(p.files).toHaveLength(4);
    const j = JSON.parse(p.historyJson);
    expect(j.exportedAt).toBe("2026-10-28T10:00:00.000Z");
    expect(j.headId).toBe(b.id);
    expect(j.project).toEqual({ id: P.id, name: "My Bike" });
    expect(j.versions.map((v: { step: string }) => v.step)).toEqual(["Start", "Step 1", "Step 2", "Step 1"]);
    expect(j.versions.map((v: { onHeadPath: boolean }) => v.onHeadPath)).toEqual([true, true, true, false]);
    expect(j.versions.map((v: { isHead: boolean }) => v.isHead)).toEqual([false, false, true, false]);
    expect(j.versions[0]).toMatchObject({ slot: null, instruction: null, mode: null, parentId: null, sheet: [] });
    expect(j.versions[2].sheet).toEqual([{ slot: "tank", title: "T-a" }, { slot: "seat", title: "T-b" }]);
    expect(j.versions[1].createdAt).toBe("1970-01-01T00:00:00.001Z");
    const md = p.historyMarkdown;
    expect(md.startsWith("# My Bike\n\nExported 2026-10-28T10:00:00.000Z\n")).toBe(true);
    expect(md).toContain("## 00 Start\n");
    expect(md).toContain("## 02 Step 2 \u2014 Seat (shown now)");
    expect(md).toContain("## 03 Step 1 \u2014 Exhaust (other branch)");
    expect(md).toContain("Full image, not blended (no_mask)");
    expect(md.match(/Full image, not blended/g)).toHaveLength(1);
  });

  it("throws on a cycle", () => {
    const a = { ...r0, id: vid("a"), parentId: vid("b") as string | null, createdAt: 1 };
    const b = { ...r0, id: vid("b"), parentId: a.id as string | null, createdAt: 2 };
    expect(() => plan([a, b], a.id)).toThrow(/cycle/);
  });
});
