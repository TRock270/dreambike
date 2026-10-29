// Folder export write logic against in-memory fake directory/file handles (fake data only).
import { describe, expect, it, vi } from "vitest";
import { folderErrorText, isFolderExportSupported, saveProjectToFolder } from "@/lib/browser/folderExport";
import type { ExportPlan } from "@/lib/project";

type Content = Blob | string;
const sizeOf = (c: Content) => (typeof c === "string" ? new Blob([c]).size : c.size);

class FakeDir {
  files = new Map<string, Content>();
  dirs = new Map<string, FakeDir>();
  aborts = 0;
  failWriteFor: string | null = null;

  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) throw new DOMException("missing", "NotFoundError");
      d = new FakeDir();
      d.parent = this;
      this.dirs.set(name, d);
    }
    return d as unknown as FileSystemDirectoryHandle;
  }
  parent: FakeDir | null = null;
  async getFileHandle(name: string, opts?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!opts?.create) throw new DOMException("missing", "NotFoundError");
    }
    const files = this.files;
    const failFor = () => this.failWriteFor;
    const abort = () => { this.aborts++; };
    return {
      getFile: async () => ({ size: sizeOf(files.get(name)!) }),
      createWritable: async () => {
        let staged: Content | null = null;
        return {
          write: async (data: Content) => {
            if (failFor() === name) throw new Error("disk error");
            staged = data;
          },
          close: async () => { files.set(name, staged ?? ""); },
          abort: async () => { abort(); },
        };
      },
    } as unknown as FileSystemFileHandle;
  }
}

const webp = (n: number) => new Blob([new Uint8Array(n)], { type: "image/webp" });
const plan = (): ExportPlan => ({
  folderName: "Bike (abcd1234)",
  files: [
    { name: "00-start-a.webp", versionId: "v0", imageId: "i0" },
    { name: "01-frame-b.webp", versionId: "v1", imageId: "i1" },
  ],
  historyJson: '{"v":1}',
  historyMarkdown: "# Bike",
});
const reader = (m: Record<string, Blob | null>) => async (id: string) => m[id] ?? null;

async function setup() {
  const root = new FakeDir();
  const run = (images: Record<string, Blob | null>, p = plan()) =>
    saveProjectToFolder(root as unknown as FileSystemDirectoryHandle, p, reader(images));
  return { root, run, dir: () => root.dirs.get("Bike (abcd1234)")! };
}

describe("saveProjectToFolder", () => {
  it("first save writes every image and both history files", async () => {
    const { run, dir } = await setup();
    const r = await run({ i0: webp(10), i1: webp(20) });
    expect(r).toEqual({ written: 2, skipped: 0, missing: [], folderName: "Bike (abcd1234)" });
    expect([...dir().files.keys()].sort()).toEqual(
      ["00-start-a.webp", "01-frame-b.webp", "history.json", "history.md"]);
  });

  it("second save skips same-size files but rewrites history", async () => {
    const { run, dir } = await setup();
    await run({ i0: webp(10), i1: webp(20) });
    const p = plan();
    p.historyJson = '{"v":2}';
    const r = await run({ i0: webp(10), i1: webp(20) }, p);
    expect(r.written).toBe(0);
    expect(r.skipped).toBe(2);
    expect(dir().files.get("history.json")).toBe('{"v":2}');
  });

  it("rewrites a file whose size changed", async () => {
    const { run, dir } = await setup();
    await run({ i0: webp(10), i1: webp(20) });
    const r = await run({ i0: webp(10), i1: webp(25) });
    expect(r.written).toBe(1);
    expect(r.skipped).toBe(1);
    expect((dir().files.get("01-frame-b.webp") as Blob).size).toBe(25);
  });

  it("lists null and non-WebP blobs as missing and does not write them", async () => {
    const { run, dir } = await setup();
    const r = await run({ i0: null, i1: new Blob([new Uint8Array(5)], { type: "image/png" }) });
    expect(r.missing).toEqual(["00-start-a.webp", "01-frame-b.webp"]);
    expect(r.written).toBe(0);
    expect(dir().files.has("00-start-a.webp")).toBe(false);
    expect(dir().files.has("history.json")).toBe(true);
  });

  it("treats a throwing reader as missing", async () => {
    const { root } = await setup();
    const r = await saveProjectToFolder(root as unknown as FileSystemDirectoryHandle, plan(), async (id) => {
      if (id === "i0") throw new Error("boom");
      return webp(3);
    });
    expect(r.missing).toEqual(["00-start-a.webp"]);
    expect(r.written).toBe(1);
  });

  it("a failing image write aborts and leaves the old history.json", async () => {
    const { root, run, dir } = await setup();
    await run({ i0: webp(10), i1: webp(20) });
    dir().failWriteFor = "01-frame-b.webp";
    const p = plan();
    p.historyJson = '{"v":2}';
    await expect(run({ i0: webp(10), i1: webp(30) }, p)).rejects.toThrow("disk error");
    expect(dir().aborts).toBe(1);
    expect(dir().files.get("history.json")).toBe('{"v":1}');
    expect((dir().files.get("01-frame-b.webp") as Blob).size).toBe(20);
    expect(root.aborts).toBe(0);
  });

  it("reports progress per file", async () => {
    const { root } = await setup();
    const onProgress = vi.fn();
    await saveProjectToFolder(
      root as unknown as FileSystemDirectoryHandle, plan(), reader({ i0: webp(1), i1: webp(2) }), onProgress);
    expect(onProgress.mock.calls).toEqual([[1, 2], [2, 2]]);
  });
});

describe("folderErrorText", () => {
  it("maps known errors to plain words", () => {
    expect(folderErrorText(new DOMException("x", "AbortError"))).toBe("Folder choice cancelled.");
    expect(folderErrorText(new DOMException("x", "NotAllowedError"))).toMatch(/did not allow/);
    expect(folderErrorText(new DOMException("x", "SecurityError"))).toMatch(/did not allow/);
    expect(folderErrorText(new DOMException("x", "QuotaExceededError"))).toBe("The disk is full.");
    expect(folderErrorText(new TypeError("Name is not allowed."))).toMatch(/file name/);
  });
  it("falls back with the message", () => {
    expect(folderErrorText(new Error("weird"))).toContain("weird");
  });
});

describe("isFolderExportSupported", () => {
  it("is false in node", () => {
    expect(isFolderExportSupported()).toBe(false);
  });
});
