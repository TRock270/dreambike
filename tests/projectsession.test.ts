// Project session glue against fake-indexeddb: open, create, accept with the head guard,
// undo/redo/branch, saving parts, identify cache. A fresh database per test.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDreamDb, openDreamDb, type DreamDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { activeItems, exportPlan, pathFromRoot, projectSnapshot } from "@/lib/project";
import { planPdfImage } from "@/lib/browser/pdfExport";
import {
  acceptEdit, cachedIdentify, saveSheet, createFromPhoto, headVersion, identifyForPhoto, jumpToVersion, loadHeadView, newAcceptIds,
  openProject, openStorage, persistParts, redoHead, saveBike, saveErrorText, undoHead, type AcceptIds, type AcceptInput, type ProjectSession,
} from "@/lib/browser/projectSession";
import { bikeFormFromRevision, bikeRevisionFromForm, confirmBike, editField, emptyBikeForm } from "@/lib/bikeForm";
import { derive, emptyPartMap, refreshedPart } from "@/lib/browser/partMap";
import * as spark from "@/lib/browser/sparkClient";
import type { BikeData, BinaryMask, NormalizedPhoto, SlotId } from "@/lib/types";
import { hash, freshIndexedDb, H, W } from "./support/idb";

vi.mock("@/lib/browser/sparkClient", () => ({ requestIdentify: vi.fn(), requestInstruction: vi.fn() }));

let h: DreamDb;
beforeEach(async () => {
  freshIndexedDb();
  h = await openDreamDb();
});
afterEach(() => {
  vi.restoreAllMocks();
  closeDreamDb(h);
});

const photoOf = (c: string): NormalizedPhoto => ({
  blob: new Blob([new Uint8Array(12).fill(c.charCodeAt(0))]), width: W, height: H, hash: hash(c), warnings: [],
});
const instruction = (title: string) => ({
  title, editPrompt: `prompt ${title}`, spec: [{ key: "finish", value: "matte" }], intent: "paint" as const, warnings: [],
});
const mask = (): BinaryMask => {
  const pixels = new Uint8Array(W * H);
  pixels[0] = 1; pixels[1] = 1;
  return { width: W, height: H, pixels };
};
const result = (c: string, composed = true) => ({
  blob: new Blob([new Uint8Array(9).fill(c.charCodeAt(0))]), width: W, height: H, hash: hash(c), composed,
  aligned: true, drift: 0.01, reason: composed ? ("composited" as const) : ("geometry" as const),
});

/** The input for one accept on the session's current head. */
function inputFor(s: ProjectSession, slot: SlotId, title: string, c: string, ids: AcceptIds = newAcceptIds()): AcceptInput {
  const r = result(c);
  return {
    ref: { projectId: s.project.id, expectedHeadId: s.project.headVersionId }, ids, slot, mode: "text",
    instruction: instruction(title), result: r, refreshed: refreshedPart(slot, slot, mask(), r.hash), now: 100,
  };
}

/** Accept and return the new session; fails the test on a refusal. */
async function accept(s: ProjectSession, slot: SlotId, title: string, c: string): Promise<ProjectSession> {
  const out = await acceptEdit(h, s, inputFor(s, slot, title, c));
  if (out.status !== "accepted") throw new Error(`refused: ${out.message}`);
  return out.session;
}

async function start(c = "a"): Promise<ProjectSession> {
  return createFromPhoto(h, photoOf(c), new Date(2026, 9, 28, 14, 5));
}

describe("create and open", () => {
  it("a new import is a project named by local date and time, with the photo saved", async () => {
    const s = await start();
    expect(s.project.name).toBe("Bike photo 2026-10-28 14:05");
    expect(s.project.settingsId).toBe("default");
    const opened = await openProject(h, s.project.id);
    expect(opened.view.photo.hash).toBe(hash("a"));
    expect(opened.view.photo.blob.size).toBe(12);
    expect(opened.hasSavedBike).toBe(false);
  });

  it("reopening starts nothing: the map is restored, nothing detected, no network call", async () => {
    const s = await start();
    const opened = await openProject(h, s.project.id);
    expect(spark.requestIdentify).not.toHaveBeenCalled();
    expect(opened.view.map.done).toBe(true);
    expect(Object.values(derive(opened.view.map).phrases).every((p) => p === "stale")).toBe(true);
    expect(opened.view.map.bikeStatus).not.toBe("none"); // never claims "no outline found" for an unchecked version
  });

  it("an unknown project id is a clear error", async () => {
    await expect(openProject(h, "missing")).rejects.toThrow(/no longer exists/);
  });

  it("a damaged version makes open fail clearly and deletes nothing", async () => {
    const s = await start();
    const raw = { ...(await h.db.get("versions", s.project.rootVersionId)), items: "not a list" };
    await h.db.put("versions", raw as never);
    await expect(openProject(h, s.project.id)).rejects.toThrow(/version/i);
    expect(await h.db.count("projects")).toBe(1);
    expect(await h.db.count("versions")).toBe(1);
  });

  it("openStorage reports unavailable instead of throwing when IndexedDB is missing", async () => {
    Object.assign(globalThis, { indexedDB: undefined });
    const st = await openStorage();
    expect(st.status).toBe("unavailable");
  });
});

describe("history through the session", () => {
  it("three accepted edits survive close and reopen", async () => {
    let s = await start();
    s = await accept(s, "fork", "Fork one", "b");
    s = await accept(s, "tank", "Tank two", "c");
    s = await accept(s, "seat", "Seat three", "d");
    closeDreamDb(h);
    h = await openDreamDb();
    const opened = await openProject(h, s.project.id);
    expect(opened.view.photo.hash).toBe(hash("d"));
    expect(activeItems(headVersion(opened.session)).map((i) => i.slot).sort()).toEqual(["fork", "seat", "tank"]);
    expect(pathFromRoot(opened.session.versions, opened.session.project.headVersionId)).toHaveLength(4);
  });

  it("undo restores the image and the sheet together, redo brings them back, no node is created", async () => {
    let s = await start();
    s = await accept(s, "fork", "Fork one", "b");
    s = await accept(s, "tank", "Tank two", "c");
    const undone = await undoHead(h, s);
    if (undone.status !== "moved") throw new Error("undo failed");
    expect(undone.view.photo.hash).toBe(hash("b"));
    expect(activeItems(headVersion(undone.session)).map((i) => i.slot)).toEqual(["fork"]);
    expect(await h.db.count("versions")).toBe(3);
    const redone = await redoHead(h, undone.session);
    if (redone.status !== "moved") throw new Error("redo failed");
    expect(redone.view.photo.hash).toBe(hash("c"));
    expect(activeItems(headVersion(redone.session))).toHaveLength(2);
    expect(await h.db.count("versions")).toBe(3);
  });

  it("undo at the start and redo at the end say so", async () => {
    const s = await start();
    expect(await undoHead(h, s)).toEqual({ status: "nothing", message: "Nothing to undo." });
    expect(await redoHead(h, s)).toEqual({ status: "nothing", message: "Nothing to redo." });
  });

  it("accepting after undo branches; redo then asks which branch and nothing is written until chosen", async () => {
    let s = await start();
    s = await accept(s, "fork", "Fork one", "b");
    const firstChildId = s.project.headVersionId;
    const back = await undoHead(h, s);
    if (back.status !== "moved") throw new Error("undo failed");
    const branch = await accept(back.session, "tank", "Tank branch", "c");
    expect(branch.versions).toHaveLength(3);
    const root = await jumpToVersion(h, branch, branch.project.rootVersionId);
    if (root.status !== "moved") throw new Error("jump failed");
    const asked = await redoHead(h, root.session);
    expect(asked.status).toBe("choose_branch");
    if (asked.status !== "choose_branch") return;
    expect(asked.children).toHaveLength(2);
    expect((await h.db.get("projects", s.project.id))!.headVersionId).toBe(root.session.project.headVersionId);
    const picked = await redoHead(h, root.session, firstChildId);
    if (picked.status !== "moved") throw new Error("redo failed");
    expect(picked.view.photo.hash).toBe(hash("b"));
    expect(activeItems(headVersion(picked.session)).map((i) => i.slot)).toEqual(["fork"]);
  });

  it("the same slot edited twice: one active item, two change records in the history", async () => {
    let s = await start();
    s = await accept(s, "fork", "Chrome fork", "b");
    s = await accept(s, "fork", "Black fork", "c");
    const items = activeItems(headVersion(s));
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Black fork");
    const changes = pathFromRoot(s.versions, s.project.headVersionId).map((v) => v.change?.instruction).filter(Boolean);
    expect(changes).toEqual(["Chrome fork", "Black fork"]);
  });
});

describe("reference mode accepts", () => {
  /** A geometry result: a wheel swap is a full-image render, so there is no refreshed part. */
  const wheelInput = (s: ProjectSession, slot: SlotId, title: string, c: string): AcceptInput => ({
    ...inputFor(s, slot, title, c), mode: "reference", refreshed: null,
    result: result(c, false),
  });
  async function acceptWheel(s: ProjectSession, slot: SlotId, title: string, c: string): Promise<ProjectSession> {
    const out = await acceptEdit(h, s, wheelInput(s, slot, title, c));
    if (out.status !== "accepted") throw new Error(`refused: ${out.message}`);
    return out.session;
  }

  it("adds exactly one build item and one version with the plain change record, and stores only the result image", async () => {
    const s = await start();
    const before = { versions: await h.db.count("versions"), images: await h.db.count("images") };
    const next = await acceptWheel(s, "wheel_front", "Gold wheel", "b");
    expect(await h.db.count("versions")).toBe(before.versions + 1);
    expect(await h.db.count("images")).toBe(before.images + 1); // the result; no reference image
    const head = headVersion(next);
    expect(activeItems(head)).toHaveLength(1);
    // Exactly the SPEC 4 record: no reference id or hash is persisted.
    expect(Object.keys(head.change!).sort()).toEqual(["instruction", "itemId", "mode", "slot"]);
    expect(head.change).toMatchObject({ slot: "wheel_front", mode: "reference", instruction: "Gold wheel" });
    const stored = await h.db.getAll("images");
    expect(stored.map((i) => i.hash).sort()).toEqual([hash("a"), hash("b")].sort());
  });

  it("two wheels in two steps give two sheet lines and two undo steps; undo restores image and sheet together", async () => {
    let s = await start();
    s = await acceptWheel(s, "wheel_front", "Gold front wheel", "b");
    s = await acceptWheel(s, "wheel_rear", "Gold rear wheel", "c");
    expect(activeItems(headVersion(s)).map((i) => i.slot).sort()).toEqual(["wheel_front", "wheel_rear"]);
    expect(pathFromRoot(s.versions, s.project.headVersionId)).toHaveLength(3);
    const one = await undoHead(h, s);
    if (one.status !== "moved") throw new Error("undo failed");
    expect(one.view.photo.hash).toBe(hash("b"));
    expect(activeItems(headVersion(one.session)).map((i) => i.slot)).toEqual(["wheel_front"]);
    const two = await undoHead(h, one.session);
    if (two.status !== "moved") throw new Error("undo failed");
    expect(two.view.photo.hash).toBe(hash("a"));
    expect(activeItems(headVersion(two.session))).toHaveLength(0);
    expect((await undoHead(h, two.session)).status).toBe("nothing");
  });
});

describe("accept guard", () => {
  it("a preview made for an older head is refused, writes nothing, and the head stays", async () => {
    let s = await start();
    const old = inputFor(s, "fork", "Late preview", "z"); // rendered while the head was the root
    s = await accept(s, "tank", "Newer edit", "b");
    const before = await h.db.count("versions");
    const out = await acceptEdit(h, s, old);
    expect(out).toMatchObject({ status: "refused", reason: "stale_head" });
    expect(await h.db.count("versions")).toBe(before);
    expect((await h.db.get("projects", s.project.id))!.headVersionId).toBe(s.project.headVersionId);
  });

  it("a preview for another project is refused", async () => {
    const a = await start("a");
    const b = await start("b");
    const out = await acceptEdit(h, b, inputFor(a, "fork", "Wrong project", "z"));
    expect(out).toMatchObject({ status: "refused", reason: "wrong_project" });
  });

  it("the database refuses a stale head even when the in-memory session is out of date (another tab)", async () => {
    let s = await start();
    const staleView = s; // this tab still thinks the head is the root
    s = await accept(s, "tank", "Other tab edit", "b");
    const out = await acceptEdit(h, staleView, inputFor(staleView, "fork", "Late", "c"));
    expect(out).toMatchObject({ status: "refused", reason: "stale_head" });
    expect(await h.db.count("versions")).toBe(2);
  });

  it("retry with the same IDs after an unknown outcome is idempotent: no duplicate line", async () => {
    const s = await start();
    const input = inputFor(s, "fork", "Fork one", "b");
    const first = await acceptEdit(h, s, input);
    const again = await acceptEdit(h, s, input); // the UI never saw the first answer
    expect(first.status).toBe("accepted");
    expect(again).toMatchObject({ status: "accepted", idempotent: true });
    expect(await h.db.count("versions")).toBe(2);
    if (again.status === "accepted") expect(activeItems(headVersion(again.session))).toHaveLength(1);
  });

  it("a failure inside the write keeps the old head and leaves no orphan; retry with the same IDs works", async () => {
    const s = await start();
    const input = inputFor(s, "fork", "Fork one", "b");
    const realPut = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof realPut>) {
      if (this.name === "projects") throw new Error("injected failure");
      return realPut.apply(this, args);
    });
    await expect(acceptEdit(h, s, input)).rejects.toThrow("injected failure");
    expect((await h.db.get("projects", s.project.id))!.headVersionId).toBe(s.project.headVersionId);
    expect(await h.db.count("versions")).toBe(1);
    expect(await h.db.count("images")).toBe(1);
    expect(await h.db.count("masks")).toBe(0);
    spy.mockRestore();
    const retry = await acceptEdit(h, s, input);
    expect(retry).toMatchObject({ status: "accepted", idempotent: false });
    expect(await h.db.count("versions")).toBe(2);
  });

  it("a full disk surfaces STORAGE_FULL, keeps the head, and the same IDs save once space is back", async () => {
    const s = await start();
    const input = inputFor(s, "fork", "Fork one", "b");
    const realPut = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof realPut>) {
      if (this.name === "versions") throw new DOMException("disk full", "QuotaExceededError");
      return realPut.apply(this, args);
    });
    const error = await acceptEdit(h, s, input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("STORAGE_FULL");
    expect(saveErrorText(error)).toMatch(/storage is full/i);
    expect((await h.db.get("projects", s.project.id))!.headVersionId).toBe(s.project.headVersionId);
    expect(await h.db.count("versions")).toBe(1);
    spy.mockRestore();
    expect((await acceptEdit(h, s, input)).status).toBe("accepted");
  });
});

describe("parts", () => {
  it("detected parts are saved on the head, restored on open, and other parts turn stale after an edit", async () => {
    let s = await start();
    const rootHash = headVersion(s).image.hash;
    const seat = refreshedPart("seat", "Seat", mask(), rootHash)!;
    const detected = derive({ ...emptyPartMap(rootHash), done: true, pointParts: [seat] });
    const saved = await persistParts(h, s, rootHash, detected);
    expect(saved).not.toBeNull();
    s = saved!;
    expect(headVersion(s).parts).toHaveLength(1);
    expect(headVersion(s).items).toHaveLength(0); // attach never touches the sheet

    s = await accept(s, "fork", "Fork one", "b");
    const reopened = await loadHeadView(h, s);
    const parts = derive(reopened.map).parts;
    const bySlot = Object.fromEntries(parts.map((p) => [p.slot, p.stale]));
    expect(bySlot).toEqual({ fork: false, seat: true }); // fresh target, inherited part shown disabled
    expect(reopened.map.imageHash).toBe(hash("b"));
  });

  it("a full-image fallback has no parts to restore", async () => {
    let s = await start();
    const r = result("b", false);
    const out = await acceptEdit(h, s, { ...inputFor(s, "fork", "Fork one", "b"), result: r });
    if (out.status !== "accepted") throw new Error("refused");
    s = out.session;
    expect(headVersion(s).parts).toEqual([]);
    expect(headVersion(s).bikeMaskId).toBeNull();
  });

  it("parts detected for another image are not saved on the shown version", async () => {
    const s = await start();
    expect(await persistParts(h, s, hash("q"), derive(emptyPartMap(hash("q"))))).toBeNull();
  });
});

describe("identify cache", () => {
  const bike: BikeData = { make: "Harley-Davidson", model: "Sportster", family: "sportster", engine: null, yearFrom: null, yearTo: null,
    abs: "unknown", style: null, facing: "left", confidence: 0.8, limitations: [] };

  it("the same photo never pays twice, and opening only reads the cache", async () => {
    vi.mocked(spark.requestIdentify).mockResolvedValue(bike);
    const photo = photoOf("a");
    const first = await identifyForPhoto(h, photo);
    expect(first.cachedAt).toBeNull();
    const second = await identifyForPhoto(h, photo);
    expect(second.cachedAt).not.toBeNull();
    expect(second.bike.model).toBe("Sportster");
    expect(spark.requestIdentify).toHaveBeenCalledTimes(1);
    expect(await cachedIdentify(h, hash("a"))).not.toBeNull();
    expect(await cachedIdentify(h, hash("b"))).toBeNull();
  });

  it("a failed cache write does not lose the answer", async () => {
    vi.mocked(spark.requestIdentify).mockResolvedValue(bike);
    const realPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof realPut>) {
      if (this.name === "cache") throw new Error("cache broke");
      return realPut.apply(this, args);
    });
    const r = await identifyForPhoto(h, photoOf("a"));
    expect(r.bike.make).toBe("Harley-Davidson");
  });

  it("without storage the call still works and is simply not cached", async () => {
    vi.mocked(spark.requestIdentify).mockResolvedValue(bike);
    const r = await identifyForPhoto(null, photoOf("a"));
    expect(r.cachedAt).toBeNull();
  });
});

describe("bike confirmation withdrawn", () => {
  it("a confirmation taken back is saved: reopening shows unconfirmed and the edited value", async () => {
    const s = await start();
    let form = confirmBike(editField(emptyBikeForm(), "facing", "right"))!;
    await saveBike(h, s, bikeRevisionFromForm(form, s.project.bikeRevision.id, 10));
    // The mechanic changes one field; the form is unconfirmed, and that is what Workspace saves.
    form = editField(form, "facing", "left");
    await saveBike(h, s, bikeRevisionFromForm(form, s.project.bikeRevision.id, 20));
    const reopened = bikeFormFromRevision((await openProject(h, s.project.id)).session.project.bikeRevision);
    expect(reopened.confirmed).toBe(false);
    expect(reopened.bike.facing).toBe("left");
    expect(reopened.revision).toBe(1);
  });
});

describe("navigation failures leave the stored head alone", () => {
  it("undo to a version whose photo is missing throws and the stored head does not move", async () => {
    let s = await start();
    const rootImageId = headVersion(s).image.id;
    s = await accept(s, "fork", "Fork one", "b");
    await h.db.delete("images", rootImageId);
    await expect(undoHead(h, s)).rejects.toThrow(/missing/);
    expect((await h.db.get("projects", s.project.id))!.headVersionId).toBe(s.project.headVersionId);
  });

  it("jump to a version whose photo is missing throws and the stored head does not move", async () => {
    let s = await start();
    const rootImageId = headVersion(s).image.id;
    const rootId = s.project.rootVersionId;
    s = await accept(s, "fork", "Fork one", "b");
    await h.db.delete("images", rootImageId);
    await expect(jumpToVersion(h, s, rootId)).rejects.toThrow(/missing/);
    expect((await h.db.get("projects", s.project.id))!.headVersionId).toBe(s.project.headVersionId);
  });

  it("jump is refused when another tab already moved the head", async () => {
    let s = await start();
    const rootId = s.project.rootVersionId;
    const stale = await accept(s, "fork", "Fork one", "b"); // head = v1
    s = await accept(stale, "tank", "Tank two", "c"); // head = v2 in storage
    const out = await jumpToVersion(h, stale, rootId); // this tab still thinks head = v1
    expect(out.status).toBe("nothing");
    expect((await h.db.get("projects", s.project.id))!.headVersionId).toBe(s.project.headVersionId);
  });
});

describe("saveSheet", () => {
  const refOf = (s: ProjectSession) => ({ projectId: s.project.id, expectedHeadId: s.project.headVersionId });
  const retitled = (s: ProjectSession, title: string) => headVersion(s).items.map((i) => ({ ...i, title }));

  it("saves a sheet version, then undo restores the parent's sheet and redo brings it back", async () => {
    const s = await accept(await start(), "tank", "Red tank", "b");
    const parent = headVersion(s);
    const out = await saveSheet(h, s, { ref: refOf(s), versionId: crypto.randomUUID(), items: retitled(s, "Edited"), fees: [], now: 200 });
    if (out.status !== "saved") throw new Error(out.status);
    expect(headVersion(out.session).kind).toBe("sheet");
    expect(headVersion(out.session).image).toEqual(parent.image);
    const undone = await undoHead(h, out.session);
    if (undone.status !== "moved") throw new Error(undone.status);
    expect(headVersion(undone.session).items[0]!.title).toBe(parent.items[0]!.title);
    const redone = await redoHead(h, undone.session);
    if (redone.status !== "moved") throw new Error(redone.status);
    expect(headVersion(redone.session).items[0]!.title).toBe("Edited");
  });

  it("refuses a stale head or another project and writes nothing", async () => {
    const s0 = await start();
    const s1 = await accept(s0, "tank", "Red tank", "b");
    const before = await h.db.count("versions");
    const stale = await saveSheet(h, s1, { ref: { projectId: s1.project.id, expectedHeadId: s0.project.headVersionId }, versionId: crypto.randomUUID(), items: [], fees: [] });
    expect(stale).toMatchObject({ status: "refused", reason: "stale_head" });
    const wrong = await saveSheet(h, s1, { ref: { projectId: "other", expectedHeadId: s1.project.headVersionId }, versionId: crypto.randomUUID(), items: [], fees: [] });
    expect(wrong).toMatchObject({ status: "refused", reason: "wrong_project" });
    expect(await h.db.count("versions")).toBe(before);
    expect((await h.db.get("projects", s1.project.id))!.headVersionId).toBe(s1.project.headVersionId);
  });

  it("a retry with the same versionId writes one version", async () => {
    const s = await accept(await start(), "tank", "Red tank", "b");
    const input = { ref: refOf(s), versionId: crypto.randomUUID(), items: retitled(s, "Once"), fees: [] };
    const first = await saveSheet(h, s, input);
    const n = await h.db.count("versions");
    const again = await saveSheet(h, s, input); // the UI still holds the old session
    expect(first).toMatchObject({ status: "saved", idempotent: false });
    expect(again).toMatchObject({ status: "saved", idempotent: true });
    expect(await h.db.count("versions")).toBe(n);
  });

  it("an unchanged sheet writes nothing", async () => {
    const s = await accept(await start(), "tank", "Red tank", "b");
    const before = await h.db.count("versions");
    const out = await saveSheet(h, s, { ref: refOf(s), versionId: crypto.randomUUID(), items: structuredClone(headVersion(s).items), fees: [] });
    expect(out).toEqual({ status: "unchanged" });
    expect(await h.db.count("versions")).toBe(before);
  });

  it("parts attached to the stored parent after the session copy end up on the sheet version", async () => {
    const s = await accept(await start(), "tank", "Red tank", "b");
    const stale = s; // the copy the sheet form was built from
    const map = { ...emptyPartMap(hash("b")), pointParts: [refreshedPart("seat", "Seat", mask(), hash("b"))!] };
    const saved = await persistParts(h, s, hash("b"), derive(map));
    expect(saved).not.toBeNull();
    const attached = headVersion(saved!).parts.map((p) => p.maskId).sort();
    expect(attached).not.toEqual(headVersion(stale).parts.map((p) => p.maskId).sort());
    const out = await saveSheet(h, stale, { ref: refOf(stale), versionId: crypto.randomUUID(), items: retitled(stale, "Later"), fees: [] });
    if (out.status !== "saved") throw new Error(out.status);
    expect(headVersion(out.session).parts.map((p) => p.maskId).sort()).toEqual(attached);
    // The parent copy in the returned session must carry the stored parts too, so Undo shows them.
    const parentId = headVersion(out.session).parentId!;
    const parentCopy = out.session.versions.find((v) => v.id === parentId)!;
    expect(parentCopy.parts.map((p) => p.maskId).sort()).toEqual(attached);
    const back = await undoHead(h, out.session);
    if (back.status !== "moved") throw new Error(back.status);
    expect(headVersion(back.session).parts.map((p) => p.maskId).sort()).toEqual(attached);
  });
});

describe("saveSheet review-only versions (T10)", () => {
  const refOf = (s: ProjectSession) => ({ projectId: s.project.id, expectedHeadId: s.project.headVersionId });
  const review = { fitInputHash: hash("f"), decision: "none" as const, notes: "checked", reviewedAt: "2026-10-29T10:00:00.000Z" };

  it("saves a version whose only change is the inspection review, then reports unchanged", async () => {
    const s = await accept(await start(), "tank", "Red tank", "b");
    const p = headVersion(s);
    const out = await saveSheet(h, s, { ref: refOf(s), versionId: crypto.randomUUID(), items: p.items, fees: p.fees, inspectionReview: review });
    if (out.status !== "saved") throw new Error(out.status);
    expect(headVersion(out.session).inspectionReview).toEqual(review);
    const again = await saveSheet(h, out.session, { ref: refOf(out.session), versionId: crypto.randomUUID(), items: p.items, fees: p.fees, inspectionReview: review });
    expect(again).toEqual({ status: "unchanged" });
    const omitted = await saveSheet(h, out.session, { ref: refOf(out.session), versionId: crypto.randomUUID(), items: p.items, fees: p.fees });
    expect(omitted).toEqual({ status: "unchanged" }); // undefined keeps the parent's review
    const cleared = await saveSheet(h, out.session, { ref: refOf(out.session), versionId: crypto.randomUUID(), items: p.items, fees: p.fees, inspectionReview: null });
    expect(cleared.status).toBe("saved");
  });

  it("saves a version whose only change is fitReviewedHash", async () => {
    const s = await accept(await start(), "tank", "Red tank", "b");
    const p = headVersion(s);
    const items = p.items.map((i) => ({ ...i, fitReviewedHash: hash("e") }));
    const out = await saveSheet(h, s, { ref: refOf(s), versionId: crypto.randomUUID(), items, fees: p.fees });
    if (out.status !== "saved") throw new Error(out.status);
    expect(headVersion(out.session).items[0]!.fitReviewedHash).toBe(hash("e"));
  });
});

describe("web reference rights (shop product photo)", () => {
  const withRef = (s: ProjectSession, c: string, webReference?: boolean, ids?: AcceptIds): AcceptInput =>
    ({ ...inputFor(s, "tank", "Red tank", c, ids), webReference });

  it("webReference true gives external_runtime on the version and the stored image", async () => {
    const s = await start();
    const out = await acceptEdit(h, s, withRef(s, "b", true));
    if (out.status !== "accepted") throw new Error(out.status);
    expect(out.version.image.rights).toBe("external_runtime");
    expect((await h.db.get("images", out.version.image.id))!.rights).toBe("external_runtime");
  });

  it("the owner path is unchanged with false or omitted", async () => {
    const s = await start();
    const a = await acceptEdit(h, s, withRef(s, "b", false));
    const s2 = await start("d");
    const b = await acceptEdit(h, s2, withRef(s2, "c"));
    if (a.status !== "accepted" || b.status !== "accepted") throw new Error("refused");
    expect(a.version.image.rights).toBe("owner");
    expect(b.version.image.rights).toBe("owner");
    expect((await h.db.get("images", b.version.image.id))!.rights).toBe("owner");
  });

  it("a child of an external_runtime version stays external_runtime without webReference", async () => {
    const s0 = await start();
    const first = await acceptEdit(h, s0, withRef(s0, "b", true));
    if (first.status !== "accepted") throw new Error(first.status);
    const second = await acceptEdit(h, first.session, { ...inputFor(first.session, "seat", "Seat", "c"), webReference: false });
    if (second.status !== "accepted") throw new Error(second.status);
    expect(second.version.image.rights).toBe("external_runtime");
    expect((await h.db.get("images", second.version.image.id))!.rights).toBe("external_runtime");
  });

  it("a retry with the same ids keeps the rights", async () => {
    const s = await start();
    const ids = newAcceptIds();
    const first = await acceptEdit(h, s, withRef(s, "b", true, ids));
    const again = await acceptEdit(h, s, withRef(s, "b", true, ids));
    if (first.status !== "accepted" || again.status !== "accepted") throw new Error("refused");
    expect(again.idempotent).toBe(true);
    expect(again.version.image.rights).toBe("external_runtime");
    expect((await h.db.get("images", ids.imageId))!.rights).toBe("external_runtime");
  });

  it("such a version gets no folder file, an incomplete snapshot and no PDF picture", async () => {
    const s0 = await start();
    const out = await acceptEdit(h, s0, withRef(s0, "b", true));
    if (out.status !== "accepted") throw new Error(out.status);
    const { project, versions } = out.session;
    const plan = exportPlan({ project, versions, headId: out.version.id, exportedAt: "2026-10-30T10:00:00.000Z" });
    expect(plan.files.map((f) => f.imageId)).toEqual([versions.find((v) => v.parentId === null)!.image.id]);
    const snap = projectSnapshot({ project, versions, cutouts: [], masks: [], plan });
    expect(snap.complete).toBe(false);
    expect(planPdfImage({ slot: "after", rights: out.version.image.rights, format: "jpeg", mock: false }).action).toBe("refuse");
  });
});
