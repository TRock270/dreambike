type Props = {
  /** quote.exclusions: one plain sentence per missing or unresolved cost. */
  exclusions: readonly string[];
};

/** The reasons a quote is incomplete, in words. Nothing here is counted as 0 in the totals. */
export function MissingCosts({ exclusions }: Props) {
  if (exclusions.length === 0) {
    return (
      <p role="status" className="rounded-chip bg-success-soft px-3 py-2 text-success-soft-text text-[13px]">
        <span aria-hidden="true" className="mr-1 font-semibold">✓</span>No costs are missing. Every amount, labor time, fit review and inspection decision is known.
      </p>
    );
  }
  return (
    <section aria-label="Missing costs" className="flex flex-col gap-2 rounded-card border border-hairline bg-surface-2 p-3">
      <h3 className="text-[15px] font-semibold">Missing or unresolved ({exclusions.length})</h3>
      <p className="text-text-muted text-[12px]">Until these are resolved the estimate stays an incomplete draft and shows no grand total.</p>
      <ul className="flex flex-col gap-1 text-[13px]">
        {exclusions.map((text, i) => (
          <li key={`${i}:${text}`} className="flex gap-2">
            <span aria-hidden="true" className="text-warning-soft-text font-semibold">⚠</span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
