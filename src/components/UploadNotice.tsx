"use client";

import { useState } from "react";

/** Shown before any upload: Meta processing, possible Contributor training, and rights. */
export function UploadNotice({ onAccept }: { onAccept: () => void }) {
  const [owned, setOwned] = useState(false);
  const [clean, setClean] = useState(false);
  return (
    <section aria-labelledby="notice-title" className="max-w-[560px] rounded-card border border-hairline bg-surface-1 p-6">
      <h2 id="notice-title" className="text-[20px] leading-[1.35]">Before you upload a photo</h2>
      <p className="mt-3">
        Photos and change requests are processed by Meta AI models. This app uses Meta&apos;s
        Contributor mode, so <strong className="font-semibold">Meta may use what you upload to train its models</strong>.
      </p>
      <p className="mt-2 text-text-secondary text-[13px]">
        Upload only a photo of a motorcycle you own or have permission to use. Make sure no people,
        license plates, VIN plates, addresses, or documents are visible.
      </p>
      <label className="mt-4 flex gap-3 items-start">
        <input type="checkbox" className="mt-1.5 size-4 accent-primary" checked={owned} onChange={(e) => setOwned(e.target.checked)} />
        <span>I own this photo or have permission to use it for this purpose.</span>
      </label>
      <label className="mt-2 flex gap-3 items-start">
        <input type="checkbox" className="mt-1.5 size-4 accent-primary" checked={clean} onChange={(e) => setClean(e.target.checked)} />
        <span>It shows no people and no plates, VIN plates, addresses, or papers.</span>
      </label>
      <button type="button" disabled={!owned || !clean} onClick={onAccept}
        className="mt-5 rounded-full bg-primary px-5 py-2 text-on-fill disabled:opacity-50">
        Continue
      </button>
    </section>
  );
}
