"use client";

import { useRef, useState } from "react";
import { uploadForNormalize } from "@/lib/browser/normalizeClient";
import { PreflightError, preflightPhoto } from "@/lib/browser/preflight";
import type { NormalizedPhoto } from "@/lib/types";

type State =
  | { kind: "idle" }
  | { kind: "busy"; step: string }
  | { kind: "error"; message: string; retryFile: File | null };

/** Drop or pick one photo; preflight in the browser, then normalize on the server. */
export function UploadDropzone({ onPhoto }: { onPhoto: (photo: NormalizedPhoto) => void }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function handle(file: File | undefined) {
    if (!file) return;
    try {
      setState({ kind: "busy", step: "Preparing the photo in your browser…" });
      const prepared = await preflightPhoto(file);
      setState({ kind: "busy", step: "Checking the photo…" });
      onPhoto(await uploadForNormalize(prepared));
      setState({ kind: "idle" });
    } catch (error) {
      const known = error instanceof PreflightError;
      setState({ kind: "error", message: known ? error.message : "The photo could not be prepared.",
        retryFile: known && error.retryable ? file : null });
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  const busy = state.kind === "busy";
  return (
    <div className="w-full max-w-[560px]">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) void handle(e.dataTransfer.files[0]); }}
        className={`flex flex-col items-center gap-3 rounded-card border-2 border-dashed p-10 text-center ${
          over ? "border-primary bg-primary-soft" : "border-hairline bg-surface-2"}`}
      >
        <p className="font-medium">Drop a bike photo here</p>
        <p className="text-text-muted text-[13px]">JPEG, PNG, or WebP, up to 25 MB. iPhone HEIC: export as JPEG first.</p>
        <button type="button" disabled={busy} onClick={() => input.current?.click()}
          className="rounded-full bg-primary px-5 py-2 text-on-fill disabled:opacity-50">
          Choose photo
        </button>
        <input ref={input} type="file" className="sr-only" aria-label="Choose a bike photo"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          onChange={(e) => void handle(e.target.files?.[0])} />
      </div>
      {busy && <p role="status" className="mt-3 text-text-secondary text-[13px]">{state.step}</p>}
      {state.kind === "error" && (
        <div role="alert" className="mt-3 rounded-chip bg-danger-soft px-4 py-3 text-danger-soft-text">
          <span aria-hidden="true" className="mr-2 font-semibold">✕</span>
          <span className="font-medium">Photo not accepted:</span> {state.message}
          {state.retryFile && (
            <button type="button" onClick={() => void handle(state.retryFile ?? undefined)}
              className="ml-3 underline underline-offset-2">Try again</button>
          )}
          <button type="button" onClick={() => setState({ kind: "idle" })}
            className="ml-3 underline underline-offset-2">Try another photo</button>
        </div>
      )}
    </div>
  );
}
