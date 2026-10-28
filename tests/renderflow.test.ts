import { afterEach, describe, expect, it, vi } from "vitest";
import { requestEdit } from "@/lib/browser/renderClient";
import { requestInstruction, type InstructionRequest } from "@/lib/browser/sparkClient";
import { unknownBike } from "@/lib/bikeForm";
import { derive, emptyPartMap, partMapAfterEdit, refreshedPart } from "@/lib/browser/partMap";
import { FALLBACK_TEXT, willSkipBlend } from "@/lib/browser/renderFlow";
import { boxIoU, chooseCandidate, interiorPoint } from "@/lib/parts";

describe("matching the edited part again (SPEC 7)", () => {
  it("picks the greatest IoU, then the closest center; refuses implausible or ambiguous matches", () => {
    const old: [number, number, number, number] = [100, 100, 200, 200];
    expect(chooseCandidate(old, [[0, 0, 50, 50], [105, 98, 205, 203], [150, 150, 300, 300]])).toBe(1);
    expect(chooseCandidate(old, [[0, 0, 50, 50]])).toBeNull();
    expect(chooseCandidate(old, [[100, 100, 200, 200], [100, 100, 200, 200]])).toBeNull();
    expect(chooseCandidate(old, [])).toBeNull();
    expect(boxIoU([0, 0, 10, 10], [5, 0, 15, 10])).toBeCloseTo(1 / 3);
  });
  it("finds an interior point near the box center, even for a ring-shaped mask", () => {
    const w = 20, h = 20, pixels = new Uint8Array(w * h);
    for (let y = 2; y < 18; y++) for (let x = 2; x < 18; x++) if (x < 5 || x > 14 || y < 5 || y > 14) pixels[y * w + x] = 1;
    const p = interiorPoint({ width: w, height: h, pixels }, [2, 2, 18, 18])!;
    expect(pixels[p.y * w + p.x]).toBe(1);
    expect(interiorPoint({ width: w, height: h, pixels: new Uint8Array(w * h) }, [0, 0, 20, 20])).toBeNull();
  });
});

describe("client-side blend skip matches the server order", () => {
  it("skips SAM for geometry, small, and aspect", () => {
    const base = { width: 2048, height: 1536 };
    expect(willSkipBlend("geometry", base, base)).toBe(true);
    expect(willSkipBlend("paint", { width: 1000, height: 750 }, base)).toBe(true);
    expect(willSkipBlend("paint", { width: 2000, height: 1250 }, base)).toBe(true);
    expect(willSkipBlend("paint", { width: 1536, height: 1152 }, base)).toBe(false); // same 4:3, short edge ≥ 1024
  });
  it("uses the exact SPEC fallback wording and has a text for every non-blended reason", () => {
    expect(FALLBACK_TEXT.drift).toBe("The model moved the bike. Showing the full edit.");
    expect(FALLBACK_TEXT.geometry).toBe("Shape change: showing the full edit.");
    for (const reason of ["drift", "geometry", "small", "aspect", "missing_mask", "no_outside_area", "disabled"] as const) {
      expect(FALLBACK_TEXT[reason], reason).toMatch(/Showing the full edit\.$|showing the full edit\.$/);
    }
  });
});

describe("after an accepted edit", () => {
  it("keeps facing, marks other parts stale, and offers only the refreshed part", () => {
    const before = { ...emptyPartMap("old"), facing: "right" as const };
    const mask = { width: 10, height: 10, pixels: new Uint8Array(100).fill(0).map((_, i) => (i === 55 ? 1 : 0)) };
    const part = refreshedPart("tank", "Tank", mask, "new")!;
    const after = partMapAfterEdit(before, "new", part, true);
    const view = derive(after);
    expect(after.facing).toBe("right");
    expect(Object.values(view.phrases).every((s) => s === "stale")).toBe(true);
    expect(view.parts.map((p) => [p.slot, p.imageHash])).toEqual([["tank", "new"]]);
    expect(derive(partMapAfterEdit(before, "new", null, true)).parts).toEqual([]);
  });
});

describe("bike outline after an accepted same-size edit", () => {
  it("keeps the previous outline until the recut replaces it; a size change drops it", () => {
    const mask = { width: 10, height: 10, pixels: new Uint8Array(100).map((_, i) => (i % 10 > 1 && i % 10 < 8 ? 1 : 0)) };
    const before = { ...emptyPartMap("old"), bikeCandidates: [{ mask, box: [2, 0, 8, 10] as [number, number, number, number], confidence: 0.9 }], bikeChoice: 0 as const, bikeStatus: "found" as const };
    expect(derive(partMapAfterEdit(before, "new", null, true)).bike?.box).toEqual([2, 0, 8, 10]);
    expect(derive(partMapAfterEdit(before, "new", null, false)).bike).toBeNull();
  });
});

describe("reference part in the request forms", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Stub fetch, run the call (it fails on the fake answer, which is fine), and return the form that was sent. */
  async function sentForm(call: () => Promise<unknown>): Promise<FormData | null> {
    let sent: FormData | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sent = init.body as FormData;
      return new Response("{}", { status: 500 });
    }));
    await call().catch(() => undefined);
    return sent;
  }
  const base = { blob: new Blob(["base"]), width: 400, height: 300, hash: "h" };
  const ref = new Blob(["ref"], { type: "image/webp" });
  const edit = (mode: "text" | "paint" | "reference", r: Blob | null) => requestEdit(base,
    { slot: "wheel_front", prompt: "p", mode, intent: "geometry", quality: "high" }, "id", undefined, r);
  const instr = (mode: "text" | "paint" | "reference", r: Blob | null) => requestInstruction(
    { slot: "wheel_front", box: [0, 0, 10, 10], bike: unknownBike(), mode, text: "t", width: 400, height: 300 } satisfies InstructionRequest,
    undefined, r);

  it("edit sends exactly one reference part after the base, only in reference mode", async () => {
    const form = (await sentForm(() => edit("reference", ref)))!;
    expect([...form.keys()]).toEqual(["payload", "base", "reference"]);
    expect(form.getAll("reference")).toHaveLength(1);
    for (const mode of ["text", "paint"] as const) {
      expect([...(await sentForm(() => edit(mode, ref)))!.keys()]).toEqual(["payload", "base"]);
    }
  });

  it("instruction sends exactly one reference part only in reference mode", async () => {
    expect((await sentForm(() => instr("reference", ref)))!.getAll("reference")).toHaveLength(1);
    for (const mode of ["text", "paint"] as const) {
      expect((await sentForm(() => instr(mode, ref)))!.has("reference")).toBe(false);
    }
  });

  it("reference mode without a reference never reaches the network", async () => {
    expect(await sentForm(() => edit("reference", null))).toBeNull();
    expect(await sentForm(() => instr("reference", null))).toBeNull();
  });
});
