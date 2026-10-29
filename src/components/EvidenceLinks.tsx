import type { z } from "zod";
import type { Source } from "@/lib/contracts";

type SourceData = z.infer<typeof Source>;

/** Date part of an ISO time ("2026-10-29T10:00:00Z" becomes "2026-10-29"). */
const day = (iso: string) => iso.slice(0, 10);

/** The sources behind a fit result. Links open in a new tab; the accessed date shows next to each. */
export function EvidenceLinks({ sources }: { sources: readonly SourceData[] }) {
  if (sources.length === 0) {
    return <p className="text-text-muted text-[13px]">No sources. Without a source the result stays a pre-check to verify.</p>;
  }
  return (
    <ul aria-label="Sources" className="flex flex-col gap-1 text-[13px]">
      {sources.map((s) => (
        <li key={s.url}>
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary-ink underline underline-offset-2">
            {s.title}<span className="sr-only"> (opens in a new tab)</span>
          </a>
          <span className="ml-2 text-text-muted">accessed <span className="tabular">{day(s.accessedAt)}</span></span>
          {s.supports && <p className="text-text-secondary">{s.supports}</p>}
        </li>
      ))}
    </ul>
  );
}
