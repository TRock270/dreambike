import { describe, expect, it } from "vitest";
import { runWorkflow, type AgentCall, type AgentOpts, type Obj, type WorkflowResult } from "./support/workflowHarness";

const approve = { verdict: "approve", findings: [], recheck: [], checksRun: [] };
const finding = (id: string, severity: string, file = "src/lib/editPolicy.ts") =>
  ({ id, severity, file, line: 1, claim: "c", failureScenario: "s", evidence: "e", requiredFix: "f" });
const changes = (findings: Obj[]) => ({ ...approve, verdict: "changes_required", findings });
const list = (result: WorkflowResult, key: string) => result[key] as Obj[];
const reviewCall = (calls: AgentCall[], reviewer: string) => calls.find((c) => c.label === `review ${reviewer}`);
// Keys the refuter was asked about, in prompt order.
const keysIn = (prompt: string) => [...prompt.matchAll(/"key": "([^"]+)"/g)].map((m) => m[1] as string);
const verdictsFor = (outcome: string) => (prompt: string) =>
  ({ verdicts: keysIn(prompt).map((key) => ({ key, outcome, reason: "r" })) });

// ---------- review-changes ----------
interface ReviewSetup {
  files?: string[];
  scope?: unknown;
  reviews?: Record<string, unknown>;
  refute?: unknown | ((prompt: string) => unknown);
}
function review(args: unknown, setup: ReviewSetup = {}) {
  const files = setup.files ?? ["src/lib/editPolicy.ts"];
  const reviews = setup.reviews ?? {};
  return runWorkflow("review-changes.js", args, (opts: AgentOpts, prompt: string) => {
    if (opts.label === "list changes") return "scope" in setup ? setup.scope : { files, error: "" };
    if (opts.label === "refute") return typeof setup.refute === "function" ? setup.refute(prompt) : setup.refute ?? null;
    const reviewer = opts.agentType ?? "";
    return reviewer in reviews ? reviews[reviewer] : approve;
  });
}
// One file per specialist: meta.ts brings models and security.
const ALL_DOMAINS = ["src/lib/server/meta.ts", "src/lib/coordinates.ts", "src/lib/quote.ts", "README.md"];

describe("review-changes depth", () => {
  it.each([
    ["main", "full"],
    ["origin/main", "full"],
    ["HEAD~1", "quick"],
    [undefined, "quick"],
    [{ base: "main", depth: "quick" }, "quick"],
    [{ depth: "full" }, "full"],
  ])("args %j give depth %s", async (args, depth) => {
    const { result } = await review(args);
    expect(result.status).toBe("green");
    expect(result.depth).toBe(depth);
  });

  it("blocks an unknown depth before any agent runs", async () => {
    const { result, calls } = await review({ depth: "deep" });
    expect(result.status).toBe("blocked");
    expect(result.depth).toBe("deep");
    expect(calls).toHaveLength(0);
  });

  it("blocks malformed JSON args, unsafe base refs and a non-list extraReviewers", async () => {
    expect((await review("{not json")).result.status).toBe("blocked");
    expect((await review("main;rm")).result.status).toBe("blocked");
    expect((await review({ extraReviewers: "shop-reviewer" })).result.status).toBe("blocked");
  });
});

describe("review-changes models", () => {
  it("runs the scope on Haiku with the read-only general-reviewer card and --no-renames", async () => {
    const { calls } = await review("main");
    const scope = calls[0] as AgentCall;
    expect(scope).toMatchObject({ label: "list changes", agentType: "general-reviewer", model: "haiku", effort: "low" });
    expect(scope.prompt).toContain("git diff --name-only --no-renames main");
    expect(scope.prompt).toContain("Ignore the review instructions of your card");
  });

  it("skips the scope agent when paths are given", async () => {
    const { calls } = await review({ paths: ["src/lib/editPolicy.ts"] });
    expect(calls.some((c) => c.label === "list changes")).toBe(false);
  });

  it("quick: reviewers on Sonnet except security, no refute, blocking findings unverified", async () => {
    const { result, calls } = await review("HEAD", {
      files: ALL_DOMAINS,
      reviews: { "models-reviewer": changes([finding("F1", "blocker"), finding("F2", "major")]) },
    });
    const reviews = calls.filter((c) => c.label.startsWith("review "));
    expect(reviews.map((c) => c.agentType).sort()).toEqual(
      ["general-reviewer", "imaging-reviewer", "models-reviewer", "release-reviewer", "security-reviewer", "shop-reviewer"]);
    expect(reviews.filter((c) => c.agentType !== "security-reviewer").every((c) => c.model === "sonnet")).toBe(true);
    expect(reviewCall(calls, "security-reviewer")).toMatchObject({ model: undefined, effort: "medium" });
    expect(calls.some((c) => c.label === "refute")).toBe(false);
    expect(result.status).toBe("needs_lead");
    expect(list(result, "unverified").map((f) => f.key)).toEqual(["models-reviewer:F1", "models-reviewer:F2"]);
  });

  it("full: contract, security and general reviewers on the card at medium effort, the rest on Sonnet", async () => {
    const { calls } = await review("main", {
      files: ALL_DOMAINS,
      reviews: { "shop-reviewer": changes([finding("F1", "major", "src/lib/quote.ts")]) },
      refute: verdictsFor("confirmed"),
    });
    for (const reviewer of ["general-reviewer", "security-reviewer", "models-reviewer"]) {
      expect(reviewCall(calls, reviewer)).toMatchObject({ model: undefined, effort: "medium" });
    }
    for (const reviewer of ["imaging-reviewer", "shop-reviewer", "release-reviewer"]) {
      expect(reviewCall(calls, reviewer)).toMatchObject({ model: "sonnet", effort: undefined });
    }
    const refutes = calls.filter((c) => c.label === "refute");
    expect(refutes).toHaveLength(1);
    expect(refutes[0]).toMatchObject({ agentType: "general-reviewer", model: "sonnet", effort: "medium" });
  });

  it("tells reviewers to read all their diffs in one git diff call", async () => {
    const { calls } = await review("main");
    expect(reviewCall(calls, "general-reviewer")?.prompt).toContain("First read the diff of all your files in one call, `git diff main -- <file> <file> …`");
  });

  it("routes the workflow tests to security-reviewer", async () => {
    const { result } = await review("HEAD", { files: ["tests/workflows.test.ts", "tests/support/workflowHarness.ts"] });
    expect(result.reviewers).toEqual(["security-reviewer", "general-reviewer"]);
  });
});

describe("review-changes batched refute", () => {
  it("keys duplicate ids with #2 and a refuted major alone stays green", async () => {
    const { result, calls } = await review("main", {
      reviews: { "models-reviewer": changes([finding("F1", "major"), finding("F1", "major")]) },
      refute: verdictsFor("refuted"),
    });
    const refute = calls.find((c) => c.label === "refute") as AgentCall;
    expect(keysIn(refute.prompt)).toEqual(["models-reviewer:F1", "models-reviewer:F1#2"]);
    expect(list(result, "refuted")).toHaveLength(2);
    expect(result.status).toBe("green");
  });

  it("keeps keys unique when a reviewer's own id already looks like a suffixed key", async () => {
    const { calls } = await review("main", {
      reviews: { "models-reviewer": changes([finding("F1#2", "major"), finding("F1", "major"), finding("F1", "major")]) },
      refute: verdictsFor("refuted"),
    });
    const keys = keysIn((calls.find((c) => c.label === "refute") as AgentCall).prompt);
    expect(keys).toEqual(["models-reviewer:F1#2", "models-reviewer:F1", "models-reviewer:F1#3"]);
  });

  it("a refuted blocker still needs the lead", async () => {
    const { result } = await review("main", {
      reviews: { "general-reviewer": changes([finding("F1", "blocker")]) },
      refute: verdictsFor("refuted"),
    });
    expect(list(result, "refuted")).toHaveLength(1);
    expect(result.status).toBe("needs_lead");
  });

  it("confirmed goes to confirmed, uncertain to unverified", async () => {
    const confirmed = await review("main", { reviews: { "general-reviewer": changes([finding("F1", "major")]) }, refute: verdictsFor("confirmed") });
    expect(list(confirmed.result, "confirmed")).toHaveLength(1);
    expect(confirmed.result.status).toBe("needs_lead");
    const uncertain = await review("main", { reviews: { "general-reviewer": changes([finding("F1", "major")]) }, refute: verdictsFor("uncertain") });
    expect(list(uncertain.result, "unverified")).toHaveLength(1);
    expect(uncertain.result.status).toBe("needs_lead");
  });

  it("a missing or duplicated verdict leaves the finding unverified", async () => {
    const { result } = await review("main", {
      reviews: { "general-reviewer": changes([finding("F1", "major"), finding("F2", "major"), finding("F3", "major")]) },
      refute: {
        verdicts: [
          { key: "general-reviewer:F1", outcome: "refuted", reason: "r" },
          { key: "general-reviewer:F3", outcome: "refuted", reason: "r" },
          { key: "general-reviewer:F3", outcome: "confirmed", reason: "r" },
        ],
      },
    });
    expect(list(result, "refuted").map((f) => f.key)).toEqual(["general-reviewer:F1"]);
    expect(list(result, "unverified").map((f) => f.key)).toEqual(["general-reviewer:F2", "general-reviewer:F3"]);
    expect(result.status).toBe("needs_lead");
  });

  it("an empty refuter answer leaves every finding unverified", async () => {
    const { result, logs } = await review("main", {
      reviews: { "general-reviewer": changes([finding("F1", "major"), finding("F2", "blocker")]) },
      refute: null,
    });
    expect(list(result, "unverified")).toHaveLength(2);
    expect(result.status).toBe("needs_lead");
    expect(logs.some((l) => l.includes("Refuter returned nothing"))).toBe(true);
  });

  it("ignores verdicts for unknown keys", async () => {
    const { result, logs } = await review("main", {
      reviews: { "general-reviewer": changes([finding("F1", "major")]) },
      refute: { verdicts: [{ key: "general-reviewer:F1", outcome: "refuted", reason: "r" }, { key: "x:F9", outcome: "confirmed", reason: "r" }] },
    });
    expect(list(result, "confirmed")).toHaveLength(0);
    expect(result.status).toBe("green");
    expect(logs.some((l) => l.includes("unknown keys: x:F9"))).toBe(true);
  });

  it("refutes at most 12 findings, blockers first", async () => {
    const majors = Array.from({ length: 13 }, (_, i) => finding(`M${i + 1}`, "major"));
    const { result, calls } = await review("main", {
      reviews: { "general-reviewer": changes([...majors, finding("B1", "blocker")]) },
      refute: verdictsFor("refuted"),
    });
    const keys = keysIn((calls.find((c) => c.label === "refute") as AgentCall).prompt);
    expect(keys).toHaveLength(12);
    expect(keys[0]).toBe("general-reviewer:B1");
    expect(list(result, "refuted")).toHaveLength(12);
    expect(list(result, "unverified").map((f) => f.key)).toEqual(["general-reviewer:M12", "general-reviewer:M13"]);
  });

  it("does not send a finding with a noncanonical file to the refuter", async () => {
    const { result, calls } = await review("main", {
      reviews: { "general-reviewer": changes([finding("F1", "major", "/abs/path.ts")]) },
      refute: verdictsFor("refuted"),
    });
    expect(calls.some((c) => c.label === "refute")).toBe(false);
    expect(list(result, "unverified")).toHaveLength(1);
  });

  it("collects minor findings without blocking", async () => {
    const { result } = await review("main", { reviews: { "general-reviewer": { ...approve, findings: [finding("F1", "minor")] } } });
    expect(result.status).toBe("green");
    expect(list(result, "minor")).toHaveLength(1);
  });
});

describe("review-changes needs_lead and blocked", () => {
  it("scope agent returned nothing", async () => {
    const { result } = await review("main", { scope: null });
    expect(result).toMatchObject({ status: "needs_lead", depth: "full", scopeError: "scope agent returned nothing" });
  });

  it("scope reported an error", async () => {
    const { result } = await review("HEAD", { scope: { files: [], error: "git diff failed" } });
    expect(result).toMatchObject({ status: "needs_lead", depth: "quick", scopeError: "git diff failed" });
  });

  it("an empty file list is needs_lead, not green", async () => {
    const { result, calls } = await review("main", { files: [] });
    expect(result.status).toBe("needs_lead");
    expect(result.reviewProblems).toEqual(["no changed files found; confirm the empty diff"]);
    expect(calls).toHaveLength(1);
  });

  it("a reviewer that returns nothing", async () => {
    const { result } = await review("main", { files: ["src/lib/server/meta.ts"], reviews: { "security-reviewer": null } });
    expect(result.status).toBe("needs_lead");
    expect(result.missingReviewers).toEqual(["security-reviewer"]);
  });

  it("changes_required without a blocking finding", async () => {
    const { result } = await review("main", { reviews: { "general-reviewer": { ...approve, verdict: "changes_required" } } });
    expect(result.status).toBe("needs_lead");
    expect(result.reviewProblems).toEqual(["general-reviewer: changes_required without blocking findings"]);
  });

  it("a private path from the scope is blocked", async () => {
    const { result } = await review("main", { files: ["src/lib/editPolicy.ts", ".env.local"] });
    expect(result).toMatchObject({ status: "blocked", depth: "full" });
  });
});

// ---------- build-ticket ----------
const DONE_WHEN = ["tests pass"];
const VERIFY_CHECKS = ["npm run build", "npm run lint", "npm run typecheck", "npm test"];
const UNIT = {
  id: "U1", domain: "models", task: "t", files: ["src/lib/editPolicy.ts", "tests/edit.test.ts"],
  dependsOn: [], extraReviewers: ["security-reviewer"],
};
const verifyPass = { checks: VERIFY_CHECKS.map((command) => ({ command, result: "pass", output: "ok" })), fixes: [], remainingFailures: [], needsLead: [] };

interface BuildSetup {
  reviews?: (reviewer: string, round: number) => unknown;
  verify?: unknown;
}
function buildTicket(setup: BuildSetup = {}) {
  return runWorkflow("build-ticket.js", "T9", (opts: AgentOpts) => {
    const label = opts.label ?? "";
    if (label === "plan T9") return { ready: true, blockers: [], doneWhen: DONE_WHEN, units: [UNIT], notes: "" };
    if (label.startsWith("U1 build")) return { summary: "s", filesChanged: UNIT.files, checks: [], responses: [], needsLead: [], notes: "" };
    if (label === "verify") return "verify" in setup ? setup.verify : verifyPass;
    if (label === "gate T9") return { items: DONE_WHEN.map((item) => ({ item, status: "met", evidence: "e" })), findings: [], summary: "s" };
    const round = Number(label.slice(-1));
    return setup.reviews ? setup.reviews(opts.agentType ?? "", round) : approve;
  });
}

describe("build-ticket models", () => {
  it("keeps plan, first reviews and gate on the card; Verify runs on Haiku in Mode: verify", async () => {
    const { result, calls } = await buildTicket();
    expect(result.status).toBe("green");
    for (const label of ["plan T9", "U1 models-reviewer r1", "U1 security-reviewer r1", "U1 general-reviewer r1", "gate T9"]) {
      expect(calls.find((c) => c.label === label)).toMatchObject({ model: undefined });
    }
    const verify = calls.find((c) => c.label === "verify") as AgentCall;
    expect(verify).toMatchObject({ agentType: "general-reviewer", model: "haiku", effort: "low" });
    expect(verify.prompt.startsWith("Mode: verify.")).toBe(true);
  });

  it("rechecks on Sonnet from round 2 (security stays on its card), and a reviewer without a first review gets the card and the round-1 task", async () => {
    const { result, calls } = await buildTicket({
      reviews: (reviewer, round) => {
        if (round === 1 && reviewer === "models-reviewer") return changes([finding("F1", "blocker")]);
        if (round === 1 && reviewer === "general-reviewer") return null;
        if (reviewer === "models-reviewer") return { ...approve, recheck: [{ findingId: "models-reviewer:r1:F1", status: "resolved", reason: "r" }] };
        return approve;
      },
    });
    expect(result.status).toBe("green");
    const models = calls.find((c) => c.label === "U1 models-reviewer r2") as AgentCall;
    expect(models.model).toBe("sonnet");
    expect(models.prompt).toContain("Recheck these findings");
    expect(calls.find((c) => c.label === "U1 security-reviewer r2")).toMatchObject({ model: undefined, effort: "medium" });
    const general = calls.find((c) => c.label === "U1 general-reviewer r2") as AgentCall;
    expect(general.model).toBeUndefined();
    expect(general.prompt).toContain("Report your findings.");
    expect(general.prompt).not.toContain("Raise new findings only if");
  });

  it("a failing or missing Verify is needs_lead", async () => {
    const failed = { ...verifyPass, checks: verifyPass.checks.map((c, i) => (i === 3 ? { ...c, result: "fail" } : c)), remainingFailures: ["tests/edit.test.ts"] };
    expect((await buildTicket({ verify: failed })).result.status).toBe("needs_lead");
    expect((await buildTicket({ verify: null })).result.status).toBe("needs_lead");
  });
});

// ---------- fix-until-green ----------
const FIX_CHECKS = ["npm run typecheck", "npm run lint", "npm test", "npm run build"];
interface FixSetup { file: string; reported?: string; review?: unknown; check?: unknown }
function fixUntilGreen(setup: FixSetup) {
  return runWorkflow("fix-until-green.js", undefined, (opts: AgentOpts) => {
    const label = opts.label ?? "";
    if (label === "check r1") {
      if ("check" in setup) return setup.check;
      return {
        checks: FIX_CHECKS.map((command) => ({ command, result: command === "npm test" ? "fail" : "pass", output: "o" })),
        failures: [{ check: "npm test", file: setup.file, message: "m" }],
      };
    }
    if (label.startsWith("check")) return { checks: FIX_CHECKS.map((command) => ({ command, result: "pass", output: "ok" })), failures: [] };
    if (label.startsWith("fix")) return { filesChanged: [setup.reported ?? setup.file], fixed: ["x"], notFixed: [] };
    if (label === "review fixes") return "review" in setup ? setup.review : approve;
    return null;
  });
}

describe("fix-until-green models", () => {
  it("checks on Haiku with the read-only card and reviews a UI fix on Sonnet", async () => {
    const { result, calls } = await fixUntilGreen({ file: "src/components/Workspace.tsx" });
    expect(result.status).toBe("green");
    const checks = calls.filter((c) => c.label.startsWith("check"));
    expect(checks).toHaveLength(2);
    for (const check of checks) {
      expect(check).toMatchObject({ agentType: "general-reviewer", model: "haiku", effort: "low" });
      expect(check.prompt.startsWith("Mode: verify.")).toBe(true);
    }
    expect(calls.find((c) => c.label === "review fixes")).toMatchObject({ model: "sonnet", effort: "medium" });
  });

  it.each(["src/lib/server/budget.ts", "src/components/BudgetBanner.tsx"])("keeps the Opus card for a fix in security path %s", async (file) => {
    const { calls } = await fixUntilGreen({ file });
    expect(calls.find((c) => c.label === "review fixes")).toMatchObject({ model: undefined, effort: "medium" });
  });

  it("maps an absolute path from a session worktree back to the repo path", async () => {
    const { result } = await fixUntilGreen({
      file: "src/components/Workspace.tsx",
      reported: "/Users/x/Hackathon/dreambike/.claude/worktrees/w1/src/components/Workspace.tsx",
    });
    expect(result.status).toBe("green");
    expect((result.fixes as Obj[])[0]?.filesChanged).toEqual(["src/components/Workspace.tsx"]);
  });

  it("a rejected fix review gives green_fix_review_failed", async () => {
    const { result } = await fixUntilGreen({ file: "src/components/Workspace.tsx", review: { verdict: "changes_required", findings: [] } });
    expect(result.status).toBe("green_fix_review_failed");
  });

  it("a check agent that returns nothing is needs_lead", async () => {
    const { result } = await fixUntilGreen({ file: "src/components/Workspace.tsx", check: null });
    expect(result.status).toBe("needs_lead");
  });
});

describe("fix-until-green keeps Opus wherever review-changes calls security-reviewer", () => {
  // Every literal security path from the review-changes RULES, plus suffixed
  // variants, because some rules there have no end anchor.
  const SECURITY_PATHS = [
    "budget/reserve.lua", "src/lib/server/budget.ts", "src/lib/server/config.ts", "src/lib/server/fetch-product.ts",
    "src/lib/server/meta.ts", "src/lib/server/http.ts", "src/lib/server/paid.ts", "tests/budget.test.ts",
    "src/app/api/edit/route.ts", "spike/ledger.py", "spike/common.py", "spike/deployment.py", "spike/run_all.py",
    "spike/responses_sam.py", "spike/responses_spark.py", "spike/images_edits.py", "spike/asr_transcribe.py",
    "spike/files.py", "spike/requirements.txt", "next.config.ts", ".env.example", ".gitignore",
    ".claude/workflows/x.js", ".claude/agents/x.md", "src/middleware.ts", "src/proxy.ts", "src/lib/contracts.ts",
    "src/lib/errors.ts", "package.json", "package-lock.json", "vercel.json", "vitest.config.ts", "eslint.config.mjs",
    "tests/config.test.ts", "tests/fetch-product.test.ts", "tests/http.test.ts", "tests/deployment.test.ts",
    "tests/workflows.test.ts", "tests/paid.test.ts", "tests/support/workflowHarness.ts",
    "src/components/BudgetBanner.tsx", "src/components/ErrorNotice.tsx", "src/components/DemoBanner.tsx",
    "src/components/ModeBanner.tsx",
  ];
  const probes = SECURITY_PATHS.flatMap((p) => [p, `${p}x`, `${p}.bak`]);

  it.each(probes)("%s", async (file) => {
    const { calls: reviewCalls } = await review({ paths: [file] }, { files: [file] });
    const routed = Boolean(reviewCall(reviewCalls, "security-reviewer"));
    // The listed paths themselves must route to security; suffixed variants only where a rule has no end anchor.
    if (SECURITY_PATHS.includes(file)) expect(routed).toBe(true);
    if (!routed) return;
    const { calls } = await fixUntilGreen({ file });
    expect(calls.find((c) => c.label === "review fixes")).toMatchObject({ model: undefined, effort: "medium" });
  });

  it("a suffixed server path fails on the card review even when Sonnet would approve", async () => {
    const file = "src/lib/server/meta.tsx";
    const { result, calls } = await runWorkflow("fix-until-green.js", undefined, (opts: AgentOpts) => {
      const label = opts.label ?? "";
      if (label === "check r1") {
        return {
          checks: FIX_CHECKS.map((command) => ({ command, result: command === "npm test" ? "fail" : "pass", output: "o" })),
          failures: [{ check: "npm test", file, message: "m" }],
        };
      }
      if (label.startsWith("check")) return { checks: FIX_CHECKS.map((command) => ({ command, result: "pass", output: "ok" })), failures: [] };
      if (label.startsWith("fix")) return { filesChanged: [file], fixed: ["x"], notFixed: [] };
      if (label === "review fixes") {
        return opts.model === "sonnet" ? approve : changes([finding("F1", "major", file)]);
      }
      return null;
    });
    expect(calls.find((c) => c.label === "review fixes")?.model).toBeUndefined();
    expect(result.status).toBe("green_fix_review_failed");
  });
});

describe("malformed JSON args are blocked", () => {
  it.each(["build-ticket.js", "fix-until-green.js", "review-changes.js"])("%s", async (name) => {
    const { result, calls } = await runWorkflow(name, "{", () => null);
    expect(result.status).toBe("blocked");
    expect(calls).toHaveLength(0);
  });
});
