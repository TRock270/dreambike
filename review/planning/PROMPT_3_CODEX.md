# Prompt 3 of 3: Codex (implementation-ready spec)

How to use: run this in Codex inside the empty project repo, so Codex can write files directly. Put the PLAN.md from DeepSeek into the repo root first, and RULES.md too. Paste everything below the line as the task. After Codex finishes, hand the repo to Claude Code with PROMPT_4_CLAUDE_CODE.md.

________________________________________________________________

Turn the project plan in `PLAN.md` into an implementation-ready spec for a coding agent (Claude Code), who will build the app ticket by ticket. Two reviewers already improved the product and technical parts. Your job is to make it buildable without guesswork.

Context:
- Project name: DreamBike. Hackathon project, Indie track, one builder with about 43 hours left, deadline Wed Nov 4, 2026, 9:00 PM ET. Rules are in `RULES.md`. Important: public repo, everything must be built during the hackathon, no assets without rights, no people in photos.
- Stack is decided: Next.js (App Router) with TypeScript on Vercel for the app; Python scripts in `/spike` for the day 0 spike and smoke tests. Local development on an M1 MacBook. The owner knows Python best and reads TypeScript slowly.
- Section 7.1 of the plan has Meta Model API facts checked against the docs. If you have web access, verify each API call shape you specify against the doc URLs in section 16 and the Meta cookbook (https://github.com/meta-models/meta-model-cookbook). If you can't verify something, mark it `UNVERIFIED` in the spec and add a smoke test for it.
- Do not write application code. Code blocks are allowed only for TypeScript types, zod schemas, function signatures and config files.

Create or update these files in the repo root:

1. `PLAN.md`: the final plan. Keep the product and technical content from the reviewers. Fix contradictions, remove anything that won't fit the schedule, and fill gaps a coding agent would hit.

2. `SPEC.md`, with these sections:
   - Repo tree (every folder and the important files, one line each on what goes there).
   - Dependencies: package name, version range, why it's needed. Keep the list short. Include `@meta-sam/parser` (0.0.13 or later) for the app and `meta-sam-parser` (0.0.6 or later) for the spike.
   - Environment variables, with a `.env.example` listing. `MODEL_API_KEY` must only be read on the server.
   - Shared TypeScript types for the whole data model.
   - Every route handler: method, path, zod request schema, zod response schema, which Meta endpoint and model it calls, timeout, retry policy, error responses.
   - The Meta API client module: one function per call (segmentConcept, segmentPoints, editImage, composeImage, identifyBike, buildInstruction, searchParts, checkFit, transcribe), with signatures and the exact request body each one sends.
   - Image utilities: normalize (including HEIC handling), mask decode, mask to alpha, dilate, feather, composite, drift check. Signatures and parameter defaults from the plan.
   - App prompts: file names under `/prompts`, inputs, expected JSON output schema for each. The fit-check schema must include the German approval and inspection fields from the plan.
   - Client state: IndexedDB schema, version graph, invalidation rules.
   - UI screens and components: list with one line each, plus the states each screen must handle (loading, empty, error). Desktop layout only.
   - Settings: shop name, logo, hourly rate, EUR, 19% VAT, labor hours per slot, inspection fee, preferred shop domains, shop rules.
   - Test fixtures: which photos go in `/fixtures` (the owner's own bike photos only, no people), and expected results.
   - Spike and smoke test scripts in `/spike`, one per Meta endpoint, each runnable with one command, so the builder can confirm the API works before building on it. Include setup steps for a Python venv on macOS.
   - Public live URL: spend cap per visitor and per day, preloaded demo project with cached results, message when the cap is reached.

3. `TASKS.md`: ordered tickets for Claude Code.
   - Ticket 0 is the day 0 spike from the plan.
   - Each ticket takes 1 to 3 hours for a coding agent, has an ID, depends-on, files touched, and "done when" checks that can be run or seen locally.
   - Order by critical path and map tickets to the days in section 11. Mark which tickets are MVP, should-have and stretch.
   - Add a ticket for README and submission material near the end, and a buffer.

4. `CLAUDE.md`: instructions Claude Code reads at the start of every session. Keep it under 150 lines. Include: what the project is in 3 sentences, stack, commands (dev, build, test, lint, spike and smoke tests), code conventions, folder rules, "read SPEC.md and TASKS.md before starting a ticket", "never commit secrets", "commit after every ticket with a clear message (the commit history proves the work was done during the hackathon)", "ask the owner before changing the stack, adding a dependency over 1 MB, or changing scope", "the owner knows Python best: keep TypeScript plain and explain non-obvious parts in a short comment or in the reply", and the rule that only the owner's own bike photos go into the repo.

5. `.env.example`.

When you're done, print a short summary: files written, number of tickets, items marked UNVERIFIED, and any decision you think the owner must make before Claude Code starts.

Plain American English in all files. Short sentences. No marketing language.
