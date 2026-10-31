"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { requestProductImage, uploadForNormalize } from "@/lib/browser/normalizeClient";
import { PreflightError, preflightPhoto } from "@/lib/browser/preflight";
import type { NormalizedPhoto } from "@/lib/types";

type Props = {
  partLabel: string;
  /** The uploaded reference, kept by the parent in browser memory only. */
  reference: NormalizedPhoto | null;
  /** The instruction is being prepared. */
  busy: boolean;
  /** `web: true` marks a shop product photo: renders made with it get rights "external_runtime". */
  onReference: (photo: NormalizedPhoto | null, source?: { web: boolean }) => void;
  /** Photo URL of the chosen product (server-offered only); null or missing hides the product photo action. */
  productImageUrl?: string | null;
  /** The current reference is a shop product photo. */
  webReference?: boolean;
  /** The mechanic's description of what the reference shows (never empty). */
  onPrepare: (description: string) => void;
  /** Description to start with (the other-wheel follow-up); the reference photo itself is never carried over. */
  initialText?: string;
};

type Upload = { kind: "idle" } | { kind: "busy"; step: string } | { kind: "error"; message: string };

/**
 * Reference mode input: one photo of a part, plus a description of what it shows.
 * The base photo's upload notice does not cover this second upload, so it is repeated here.
 */
export function ReferenceDropzone({ partLabel, reference, busy, onReference, onPrepare, initialText, productImageUrl, webReference }: Props) {
  const [owned, setOwned] = useState(false);
  const [text, setText] = useState(initialText ?? "");
  const [upload, setUpload] = useState<Upload>({ kind: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const [webOk, setWebOk] = useState(false);
  // An upload can finish after this form was closed (another part was selected). Then it must do nothing.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // A local preview of the reference. The object URL points at browser memory and is revoked on change.
  const previewUrl = useMemo(() => (reference ? URL.createObjectURL(reference.blob) : null), [reference]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function handle(file: File | undefined) {
    if (!file || !owned) return;
    try {
      setUpload({ kind: "busy", step: "Preparing the reference photo in your browser…" });
      const prepared = await preflightPhoto(file); // gives the exact HEIC "export as JPEG" message
      if (!mounted.current) return;
      setUpload({ kind: "busy", step: "Checking the reference photo…" });
      const normalized = await uploadForNormalize(prepared); // a WebP the edit routes accept
      if (!mounted.current) return;
      onReference(normalized);
      setUpload({ kind: "idle" });
    } catch (error) {
      if (!mounted.current) return;
      setUpload({ kind: "error", message: error instanceof PreflightError ? error.message : "The reference photo could not be prepared." });
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  // One explicit click fetches the product photo. A failure shows the server's words; the file input stays usable.
  async function fetchProductPhoto() {
    if (!productImageUrl || !webOk || upload.kind === "busy") return;
    try {
      setUpload({ kind: "busy", step: "Fetching the product photo…" });
      const photo = await requestProductImage(productImageUrl);
      if (!mounted.current) return;
      onReference(photo, { web: true });
      setUpload({ kind: "idle" });
    } catch (error) {
      if (!mounted.current) return;
      setUpload({ kind: "error", message: error instanceof PreflightError ? error.message : "The product photo could not be fetched." });
    }
  }

  const trimmed = text.trim();
  const uploading = upload.kind === "busy";
  const why = !reference ? "Add a reference photo first." : !trimmed ? "Describe what the reference photo shows." : null;

  return (
    <div className="flex flex-col gap-2 text-[13px]">
      {!reference && (
        <>
          <p className="text-text-secondary">
            Upload a photo of the {partLabel.toLowerCase()} you want to use. Reference photos are processed by Meta AI
            models in Contributor mode, so <strong className="font-semibold">Meta may use this photo to train its models</strong>.
            The reference stays in this browser tab; it is not saved with the project.
          </p>
          <p className="text-text-muted text-[12px]">
            Show only the part, with no people, license plates, VIN plates, addresses, or papers.
          </p>
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 size-4 accent-primary" checked={owned} onChange={(e) => setOwned(e.target.checked)} />
            <span>I own this reference photo or have permission to use it for this purpose.</span>
          </label>
          <button type="button" disabled={!owned || uploading} onClick={() => input.current?.click()}
            className="self-start rounded-full bg-primary px-4 py-1.5 text-on-fill disabled:opacity-50">
            Choose reference photo
          </button>
          {!owned && <p className="text-text-muted text-[12px]">Tick the box above to choose a photo.</p>}
          {productImageUrl && (
            <div className="flex flex-col gap-2 rounded-card border border-hairline bg-surface-3 p-3">
              <p className="font-semibold">Or use the photo of the chosen product</p>
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 size-4 accent-primary" checked={webOk} onChange={(e) => setWebOk(e.target.checked)} />
                <span>I may use this image for this project. It is sent to Meta, which may use it for training.</span>
              </label>
              <button type="button" disabled={!webOk || uploading} onClick={() => void fetchProductPhoto()}
                className="self-start rounded-full bg-primary px-4 py-1.5 text-on-fill disabled:opacity-50">
                Use the photo of the chosen product
              </button>
              {!webOk && <p className="text-text-muted text-[12px]">Tick the box above to use the product photo.</p>}
            </div>
          )}
          <input ref={input} type="file" className="sr-only" aria-label="Choose a reference photo" disabled={!owned}
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            onChange={(e) => void handle(e.target.files?.[0])} />
        </>
      )}
      {uploading && <p role="status" className="text-text-secondary">{upload.step}</p>}
      {upload.kind === "error" && (
        <p role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-danger-soft-text">
          <span aria-hidden="true" className="mr-1 font-semibold">✕</span>Reference photo not accepted: {upload.message}
        </p>
      )}
      {reference && (
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-3">
            {/* A plain img is fine: the source is an object URL in browser memory, so next/image has nothing to optimize. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {previewUrl && <img src={previewUrl} alt={`Reference photo for the ${partLabel.toLowerCase()}`} className="h-20 w-20 rounded-inner border border-hairline object-cover" />}
            <div className="flex flex-col gap-1">
              <p className="tabular text-text-muted text-[12px]">{reference.width} × {reference.height} px</p>
              {webReference && (
                <p className="rounded-chip bg-neutral-soft px-3 py-2 text-neutral-soft-text text-[12px]">
                  <span aria-hidden="true" className="mr-1 font-semibold">ⓘ</span>
                  Shop product photo in use. Renders made with it stay out of the PDF and the folder save.
                </p>
              )}
              <button type="button" onClick={() => onReference(null)} disabled={busy}
                className="self-start rounded-full border border-hairline px-3 py-1 disabled:opacity-50">
                Remove reference
              </button>
            </div>
          </div>
          {reference.warnings.map((w) => (
            <p key={w} className="rounded-chip bg-warning-soft px-3 py-2 text-warning-soft-text">
              <span aria-hidden="true" className="mr-1 font-semibold">⚠</span>{w}
            </p>
          ))}
        </div>
      )}
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (reference && trimmed) onPrepare(trimmed); }}>
        <label className="flex flex-col gap-1">
          What does the reference photo show?
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3}
            placeholder="For example: gold multi-spoke wheel with chrome hub, about 20 inch"
            className="rounded-inner border border-hairline bg-surface-3 px-3 py-2" />
        </label>
        <p className="text-text-muted text-[12px]">Say what the part is, size, finish, and brand if you know it. This goes on the build sheet.</p>
        <button type="submit" disabled={!!why || busy}
          className="self-start rounded-full bg-primary px-4 py-1.5 text-on-fill disabled:opacity-50">
          Prepare change
        </button>
        {why && <p className="text-text-muted text-[12px]">{why}</p>}
      </form>
    </div>
  );
}
