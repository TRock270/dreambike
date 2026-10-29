import type { FitStatus } from "@/lib/project";

// Each status has a word AND a different icon shape, so color is never the only signal.
const LOOK: Record<FitStatus, { word: string; tone: string; icon: React.ReactNode }> = {
  ok: {
    word: "Fit ok", tone: "bg-success-soft text-success-soft-text",
    icon: <path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
  },
  verify: {
    word: "Verify fit", tone: "bg-warning-soft text-warning-soft-text",
    icon: <path d="M8 2.5l6 10.5H2L8 2.5zM8 6.8v3M8 11.6v.1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />,
  },
  problem: {
    word: "Fit problem", tone: "bg-danger-soft text-danger-soft-text",
    icon: <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />,
  },
  stale: {
    word: "Check is stale", tone: "bg-neutral-soft text-neutral-soft-text",
    icon: <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />,
  },
  not_checked: {
    word: "Not checked", tone: "bg-neutral-soft text-neutral-soft-text",
    icon: <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.5 2" />,
  },
};

/** Fit status as a chip: icon plus word. The status itself comes from fitStatusOf (project.ts). */
export function FitBadge({ status }: { status: FitStatus }) {
  const look = LOOK[status];
  return (
    <span data-testid="fit-badge" data-status={status} className={`inline-flex items-center gap-1 rounded-chip px-2 py-0.5 text-[12px] font-medium ${look.tone}`}>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 shrink-0">{look.icon}</svg>
      {look.word}
    </span>
  );
}
