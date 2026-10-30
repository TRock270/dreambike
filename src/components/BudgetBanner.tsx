"use client";

import { useEffect, useRef, useState } from "react";
import { BudgetResponse } from "@/lib/contracts";
import { ERRORS, VISITOR_BUDGET_MESSAGE } from "@/lib/errors";
import type { z } from "zod";

type Budget = z.infer<typeof BudgetResponse>;

type State =
  | { kind: "loading" }
  | { kind: "unreachable" }
  | { kind: "ready"; budget: Budget };

// SPEC texts come from errors.ts so they cannot drift. Only "unreachable" and "shared" belong to the banner.
// The banner switches on `reason`, never on these words.
const TEXT = {
  visitor: VISITOR_BUDGET_MESSAGE,
  global: ERRORS.BUDGET_EXCEEDED.message,
  off: ERRORS.LIVE_DISABLED.message,
  accounting: ERRORS.ACCOUNTING_UNAVAILABLE.message,
  unreachable: "The live allowance could not be checked. The cached demo still works.",
  shared: "People on one network share one allowance.",
  closeFirst: "Close the project to open the cached demo.",
};

const BUDGET_TIMEOUT_MS = 10_000;

/** Aborts when either signal does. AbortSignal.any is newer, so older browsers get a manual fallback. */
function anySignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any([a, b]);
  const c = new AbortController();
  for (const s of [a, b]) {
    if (s.aborted) c.abort();
    else s.addEventListener("abort", () => c.abort(), { once: true });
  }
  return c.signal;
}

/** Whole-dollar-and-cents display of USD microdollars. Display only: all budget math stays on the server. */
function usd(micro: number): string {
  return (micro / 1_000_000).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** The reset time in the visitor's own locale and time zone, although the server counts days in New York time. */
function resetText(resetAt: string): string {
  return new Date(resetAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const ICON = { ok: "✓", info: "ⓘ", warn: "⚠" } as const;

type Props = {
  /** Changing this value fetches the budget again. Workspace changes it when a paid call starts or ends. */
  refreshKey: string;
  /** "Explore the cached demo": shown only when live use is limited. */
  onOpenDemo?: () => void;
  /** A project is open: the demo link is replaced by a hint, and no work is closed automatically. */
  projectOpen?: boolean;
};

/** Live allowance in the header: visitor cap, global cap, live off, or accounting outage. Unknown spend reads "unavailable". */
export function BudgetBanner({ refreshKey, onOpenDemo, projectOpen }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  // Counts requests so an older, slower answer can never replace a newer one.
  const latest = useRef(0);

  useEffect(() => {
    const mine = ++latest.current;
    const controller = new AbortController();
    // A timeout aborts the same signal as unmounting, so tell them apart by controller.signal itself below.
    const signal = anySignal(controller.signal, AbortSignal.timeout(BUDGET_TIMEOUT_MS));
    void (async () => {
      let next: State;
      try {
        const res = await fetch("/api/budget", { credentials: "same-origin", cache: "no-store", signal });
        const parsed = BudgetResponse.safeParse(await res.json());
        next = parsed.success ? { kind: "ready", budget: parsed.data } : { kind: "unreachable" };
      } catch {
        if (controller.signal.aborted) return; // unmounted or refreshed: a newer request owns the state
        next = { kind: "unreachable" };
      }
      if (mine === latest.current) setState(next);
    })();
    return () => controller.abort();
  }, [refreshKey]);

  if (state.kind === "loading") return null;

  let text: string;
  let tone: string;
  let icon: string;
  let limited = true;
  let details: string[] = [];
  if (state.kind === "unreachable") {
    text = TEXT.unreachable; tone = "bg-warning-soft text-warning-soft-text"; icon = ICON.warn;
  } else {
    const b = state.budget;
    const reset = `Resets ${resetText(b.resetAt)}.`;
    // spent is null when accounting is unknown: say so, never show zero.
    const spent = b.spentTodayMicroUsd === null ? "unavailable" : usd(b.spentTodayMicroUsd);
    if (b.reason === "visitor_cap") {
      text = TEXT.visitor; tone = "bg-warning-soft text-warning-soft-text"; icon = ICON.warn;
      details = [reset, TEXT.shared];
    } else if (b.reason === "global_cap") {
      text = TEXT.global; tone = "bg-warning-soft text-warning-soft-text"; icon = ICON.warn;
      details = [reset];
    } else if (b.reason === "project_cap" || b.reason === "live_disabled") {
      text = TEXT.off; tone = "bg-neutral-soft text-neutral-soft-text"; icon = ICON.info;
    } else if (b.reason === "accounting_unavailable") {
      text = TEXT.accounting; tone = "bg-danger-soft text-danger-soft-text"; icon = "✕";
      details = ["Spent today: unavailable."];
    } else if (!b.liveEnabled) {
      // No reason but live is off (for example mock or demo mode): same plain statement.
      text = TEXT.off; tone = "bg-neutral-soft text-neutral-soft-text"; icon = ICON.info;
    } else {
      limited = false;
      tone = "bg-neutral-soft text-neutral-soft-text"; icon = ICON.ok;
      text = `Live allowance today: ${usd(b.visitorRemainingMicroUsd)} left, about ${b.remainingEdits} ${b.remainingEdits === 1 ? "edit" : "edits"}.`;
      details = [`Spent today: ${spent} of ${usd(b.dailyCapMicroUsd)}.`, reset, TEXT.shared];
    }
  }

  return (
    <div role="status" data-testid="budget-banner" data-reason={state.kind === "ready" ? (state.budget.reason ?? "none") : "unreachable"}
      className={`${tone} flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline px-6 py-2 text-[13px]`}>
      <span aria-hidden="true" className="font-semibold">{icon}</span>
      <span className="font-medium">{text}</span>
      {details.map((d) => <span key={d} className="tabular">{d}</span>)}
      {limited && !onOpenDemo && projectOpen && <span className="ml-auto text-[13px]">{TEXT.closeFirst}</span>}
      {limited && onOpenDemo && (
        <button type="button" onClick={onOpenDemo} className="ml-auto rounded-full border border-hairline bg-surface-1 px-3 py-1 text-[13px] text-text">
          Explore the cached demo
        </button>
      )}
    </div>
  );
}
