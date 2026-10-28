# Codex report: workflow cost changes (a8bb7dd)

## Verdict
fail

## Findings
### C1 [major] .claude/workflows/fix-until-green.js:26 — Suffix-bearing security paths can receive a Sonnet fix review and return green
- Condition violated: 5
- Inputs: Default args; first check fails at `src/lib/server/meta.tsx`; the fixer reports that file; the second check passes. Sonnet returns `approve`; the card-model review would return a major finding. `review-changes.js`’s security rule matches this path because its `\.ts` alternative is not end-anchored, while `OPUS_REVIEW_RE` requires `\.ts$`.
- Result now: `status: "green"`; `review fixes` runs with `model: "sonnet"`.
- Expected: `green_fix_review_failed` with the proof’s card-model output; never `green` solely on the Sonnet approval.
- Proof:
  ```ts
  it("uses the card model for every security-rule path", async () => {
    const file = "src/lib/server/meta.tsx";
    const commands = ["npm run typecheck", "npm run lint", "npm test", "npm run build"];
    const report = (fail = false) => ({
      checks: commands.map(command => ({
        command,
        result: fail && command === "npm test" ? "fail" : "pass",
        output: "o",
      })),
      failures: fail ? [{ check: "npm test", file, message: "m" }] : [],
    });

    const { result, calls } = await runWorkflow("fix-until-green.js", undefined, opts => {
      if (opts.label === "check r1") return report(true);
      if (opts.label === "fix models-builder r1")
        return { filesChanged: [file], fixed: ["x"], notFixed: [] };
      if (opts.label === "check r2") return report();
      if (opts.label === "review fixes") {
        return opts.model === "sonnet"
          ? { verdict: "approve", findings: [] }
          : { verdict: "changes_required",
              findings: [{ severity: "major", file, claim: "c", requiredFix: "f" }] };
      }
      return null;
    });

    expect(calls.find(c => c.label === "review fixes")?.model).toBeUndefined();
    expect(result.status).toBe("green_fix_review_failed");
  });
  ```
  Current failure: `expected "green" to be "green_fix_review_failed"`.
- Fix: Make `OPUS_REVIEW_RE` a conservative superset of the security `RULES`, including their non-end-anchored server, spike, `next.config.ts`, and middleware alternatives.

### C2 [minor] .claude/workflows/build-ticket.js:34 — Malformed JSON workflow arguments cause an uncaught exception
- Condition violated: crash
- Inputs: `runWorkflow("build-ticket.js", "{", () => null)`.
- Result now: Uncaught `SyntaxError: Expected property name or '}' in JSON at position 1`; no status is returned.
- Expected: `blocked`
- Proof: `await expect(runWorkflow("build-ticket.js", "{", () => null)).resolves.toMatchObject({ result: { status: "blocked" } })` rejects with the stated `SyntaxError`.
- Fix: Catch `JSON.parse` failures in `parseArgs` and return a parse-error sentinel handled as `blocked`.

### C3 [minor] .claude/workflows/fix-until-green.js:32 — Malformed JSON workflow arguments cause an uncaught exception
- Condition violated: crash
- Inputs: `runWorkflow("fix-until-green.js", "{", () => null)`.
- Result now: Uncaught `SyntaxError: Expected property name or '}' in JSON at position 1`; no status is returned.
- Expected: `blocked`
- Proof: `await expect(runWorkflow("fix-until-green.js", "{", () => null)).resolves.toMatchObject({ result: { status: "blocked" } })` rejects with the stated `SyntaxError`.
- Fix: Catch `JSON.parse` failures in `parseArgs` and return `blocked`.

## Checked without finding
- Condition 1: Tried null and empty refuter answers, missing/duplicate/unknown verdict keys, duplicate and suffix-like IDs, noncanonical finding paths, confirmed/uncertain outcomes, the cap, and refuted blockers; none incorrectly returned green.
- Condition 2: Tried null reviewers, scope errors, empty scopes, duplicate files, and unsafe scope paths; all produced `needs_lead` or `blocked`.
- Condition 3: Traced initial reviews, delayed first reviews, batching, and rechecks; first reviews retain card models and security reviews/rechecks retain the security card.
- Condition 4: Tried missing, duplicate, unknown, failed, and `not_run` checks plus nonempty Verify `fixes`, `remainingFailures`, and `needsLead`; none returned green.
- Condition 5: Compared every security rule with `OPUS_REVIEW_RE`; the suffix-anchor mismatch is C1, while ordinary listed security paths retained the card model.

## Commands run
- `git diff d220d74..a8bb7dd -- …`: inspected the specified scripts, tests, harness, and context change.
- `nl -ba` / `sed -n` on all required files: completed line-by-line review.
- `npx --no-install vitest run tests/workflows.test.ts`: 39 tests passed.
- `npx --no-install vitest run --root /tmp/dreambike-codex-workflow-review workflow-edge-cases.test.ts`: 3 proof tests failed as expected.
- `git log --oneline d220d74..a8bb7dd`: confirmed commits `7619593`, `8b33fc1`, and `a8bb7dd`.
- `git status --short`: reported `?? node_modules`; no repository files were changed by this review.
