// Pure part-map derivation: facing and bike choices survive late detection results.
import { describe, expect, it } from "vitest";
import { derive, emptyPartMap, partsForPhrase, type PartMapState } from "@/lib/browser/partMap";
import type { BinaryMask, SegmentedObject } from "@/lib/types";

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
  it("ignores point parts from another photo", () => {
    const s = withResults({ ...emptyPartMap("h2"), bikeStatus: "none" }, "fuel tank", []);
    const stray = { id: "point:tank:9", slot: "tank" as const, label: "Tank", mask: rect(1, 1, 5, 5), area: 16,
      box: [1, 1, 5, 5] as [number, number, number, number], source: "point" as const, confidence: null, stale: false, imageHash: "h1" };
    expect(derive({ ...s, pointParts: [stray] }).parts).toEqual([]);
  });
});
