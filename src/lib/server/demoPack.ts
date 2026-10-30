// Packs a saved project folder into public/demo (SPEC 13). Server-only and run by the lead from
// an env-gated test block, never from the app: it reads the owner's saved folder, keeps the
// root-to-head path, writes v<n>.webp, 1-bit PNG masks, project.json and the example quote.
// The pure pruning lives in src/lib/demo.ts (browser-safe); this file adds fs, sharp and checks.
import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { DemoManifest as DemoManifestSchema, Id, Note, ProjectSnapshot as ProjectSnapshotSchema, Short } from "../contracts";
import { pruneDemoSnapshot } from "../demo";
import { MOCK_LABEL } from "../mocks";
import { fitInputHash, fitReviewHash, LEGAL_SEED } from "../project";
import { EXAMPLE_SETTINGS } from "../quote";
import type { DemoManifest, DemoProvenanceData, ProjectSnapshot, ShopSettings, Version } from "../types";

export class DemoPackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoPackError";
  }
}

/**
 * What the lead supplies as DEMO_PROVENANCE. entries come from the budget ledger (one per
 * generated version); anything missing is written as "unknown", never guessed.
 */
export const ProvenanceInput = z.object({
  // One row per ledger call; several rows may share a versionId (instruction + edit).
  entries: z.array(z.object({ versionId: Id, route: Short.default("unknown"), model: Short, at: z.iso.datetime() }).strict()).max(40),
  // Calls behind masks, cutouts and the fit check (no single version owns them).
  assetCalls: z.array(z.object({ route: Short, model: Short, at: z.iso.datetime() }).strict()).max(20).default([]),
  promptFiles: z.array(z.object({ file: Short, version: Short }).strict()).max(20),
  rights: z.object({ credit: Short, clearance: Note.min(1).max(200) }).strict(),
}).strict();
export type ProvenanceInputData = z.infer<typeof ProvenanceInput>;

export type PackOptions = {
  /** A "Save project to folder" directory: project.json, images, masks/<id>.bin, quote.pdf. */
  srcDir: string;
  outDir: string;
  cachedAt: string;
  provenance: ProvenanceInputData;
  /** The shop settings the fit hashes were made with. Defaults to the example shop. */
  settings?: ShopSettings;
  quotePdfPath?: string;
};

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

// ----------------------------------------------------------------- mask PNGs

/** 0/1 bytes to a 1-bit palette PNG (black/white). */
export async function maskToPng(pixels: Uint8Array, width: number, height: number): Promise<Buffer> {
  if (pixels.length !== width * height) throw new DemoPackError("Mask size does not match its pixels.");
  const gray = Buffer.from(Uint8Array.from(pixels, (v) => (v === 1 ? 255 : 0)));
  return sharp(gray, { raw: { width, height, channels: 1 } })
    .toColourspace("b-w")  // Two colours make sharp write a 1-bit palette PNG (the tests check the IHDR bit depth).
    .png({ palette: true, colours: 2 }).toBuffer();
}

/** The inverse, same rule as the browser decoder: red channel above 127 is 1. */
export async function pngToMask(png: Uint8Array): Promise<{ width: number; height: number; pixels: Uint8Array }> {
  const { data, info } = await sharp(png).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, pixels: Uint8Array.from(data, (v) => (v > 127 ? 1 : 0)) };
}

// ----------------------------------------------------------------- fit hashes

/**
 * The head's fit results must still be valid with the example settings: the build's fit input
 * hash recomputes, every acknowledged review hash matches, and the inspection review points at
 * the current hash. Older versions are history and may hold older hashes, so only the head counts.
 * Returns the problems found (empty = valid).
 */
export async function fitHashProblems(
  head: Version, bikeRevision: Parameters<typeof fitInputHash>[0], settings: ShopSettings,
): Promise<string[]> {
  const problems: string[] = [];
  const current = await fitInputHash(bikeRevision, head.items, settings.shopRules, LEGAL_SEED.version);
  for (const item of head.items) {
    if (item.fit === null) continue;
    if (item.fitInputHash !== current) problems.push(`${item.slot}: fit input hash does not recompute with the example settings`);
    if (item.fitReviewedHash !== null) {
      const ok = item.fitReviewedHash === (await fitReviewHash(item, false)) || item.fitReviewedHash === (await fitReviewHash(item, true));
      if (!ok) problems.push(`${item.slot}: fit review hash does not match the fit result`);
    }
  }
  if (head.inspectionReview && head.inspectionReview.fitInputHash !== current) {
    problems.push("inspection review does not match the current fit input hash");
  }
  return problems;
}

// ----------------------------------------------------------------- provenance

/** Dates come from Version.createdAt; models and times only from ledger entries, else "unknown". */
export function buildProvenance(
  originalVersions: readonly Version[], imageFileOf: (v: Version) => string, input: ProvenanceInputData,
): DemoProvenanceData {
  // Group, never overwrite: a visual version has an instruction call and an edit call.
  const byVersion = new Map<string, DemoProvenanceData["steps"][number]["calls"]>();
  for (const e of input.entries) {
    byVersion.set(e.versionId, [...(byVersion.get(e.versionId) ?? []), { route: e.route ?? "unknown", model: e.model, at: e.at }]);
  }
  return {
    steps: originalVersions.map((v) => ({
      file: imageFileOf(v), kind: v.kind, createdAt: new Date(v.createdAt).toISOString(),
      // The root is the owner's upload and a sheet save is not a model call.
      calls: v.kind === "visual" ? (byVersion.get(v.id) ?? [{ route: "unknown", model: "unknown", at: "unknown" }]) : [],
    })),
    assetCalls: (input.assetCalls ?? []).map((c) => ({ ...c })),
    promptFiles: input.promptFiles,
  };
}

/** Mock content must never ship as the cached demo (fit reasons, limitations, warnings, sources). */
export function mockProblems(snapshot: ProjectSnapshot): string[] {
  return JSON.stringify(snapshot).includes(MOCK_LABEL) ? ["the demo project still holds mock data"] : [];
}

/**
 * The strict head check: every head item has a real (non-mock) fit that recomputes, the mechanic's
 * review hash matches that fit, and the head has an inspection review for the current hash.
 * Unlike fitHashProblems, a missing fit or review is a problem. Empty list = publishable.
 */
export async function strictFitProblems(
  head: Version, bikeRevision: Parameters<typeof fitInputHash>[0], settings: ShopSettings,
): Promise<string[]> {
  const problems = await fitHashProblems(head, bikeRevision, settings);
  for (const item of head.items) {
    if (item.fit === null) problems.push(`${item.slot}: no fit result`);
    else if (item.fitReviewedHash === null) problems.push(`${item.slot}: the fit result is not reviewed by the mechanic`);
    else if (item.fitReviewedHash !== (await fitReviewHash(item, false))) problems.push(`${item.slot}: fit review hash is not the hash of the current fit result`);
    if (item.fit !== null && JSON.stringify(item.fit).includes(MOCK_LABEL)) problems.push(`${item.slot}: the fit result is mock data`);
  }
  if (head.inspectionReview === null) problems.push("the head has no inspection review");
  return problems;
}

/** SPEC 13 public rights, checked on the source before anything is built. */
export function publicRightsProblems(snapshot: ProjectSnapshot): string[] {
  const problems: string[] = [];
  for (const i of snapshot.images) if (i.rights !== "owner") problems.push(`image ${i.file} has rights "${i.rights}", not "owner"`);
  for (const v of snapshot.versions) {
    if (v.change?.mode === "reference") problems.push(`version ${v.id} is a reference-photo edit`);
    for (const it of v.items) if (it.product?.imageUrl != null) problems.push(`item ${it.slot} carries a product image URL`);
  }
  return problems;
}

// -------------------------------------------------------------- published text

export type PublishedText = { field: string; text: string };

/** Every string under value, labelled with its path; id and hash keys are not free text. */
function collectStrings(value: unknown, label: string, out: PublishedText[]): void {
  if (typeof value === "string") out.push({ field: label, text: value });
  else if (Array.isArray(value)) value.forEach((v, n) => collectStrings(v, `${label}[${n}]`, out));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) if (!/^(id|hash|.*Hash|.*Id)$/.test(k)) collectStrings(v, `${label}.${k}`, out);
  }
}

/** All free text and URLs the demo publishes, for the lead's review before it goes public. */
export function publishedText(snapshot: ProjectSnapshot, settings: ShopSettings): PublishedText[] {
  const out: PublishedText[] = [{ field: "project.name", text: snapshot.project.name }];
  collectStrings(snapshot.project.bikeRevision, "bike", out);
  for (const v of snapshot.versions) {
    const at = `version ${new Date(v.createdAt).toISOString()}`;
    if (v.change) out.push({ field: `${at} change.instruction`, text: v.change.instruction });
    if (v.fallbackReason) out.push({ field: `${at} fallbackReason`, text: v.fallbackReason });
    for (const p of v.parts) out.push({ field: `${at} part.label`, text: p.label });
    for (const it of v.items) {
      const f = `${at} item ${it.slot}`;
      out.push({ field: `${f}.title`, text: it.title }, { field: `${f}.mechanicNotes`, text: it.mechanicNotes });
      collectStrings(it.spec, `${f}.spec`, out);
      collectStrings(it.product, `${f}.product`, out);
      collectStrings(it.fit, `${f}.fit`, out);
    }
    for (const fee of v.fees) out.push({ field: `${at} fee.label`, text: fee.label });
    if (v.inspectionReview) out.push({ field: `${at} inspectionReview.notes`, text: v.inspectionReview.notes });
  }
  // The example quote PDF prints the settings' text.
  out.push({ field: "quote.shopName", text: settings.shopName }, { field: "quote.notes", text: settings.quoteNotes });
  settings.shopRules.forEach((r, n) => out.push({ field: `quote.shopRules[${n}]`, text: r }));
  return out.filter((e) => e.text !== "");
}

// ----------------------------------------------------------------------- pack

export type PackReport = {
  manifest: DemoManifest;
  /** Every free-text field and URL that goes public. */
  published: PublishedText[];
  /** Where the quote PDF came from and its hash, so the lead can tell which file shipped. */
  quoteSource: { path: string; sha256: string };
  /** Files written to outDir. */
  files: string[];
};

async function readChecked(file: string, bytes: number, hash: string, label: string): Promise<Buffer> {
  const buf = await readFile(file);
  if (buf.length !== bytes) throw new DemoPackError(`${label} has the wrong size.`);
  if (sha256(buf) !== hash) throw new DemoPackError(`${label} does not match its hash.`);
  return buf;
}

async function assertEmptyOutDir(dir: string): Promise<void> {
  const entries = await readdir(dir).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return [] as string[];
    throw e;
  });
  if (entries.length > 0) throw new DemoPackError(`The output folder ${dir} is not empty.`);
}

/**
 * Build everything in memory, validate, then write. Nothing is written when any check fails, and
 * a partly written folder is removed again.
 */
export async function packDemo(opts: PackOptions): Promise<PackReport> {
  const settings = opts.settings ?? EXAMPLE_SETTINGS;
  const raw = JSON.parse(await readFile(path.join(opts.srcDir, "project.json"), "utf8")) as unknown;
  const source = ProjectSnapshotSchema.parse(raw);
  const rightsProblems = publicRightsProblems(pruneDemoSnapshot(source).snapshot);
  if (rightsProblems.length > 0) throw new DemoPackError(`Not publishable: ${rightsProblems.join("; ")}`);
  const pruned = pruneDemoSnapshot(source);
  const { snapshot } = pruned;
  if (snapshot.project.settingsId !== "example") throw new DemoPackError("The demo project must use the example shop settings.");
  const head = snapshot.versions.find((v) => v.id === snapshot.project.headVersionId);
  if (!head) throw new DemoPackError("The head version is missing.");
  const mock = mockProblems(snapshot);
  if (mock.length > 0) throw new DemoPackError(`Mock content is not allowed: ${mock.join("; ")}`);
  const problems = await strictFitProblems(head, snapshot.project.bikeRevision, settings);
  if (problems.length > 0) throw new DemoPackError(`The head is not publishable: ${problems.join("; ")}`);
  await assertEmptyOutDir(opts.outDir);

  const outFiles = new Map<string, Uint8Array>();
  const rights: DemoManifest["rights"] = [];
  const credit = opts.provenance.rights;
  const rootImageId = snapshot.versions.find((v) => v.id === snapshot.project.rootVersionId)?.image.id;
  const addRights = (file: string, kind: "owner_photo" | "generated_derivative") =>
    rights.push({ file, kind, credit: credit.credit, clearance: credit.clearance });

  // Images: check size, hash and the real WebP dimensions against the source listing.
  for (const f of pruned.imageFiles) {
    const img = snapshot.images.find((i) => i.id === f.id);
    if (!img) throw new DemoPackError(`Image ${f.id} is missing.`);
    const buf = await readChecked(path.join(opts.srcDir, f.from), img.bytes, img.hash, `Image ${f.from}`);
    const meta = await sharp(buf).metadata();
    if (meta.format !== "webp" || meta.width !== img.width || meta.height !== img.height) {
      throw new DemoPackError(`Image ${f.from} is not a WebP of ${img.width}x${img.height}.`);
    }
    outFiles.set(f.to, buf);
    // The kind comes from the image's role (root image id), never from its file name.
    addRights(f.to, f.id === rootImageId ? "owner_photo" : "generated_derivative");
  }

  // Masks: 0/1 bytes to 1-bit PNG; the PNG must decode back to the same bytes.
  const masks: DemoManifest["masks"] = [];
  for (const m of snapshot.masks) {
    const pixels = new Uint8Array(await readFile(path.join(opts.srcDir, "masks", m.file)));
    if (pixels.length !== m.width * m.height || pixels.some((v) => v > 1)) throw new DemoPackError(`Mask ${m.file} is not a valid 0/1 mask.`);
    const png = await maskToPng(pixels, m.width, m.height);
    const back = await pngToMask(png);
    if (back.width !== m.width || back.height !== m.height || !Buffer.from(back.pixels).equals(Buffer.from(pixels))) {
      throw new DemoPackError(`Mask ${m.id} does not survive the PNG round trip.`);
    }
    const file = `${m.id}.png`;
    outFiles.set(file, png);
    masks.push({ id: m.id, file, sha256: sha256(png), bytes: png.length, width: m.width, height: m.height });
    addRights(file, "generated_derivative");
  }

  const quoteSourcePath = opts.quotePdfPath ?? path.join(opts.srcDir, "quote.pdf");
  const quote = await readFile(quoteSourcePath);
  outFiles.set("quote.pdf", quote);
  addRights("quote.pdf", "generated_derivative");

  const fileOf = new Map(pruned.imageFiles.map((f) => [f.id, f.to]));
  const manifest = DemoManifestSchema.parse({
    schemaVersion: 1, cachedAt: opts.cachedAt,
    provenance: buildProvenance(snapshot.versions, (v) => fileOf.get(v.image.id) ?? "unknown", opts.provenance),
    rights, snapshot, masks,
    quote: { path: "quote.pdf", bytes: quote.length, sha256: sha256(quote) },
  });
  outFiles.set("project.json", Buffer.from(JSON.stringify(manifest, null, 2)));

  // Everything validated: now write. The folder was empty, so a failure can be undone file by file.
  await assertEmptyOutDir(opts.outDir);
  await mkdir(opts.outDir, { recursive: true });
  try {
    for (const [name, bytes] of outFiles) await writeFile(path.join(opts.outDir, name), bytes);
  } catch (e) {
    await Promise.all([...outFiles.keys()].map((name) => rm(path.join(opts.outDir, name), { force: true })));
    throw e;
  }
  return {
    manifest, published: publishedText(snapshot, settings),
    quoteSource: { path: quoteSourcePath, sha256: sha256(quote) }, files: [...outFiles.keys()],
  };
}
