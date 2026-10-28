# Context: cost changes to the review workflows

Self-contained background for a read-only review of three Claude Code
workflow scripts. You need nothing outside this repo.

## 1. What the workflows do

DreamBike is a hackathon app. The lead Claude session uses three workflow
scripts in `.claude/workflows/` to build and review code with subagents.
Each subagent has a "card" in `.claude/agents/*.md` with a default model
(builders on Sonnet, reviewers on Opus).

- `review-changes.js` reviews the current diff. Path rules (`RULES`) assign
  specialist reviewers; `general-reviewer` always joins. It returns a status
  the lead acts on: `green` (safe to commit), `needs_lead` (the lead decides
  each item), `blocked` (bad arguments or unsafe scope).
- `build-ticket.js` runs a plan check, then per unit a builder/reviewer loop
  of up to 3 rounds, then a read-only Verify step and a done-when gate.
- `fix-until-green.js` runs checks, lets domain builders fix located
  failures, then has `general-reviewer` review the fixes.

## 2. Runtime rules (Claude Code workflow scripts)

- Plain JavaScript body run as an async function; top-level `await` and
  `return` are allowed. `export const meta = {...}` comes first.
- `agent(prompt, {label, phase, agentType, model, effort, schema})` returns
  the subagent's structured output or **null on any failure**. `schema` is a
  JSON Schema the runtime enforces on the output.
- `agentType` uses the card's model unless `model` is passed. `effort`
  sets reasoning effort.
- `parallel(thunks)` is a barrier; a thunk that throws yields null.
- No file system access from the script; agents read and run git themselves.

## 3. What changed (commits 7619593, 8b33fc1, a8bb7dd on top of d220d74)

The goal was lower cost at about 95 % of the review quality. Measured on the
same 8-file diff with `/review-changes main`: 2.50 USD and 8 agents before,
1.53 USD and 5 agents after, same blocking findings.

review-changes.js:
- New `depth` argument: `full` by default for base `main`/`origin/main`,
  else `quick`. Invalid depth is `blocked`; `depth` is in every result.
- quick: reviewers run on Sonnet, no refute; every blocker/major goes to
  `unverified`, so the status is `needs_lead`.
- full: general/models reviewers stay on their Opus card at effort medium;
  imaging/shop/release reviewers run on Sonnet.
- security-reviewer always keeps its Opus card at effort medium (both
  depths), because the parent rules require Opus for security work.
- One batched refuter (general-reviewer, Sonnet, effort medium) replaces one
  refute agent per finding. Each blocking finding gets key `reviewer:id`;
  duplicates get `#2`, `#3`. Blockers are sorted first; at most 12
  (`MAX_REFUTES`) are sent. A missing or duplicated verdict, or a null
  refuter answer, leaves the finding `unverified`.
- A refuted **blocker** still gives `needs_lead`. A refuted major alone may
  give `green` (owner decision).
- An empty file list gives `needs_lead` instead of `green`.
- Scope agent: general-reviewer card (no Edit/Write tools) on Haiku,
  `git diff --name-only --no-renames <base>` plus untracked files.

build-ticket.js:
- From round 2, a reviewer that already returned a review for the unit runs
  on Sonnet; a reviewer without one (`notYetReviewed`) gets the round-1
  prompt on its card ("firstLook"). security-reviewer rechecks keep its
  card at effort medium.
- Verify runs on the read-only general-reviewer card on Haiku, effort low,
  in "Mode: verify" (run exactly the listed checks, repair nothing).
- `repoPath()` maps absolute paths reported by agents to repo paths,
  including a session worktree under `.claude/worktrees/<name>/`.

fix-until-green.js:
- The check runs on the read-only general-reviewer card on Haiku.
- The fix review runs on Sonnet at effort medium, unless a changed file
  matches `OPUS_REVIEW_RE` (security paths, a copy of the security-reviewer
  RULES in review-changes.js); then it keeps the Opus card.

## 4. Owner decisions (do not reopen without a concrete failure scenario)

- quick runs every reviewer except security-reviewer on Sonnet.
- In full, imaging-reviewer runs on Sonnet.
- A refuted major alone may end green; a refuted blocker never does.
- One refuter for all findings; cap 12, blockers first.
- The project has no formatter; builders get no format step.

## 5. Known open point (minor, deferred)

In a session worktree, `repoPath` also maps an absolute path in the main
checkout to a repo path, so a builder edit in the wrong checkout is not
flagged as out of scope. Verify and the gate run in the active checkout, so
this should not produce green. Mention it only if you find that it can.

## 6. How to check

- Mock tests run the scripts offline with a mocked `agent()` and
  `parallel()`: `tests/support/workflowHarness.ts` and
  `tests/workflows.test.ts` (39 tests).
- Run them with `npx --no-install vitest run tests/workflows.test.ts`
  (needs `node_modules`; see README.md).
- Diff of the change: `git diff d220d74..a8bb7dd -- .claude CLAUDE.md tests .gitignore`.
