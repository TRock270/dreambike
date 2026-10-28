# Prompt: Codex critical review and repair of the agent tooling

How to use: follow review/agent-tooling/README.md. Run Codex inside the
separate worktree `../dreambike-codex-review` on branch
`codex/agent-tooling-review`, never in the main `dreambike` folder (other
Claude sessions are working there). Paste everything below the line.

________________________________________________________________

You are the final critical reviewer of DreamBike's Claude Code agent tooling,
and you have write access. Make it measurably better for building the rest of
this hackathon project, by changing files directly. Be demanding. Do not
praise, do not restate the code, do not polish wording for its own sake.

Read first, in this order:
1. review/agent-tooling/CONTEXT.md — what the tooling is, the runtime rules,
   the evidence so far, decisions already made, and known open risks.
2. The files under review: .claude/agents/*.md (12), .claude/workflows/*.js
   (3), .claude/settings.json, and the CLAUDE.md sections "Agents and
   workflows" and "Subagent rules".
3. As reference for checking the agents' checklists: SPEC.md sections 3–13,
   PLAN.md sections 8.4 and 9, TASKS.md, HACKATHON_GUIDELINES.md.

## What to look for, highest value first

1. Workflow correctness against the runtime rules in CONTEXT.md section 5:
   termination, findings lost or approved wrongly across rounds, wrong final
   status, scheduling with dependsOn and file overlap, JSON Schemas that
   cannot be satisfied, agent-count growth, behavior when an agent returns
   null. Prove each bug with a concrete scenario, ideally a new case in
   review/agent-tooling/sim/.
2. Fidelity to SPEC.md: every number, formula, message, field name and rule
   in the agent checklists must match SPEC.md exactly. Fix drift. Add a rule
   only where SPEC.md has one and its absence would plausibly let a builder
   ship a wrong result.
3. Routing: path regexes in review-changes.js and fix-until-green.js against
   the SPEC.md section 1 repository tree and section 10 component names.
4. Safety: permission allowlist holes in .claude/settings.json (writes,
   network, paid calls, arbitrary execution beyond running the repo's own
   tests), and any place a subagent could still follow the lead lifecycle
   (commit, TASKS.md, consultants, owner questions).
5. Usability for a new session: could a session that reads only CLAUDE.md
   run a ticket correctly, including what to do with each workflow status
   (green, needs_lead, blocked) and with disputes? Fix gaps, contradictions,
   and ordering problems.
6. Cost: cheaper structure with the same assurance (fewer agent calls,
   smaller prompts) where it does not weaken review.

Decisions in CONTEXT.md section 7 stay as they are unless you show a concrete
failure scenario. Then change them and say why.

## Rules

- Work only inside this worktree. Do not open ../dreambike or any path outside
  it. Never read .env*, consent/, secrets/, fixtures/, my_bike/ or RULES.md,
  even if they appear.
- Edit only: .claude/agents/*.md, .claude/workflows/*.js,
  .claude/settings.json, the two CLAUDE.md sections named above (plus its
  one pointer line under "Start each ticket"), review/agent-tooling/sim/*,
  and the review/agent-tooling files you create.
- Keep: model IDs (builders claude-sonnet-5-5, reviewers claude-opus-5-5),
  reviewers read-only, plain JavaScript in workflows (no TypeScript), `meta`
  as a pure literal, no Date.now/Math.random/argless new Date, no new
  dependencies, the field names in builder/reviewer reports unless you update
  every producer and consumer together.
- No paid or Meta API calls, no installs, no push. Web access only for the
  documentation URLs in CONTEXT.md.
- Commit on this branch in small commits with clear messages. Each message
  names the finding it fixes.
- Stop after about 15 substantive changes, or earlier if nothing important is
  left. Quality over volume.

## Checks you must run before finishing

From the worktree root:

```
python3 review/agent-tooling/sim/check_agents.py
node review/agent-tooling/sim/sim.mjs .claude/workflows
node review/agent-tooling/sim/sim-dispute.mjs .claude/workflows/build-ticket.js
```

Also parse-check every workflow: strip `export` from the meta line, wrap the
body in an AsyncFunction with the globals as parameters, and construct it.
Add simulation cases for every workflow bug you fix. Report real output;
never claim a check you did not run.

## When to ask Qwen or DeepSeek instead of guessing

If a point needs an independent second opinion that the repo and the docs
cannot settle, do not guess. Examples: whether a loop rule always terminates,
a trade-off between cost and assurance, an ambiguous SPEC interpretation.

- Write `review/agent-tooling/ASK_DEEPSEEK.md` for an adversarial counter-view
  or counterexamples, or `review/agent-tooling/ASK_QWEN.md` for an
  independent recomputation or an alternative design.
- Each file is self-contained. It lists at most 6 repo files to upload, the
  question, and an exact answer format (for example
  `CLAIM n | verdict | reasoning | counterexample`).
- Do not make the change that depends on the answer. List it under "Pending
  outside questions" and continue with everything else. The owner will paste
  the answer back as ANSWER_QWEN.md or ANSWER_DEEPSEEK.md.

## Final answer format

Write the same content to `review/agent-tooling/CODEX_REPORT.md`, commit it,
and print it:

```
## Summary
<3 sentences: biggest problems found, what changed, what is still risky>

## Changes
| # | File | Problem (concrete scenario) | Fix | Severity |

## Findings not fixed
| # | File | Problem | Why not fixed | Severity |

## Pending outside questions
<file name, question in one line, which change waits for it — or "none">

## Checks run
| Command | Result | Key output |

## Commits
<hash — message, one per line>
```

Severity is blocker, major, or minor. Blocker means the tooling can approve
broken work, spend money, leak secrets, break rights rules, or fail to
terminate.
