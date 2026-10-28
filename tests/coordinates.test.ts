import { describe, expect, it } from "vitest";
import { dragToImageBox, displayedRect, hitTest, screenToImage, type BinaryMask, type HitPart } from "@/lib/coordinates";

const image = { width: 2000, height: 1500 };

describe("screenToImage with contain-fit letterboxing", () => {
  it("maps through vertical and horizontal letterboxes and rejects the bars", () => {
    // Wide container: bars left and right.
    expect(screenToImage({ x: 500, y: 250 }, { left: 0, top: 0, width: 1000, height: 500 }, image)).toEqual({ x: 1000, y: 750 });
    expect(screenToImage({ x: 100, y: 250 }, { left: 0, top: 0, width: 1000, height: 500 }, image)).toBeNull();
    // Tall container: bars top and bottom.
    expect(screenToImage({ x: 150, y: 300 }, { left: 0, top: 0, width: 300, height: 600 }, image)).toEqual({ x: 1000, y: 750 });
    expect(screenToImage({ x: 150, y: 10 }, { left: 0, top: 0, width: 300, height: 600 }, image)).toBeNull();
  });

  it("lands within 3 px at two canvas sizes, including fractional CSS sizes and offsets", () => {
    for (const container of [{ left: 37.25, top: 12.5, width: 1280.4, height: 720.6 }, { left: 0, top: 0, width: 641, height: 1003 }]) {
      const shown = displayedRect(container, image)!;
      for (const [tx, ty] of [[0, 0], [1999, 1499], [1234, 567], [3, 1490]] as const) {
        const sx = shown.left + ((tx + 0.5) / image.width) * shown.width;
        const sy = shown.top + ((ty + 0.5) / image.height) * shown.height;
        const got = screenToImage({ x: sx, y: sy }, container, image)!;
        expect(Math.hypot(got.x - tx, got.y - ty)).toBeLessThanOrEqual(3);
      }
    }
  });

  it("treats the right/bottom photo edge as exclusive and clamps to width-1/height-1", () => {
    const c = { left: 0, top: 0, width: 1000, height: 500 };
    const shown = displayedRect(c, image)!;
    expect(screenToImage({ x: shown.left + shown.width - 0.001, y: 499.999 }, c, image)).toEqual({ x: 1999, y: 1499 });
    expect(screenToImage({ x: shown.left + shown.width + 1e-6, y: 250 }, c, image)).toBeNull();
    expect(screenToImage({ x: 1, y: 1 }, { left: 0, top: 0, width: 0, height: 0 }, image)).toBeNull();
  });
});

describe("hitTest", () => {
  const W = 20, H = 10;
  const rect = (l: number, t: number, r: number, b: number): BinaryMask => {
    const pixels = new Uint8Array(W * H);
    for (let y = t; y < b; y++) for (let x = l; x < r; x++) pixels[y * W + x] = 1;
    return { width: W, height: H, pixels };
  };
  const part = (id: string, mask: BinaryMask, stale = false): HitPart =>
    ({ id, slot: "custom", mask, stale, area: mask.pixels.reduce((a, v) => a + v, 0) });

  it("picks the smallest containing mask, skips stale and wrong-size masks", () => {
    const bike = part("bike", rect(0, 0, 20, 10));
    const tank = part("tank", rect(5, 2, 9, 5));
    const staleTiny = part("old", rect(6, 3, 7, 4), true);
    const otherImage = part("other", { width: 21, height: 10, pixels: new Uint8Array(210).fill(1) });
    const parts = [bike, tank, staleTiny, otherImage];
    expect(hitTest(parts, { x: 6, y: 3 }, { width: W, height: H })?.id).toBe("tank");
    expect(hitTest(parts, { x: 15, y: 8 }, { width: W, height: H })?.id).toBe("bike");
    // Half-open: column 9 is outside the tank rect [5, 9).
    expect(hitTest([tank], { x: 9, y: 3 }, { width: W, height: H })).toBeNull();
  });
});

describe("hitTest image identity", () => {
  it("never selects a same-size mask that belongs to another photo", () => {
    const pixels = new Uint8Array(20 * 10).fill(1);
    const part = { id: "old", slot: "tank" as const, mask: { width: 20, height: 10, pixels }, area: 200, stale: false, imageHash: "photo-a" };
    expect(hitTest([part], { x: 3, y: 3 }, { width: 20, height: 10, hash: "photo-b" })).toBeNull();
    expect(hitTest([part], { x: 3, y: 3 }, { width: 20, height: 10, hash: "photo-a" })?.id).toBe("old");
  });
});

describe("dragToImageBox", () => {
  const img = { width: 1000, height: 500 };
  const tall = { left: 0, top: 0, width: 1000, height: 1000 };  // shown 1000x500 at top 250, scale 1 (bars above and below)
  const wide = { left: 0, top: 0, width: 1000, height: 250 };   // shown 500x250 at left 250, scale 2 (bars left and right)
  it("maps a drag through a vertical letterbox to a half-open box", () => {
    expect(dragToImageBox({ x: 100, y: 300 }, { x: 300, y: 400 }, tall, img)).toEqual([100, 50, 301, 151]);
  });
  it("maps a drag through a horizontal letterbox, corners in any order", () => {
    expect(dragToImageBox({ x: 350, y: 50 }, { x: 450, y: 150 }, wide, img)).toEqual([200, 100, 401, 301]);
    expect(dragToImageBox({ x: 450, y: 150 }, { x: 350, y: 50 }, wide, img)).toEqual([200, 100, 401, 301]);
  });
  it("clamps an end point in the letterbox or outside the element to the photo edge", () => {
    expect(dragToImageBox({ x: 500, y: 500 }, { x: 5000, y: 5000 }, tall, img)).toEqual([500, 250, 1000, 500]);
    expect(dragToImageBox({ x: 500, y: 500 }, { x: -50, y: 0 }, tall, img)).toEqual([0, 0, 501, 251]);

    expect(dragToImageBox({ x: 400, y: 125 }, { x: 0, y: 625 }, wide, img)).toEqual([0, 250, 301, 500]);
  });
  it("returns null when a side is under 8 image px, at two container sizes", () => {
    expect(dragToImageBox({ x: 100, y: 300 }, { x: 106, y: 400 }, tall, img)).toBeNull();   // 7 px wide
    expect(dragToImageBox({ x: 100, y: 300 }, { x: 107, y: 400 }, tall, img)).toEqual([100, 50, 108, 151]);
    expect(dragToImageBox({ x: 350, y: 50 }, { x: 353, y: 150 }, wide, img)).toBeNull();    // 2 px * 2 = 4 + 1 wide
    expect(dragToImageBox({ x: 350, y: 50 }, { x: 357, y: 150 }, wide, img)).toEqual([200, 100, 215, 301]);
  });
});
