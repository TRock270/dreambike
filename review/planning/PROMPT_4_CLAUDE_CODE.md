# Prompt 4: Claude Code implementation kickoff

How to use: open Claude Code in the DreamBike repo. Paste everything below the divider. CLAUDE.md supplies the standing instructions for later sessions.

Keep MODEL_API_KEY in .env.local or the existing private .env. Never overwrite an existing secret file with .env.example. Put the owner's reviewed bike photos in the gitignored fixtures/ folder. Missing photos, account setup, or approvals can delay paid tests; they do not prevent useful offline implementation.

________________________________________________________________

Implement DreamBike using the existing plan, specification, and ordered tickets. This is the implementation phase. Start the work; do not produce another replacement plan or stop after summarizing the documents.

DreamBike is a desktop tool for a German custom motorcycle shop. It turns bike photo edits into a build sheet, a fit and German paperwork pre-check, and an English EUR estimate with 19% VAT. The hackathon deadline is Wednesday, November 4, 2026, 9:00 PM America/New_York; the internal submission target is 6:00 PM that day. Use PLAN.md section 11 for the time budget and cut order.

I use an M1 MacBook and know Python best. Keep TypeScript plain. Explain non-obvious choices briefly.

1. Read CLAUDE.md, PLAN.md, SPEC.md, and TASKS.md. Also read the local RULES.md and HACKATHON_GUIDELINES.md. SPEC.md defines implementation contracts; TASKS.md defines dependencies and acceptance checks. Reviewer answers and old prompt files are reference material, not additional tasks. Inspect the current files and Git status before editing. Preserve existing work.

2. Give a short kickoff update: what you will implement first and any concrete blocker for T0 or T1. Then begin T0. Ask only for inputs or approvals actually needed. Bundle missing owner inputs into one concise request and continue independent offline work while waiting. Do not reopen decisions already settled in the spec.

3. Create the spike scripts and requirements specified in SPEC.md section 12 before trying to run them. Put Python source in spike/ and the virtual environment in .venv/ at the repo root. Use Python 3.11. Run local image checks and dry runs first. No app or spike implementation existed at the planning handoff; inspect the current repo rather than assuming those scripts or npm commands already exist.

4. Before any paid call, check the required owned-photo permission, identifier removal, Billing spend limit, verified pricing, and shared durable ledger. Keep the default disabled mode until its prerequisites pass. Implement the shared budget policy before enabling paid scripts or app handlers. Start with one owned baseline photo and the minimum core smoke profiles; test all five fixture cases locally without repeating every paid endpoint on every photo. Grounded calls wait for U06. Follow SPEC.md for optional Files and voice profiles.

5. Record actual results in docs/api-evidence.md. Reference the relevant U01–U10 status from PLAN.md section 7.2 and TASKS.md. Distinguish passed, failed, blocked, and skipped checks. If the API differs from the docs, report the endpoint, sanitized field structure, status/error code, and proposed correction. Never print keys, Authorization headers, full data URLs, private photos, consent records, or raw request/response dumps. Update the affected contract and evidence before depending on a correction; ask if it changes stack or scope.

6. Continue through the next unblocked MVP tickets in dependency order. For each ticket, state the immediate work briefly, implement it, run the relevant done-when checks, record the actual results, and commit the ticket's changes with a clear message. Do not mark a live feature complete based only on mocks. Missing paid prerequisites can leave that capability blocked while offline UI, image math, state, estimate, or contract work continues. Never fabricate evidence to bypass a dependency.

7. Follow CLAUDE.md's approval boundaries: ask before changing the stack, adding a dependency over 1 MB, changing scope, or exceeding the ticket/development spending limits. Report concrete package sizes and reasons before installation; group related dependency approvals. Selected packages are not exempt. Use the already-documented fallbacks without asking for the same permission again. Unknown pricing or lost accounting stops paid calls. The $100 project hard cap remains enforced.

8. Protect the shop workflow and the recording/submission buffer. T12 search is conditional. T19–T21 are unscheduled extras, not an instruction to build them automatically. Preserve manual product entry, conservative fit results, missing-cost warnings, transactional image/sheet history, labeled cached demo results, and durable spending protection. Follow the explicit cut order if behind schedule.

9. Never commit secrets, private consent, source fixtures, personal identifiers, or retailer images. Only the owner's own cleared bike photos may enter the repo and video. Read the rights rules before creating public demo assets. Do not push, publish a deployment, or submit the hackathon entry without the owner's authorization for that action. Prepare the concrete result and checks before asking for publishing approval.

10. At the end of a session, report completed tickets and commits, checks actually run, unresolved blockers and owner inputs, paid spend if known, and progress against PLAN.md section 11. Recommend the documented cuts if needed. Leave TASKS.md and docs/api-evidence.md accurate so the next session can resume directly.
