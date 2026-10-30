# DreamBike

DreamBike helps a custom motorcycle shop show a customer a change on a photo of the customer's own bike. Every accepted change updates a build sheet with parts, labor, fit and paperwork. The shop then exports an English EUR estimate with before/after images and 19% VAT.

Built by Tom (GitHub TRock270), solo, for the Meta AI Developer Hackathon (Indie Developer track, Build for Your World). Official participant page: https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details

- Repository: https://github.com/TRock270/dreambike
- Live site: https://dreambike-pied.vercel.app (opens without login; see "Live AI edits" below)
- Demo video: pending (T16)

## Why

A German custom shop talks about a build at the counter, but the customer cannot see it, and the shop has to look up parts, fit and paperwork (approval, inspection, registration) by hand before quoting. DreamBike keeps the picture, the parts list and the quote in one place, so one change updates all three.

## What works

Every item below is built and was checked in its ticket (see TASKS.md).

- Photo import: JPEG, PNG and WebP are checked and normalized to one oriented bitmap on the server. HEIC is rejected with a message asking for a JPEG export. A notice about Meta's Contributor mode is shown before any upload.
- Bike cutout and parts: SAM 3.1 finds the bike and its parts from part names. You pick a detected part from the list, or mark a part with a box (a local rectangle, no model call), or add a missing part. Selecting by point is off for live calls (see Limitations).
- Bike confirmation and edit instruction: Muse Spark identifies the bike (you confirm or correct it) and turns your wish into an edit instruction.
- One image render per explicit click (Muse Image), local compositing back into the photo, a drift check and an accept step. Undo and redo move a pointer in an immutable history tree.
- Owned reference photo mode: a reference photo you own or may use can serve as the reference for an edit.
- Projects live in the browser (IndexedDB). You can save and open a project in a folder.
- Build sheet with manual product input; fit check and German paperwork pre-check (Muse Spark with web search; sources are shown only when the model cites them, and when evidence is missing the answer is "verify", never "ok"). The cached demo check found no citable source, so every item there says verify.
- Shop settings, an example shop, an estimate in integer EUR cents with 19% VAT and inspection fees.
- Client-side estimate PDF with before/after images and a paperwork summary (pdf-lib, IBM Plex fonts).
- Cached demo project with precomputed results, and an atomic budget ledger (Upstash Redis, Lua scripts) that caps paid calls.
- Deployment on Vercel and `spike/deployment.py` checks against the live origin.

Not built: part search and product images, voice input, German PDF, mobile layout, accounts.

## Meta models

The app uses three Meta models through the Meta Model API. Only `src/lib/server/meta.ts` talks to the API and reads the key.

| Model | Used by | What for |
| --- | --- | --- |
| `sam-3.1` | `/api/segment` | Bike and part masks from a part name (concept prompts). Point clicks work only offline and in mock mode until the mask placement check (U01) is cleared; a box makes no SAM call |
| `muse-spark-1.3-contributor` | `/api/identify`, `/api/instruction`, `/api/check` | Bike identification, edit instruction text, and the fit and paperwork pre-check (the check uses web search; off on the public site) |
| `muse-image-1.0` | `/api/edit` | One edited image per click, including the owned-reference mode |

No model is called by `/api/normalize`, `/api/composite` (local sharp image code), `/api/budget` or `/api/health`. Voice input is not used. Contributor mode means Meta may train on submitted content.

## Architecture

```
Browser (desktop)                     Vercel Node functions (Next.js route handlers)             Meta Model API
-----------------                     ----------------------------------------------             --------------
IndexedDB projects + history   POST   validate request (Zod), same-origin + signed cookie   --->  SAM 3.1
canvas: clicks, boxes, overlay -----> reserve budget in Upstash Redis (Lua, atomic)          --->  Muse Spark
pdf-lib: estimate PDF         <-----  settle the real cost, return JSON                      --->  Muse Image
cached demo (/demo files)             local sharp: normalize, composite
```

The API key stays on the server. Bike projects never leave the browser except for the images sent to a model for one request. Redis stores only budget counters.

## Run the cached demo without a key

Needs Node 22 (`package.json` engines: `>=22.9 <23`).

```
npm ci
npm run build
npm start
```

Open http://localhost:3000. No environment variables or key are needed: with no `.env.local` the app is in demo-only mode, without AI calls:

- Works: the cached demo project (before/after, versions, build sheet, fit results, estimate), and "Try editing", which copies the demo into your browser.
- Refused: every request that would call a model, and every POST to the server. `npm start` runs with `NODE_ENV=production`, which the server treats as a deployment, and without `VISITOR_HASH_SECRET` a deployment refuses POSTs. So you cannot import your own photo this way.

`npm run dev` binds to 127.0.0.1 and is for development.

## Optional live mode

Live calls need your own Meta key and a working budget ledger. They stay off if any piece is missing (the app then shows the cached demo only).

Which command: locally, live calls run only under `npm run dev` (127.0.0.1, with `BUDGET_PHASE=development` and `BUDGET_TICKET` set). `npm start` and any non-production Vercel deployment always stay demo-only, because the server treats `NODE_ENV=production` as a deployment and then requires `VERCEL_ENV=production` and `BUDGET_PHASE=demo`. On Vercel, live calls run only on the production deployment with `BUDGET_PHASE=demo` and `APP_ORIGIN` set.

Copy `.env.example` to `.env.local` and set these variable names; never commit values:

`MODEL_API_KEY`, `LIVE_API_ENABLED`, `APP_ORIGIN`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `VISITOR_HASH_SECRET`, `PRICING_VERIFIED_AT`, `BUDGET_TICKET`, `BUDGET_PHASE`.

Optional names: `MUSE_MODEL`, `MOCK`, `COMPOSITE_ENABLED`, `REFERENCE_MODE_ENABLED`, `SEARCH_ENABLED`, `SEARCH_QUERY_RESERVE`, `VOICE_ENABLED`, `DAILY_CAP_USD`, `VISITOR_DAILY_CAP_USD`, `VISITOR_DAILY_EDIT_LIMIT`, `VISITOR_DAILY_SAM_LIMIT`, `VISITOR_DAILY_SPARK_LIMIT`, `VISITOR_DAILY_ASR_LIMIT`, `PROJECT_HARD_CAP_USD`, `DEVELOPMENT_STOP_USD`, `TICKET_CAP_USD`, `LIVE_FROM_ET`, `LIVE_UNTIL_ET`, `PUBLIC_SHOP_DOMAINS`.

Before any paid call:

1. Set a spend limit in your Meta Billing settings.
2. Initialize the ledger, then store the caps, with Python 3.11 and `spike/requirements.txt` installed in `.venv`: `.venv/bin/python spike/ledger.py init --spent-usd <your Billing total> --confirm-reconciled`, then `.venv/bin/python spike/ledger.py set-caps --project-usd 100 --daily-usd 5`. Live calls stop while the lifetime total or the stored caps are missing.
3. Check the prices in `budget/prices.json` against Meta's pricing page and set `PRICING_VERIFIED_AT` yourself.

`MOCK=1` serves labeled fixtures for UI work in local development only; it is refused on a deployment.

## Live AI edits on the public site

Live edits on the public site run only from 2026-11-05 to 2026-11-09, US Eastern time. In that window the site spends at most $5 per day in total and $0.50 per visitor per day. Outside it, or when a limit is reached, the cached demo keeps working and makes no AI calls. The live path was built and tested during the event: on 2026-10-30 one real edit on the public site (part mask, instruction, image) took under 30 seconds and cost $0.013, and the daily limit refused a further edit. See `docs/submission.md`.

## Limitations

- The fit and paperwork check is a pre-check, not legal advice or an approval. Missing evidence means "verify".
- The fit check with web search is off on the public site, because its search cost per request cannot be bounded. The demo shows a real fit check made on 2026-10-29.
- Prices and the shop in the demo are illustrative examples, not real quotes.
- Desktop only, screens at least 1280 px wide. No mobile layout.
- Live selection by point is off: the point answer returned the whole bike (U01). Pick a part from the list or draw a box.
- HEIC photos are rejected; export a JPEG first.
- Spending caps apply: $5 per day in total and $0.50 per visitor per day on the public site, and a $100 project hard cap.
- One image render per explicit click; renders can differ from the photo, which is why the drift check and your accept step exist.
- Not built: part search and product images, voice input, German PDF, accounts.

## Provenance: what was built when

Times are US Eastern, taken from `git log`. The commit history is the evidence.

| Category | Contents | Claimed as our work |
|---|---|---|
| Pre-existing third-party work | Meta Model API and models, Next.js, npm and Python libraries, Vercel, Upstash, IBM Plex fonts (SIL OFL) | No |
| Our work made before Oct 27 | Nordlicht design system, the owner's own: only its color, type and spacing values are reused; the stylesheet is written new | No |
| Oct 27 (1 commit) | Planning documents only: plan, spec, tickets, guidelines, review prompts. No code | Yes |
| `review/` | Our review prompts, plus answers and reports from other AI reviewers, including OpenAI Codex, kept as evidence | Prompts yes; the answers and reports are not claimed as our work |
| Oct 28 (50 commits) | T0 spike and shared ledger, T1 scaffold, T2 import, T3 cutout and selection, T4 bike confirmation and instruction, T5 render, compositing and drift check, T6 projects and history, T7 reference photo mode, layout and folder save, T8 build sheet | Yes |
| Oct 29 (15 commits) | OF1 save/open to a folder, T9 fit and paperwork pre-check, T10 shop settings and estimate, T11 estimate PDF | Yes |
| Oct 30 (8 commits for T13 and T14, then T15) | T13 cached demo and budget caps, T14 deployment, T15 this documentation | Yes |
| Media | The owner's own bike photos and one permitted studio photo, see CREDITS.md | Disclosed separately |

Disclosure: DreamBike was built during the hackathon, from Oct 27, 2026. The code was written with Claude Code (Anthropic) as the coding agent under the owner's direction; commits carry `Co-Authored-By` lines. It uses Meta's SAM 3.1, Muse Image and Muse Spark through the Meta Model API, plus the open-source libraries listed in CREDITS.md. The bike photos are the owner's own, except one studio photo of another motorcycle (not the owner's R nineT) that is used with the rights holder's permission; it is private and not published. Photos sent to Meta in tests were the owner's own right-side photo and its patched copy, and two wheel crops of that studio photo. Other AI models, including OpenAI Codex, NVIDIA Nemotron and Google Gemini, reviewed plans and code, but did not write project code.

## Rights and credits

- MIT license for our original code only (`LICENSE`). It does not cover photos, demo images, fonts, dependencies, or Meta services and models.
- `CREDITS.md` lists fonts, every direct dependency with its license, and every photo with date and consent coverage.
- Background signage and trademarks in the photos are incidental and belong to their owners. DreamBike is not endorsed by Meta, BMW, TÜV or any shop; brand names only describe bikes and parts.
- No shop product images are included or fetched in this build.

## Commands

`npm run dev`, `npm run build`, `npm start`, `npm run lint`, `npm run typecheck`, `npm test` (offline Vitest).
