"use client";

import { useState } from "react";
import type { NormalizedPhoto } from "@/lib/types";
import { ImageCanvas } from "./ImageCanvas";
import { UploadDropzone } from "./UploadDropzone";
import { UploadNotice } from "./UploadNotice";

/** Photo area and edit panel. Projects are not persisted until T6. */
export function Workspace() {
  const [noticeAccepted, setNoticeAccepted] = useState(false);
  const [photo, setPhoto] = useState<NormalizedPhoto | null>(null);

  return (
    <main className="flex flex-1 gap-4 p-4">
      <section aria-label="Photo" className="flex flex-[2] items-center justify-center rounded-card border border-hairline bg-recess p-4">
        {photo ? <ImageCanvas photo={photo} />
          : noticeAccepted ? <UploadDropzone onPhoto={setPhoto} />
          : <UploadNotice onAccept={() => setNoticeAccepted(true)} />}
      </section>
      <aside aria-label="Edit panel" className="w-[360px] shrink-0 rounded-card border border-hairline bg-surface-1 p-4">
        <h2 className="text-[20px] leading-[1.35]">Edit</h2>
        <p className="mt-2 text-text-muted text-[13px]">
          {photo ? "Part selection arrives with the part map." : "Import a photo of your own bike to start."}
        </p>
        {photo && (
          <button type="button" onClick={() => setPhoto(null)}
            className="mt-4 rounded-full border border-hairline px-4 py-1.5 text-[13px]">
            Use a different photo
          </button>
        )}
      </aside>
    </main>
  );
}
