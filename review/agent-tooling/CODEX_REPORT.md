## Summary
Workflow success could be reported without complete checks, acceptance coverage, or a completed review, and failed agents could lose findings or edit evidence.
Repaired 15 areas in the isolated `dreambike-codex-review` worktree on `codex/agent-tooling-review`; all 64 adversarial cases and 44 static permission assertions pass.
Unsandboxed command execution, shared-working-tree races, and untested live Claude integration remain risks.

## Changes
Workflow filenames below refer to `.claude/workflows/`; agent filenames refer to `.claude/agents/`.

| # | File | Problem (concrete scenario) | Fix | Severity |
| --- | --- | --- | --- | --- |
| 1 | build-ticket.js | Empty/partial Verify reports, remainingFailures, or needsLead could still produce green; Verify could change code after specialist approval. | Require one passing result per exact requested command, no outstanding blockers or edits; make Verify read-only. | blocker |
| 2 | build-ticket.js | Auditing the first acceptance item twice satisfied the count while omitting the second. | Match the complete acceptance-item multiset and require every item met. | blocker |
| 3 | build-ticket.js | Unknown/self dependencies were deleted; cycles threw; independent units could overwrite the same approved file. | Reject invalid graphs and unordered shared files before building; support ordinary IDs such as constructor. | major |
| 4 | build-ticket.js | An out-of-scope edit could be approved; later reports/null builders hid earlier changed paths and disputes. | Validate ownership, retain cumulative edit/dispute evidence, expose owned paths even on first-round failure. | major |
| 5 | build-ticket.js | changes_required without findings counted as approval; a skipped recheck counted as an upheld dispute and stopped early. | Retain incomplete-review diagnostics; distinguish explicit upheld status from missing rechecks; preserve dispute evidence. | blocker |
| 6 | build-ticket.js | A fourth required reviewer was dropped; a specialist that approved round 1 never saw edits caused by another reviewer. | Run all assigned specialists after edits, batching three per unit; retain the cheaper no-edit dispute path. | blocker |
| 7 | fix-until-green.js; build-ticket.js | Empty check arrays passed vacuously; invalid round/check arguments could skip intended work. | Validate arguments before dispatch and require complete, exact check evidence; preserve earlier results when a check agent fails. | blocker |
| 8 | fix-until-green.js | A null fixer could leave edits unreported; unrestricted ownership allowed arbitrary extra files; empty filesChanged could bypass review. | Stop for the lead on failure/blockers, restrict fixes to explicit located paths, and review every attempted file scope. | major |
| 9 | fix-until-green.js | Null final review, or approve with a major finding, left status green. | Require a completed approving review without blocker/major findings; otherwise green_fix_review_failed. | blocker |
| 10 | review-changes.js | Failed scope discovery looked like an empty diff; the scope schema could not report a git error; missing reviewers lacked a final status. | Add scope error reporting and consistent statuses; reject unsafe refs/private paths and retain missing/inconsistent review diagnostics. | blocker |
| 11 | review-changes.js | Failed refute thunks disappeared; refuters lacked the chosen base; 12 refuters plus five unfinished reviews could exceed 16 active agents. | Preserve failed/capped findings as unverified, supply base/scope, and finish reviews before bounded refutations. | blocker |
| 12 | review-changes.js; fix-until-green.js | Shared contracts, slots, several named UI components, check-route policy, PDF/HTTP tests, and tooling changes missed their specialists. | Expand routing, union repeated specialist matches, and honor extra reviewers across the whole requested scope. | major |
| 13 | .claude/settings.json; all agents | Wildcard test commands accepted external config/reporter code; npx could install; Write and .env.local denial gaps remained. | Allow exact offline commands with --no-install, complete private-path/Edit/Write denials, remove ToolSearch, retain WebFetch/WebSearch. | blocker |
| 14 | models-*, imaging-*, shop-*, release-reviewer.md | Checklists omitted ASR wire details, current estimate acknowledgments and candidate/resume rules; release review explicitly requested private RULES.md. | Align with SPEC 5–7/11, require real PDF QA evidence, and route private rules/consent verification to the lead. | blocker |
| 15 | CLAUDE.md; general-*; review/agent-tooling/sim/ | Inline/workflow instructions conflicted; repair green skipped specialists; report modes conflicted; old simulations exited successfully even when intended green cases were red. | Document status/dispute/recovery order and schema modes; require specialist repair review; add assertions, schema/concurrency regressions, parse and scope audits. | major |

The initial 43-case adversarial run had 41 failures. The final suite adds boundary/diagnostic cases and passes 64/64.
Decisions reopened with concrete scenarios: Verify editing bypassed specialist approval; reviewer capping dropped required coverage; wildcard test flags loaded code outside the repo; .env.local/private-file access remained permitted through missing denials.
No dependencies were added and no paid calls or pushes were made.

## Findings not fixed
| # | File | Problem | Why not fixed | Severity |
| --- | --- | --- | --- | --- |
| 1 | .claude/settings.json | Allowed repository tests/builds still execute code with ambient filesystem/network access and can bypass tool-level secret restrictions. | CONTEXT 8 reserves the repository-wide Bash sandbox decision for the owner; exact commands are not a sandbox. | blocker |
| 2 | .claude/workflows/*.js | Another session can change an already-reviewed file or its imported dependency before final verification/commit. | No shared-tree isolation or revision snapshot exists in the documented workflow globals; unit ordering only controls this run. | blocker |
| 3 | All tooling | Local stubs and static permission checks do not prove live Claude permission/schema/runtime behavior. | No paid agent invocation was authorized for this review; no installs or live workflow runs were performed. | major |

## Pending outside questions
none

## Checks run
All commands ran from the review worktree root; simulation results use stubbed agents, not live model calls.

| Command | Result | Key output |
| --- | --- | --- |
| `shasum -a 256 -c review/agent-tooling/FILES.sha256` | Pass before edits | All 22 review-base entries OK. |
| `python3 review/agent-tooling/sim/check_agents.py` | Pass | All 12 agents OK; ALL OK. |
| `node review/agent-tooling/sim/sim.mjs .claude/workflows` | Pass | build-ticket green; fix-until-green green; ALL SIM ASSERTIONS PASSED. |
| `node review/agent-tooling/sim/sim-dispute.mjs .claude/workflows/build-ticket.js` | Pass | needs_lead; unresolved; rounds 2; disputes 1; builds 2; DISPUTE ASSERTIONS PASSED. |
| `node review/agent-tooling/sim/regressions.mjs .claude/workflows` | Pass | 64 cases; 64 passed; 0 failed; includes the 87-call/12-active ticket bound. |
| `node review/agent-tooling/sim/permissions.mjs` | Pass | 44 permission assertions passed; static model, live sandbox not exercised. |
| `node review/agent-tooling/sim/parse-workflows.mjs .claude/workflows` | Pass | PARSE OK for all three workflows after stripping export and constructing AsyncFunction with the documented globals. |
| `python3 review/agent-tooling/sim/audit_scope.py` | Pass | Authorized changed paths only; CLAUDE.md outside permitted sections/pointer unchanged. |
| `git diff --check agent-tooling-review-base` | Pass | No output. |

## Commits
Implementation and regression commits; the report/audit commit itself is excluded to avoid a self-referential hash.

- d105fab — Reproduce false-green approvals, lost findings, and routing gaps
- db45ab3 — Fix false-green ticket gates, stale approvals, and invalid unit graphs
- 2223815 — Fix missing check evidence, null fix reviews, and unbounded fixer scope
- e7d5e6d — Preserve failed reviews and refutes and bound review concurrency
- 485f57c — Close specialist re-review gaps and route shared contracts and failure paths
- 4e06446 — Fix SPEC checklist omissions and private-file and ToolSearch escape paths
- 9b584e7 — Close arbitrary test-flag allowances and secret Write denial gaps
- 29b1f36 — Fix workflow status handling and simulations that passed without assertions
- 60908c7 — Keep owned paths visible when a builder fails before reporting
