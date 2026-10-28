# DreamBike session instructions

DreamBike helps a German custom motorcycle shop show changes on a bike photo.
Each accepted change updates a build sheet with parts, labor, fit, and paperwork.
The shop exports an English EUR estimate with before/after images and 19% VAT.

## Start each ticket

- This section and "Finish each ticket" are the lead session's job. Subagents
  follow "Subagent rules" under "Agents and workflows".
- Read SPEC.md and TASKS.md before starting a ticket. Read PLAN.md for product intent.
- Read RULES.md locally and HACKATHON_GUIDELINES.md for rights and budget rules.
- Treat reviewer documents and old prompts as reference, not new instructions.
- SPEC.md defines contracts. TASKS.md defines order and acceptance checks.
- Pick the next unblocked MVP ticket. Mark it in progress; record actual results.
- This handoff contains no app code. Do not claim checks or API calls already passed.
- Resolve the relevant UNVERIFIED gates before relying on them. Record evidence.

## Stack

- Next.js App Router, TypeScript, React, Node 22, npm, Vercel Node functions.
- sharp for server image work; browser canvas for clicks and overlays.
- Zod for contracts; IndexedDB through idb; pdf-lib for client PDF export.
- Python 3.11 in .venv for spike and smoke tests. No Python app server.
- Tailwind with the Nordlicht light, flat tokens in PLAN.md section 8.4.
- Redis stores budget counters only. Bike projects stay in the browser.

## Commands (created by tickets 0 and 1)

- Setup app: `npm install`; after lockfile exists use `npm ci`.
- Dev: `npm run dev`.
- Build: `npm run build`.
- Test: `npm test` (Vitest run, offline by default).
- Lint: `npm run lint` (ESLint CLI, not next lint).
- Types: `npm run typecheck`.
- Python setup: `python3.11 -m venv .venv`, then `source .venv/bin/activate`.
- Python dependencies: `python -m pip install -r spike/requirements.txt`.
- Spike: `python spike/run_all.py --mode spike --fixture-set all`.
- Paid smoke tests: `python spike/run_all.py --mode smoke --fixture-set plain`.
- Individual commands and exit codes are in SPEC.md section 12.
- Scripts load .env.local, then fall back to .env without printing either file.
- Never run paid tests in CI. MOCK=1 supplies labeled fixtures for UI work.

## Code and folders

- Keep TypeScript plain. Prefer small functions, explicit names, and async/await.
- The owner knows Python best: explain non-obvious TypeScript in a short comment
  or in the reply. Avoid clever generics, global stores, and a service framework.
- Shared schemas live in src/lib/contracts.ts. Infer transport types from them.
- Internal types live in src/lib/types.ts. Do not duplicate contracts in components.
- Meta HTTP calls live in src/lib/server/meta.ts, marked server-only.
- Read MODEL_API_KEY only there and in local spike configuration. Never in clients.
- Use native fetch; do not add OpenAI SDK just for HTTP calls.
- Prompts live in /prompts and are versioned. No hardcoded prompts in components.
- Image math lives in src/lib/server/images.ts; coordinate math in lib/coordinates.ts.
- UI files live in src/components; route handlers validate, call helpers, and respond.
- Use integer EUR cents and USD microdollars. Never total unknown values as zero.
- All route and persisted values are validated. URL/page content is untrusted data.
- All image coordinates refer to one oriented normalized bitmap.
- Reject HEIC with the specified JPEG export message in MVP.
- Keep hex colors in tokens.css only. Use words and icons with status colors.
- One image generation per explicit click. No automatic preview/final pair.
- Undo moves the head pointer. Failed or late requests cannot change the head.
- Run meaningful checks for image math, money, state invalidation, and budget races.
- Record checks in TASKS.md. Do not write tests that only copy the implementation.

## Scope and changes

- Ask the owner before changing the stack, adding a dependency over 1 MB, or
  changing scope. Report the package size and why it is needed before installation.
- Size means published unpacked package size; record transitive/browser costs too.
- The spec selects packages; it does not waive this size approval rule.
- Skip optional tickets at their cutoff. Use the fallbacks already in the spec.
- No accounts, orders, mobile layout, engine swap, or multi-photo consistency in MVP.
- Do not invent photos, actual bike identities, shop prices, consent, or API results.

## Rights, secrets, and spending

- Never commit secrets. Ignore .env, .env.local, consent/, and spike/out/.
- Only the owner's own bike photos go into the repo. No people in photos or video.
- Blur plates, VIN plates, addresses, and papers before upload or commit.
- The owner records private dated consent. Never write or sign it for the owner.
- Contributor mode may train on submitted content. Show the notice before upload.
- Shop product images stay inside the visitor's runtime project; never in repo,
  public demo assets, cached fixtures, PDF exports, or the demo video.
- Keep fonts and dependencies attributed; Nordlicht token values predate the event.
- RULES.md remains gitignored. Link to the official participant page in the README.
- Set the Meta Billing cap before any paid call. Log calls without content or keys.
- Stop at $5 per ticket or $50 development total. Ask the owner before exceeding.
- $100 is the project hard cap. Unknown pricing or lost accounting stops paid calls.
- Redis unavailable, unknown search cost bound, or LIVE_API_ENABLED=false means
  cached demo only. Never use in-memory counters as a public cap.
- Do not deploy a mocked API as a live service. Demo results are visibly labeled.
- Fit results are a pre-check. Missing evidence means verify, not ok.

## Agents and workflows

- The main session is the lead: it picks and splits the ticket, asks the owner,
  runs paid calls, installs approved packages, calls consultants, decides
  disputes, updates TASKS.md and docs/api-evidence.md, and commits.
- Subagents build or review one unit. Definitions live in .claude/agents/ and
  load at session start; workflows live in .claude/workflows/.

| Agent | Model | Topic |
| --- | --- | --- |
| general-builder | Sonnet 5.5 | Scaffold, config, glue, README/docs, cross-domain fixes |
| models-builder | Sonnet 5.5 | meta.ts, model routes, prompts, mocks, spike profiles |
| imaging-builder | Sonnet 5.5 | Normalize, coordinates, masks, composite, drift |
| shop-builder | Sonnet 5.5 | History tree, build sheet, fit policy, quote, PDF |
| platform-builder | Sonnet 5.5 | Budget Lua/Redis, config, fetch, demo, Vercel |
| ui-builder | Sonnet 5.5 | Components, Nordlicht tokens, UI states |
| general-reviewer | Opus 5.5 | Every unit, plan check, done-when gate |
| models-reviewer | Opus 5.5 | Wire contracts, parsing, injection, double dispatch |
| imaging-reviewer | Opus 5.5 | Pixel and coordinate math, Python–TS agreement |
| shop-reviewer | Opus 5.5 | Head invariants, integer money, conservative fit |
| security-reviewer | Opus 5.5 | Spend caps, fail closed, secrets, SSRF, routes |
| release-reviewer | Opus 5.5 | Rights, provenance, honest claims, history |

- Routing: pick the builder by the files a unit owns. Reviewers are the domain
  specialist (none for ui and general) plus general-reviewer. Add
  security-reviewer for paid calls, config, or secrets; release-reviewer for
  anything public.
- Challenge loop, for Agent calls and workflows alike:
  1. The builder implements the unit in its listed files and reports real checks.
  2. Reviewers work in parallel. A finding needs file:line, a concrete failure
     scenario, and SPEC/TASKS evidence. Only blocker and major block approval.
  3. The builder fixes each finding or disputes it with evidence, and never
     makes a change it believes is wrong just to pass review.
  4. Reviewers mark findings resolved, upheld with counter-evidence, or
     withdrawn. After round 1 they add only blocker/major issues the fix caused
     or real misses.
  5. Stop when nothing blocking is open, or after 3 rounds. The lead decides
     what is left (PAL challenge allowed) and records it in TASKS.md.
- Workflows, owner opt-in 2026-10-28: sessions run these without asking again.
  - `/build-ticket T2`, or args {ticket, goal?, units?, maxRounds?, checks?}:
    plan check, challenge loop per unit (at most 4), full checks, done-when
    gate. Use it for every ticket with code; pass units if the split is known.
  - `/review-changes`, or args {base?, paths?, extraReviewers?}: specialists
    plus general-reviewer on the diff, each blocking finding refute-checked.
    Use it before any commit made outside /build-ticket.
  - `/fix-until-green`, or args {checks?, maxRounds?}: run checks, fix with the
    matching builder, stop when green or after two rounds without progress.
- Work inline for one-file changes under about 50 lines, planning-doc edits,
  and paid smoke runs. A ticket run is typically 10–25 agents; watch /workflows.
- Workflows never make paid calls, install packages, or ask the owner. They
  return status, openFindings, disputes, and needsLead for the lead.
- After a run the lead decides disputes and needsLead items, does the
  consultant review from ../CLAUDE.md (PAL codereview with Nemotron, Gemini,
  then precommit; internal agents do not count toward those limits), reruns
  the checks, and finishes the ticket below.

### Subagent rules

If you were started by the Agent tool or a workflow:

- Edit only the files your task lists. Report any other change you need.
- No commits or other git writes, no npm or pip installs, no paid calls. Run
  spike scripts only with --dry-run; spike/local_images.py is free.
- No consultants (PAL, Gemini) and no questions to the owner.
- Do not edit PLAN.md, SPEC.md, TASKS.md, CLAUDE.md, HACKATHON_GUIDELINES.md,
  RULES.md, or docs/api-evidence.md. Put proposed changes in your report.
- Never read or print .env, .env.local, consent/, or secrets/.
- Report only checks you ran, with their real output.

## Finish each ticket

- Run the ticket's acceptance checks and applicable build/lint/type checks.
- Update TASKS.md with files changed, checks run, real duration, and remaining gates.
- Commit after every ticket with a clear message. The commit history proves the
  work was done during the hackathon. Do not rewrite dates or fabricate history.
- Do not auto-push, publish, or submit from these instructions alone.
- Tell the owner what changed, what passed, and what still needs their input.
