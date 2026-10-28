# Prompt: Codex read-only check of the workflow cost changes

How to use: follow review/workflow-cost/README.md. Paste everything below
the line into Codex, started in the separate worktree.

________________________________________________________________

You are a read-only critical reviewer. Do not edit, create or delete any
file in this repository, do not commit, and do not run anything that needs
the network. Do not praise and do not restate the code.

Read first: review/workflow-cost/CONTEXT.md. Then the three scripts
`.claude/workflows/review-changes.js`, `.claude/workflows/build-ticket.js`,
`.claude/workflows/fix-until-green.js`, and the mock tests
`tests/workflows.test.ts` with `tests/support/workflowHarness.ts`. The
change under review is `git diff d220d74..a8bb7dd`.

## The one question

Is there any combination of agent outputs (including null, empty arrays,
odd ids, odd file paths, duplicate or unknown verdict keys) or workflow
arguments for which a script returns a passing status although it should
not? Passing means `green` for review-changes and build-ticket, and `green`
without `green_fix_review_failed` for fix-until-green. "Should not" means at
least one of these holds:

1. A blocker or major finding was not judged `refuted` by exactly one
   verdict, or a refuted finding is a blocker (review-changes).
2. An assigned reviewer returned nothing, or the scope failed or was empty
   (review-changes).
3. A reviewer's first review of a unit never ran on its card model, or a
   security-reviewer review or recheck ran on Sonnet (build-ticket,
   review-changes).
4. A requested check did not pass exactly once, or Verify reported an edit,
   a remaining failure or needsLead (build-ticket).
5. A fix touching a security path (any path the security-reviewer RULES in
   review-changes.js match) was reviewed on Sonnet (fix-until-green).

Also report a crash (uncaught exception) only if a plausible agent output
or argument triggers it.

Stay inside these three scripts and this question. Owner decisions in
CONTEXT.md section 4 are not findings. Style, wording and cost ideas are out
of scope.

## How to prove a finding

Give concrete inputs. Best is a vitest case written against
`tests/support/workflowHarness.ts` (`runWorkflow(name, args, respond)`) that
fails on the current code. Run such a test from a scratch copy outside the
repo or paste it into your answer; do not add it to the repo. You may run
`npx --no-install vitest run tests/workflows.test.ts` and `git diff`,
`git show`, `git log` read-only.

## Answer format (exactly this, Markdown)

```
# Codex report: workflow cost changes (a8bb7dd)

## Verdict
pass | fail   (fail if any blocker or major below)

## Findings
### C1 [blocker|major|minor] <file>:<line> — <one-line claim>
- Condition violated: <1–5 from the question, or "crash">
- Inputs: <exact agent outputs / args>
- Result now: <status and fields the script returns>
- Expected: <status>
- Proof: <vitest case or exact trace>
- Fix: <smallest change>

(repeat; at most 10, most severe first; write "None." if there are none)

## Checked without finding
- <one line per condition 1–5: what you tried>

## Commands run
- <command>: <result>
```
