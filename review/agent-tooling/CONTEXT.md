# Agent tooling review: context

Self-contained background for reviewing DreamBike's Claude Code subagents and
workflows. Written 2026-10-28 by the lead Claude Code session.

## 1. Project in brief

DreamBike is a solo hackathon project (Meta Global AI Developer Hackathon,
deadline 2026-11-04 9:00 PM ET, about 40 working hours left). A German custom
motorcycle shop edits a bike photo, and each accepted change updates a build
sheet, a fit and paperwork pre-check, and an EUR estimate. Next.js + TypeScript
on Vercel, Python spike scripts, Meta model APIs. PLAN.md (intent), SPEC.md
(contracts), TASKS.md (tickets T0–T21, acceptance checks) are the sources of
truth. The owner knows Python best and wants plain TypeScript.

Claude Code writes all code. Several Claude Code sessions can work in the same
working tree at the same time; today one built T1/T2 app code and one prepared
T0 fixtures and evidence.

## 2. What is under review

| Path | What it is |
| --- | --- |
| .claude/agents/*-builder.md (6) | Sonnet 5.5 builders: general, models, imaging, shop, platform, ui |
| .claude/agents/*-reviewer.md (6) | Opus 5.5 read-only reviewers: general, models, imaging, shop, security, release |
| .claude/workflows/build-ticket.js | Plan check → per-unit builder/reviewer challenge loop → full checks → done-when gate |
| .claude/workflows/review-changes.js | Path-routed specialist review of a diff, each blocking finding refute-checked |
| .claude/workflows/fix-until-green.js | Run checks, route failures to builders, repeat, review the fixes |
| .claude/settings.json | Project permission allowlist for offline checks, read-only git, the 3 workflows |
| CLAUDE.md, section "Agents and workflows" and "Subagent rules" | How a session uses all of the above |

The rest of CLAUDE.md, PLAN.md, SPEC.md and TASKS.md are context, not review
targets. Agent files distil SPEC.md rules into checklists; checking that they
match SPEC.md is in scope.

## 3. Intended operating model

- Lead = the main Claude Code session (Opus 5.5). It picks a ticket, runs
  `/build-ticket T<n>`, reads the JSON result, decides disputes and
  `needsLead` items, runs external consultant review, updates TASKS.md, and
  commits by explicit paths.
- Builders edit only the files their unit lists. Reviewers never edit.
- Challenge loop: builder builds → specialist reviewer + general-reviewer in
  parallel → builder fixes or disputes with evidence → reviewers mark each
  finding resolved / upheld / withdrawn → stop when nothing blocking is open,
  after 3 rounds, or when only upheld disputes remain.
- Only blocker and major findings block. After round 1, reviewers add only
  blocker/major issues the fix caused or real misses.
- Owner opted in (2026-10-28) to sessions running these workflows without
  asking each time.

## 4. Hard constraints the tooling must respect

- Only the lead commits, installs packages (owner approval for >1 MB), makes
  paid Meta API calls (shared Redis ledger; caps $5/ticket, $50 development,
  $100 project), and calls external consultants.
- A parent instruction file outside the repo (German) tells every Claude
  session it is lead developer and may call consultants: PAL (Nemotron) and
  Gemini, at most 3 PAL and 1 Gemini call per task, Codex only at critical
  gates. Subagents load it too, so each agent body starts with a preamble and
  CLAUDE.md has "Subagent rules" to override it.
- Secrets: .env, .env.local, consent/, secrets/, fixtures/, my_bike/ and
  RULES.md are gitignored and must never be read, printed, or committed.
- Public repo: only the owner's own bike photos, no people, no retailer
  images, honest claims, real build dates.
- Workflows cannot take user input mid-run; anything needing the owner comes
  back as `needsLead`.

## 5. Runtime facts (Claude Code 2.1.312, from the official docs)

- Subagent frontmatter: name, description, tools, disallowedTools, model
  (alias or full ID such as claude-opus-5-5), effort, permissionMode, skills,
  mcpServers, hooks, memory, color, isolation (worktree), maxTurns. Agents
  load at session start. Subagents load CLAUDE.md. Docs:
  https://code.claude.com/docs/en/sub-agents
- Workflow script: plain JavaScript, `export const meta = {...}` first and a
  pure literal. Globals: `agent(prompt, {label, phase, schema, model, effort,
  isolation, agentType})`, `parallel(thunks)` (barrier, failed thunk → null),
  `pipeline(items, ...stages)` (no barrier), `phase()`, `log()`, `args`,
  `budget`, `workflow()`. `agent()` resolves null on failure. `schema` forces
  structured output (JSON Schema, root object, required ⊆ properties). No
  Date.now, Math.random, argless new Date, fs, or import(). Up to 16 agents in
  parallel, 1000 per run. `agentType` uses the custom agent's frontmatter
  model unless `model` is passed. Saved workflows run as `/<name>` with args.
  Docs: https://code.claude.com/docs/en/workflows
- Permission rules: `Bash(cmd *)` is a prefix wildcard; compound commands are
  checked per subcommand; deny beats allow; project settings apply only after
  the owner accepts workspace trust.

## 6. Evidence so far

- Static check (`python3 review/agent-tooling/sim/check_agents.py`): all 12
  agents have the right model, builders acceptEdits, reviewers no Edit/Write,
  no MCP/Agent/Workflow tools, preamble present.
- Headless smoke test: general-builder reported claude-sonnet-5-5 with Read,
  Bash, Edit, Write, ToolSearch, WebFetch, WebSearch; general-reviewer
  reported claude-opus-5-5 without Edit/Write. Grep and Glob are listed in
  frontmatter but do not exist in this build (ignored).
- Node simulations with stubbed agents (`review/agent-tooling/sim/`): approve
  path, round-2 fix, reviewer returning null re-asked, dependency order,
  upheld-dispute early stop; review-changes routing and refute split;
  fix-until-green routing and stop.
- Real workflow run (headless `claude -p`, /review-changes on 11 tooling files,
  run wf_52a49c8c-62c): both custom agent types resolved, the reviewers
  returned valid structured output under their `tools` allowlists
  (security-reviewer 5 findings, general-reviewer 12), and the refuters ran
  (3 confirmed, 1 refuted). The headless session stopped background tasks
  after 10 minutes, so the final JSON was never printed; the run journal
  holds the results. In that run the project allow rules were ignored
  because the owner had not yet accepted workspace trust.
- Consultants: Gemini (17 findings) and Nemotron 3.5 (10 findings) reviewed
  the first version. Nemotron 3 Super returned 404.

## 7. Decisions already made (reopen only with a concrete failure scenario)

Applied:
- Subagent preamble in all 12 agents; "Subagent rules" in CLAUDE.md.
- run_all.py allowed only as the exact string `--mode smoke --dry-run`
  (a wildcard could hide a paid run behind a shell comment).
- Deny `git *--output*` and `git *--ext-diff*` (file writes / external diff).
- Reviewers do not run `npm run build` (parallel builds collide in .next/).
- general-reviewer: failing or not_run done-when checks are major; failures
  from files outside the unit are not findings; rights and mock-label checks;
  report formats for plan-check and gate modes.
- build-ticket: reviewer that returned null is re-asked before approval;
  empty plan, empty done-when, or partial gate audit cannot be green; early
  stop when only upheld disputes remain; log when a reviewer skips a recheck;
  `notApproved` summary.
- fix-until-green: stops with `unlocated_failure` if checks fail without a
  located failure; string args become one check.
- review-changes: constrained recheck schema; unknown extraReviewers ignored.
- From the real run: needsLead only for blocking items (follow-ups go in
  notes); Verify fixes and deferred units are passed to the gate, and
  deferred units block green; plan prompt adds imaging/shop reviewers to
  relevant ui units; builder and reviewer prompts forbid `npm run build`;
  tests/ files and the T2 files (src/lib/browser/, imageFormat.ts,
  server/http.ts, UploadNotice, DemoBanner) are routed; fix-until-green
  reports green_fix_review_failed; agents use `.venv/bin/python`; bare
  `python` allow rules dropped; exact bare allow forms added; deny rules for
  `--no-index` and vitest `--outputFile`; models-builder search-flag rule
  matches SPEC 6.2.

Rejected, with reason:
- Remove WebFetch/WebSearch: SPEC requires checking docs instead of
  inventing API signatures.
- `npx vitest run *` executes arbitrary JS: running tests always executes repo
  code; the safeguards are the review loop and the Billing spend cap.
- git commands can print secrets: secret files are gitignored; transcripts
  are local.
- Raise post-round-1 misses only as non-blocking notes: real late misses must
  reach the lead; the 3-round cap bounds the loop.
- needsLead triggers 3 futile rounds: runUnit already returns on needsLead.
- Deferred dependency can run early: units are topologically ordered, so a
  kept unit never depends on a deferred one.
- refuteBudget race: JavaScript is single-threaded and the check/decrement
  is synchronous before each agent call.
- Stall detection by failure identity: equal counts already count as stalled.

## 8. Known open risks (fair game)

- Owner decision pending: turn on Claude Code's Bash sandbox (network
  allowlist, read deny for secrets). The allowed test and build commands run
  repo code with full network and file access. The sandbox would affect
  every session in this repo and could break font downloads during
  `next build`, so it was not enabled automatically.
- Read/Edit deny rules for .env, .env.local, consent/, secrets/ and Edit
  deny for .claude/settings.json: applied for .env, consent/, secrets/ and
  settings.json. The .env.local rules wait until the parallel T0 session has
  finished its planned .env.local edit.

- Parallel units share one working tree; there is no worktree isolation.
- Fixes made in the Verify phase are reviewed only by the done-when gate.
- Worst-case agent count per /build-ticket is about 50; typical 10–25.
- Agent checklists may have drifted from SPEC.md wording or numbers.
- Path-routing regexes may miss files the SPEC repo tree defines.
- Whether a new session reading only CLAUDE.md would use the tooling
  correctly (clarity, ordering, contradictions with the lifecycle sections).
