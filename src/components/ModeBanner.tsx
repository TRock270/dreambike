import type { AppMode } from "@/lib/server/config";

/** Always-visible statement of where results come from. Word plus icon, never color alone. */
export function ModeBanner({ mode }: { mode: AppMode }) {
  if (mode === "live") return null;
  const text = mode === "mock"
    ? "Mock mode — responses are labeled fixtures, not AI results. Local development only."
    : "Live AI is off. You can explore the demo project; it uses cached results and makes no AI calls.";
  const tone = mode === "mock"
    ? "bg-warning-soft text-warning-soft-text"
    : "bg-neutral-soft text-neutral-soft-text";
  return (
    <div role="status" data-testid="mode-banner" className={`${tone} border-b border-hairline px-6 py-2 text-[13px]`}>
      <span aria-hidden="true" className="mr-2 font-semibold">{mode === "mock" ? "⚠" : "ⓘ"}</span>
      <span className="font-medium">{mode === "mock" ? "Mock" : "Demo only"}:</span> {text}
    </div>
  );
}
