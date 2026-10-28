"use client";

import { useState } from "react";

type Props = { partLabel: string; busy: boolean; onPrepare: (text: string) => void };

/** Free-text change for the selected part (replacement or shape change). */
export function DescribeForm({ partLabel, busy, onPrepare }: Props) {
  const [text, setText] = useState("");
  const trimmed = text.trim();
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (trimmed) onPrepare(trimmed); }}>
      <label className="flex flex-col gap-1 text-[13px]">
        Describe the new {partLabel.toLowerCase()}
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3}
          placeholder="For example: 14-inch ape hanger, black, internal wiring"
          className="rounded-inner border border-hairline bg-surface-3 px-3 py-2" />
      </label>
      <p className="text-text-muted text-[12px]">Describe one part. Brand, size, and finish help the build sheet.</p>
      <button type="submit" disabled={!trimmed || busy}
        className="self-start rounded-full bg-primary px-4 py-1.5 text-on-fill text-[13px] disabled:opacity-50">
        Prepare change
      </button>
    </form>
  );
}
