/** Always shown with the cached demo project. Word plus icon, never color alone. */
export const DEMO_BANNER_TEXT = "Demo project — precomputed results. Live changes use the daily budget.";

export function DemoBanner() {
  return (
    <div role="status" data-testid="demo-banner" className="rounded-chip bg-neutral-soft px-3 py-2 text-neutral-soft-text text-[13px]">
      <span aria-hidden="true" className="mr-2 font-semibold">ⓘ</span>
      {DEMO_BANNER_TEXT}
    </div>
  );
}
