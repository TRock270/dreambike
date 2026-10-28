// Pure part-map derivation: facing and bike choices survive late detection results.
import { describe, expect, it } from "vitest";
import { binaryToStoredMask, derive, emptyPartMap, partMapAfterEdit, partsForPhrase, partsToPersisted, restoredPartMap, storedMaskToBinary, type PartMapState } from "@/lib/browser/partMap";
import { hitTest } from "@/lib/coordinates";
import { maskArea, maskBox } from "@/lib/parts";
import { CORE_PHRASES } from "@/lib/slots";
import type { BinaryMask, MapPart, Part, SegmentedObject, SlotId } from "@/lib/types";

const W = 100, H = 50;
function rect(l: number, t: number, r: number, b: number): BinaryMask {
  const pixels = new Uint8Array(W * H);
  for (let y = t; y < b; y++) for (let x = l; x < r; x++) pixels[y * W + x] = 1;
  return { width: W, height: H, pixels };
}
const obj = (m: BinaryMask): SegmentedObject => ({ mask: m, box: [0, 0, 1, 1], confidence: 0.9 });
const bike = obj(rect(10, 10, 90, 45));
const wheels = [obj(rect(12, 25, 32, 45)), obj(rect(68, 25, 88, 45))];

function withResults(s: PartMapState, phrase: string, objects: SegmentedObject[]): PartMapState {
  return { ...s, requests: { ...s.requests, [phrase]: "done" }, raw: { ...s.raw, [phrase]: objects } };
}

const PHOTO = { hash: "h2", width: W, height: H };

describe("derive", () => {
  it("asks for facing, then assigns wheels; a later result does not undo the answer", () => {
    let s: PartMapState = { ...emptyPartMap("h1"), bikeCandidates: [bike], bikeChoice: 0, bikeStatus: "found" };
    s = withResults(s, "wheel", wheels);
    expect(derive(s).phrases.wheel).toBe("needs_facing");
    s = { ...s, facing: "right" };                              // mechanic answers while detection runs
    s = withResults(s, "fuel tank", [obj(rect(40, 12, 60, 20))]); // a late phrase arrives afterwards
    const view = derive(s);
    expect(view.parts.map((p) => p.id).sort()).toEqual(["fuel tank:tank", "wheel:wheel_front", "wheel:wheel_rear"]);
    expect(view.parts.find((p) => p.slot === "wheel_front")!.box[0]).toBe(68); // facing right: front on the right
    expect(view.parts.every((p) => p.imageHash === "h1")).toBe(true);
  });

  it("unions plural objects into one slot and re-derives when the bike changes", () => {
    let s: PartMapState = { ...emptyPartMap("h1"), bikeCandidates: [bike, obj(rect(0, 0, 40, 20))], bikeChoice: 0, bikeStatus: "found" };
    s = withResults(s, "mirror", [obj(rect(20, 10, 24, 14)), obj(rect(70, 10, 74, 14))]);
    const mirrors = derive(s).parts.find((p) => p.slot === "mirrors")!;
    expect(mirrors.area).toBe(32);
    s = { ...s, bikeChoice: 1 }; // the mechanic switches to the other bike: only one mirror lies on it
    expect(derive(s).parts.find((p) => p.slot === "mirrors")!.area).toBe(16);
  });

  it("does not clip or apply the 60% rule without a bike, and keeps a point part over the detected one", () => {
    const s = withResults({ ...emptyPartMap("h1"), bikeStatus: "none" }, "fuel tank", [obj(rect(0, 0, 100, 50))]);
    expect(partsForPhrase("fuel tank", s.raw["fuel tank"]!, null, "unknown", "h1").status).toBe("found");
    const point = { ...derive(s).parts[0]!, id: "point:tank:1", source: "point" as const };
    const v = derive({ ...s, pointParts: [point] });
    expect(v.parts.map((p) => p.id)).toEqual(["point:tank:1"]);
  });
});

describe("review fixes", () => {
  it("rejects a union of plural objects that covers most of the bike", () => {
    const r = partsForPhrase("mirror", [obj(rect(10, 10, 50, 45)), obj(rect(50, 10, 90, 45))], rect(10, 10, 90, 45), "unknown", "h1");
    expect(r.status).toBe("needs_point");
  });
  it("needs a point for two wheel candidates when there is no bike outline", () => {
    expect(partsForPhrase("wheel", wheels, null, "right", "h1").status).toBe("needs_point");
  });
  it("ignores a small wheel fragment, so two real wheels are still assigned", () => {
    // Live 2026-10-28 on an edited photo: two wheels plus a small fragment above the rear wheel.
    const fragment = obj(rect(30, 12, 38, 16));                 // 32 px vs 400 px wheels
    const r = partsForPhrase("wheel", [...wheels, fragment], bike.mask, "right", "h1");
    expect(r.status).toBe("found");
    expect(r.parts.map((p) => [p.slot, p.box[0]])).toEqual([["wheel_front", 68], ["wheel_rear", 12]]);
    // A third candidate of wheel size still asks for a point, as before.
    expect(partsForPhrase("wheel", [...wheels, obj(rect(40, 25, 58, 45))], bike.mask, "right", "h1").status).toBe("needs_point");
    // Fenders keep small candidates (front and rear fenders can differ a lot in size).
    expect(partsForPhrase("fender", [obj(rect(12, 20, 32, 24)), obj(rect(68, 22, 72, 24))], bike.mask, "right", "h1").status).toBe("found");
  });
  it("ignores point parts from another photo", () => {
    const s = withResults({ ...emptyPartMap("h2"), bikeStatus: "none" }, "fuel tank", []);
    const stray = { id: "point:tank:9", slot: "tank" as const, label: "Tank", mask: rect(1, 1, 5, 5), area: 16,
      box: [1, 1, 5, 5] as [number, number, number, number], source: "point" as const, confidence: null, stale: false, imageHash: "h1" };
    expect(derive({ ...s, pointParts: [stray] }).parts).toEqual([]);
  });
});

describe("stale parts and persistence", () => {
  const box = (m: BinaryMask) => maskBox(m)!;
  const mk = (id: string, slot: SlotId, m: BinaryMask, hash: string, stale: boolean): MapPart =>
    ({ id, slot, label: slot, mask: m, area: maskArea(m), box: box(m), source: "point", confidence: null, stale, imageHash: hash });
  const bikeMask = rect(10, 10, 90, 45);
  const base = (): PartMapState => ({ ...emptyPartMap("h2"), bikeCandidates: [obj(bikeMask)], bikeChoice: 0, bikeStatus: "found", done: true,
    requests: Object.fromEntries(CORE_PHRASES.map((p) => [p, "stale"])) });

  it("derive keeps a stale part but it is not selectable, and hitTest ignores it", () => {
    const stale = mk("point:tank:1", "tank", rect(40, 12, 60, 20), "h1", true);
    const view = derive({ ...base(), pointParts: [stale] });
    const kept = view.parts.find((p) => p.id === stale.id)!;
    expect(kept.stale).toBe(true);
    expect(kept.imageHash).toBe("h1");
    expect(view.phrases["fuel tank"]).toBe("stale");
    expect(hitTest(view.parts, { x: 50, y: 15 }, { width: W, height: H })).toBeNull();
  });

  it("a fresh part for the same slot replaces the stale one", () => {
    const stale = mk("point:tank:1", "tank", rect(40, 12, 60, 20), "h1", true);
    const fresh = mk("point:tank:2", "tank", rect(42, 12, 58, 20), "h2", false);
    const view = derive({ ...base(), pointParts: [stale, fresh] });
    expect(view.parts.map((p) => p.id)).toEqual(["point:tank:2"]);
    expect(view.phrases["fuel tank"]).toBe(base().requests["fuel tank"]);
  });

  it("partMapAfterEdit carries other parent parts as stale and matches the restored map", () => {
    const tank = mk("point:tank:1", "tank", rect(40, 12, 60, 20), "h1", false);
    const seat = mk("point:seat:1", "seat", rect(20, 12, 35, 20), "h1", false);
    const prev = { ...base(), imageHash: "h1", pointParts: [tank, seat] };
    const refreshed = mk("point:seat:accepted:h2", "seat", rect(20, 12, 36, 20), "h2", false);
    const after = partMapAfterEdit(prev, "h2", refreshed, true);
    const v = derive(after);
    expect(v.parts.map((p) => [p.slot, p.stale]).sort()).toEqual([["seat", false], ["tank", true]]);
    expect(partMapAfterEdit(prev, "h2", refreshed, false).pointParts).toEqual([refreshed]);

    // persist, then restore: the same view comes back
    let n = 0;
    const saved = partsToPersisted(v, "h2", () => `m${n++}`, 5);
    const byId = new Map(saved.masks.map((m) => [m.id, m]));
    const restored = restoredPartMap(PHOTO, v.bike!.mask,
      saved.parts.map((part) => ({ part, mask: byId.get(part.maskId)! })), "unknown");
    const again = derive(restored);
    expect(again.parts.map((p) => [p.id, p.stale, p.imageHash])).toEqual(v.parts.map((p) => [p.id, p.stale, p.imageHash]));
    for (const p of v.parts) expect(Array.from(again.parts.find((q) => q.id === p.id)!.mask.pixels)).toEqual(Array.from(p.mask.pixels));
  });

  it("does not persist a carried-over bike outline under the new hash", () => {
    const prev = { ...base(), imageHash: "h1" };
    const after = partMapAfterEdit(prev, "h2", null, true);
    const v = derive(after);
    expect(v.bike).not.toBeNull();
    expect(partsToPersisted(v, "h2", () => "x", 1).bikeMask).toBeNull();
    const recut = { ...after, bikeCarried: false };
    expect(partsToPersisted(derive(recut), "h2", () => "x", 1).bikeMask).not.toBeNull();
  });

  it("round-trips masks bit-exactly and keeps old ids for stale parts", () => {
    const m = rect(3, 4, 17, 9);
    m.pixels[0] = 1; m.pixels[W * H - 1] = 1; // border pixels
    const stored = binaryToStoredMask(m, "h2", "mk", 7);
    expect(stored.pixels.length).toBe(W * H);
    expect(Array.from(storedMaskToBinary(stored, "h2").pixels)).toEqual(Array.from(m.pixels));
    const stale = mk("point:tank:1", "tank", rect(40, 12, 60, 20), "h1", true);
    const out = partsToPersisted({ bike: null, parts: [stale], phrases: {} }, "h2", () => "new", 1, new Map([["point:tank:1", "old-mask"]]));
    expect(out.parts[0]!.maskId).toBe("old-mask");
    expect(out.masks).toEqual([]);
  });

  it("rejects masks with the wrong size, wrong hash, or non-binary bytes", () => {
    const good = binaryToStoredMask(rect(1, 1, 5, 5), "h2", "mk", 1);
    expect(() => storedMaskToBinary({ ...good, pixels: good.pixels.slice(1) })).toThrow(/bytes/);
    expect(() => storedMaskToBinary(good, "other")).toThrow(/another photo/);
    const bad = good.pixels.slice(); bad[3] = 2;
    expect(() => storedMaskToBinary({ ...good, pixels: bad })).toThrow(/0 or 1/);
    expect(() => binaryToStoredMask({ width: 2, height: 2, pixels: new Uint8Array(3) }, "h2", "x", 1)).toThrow();
    const part: Part = { id: "p", slot: "tank", label: "Tank", box: [1, 1, 5, 5], maskId: "mk", area: 16, source: "point", confidence: null, stale: false };
    expect(() => restoredPartMap({ ...PHOTO, hash: "h3" }, null, [{ part, mask: good }], "unknown")).toThrow(/another photo/);
    const small = { ...binaryToStoredMask({ width: 4, height: 4, pixels: new Uint8Array(16) }, "h2", "s", 1) };
    expect(() => restoredPartMap(PHOTO, bikeMask, [{ part, mask: small }], "unknown")).toThrow(/photo size/);
    // no bike: the photo size is still enforced, fresh and stale
    expect(() => restoredPartMap(PHOTO, null, [{ part, mask: small }], "unknown")).toThrow(/photo size/);
    const oldSmall = { ...small, imageHash: "h1" };
    expect(() => restoredPartMap(PHOTO, null, [{ part: { ...part, stale: true }, mask: oldSmall }], "unknown")).toThrow(/photo size/);
    expect(() => restoredPartMap(PHOTO, { width: 4, height: 4, pixels: new Uint8Array(16) }, [], "unknown")).toThrow(/bike outline/);
  });

  it("a restored map shows 'stale', never 'pending', and runs nothing", () => {
    const m = binaryToStoredMask(rect(40, 12, 60, 20), "h2", "mk", 1);
    const part: Part = { id: "point:tank:1", slot: "tank", label: "Tank", box: [40, 12, 60, 20], maskId: "mk", area: 160, source: "point", confidence: null, stale: false };
    const s = restoredPartMap(PHOTO, bikeMask, [{ part, mask: m }], "right");
    expect(s.done).toBe(true);
    expect(s.facing).toBe("right");
    const v = derive(s);
    expect(v.phrases["fuel tank"]).toBe("stale");
    expect(v.parts.map((p) => p.id)).toEqual(["point:tank:1"]);
    expect(v.phrases["wheel"]).toBe("stale");
    expect(Object.values(v.phrases)).not.toContain("pending");
    expect(hitTest(v.parts, { x: 50, y: 15 }, { width: W, height: H, hash: "h2" })?.id).toBe("point:tank:1");
    expect(derive(restoredPartMap(PHOTO, null, [], "unknown")).phrases["wheel"]).toBe("stale");
  });
});
