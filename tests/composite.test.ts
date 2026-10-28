// TypeScript composite math vs the Python reference (spike/imaging.py), plus
// the SPEC 7 fallback order. Offline; the parity part skips without .venv.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compositeParams, compositeRgb, dilate, driftCheck, feather, type RawRgb } from "@/lib/server/images";
import type { BinaryMask } from "@/lib/types";

function lcg(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1103515245 + 12345) >>> 0) >>> 24); }
function noise(w: number, h: number, seed: number): RawRgb {
  const next = lcg(seed); const data = new Uint8Array(w * h * 3);
  for (let i = 0; i < data.length; i++) data[i] = next();
  return { width: w, height: h, data };
}
function rect(w: number, h: number, l: number, t: number, r: number, b: number): BinaryMask {
  const pixels = new Uint8Array(w * h);
  for (let y = t; y < b; y++) for (let x = l; x < r; x++) pixels[y * w + x] = 1;
  return { width: w, height: h, pixels };
}

const W = 1536, H = 1152;
const base = noise(W, H, 11);
const oldMask = rect(W, H, 500, 400, 900, 700);
const newMask = rect(W, H, 520, 410, 910, 690);
// The edited image differs everywhere (+8 outside the part, like a slightly different render), so a
// test of "outside the feather support equals the base" cannot pass by accident.
const edited: RawRgb = { width: W, height: H, data: base.data.map((v) => Math.min(255, v + 8)) };
for (let i = 0; i < W * H; i++) if (oldMask.pixels[i]) { edited.data[i * 3] = 200; edited.data[i * 3 + 1] = 30; edited.data[i * 3 + 2] = 30; }

describe("composite fallbacks and protection (SPEC 7)", () => {
  it("composites and keeps every pixel outside the feather support identical to the base", () => {
    const res = compositeRgb(base, edited, oldMask, newMask, 1000, "paint", { width: W, height: H });
    expect([res.composed, res.reason]).toEqual([true, "composited"]);
    const { radius, sigma } = compositeParams(1000);
    const support = dilate(oldMask, radius + Math.ceil(3 * sigma) + 1);
    const support2 = dilate(newMask, radius + Math.ceil(3 * sigma) + 1);
    let changedOutside = 0;
    for (let i = 0; i < W * H; i++) {
      if (support.pixels[i] || support2.pixels[i]) continue;
      for (let c = 0; c < 3; c++) if (res.image.data[i * 3 + c] !== base.data[i * 3 + c]) changedOutside++;
    }
    expect(changedOutside).toBe(0);
    // ...and the band between the hard union and the support really does take edited pixels.
    const hard = dilate(oldMask, radius);
    let bandChanged = 0;
    for (let i = 0; i < W * H; i++) {
      if (!hard.pixels[i] || oldMask.pixels[i] || newMask.pixels[i]) continue;
      if (res.image.data[i * 3] !== base.data[i * 3]) bandChanged++;
    }
    expect(bandChanged).toBeGreaterThan(0);
    expect(res.drift).toBeGreaterThan(0.02);
    expect(res.drift).toBeLessThan(0.05);
    // The core of the part is fully the edited color.
    const core = (450 + 30) * W + 700;
    expect(Array.from(res.image.data.slice(core * 3, core * 3 + 3))).toEqual([200, 30, 30]);
  });

  it("takes the documented full-image path in SPEC order", () => {
    const run = (o: Partial<{ enabled: boolean; intent: "paint" | "geometry"; gen: { width: number; height: number };
      old: BinaryMask | null; neu: BinaryMask | null; ed: RawRgb }>) => compositeRgb(base, o.ed ?? edited,
      o.old === undefined ? oldMask : o.old, o.neu === undefined ? newMask : o.neu, 1000, o.intent ?? "paint",
      o.gen ?? { width: W, height: H }, o.enabled ?? true);
    expect(run({ enabled: false }).reason).toBe("disabled");
    expect(run({ intent: "geometry" }).reason).toBe("geometry");
    expect(run({ gen: { width: 1000, height: 750 } }).reason).toBe("small");
    expect(run({ gen: { width: 1536, height: 1100 } }).reason).toBe("aspect");
    expect(run({ neu: null }).reason).toBe("missing_mask");
    expect(run({ old: rect(W, H, 0, 0, W, H) }).reason).toBe("no_outside_area");
    const shifted: RawRgb = { width: W, height: H, data: base.data.map((v) => Math.min(255, v + 40)) };
    const drift = run({ ed: shifted });
    expect([drift.reason, drift.composed, (drift.drift ?? 0) > 0.05]).toEqual(["drift", false, true]);
    expect(() => run({ ed: noise(W - 2, H, 1) })).toThrow();
    expect(() => run({ neu: rect(W - 1, H, 0, 0, 5, 5) })).toThrow();
  });

  it("drift is exactly 0 when only excluded pixels change and null with no outside pixels", () => {
    const insideOnly: RawRgb = { width: W, height: H, data: base.data.slice() };
    for (let i = 0; i < W * H; i++) if (oldMask.pixels[i]) insideOnly.data[i * 3] = 0;
    expect(driftCheck(base.data, insideOnly.data, dilate(oldMask, 1)).score).toBe(0);
    expect(driftCheck(base.data, edited.data, rect(W, H, 0, 0, W, H)).score).toBeNull();
  });
});

const python = path.join(process.cwd(), ".venv/bin/python");
describe.skipIf(!existsSync(python))("TypeScript matches the Python reference", () => {
  it("dilate, feather, drift, and the blended pixels agree", () => {
    const w = 320, h = 240;
    const b = noise(w, h, 5), e = noise(w, h, 6);
    const om = rect(w, h, 90, 60, 200, 150), nm = rect(w, h, 100, 70, 210, 160);
    // Paint-like edit: only inside the old part, so drift stays low and composition runs.
    // Outside the part the edit differs by +6 so the parity also covers a non-zero drift.
    const ed: RawRgb = { width: w, height: h, data: b.data.map((v) => Math.min(255, v + 6)) };
    for (let i = 0; i < w * h; i++) if (om.pixels[i]) for (let c = 0; c < 3; c++) ed.data[i * 3 + c] = e.data[i * 3 + c]!;
    const dir = mkdtempSync(path.join(tmpdir(), "dreambike-parity-"));
    writeFileSync(path.join(dir, "base.bin"), b.data); writeFileSync(path.join(dir, "edited.bin"), ed.data);
    writeFileSync(path.join(dir, "old.bin"), om.pixels); writeFileSync(path.join(dir, "new.bin"), nm.pixels);
    const script = `
import sys, json, numpy as np
sys.path.insert(0, 'spike')
import imaging
d, w, h = sys.argv[1], ${w}, ${h}
rd = lambda n, s: np.frombuffer(open(f'{d}/{n}.bin','rb').read(), dtype=np.uint8).reshape(s)
base, ed = rd('base', (h, w, 3)), rd('edited', (h, w, 3))
om, nm = rd('old', (h, w)).astype(bool), rd('new', (h, w)).astype(bool)
open(f'{d}/dil.bin','wb').write(imaging.dilate(om, 7).astype(np.uint8).tobytes())
open(f'{d}/fea.bin','wb').write(imaging.feather(om, 3.0).tobytes())
s, n = imaging.drift_check(base, ed, imaging.dilate(om, 2))
r = imaging.composite(base, ed, om, nm, 1000, 'paint', (2048, 1536))
open(f'{d}/out.bin','wb').write(r.image.astype(np.uint8).tobytes())
print(json.dumps({'drift': s, 'reason': r.reason, 'cdrift': r.drift}))`;
    // The aspect check uses the generated size; 2048x1536 has the same 4:3 aspect as 320x240.
    const py = JSON.parse(execFileSync(python, ["-I", "-c", script, dir], { cwd: process.cwd() }).toString());
    expect(Array.from(dilate(om, 7).pixels)).toEqual(Array.from(readFileSync(path.join(dir, "dil.bin"))));
    const tsFeather = feather(om, 3.0), pyFeather = readFileSync(path.join(dir, "fea.bin"));
    let maxDiff = 0;
    for (let i = 0; i < tsFeather.length; i++) maxDiff = Math.max(maxDiff, Math.abs(tsFeather[i]! - pyFeather[i]!));
    expect(maxDiff).toBeLessThanOrEqual(1); // float summation order may move a .5 boundary by one step
    expect(Math.abs(driftCheck(b.data, ed.data, dilate(om, 2)).score! - py.drift)).toBeLessThan(1e-9);
    const ts = compositeRgb(b, ed, om, nm, 1000, "paint", { width: 2048, height: 1536 });
    expect([ts.reason, py.reason]).toEqual(["composited", "composited"]);
    const pyOut = readFileSync(path.join(dir, "out.bin"));
    let worst = 0;
    for (let i = 0; i < pyOut.length; i++) worst = Math.max(worst, Math.abs(ts.image.data[i]! - pyOut[i]!));
    expect(worst).toBeLessThanOrEqual(1);
    expect(Math.abs(ts.drift! - py.cdrift)).toBeLessThan(1e-9);
    expect(ts.drift!).toBeGreaterThan(0.01);
  });
});
