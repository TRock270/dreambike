# DreamBike build tickets

Status: planning handoff, October 27, 2026. No implementation ticket is complete. Estimated hours are coding-agent work plus the stated owner checks, not runtime promises. Read SPEC.md and this file before every ticket. Follow CLAUDE.md. Record actual results and commit after each completed ticket. Never backdate work.

There are 22 tickets, T0–T21. The scheduled baseline is T0–T18: 39 mandatory hours plus 2 conditional search hours. Two unallocated hours make the original 43-hour plan. T19–T21 are outside that commitment. No feature work consumes the protected recording/submission time without an owner scope decision.

Dependencies below are completion dependencies. Offline UI/mock work may proceed while a paid capability is gated, but it cannot be marked integrated or live. A failed smoke test is evidence, not a pass. Required photos, owner consent, package-size decisions, and account configuration are inputs to request once, not values to invent.

## Day and critical path map

| Day, ET | Budget | Tickets |
| --- | --- | --- |
| Tue Oct 27 | 1h | T0 prep, fixture and account checklist |
| Wed Oct 28 | 5h | T0 remaining 2h; T1 2h; 1h unallocated |
| Thu Oct 29 | 5h | T2 2h; T3 3h |
| Fri Oct 30 | 8h | T4 2h; T5 3h; T6 2h; T7 1h |
| Sat Oct 31 | 5h | T8 2h; T9 3h |
| Sun Nov 1 | 5h | T10 2h; T11 2h; T12 1h if green |
| Mon Nov 2 | 5h | T12 remaining 1h if green; T13 2h; T14 2h |
| Tue Nov 3 | 5h | T15 2h; T16 3h |
| Wed Nov 4 | 4h | T17 2h; T18 1h; 1h unallocated |

Critical path: T0 → T1 → T2 → T3 → T4 → T5 → T6 → T8 → T9 → T10 → T11 → T13 → T14 → T15 → T16 → T17 → T18. T7 fits Friday but may use the documented reference fallback. T12 is optional. If Friday shrinks to 5 hours, skip T12 and use one unallocated hour to move unfinished core work. Skip extra features rather than weakening fit, estimate, caps, or recording.

## T0 — Day 0 API and image spike

- Status: IN PROGRESS. Offline part done 2026-10-27. Shared ledger verified and owner fixtures built 2026-10-28. Live profiles wait for the owner's pricing review, fixture sign-off and consent record (see log, T0 session 3).
- Priority: MVP. Estimate: 3h, split Oct 27/28. Depends on: none.
- Files: budget/reserve.lua/settle.lua, spike/requirements.txt, common.py, run_all.py, responses_sam.py, responses_spark.py, images_edits.py, asr_transcribe.py, files.py, local_images.py, deployment.py; docs/api-evidence.md; fixtures/expected.json locally; .gitignore; PLAN.md 7.2 status references.
- Work: inspect installed Python/Node and package availability; record package sizes before installing >1MB packages; obtain owner fixture/consent/Billing inputs; implement the command contracts in SPEC 12; create the shared atomic reserve/settle policy and connect the cost ledger before paid dispatch. Start with one owned baseline. Test concept, off-origin point, identify JSON, text edit, and owned reference. Visit all five fixture input cases with local tests. Grounded checks wait for U06 billing bounds. Files and ASR remain opt-in.
- Done when: the venv setup works; `python spike/local_images.py --fixture-set all` reports real pass/fail/skips; core commands from SPEC 12 produce saved private overlays and sanitized evidence; U01–U06 have explicit results or a blocking reason/fallback; total ticket spend is at most $5. The owner can see the mask landing correctly on an off-origin part. No guessed mask placement or fabricated API pass is accepted. If a core gate fails, stop that dependency and report it; scaffold can continue in mock mode.

## T1 — Scaffold, contracts, configuration, and offline mocks

- Status: DONE 2026-10-28 00:25 ET (offline scope; live handlers arrive with their tickets). See log.
- Priority: MVP. Estimate: 2h, Oct 28. Depends on: T0 contract findings; paid failures do not block offline scaffold.
- Files: package.json/lock, Next/TS/ESLint/PostCSS/Vitest configs, src/app/layout.tsx/page.tsx/globals.css, src/styles/tokens.css, src/lib/contracts.ts/types.ts/errors.ts/slots.ts, src/lib/server/config.ts/meta.ts boundaries and budget.ts wrapper for the shared Lua files, src/lib/mocks/, .env.example, tests/contracts.test.ts.
- Work: create the chosen stack without overwriting planning files; generate all declared schemas/types and safe flags; implement server-only boundary and mock response dispatch; add original native controls and Nordlicht tokens. No paid API calls from mock mode. A live server handler must use the already-tested shared atomic budget policy before its first dispatch; no temporary uncounted path. Collect any >1MB install approvals with concrete sizes first.
- Done when: `npm run dev` opens the shell; `npm run build`, `npm run lint`, `npm run typecheck`, and `npm test` pass; MOCK=1 shows a visible mock label; production rejects MOCK=1; no MODEL_API_KEY value or server import enters the client bundle. Schemas validate representative success/error fixtures and reject unexpected fields. All colors live in tokens.css.

## T2 — Photo import, preflight, normalization, and upload notice

- Status: DONE 2026-10-28 (offline and Chrome checked; Safari check and owned fixture roles pending, see log).
- Priority: MVP. Estimate: 2h, Oct 29. Depends on: T1.
- Files: src/components/UploadDropzone.tsx/UploadNotice.tsx/ImageCanvas.tsx, src/app/api/normalize/route.ts, src/lib/server/images.ts, browser image adapter, tests/images.test.ts, spike/local_images.py.
- Work: owned-photo notice; MIME/signature checks; client orientation-aware bounded WebP; server decode/EXIF/sRGB/metadata stripping; dimensions/hash; HEIC rejection; low-resolution warning. Enforce actual total body bytes.
- Done when: all five input cases are visibly handled; EXIF fixture agrees across browser/Pillow/sharp; HEIC shows the exact JPEG export message and makes zero Meta calls; corrupt/animated/over-limit cases do not 500; a large source is reduced before upload; normalized image is <=2048 px and <=1,250,000 bytes. Run image tests, build, and types. Record U05 evidence.

## T3 — Bike cutout, part map, and point selection

- Status: DONE OFFLINE AND IN MOCK 2026-10-28. Live SAM is gated on U01 (route refuses live segmentation before any reservation until placement is verified). See log.
- Priority: MVP. Estimate: 3h, Oct 29. Depends on: T2 and U01 resolved for mask display.
- Files: src/app/api/segment/route.ts, src/lib/server/meta.ts/images.ts, src/lib/coordinates.ts/slots.ts, src/components/PartOverlay.tsx/PartSelector.tsx, tests/coordinates.test.ts/masks.test.ts.
- Work: exact SAM SSE body/parser; full-image binary mask adapter; cutout; core phrase queue at concurrency 4; fixed colors; front/rear by facing; smallest-mask hit test; point fallback; manual custom name. All live calls use the Node wrapper over the same atomic policy created in T0/T1. Public visitor hardening and demo integration arrive in T13; local accounting already enforces project, development, ticket, and day caps.
- Done when: a wheel click highlights its real pixels; letterboxed clicks land within 3 px at two canvas sizes; zero matches is an empty state; merged wheels use point selection; a >60% bike mask is rejected as a part but accepted in cutout mode; queue never exceeds 4; partial results remain usable. Tests cover SSE byte splits, confidence records, half-open borders, and dimension mismatch. No stale/wrong-image mask is clickable.

## T4 — Bike confirmation and edit instruction

- Status: DONE OFFLINE AND IN MOCK 2026-10-28. Live Spark answers are gated on U02 (strict JSON on this account). See log.
- Priority: MVP. Estimate: 2h, Oct 30. Depends on: T3 and U02 identify/instruction profiles.
- Files: prompts/identify.v1.md/instruction.v1.md/paint.v1.md/compose.v1.md, src/app/api/identify/route.ts/instruction/route.ts, src/lib/server/meta.ts, src/components/BikeConfirm.tsx/DescribeForm.tsx/PaintForm.tsx.
- Work: exact Spark text.format schema; editable one-panel bike ID; allow unknown ABS/year/facing; instruction preview and geometry intent; paint-only engine/frame. Model response traversal handles reasoning/tool items before message output.
- Done when: manual bike data can be entered before ID finishes and is never overwritten; text/paint requests return validated English instruction/title/spec; fork/wheel replacement and taller bar intent is geometry; missing bike details become limitations; malformed/incomplete/refused responses are safe errors. Run contract/type/build checks and the cached smoke profiles; only force a paid rerun if needed.

## T5 — One render, compositing, drift, and preview acceptance

- Status: DONE OFFLINE AND IN MOCK 2026-10-28. A live render is gated on U04 (and real masks on U01). Accept works in memory; history and persistence come with T6. See log.
- Priority: MVP. Estimate: 3h, Oct 30. Depends on: T4 and U04 edit profile; U01 for composition.
- Files: src/app/api/edit/route.ts/composite/route.ts, src/lib/server/meta.ts/images.ts, src/components/ProgressStatus.tsx/EditReview.tsx/BeforeAfter.tsx, tests/composite.test.ts.
- Work: single-shot JSON edit; no mask field; one render per click; bounded result cached before new masks; selected-slot SAM refresh; local composite route with exact dilation/feather/drift; clear full-image fallback. Implement the staged progress UI and manual resume after a mask/composite failure.
- Done when: paint preview changes the target; protected pixels outside feather support match base; drift >0.05, wrong aspect, small result, missing mask, geometry, and disabled composition all take the documented full-image path; no retry of segment/composite repeats generation; duplicate request IDs cannot dispatch twice; all fallback badges display. Run image math tests plus one budgeted live visual review if a valid cached result is unavailable. Record U04 findings, not a claimed performance number.

## T6 — Durable local projects and history tree

- Status: DONE 2026-10-28 (offline and in mock; no paid calls involved). See log.
- Priority: MVP. Estimate: 2h, Oct 30. Depends on: T5.
- Files: src/lib/db.ts/project.ts/cache.ts, src/components/VersionStrip.tsx/ProjectList.tsx, tests/project.test.ts/cache.test.ts.
- Work: IndexedDB stores, immutable snapshots, transactional acceptance, same-slot replacement, head navigation, branching, stale mask flags, quota/LRU handling, pending-request guard. Derive active sheet from the selected version.
- Done when: three accepted edits survive reload; undo restores image and sheet together; redo and a branch from an earlier node work; editing the same slot produces one active quoted item and multiple historical changes; a simulated failed write keeps the prior head; late preview cannot overwrite a new head; storage-full preserves saved projects. Run state/cache tests and inspect in the browser.

## T7 — Owned reference photo mode

- Priority: MVP with documented cut fallback. Estimate: 1h, Oct 30. Depends on: T5, T6 and U04 compose profile.
- Files: src/components/ReferenceDropzone.tsx, prompts/compose.v1.md, src/lib/server/meta.ts, instruction/edit route reference branches.
- Work: normalize one owned reference, base first/reference second, force image/web search off, share preview/accept/version path. No second build-item write on accept.
- Done when: an owner's own part crop can render a reference edit; missing/extra reference files fail validation; disabled reference mode is explained; base and reference roles are not swapped; reference image is absent from public assets and PDF export. Inspect one result, run contract/build checks. If spike evidence makes this unsuitable, record the fallback and cut explicitly; do not present a mock as shipped.

## T8 — Build sheet and manual product input

- Priority: MVP. Estimate: 2h, Oct 31. Depends on: T6; T7 is not a dependency.
- Files: src/components/BuildSheet.tsx/ProductFields.tsx, src/lib/project.ts, tests/project.test.ts, seed mock product/check data.
- Work: active slot lines, title/spec, manual source URL, price-as-listed and gross/net/unknown basis, labor minutes, explicit labor-only switch, remove/replace, semantic sheet revisions. No automated product fetching yet.
- Done when: accepted render creates one line; repeated same-slot edits replace its active line; changing a product preserves prior history and invalidates checks; unknown part price is displayed as unknown; explicit labor-only permits zero part cost; undo restores the prior sheet. Test invalidation and money-field validation. Build and lint pass.

## T9 — Sourced fit and German paperwork pre-check

- Priority: MVP. Estimate: 3h, Oct 31. Depends on: T8, U02 grounded profile, U06 cost bound; owner's rule review remains visible if pending.
- Files: prompts/fit-check.v1.md, src/app/api/check/route.ts, src/lib/server/meta.ts, src/lib/project.ts/cache.ts, src/components/FitBadge.tsx/EvidenceLinks.tsx/PaperworkSummary.tsx, tests/fit-policy.test.ts.
- Work: <=3 target items plus whole-build context; exact IDs; citation/result extraction; conservative source applicability; all German fields; batch progress/failure; stale hash protection; interaction invalidation. No standalone legal chatbot.
- Done when: owned-bike live or genuinely recorded smoke results show evidence and unknowns; ABE conditions, unknown ABS/wheel fit, tall handlebar cable reach, and unsupported US exhaust do not receive unjustified ok; unsupported citation URLs are removed; one failed batch leaves other completed results; changing bike/part/shop rules invalidates every active fit. Offline policy tests and contract checks pass. If grounded dispatch remains gated, keep fresh checking disabled and record T9 blocked; cached demo results alone do not complete this live capability.

## T10 — Settings and integer EUR estimate math

- Priority: MVP. Estimate: 2h, Nov 1. Depends on: T8, T9 schema integration; offline math work need not wait for a live call.
- Files: src/components/ShopSettingsForm.tsx/InspectionFees.tsx/EstimatePreview.tsx/MissingCosts.tsx, src/lib/quote.ts/db.ts, tests/quote.test.ts.
- Work: real vs isolated demo settings, owned logo, default minutes, editable net rates/allowances, fixed 19%, preferred domains/rules, gross-to-net conversion, missing values, fee deduplication and acknowledgment.
- Done when: SPEC 11's €416.50 total matches; adding an unknown part makes grand totals null while known subtotal stays €350; two affected items do not double-charge one inspection; zero labor is explicitly confirmed; real settings never silently inherit demo rates. Unit tests cover rounding and invalidation. Settings survive reload.

## T11 — Estimate PDF with paperwork summary

- Priority: MVP. Estimate: 2h, Nov 1. Depends on: T10.
- Files: src/lib/pdf.ts, src/components/ExportButton.tsx, public/fonts/ plus licenses, tests/quote.test.ts, local PDF QA artifacts in spike/out/.
- Work: A4 PDF, owned before/after images, line items, net/VAT/gross or incomplete draft, inspection allowances, German paperwork fields, evidence links, visualization/pre-check notes, multi-page layout.
- Done when: a complete one-page and long three-page PDF are opened and visually checked locally; no clipping or overlapping rows; fonts and EUR/German terms render; export works offline with no external photo/network fetch; unknown-cost draft has no grand total and a clear warning; complete export requires mechanic review. Record observed QA and run build/types.

## T12 — Optional grounded part search and safe product images

- Priority: Should-have. Estimate: 2h, Nov 1/2. Depends on: T9, T11, U06; domains/rights inputs under U07.
- Files: prompts/search-parts.v1.md, src/app/api/search-parts/route.ts/product-image/route.ts, src/lib/server/fetch-product.ts/meta.ts, search panel in ProductFields.tsx, tests/fetch-product.test.ts.
- Work: query and URL modes, up to five cited candidates, source timestamps, EUR price only when stated, exact-host allowlist and public-DNS fetch policy, redirect rechecks, one optional runtime reference image with explicit rights confirmation. No extra product-validation model call.
- Done when: an actual supported listing produces its exact listed price/source or explicit unknown; no-result and dead-link cases are usable; localhost/private-IP/credentialed URL and redirect-to-private tests are blocked before a fetch; remote image failure leaves manual input; external image never enters public assets/fixtures/PDF. Search remains off if any required safety/cost/rights gate fails. Stop this ticket by Monday's cutoff; manual product fields already work.

## T13 — Cached demo and atomic public cost protection

- Priority: MVP. Estimate: 2h, Nov 2. Depends on: T6, T9, T11; T12 is not required.
- Files: src/lib/server/budget.ts, src/app/api/budget/route.ts/health/route.ts, all paid handler budget guards, public/demo/, src/components/DemoBanner.tsx/BudgetBanner.tsx, tests/budget.test.ts, spike/common.py ledger integration.
- Work: shared Redis REST/Lua reserve/settle, all model/cost/count limits, lifetime/development/ticket accounting, ET dates/DST, duplicate IDs, cookie/IP HMAC, unknown charge retention, fail closed; static genuine demo manifest/images/masks/checks/PDF. Harden the already-working T0/T1 shared ledger with public identity buckets, not a second ledger.
- Done when: races cannot overspend; duplicate ID dispatches once; crash/timeout keeps its reservation; missing Redis or missing lifetime key disables paid work; simulated deployment keeps total; DST/ET tests pass. Real atomic Redis integration is exercised without Meta calls. Cached demo works at caps and with API key removed; static requests cause zero Meta calls. Unknown query bounds keep grounded calls disabled. Public rights cleared by owner; no invented demo checks.

## T14 — Vercel deploy and end-to-end reliability

- Priority: MVP. Estimate: 2h, Nov 2. Depends on: T13 and actual repository/hosting access.
- Files: Next/Vercel configuration as needed, docs/api-evidence.md/submission.md, README live URL placeholder, spike/deployment.py, targeted tests for fixes.
- Work: verify actual plan/runtime/duration/body caps; production env and no MOCK; deploy the reviewed result with owner publishing authorization; record real URL; test second-laptop cached flow and one controlled live change if gates allow. Cache-only fallback is clearly labeled.
- Done when: `npm run build`, lint/types/tests pass; `python spike/deployment.py --origin <actual-origin>` passes; cache demo opens without login on a second laptop; cap/disabled/composition-off cases work; key is absent from browser source/network; no input exceeds bounded envelope. A real edit fits the actual platform deadline or live mode stays disabled with the exact limitation disclosed. Record U08.

## T15 — README, attribution, and submission package

- Priority: MVP. Estimate: 2h, Nov 3. Depends on: T14.
- Files: README.md, LICENSE, CREDITS.md, docs/submission.md/demo-script.md, .gitignore, TASKS.md evidence entries.
- Work: reproducible setup, actual features and Meta model map, architecture, limitations and gates, no-API demo, MIT code boundaries, dependency/font/photo credits, actual date-based provenance from commits, official source link, public repo/live/video fields, owner submission checklist.
- Done when: another reader can run the cached demo using README; no fake URL or unbuilt feature is claimed; source photos/consent/RULES.md remain private; current files and full history are checked for secrets and identifiers without printing secret values; public asset credits have real photographer/date/rights. Owner checks official platform rubric and required fields. Missing owner decisions are listed precisely.

## T16 — Record the three-minute demo and backup

- Priority: MVP. Estimate: 3h, Nov 3. Depends on: T15 and owner's recording time.
- Files: docs/demo-script.md/submission.md; video/backup outside repo unless explicitly cleared; small screenshots only with asset rights.
- Work: rehearse PLAN 12 sequence with actual bike and actual checks; record screen and voice-over; show at least 90 seconds of sheet/paperwork/estimate; label cached/manual actions; avoid people and retailer photos; show only shipped event-built features.
- Done when: owner reviews a <=3:00 video, has a successful full-length backup, and verifies the uploaded public video link in a private window; script names only models actually used. If search/voice/reference was cut, remove it from the script and model count. No application change is required solely to match an earlier storyboard.

## T17 — Protected regression buffer

- Priority: MVP buffer. Estimate: 2h, Nov 4. Depends on: T16.
- Files: only files needed for demonstrated regressions; docs/submission.md and TASKS.md.
- Work: resolve defects found in rehearsal or deployment; recheck affected paths; verify caps, cached demo, missing-cost PDF, reference/composite fallbacks, and fresh browser. No new features.
- Done when: any fixed regression has a concrete observed reproduction and recheck; build/lint/types/tests are green; public links remain usable. If no defect exists, use this ticket for final review and preserve unused time. Do not create busywork tests.

## T18 — Final checks and owner submission

- Priority: MVP. Estimate: 1h, Nov 4. Depends on: T17.
- Files: docs/submission.md, README final links, TASKS.md.
- Work: owner verifies public repo/video/live URL, rights/provenance, spend and Billing cap, Indie/Build for Your World fields, representative details; submit by 6:00 PM ET (official deadline 9:00 PM ET).
- Done when: the owner records actual submission confirmation and timestamp, all artifact links work unauthenticated, and no final claim exceeds shipped behavior. An automated agent does not invent confirmation or submit on the owner's behalf without authorization.

## T19 — Optional PCM WAV voice input

- Priority: Should-have, unscheduled. Estimate: 2h. Depends on: T14; core regression work must be complete.
- Files: src/components/VoiceInput.tsx, src/app/api/transcribe/route.ts, browser WAV encoder/resampler, src/lib/server/meta.ts, spike/asr_transcribe.py, WAV format tests.
- Work: push-to-record, at most 30 seconds; permission denial state; mono 24kHz PCM16 WAV encoder; exact multipart request; insert text into the description, never auto-render.
- Done when: actual recording passes WAV validation and ASR smoke; unsupported/denied/empty states work; cap includes ASR; VOICE_ENABLED=false hides the feature. Build/types/tests pass. Do not spend the protected final-day buffer on this ticket.

## T20 — Extra automatic slots and custom-part naming

- Priority: Stretch, unscheduled. Estimate: 1h. Depends on: T14 and explicit scope approval to add any route/schema.
- Files: src/lib/slots.ts, prompts/label-part.v1.md, corresponding contracts/client/route only after SPEC update, optional fixture assertions.
- Work: try five extra phrases only where visible on owned bikes; if justified, specify the labelPart call/route with the same strict schema/budget rules before implementation. Keep manual labels as the fallback.
- Done when: useful masks are shown for visible parts; missing masks cause no error or false detection; new route has method/schema/deadline/errors in SPEC and a paid-call cap; no additional dependency or generic image-analysis scope appears. Otherwise leave this ticket skipped.

## T21 — German estimate PDF

- Priority: Stretch, unscheduled. Estimate: 2h. Depends on: T11, T14 and owner translation review.
- Files: src/lib/pdf.ts, translation data, local QA PDFs, docs/submission.md feature list.
- Work: translate estimate labels and notes, keep schemas/amounts identical, verify long compound words and German legal terms. English remains the default hackathon output.
- Done when: owner reviews translation; 1-page and 3-page PDFs render cleanly; values match English output exactly; no legal certification language is introduced. Never delay T18 for this ticket.

## Completion log template

For each completed ticket append actual date/time ET, files changed, checks and observations, cost ledger total, remaining U-gates, actual hours, and commit hash. For a cut/blocked ticket record the concrete fallback or missing input. A checkbox alone is not evidence. The final README and video use this actual log, not the estimates above.

## Progress log

### T0 session 1 — 2026-10-27, about 23:15–23:58 ET (about 0.75 h)

- Status: in progress. Offline scope done. Live scope blocked.
- Files: budget/prices.json, budget/reserve.lua, budget/settle.lua; spike/requirements.txt, common.py, imaging.py, local_images.py, responses_sam.py, responses_spark.py, images_edits.py, asr_transcribe.py, files.py, deployment.py, run_all.py, ledger.py, expected.example.json; prompts/identify.v1.md, instruction.v1.md, paint.v1.md, compose.v1.md, prompts/schemas/bike_identification_v1.json, edit_instruction_v1.json; docs/api-evidence.md; SPEC.md notes (sharp 0.35.5, click floor, Redis hash tag); PLAN.md 7.2 pointer.
- Checks run:
  - `.venv` setup with Python 3.11.16: ok.
  - `python spike/local_images.py --fixture-set all`: 32 passed, 0 failed, 5 skipped. The skips are the missing owned fixtures (U09).
  - `python spike/run_all.py --mode smoke --dry-run`: all request shapes built, no HTTP.
  - Gates fail closed. Paid scripts exit 3 without a ledger. Grounded exits 3 (U06). Files exits 3 (pricing unknown). ASR exits 5. deployment.py exits 2 because the app isn't built yet.
- Not run: any live profile, `ledger.py selftest` (needs Redis), and the TypeScript parser and placement repeat (T1/T3).
- Cost ledger: $0.00. No paid calls were made.
- Owner decisions recorded: npm set approved with sharp 0.35.5; Pillow and numpy approved; charset-normalizer approved after the fact; node@22 installed via Homebrew.
- Remaining before T0 can complete:
  - U09: five owned photos, fixtures/expected.json, and the consent record.
  - U06: Billing spend limit, `ledger.py init` after reconciliation, PRICING_VERIFIED_AT. (Upstash done 2026-10-28; see below.)
  - Then the live profiles: SAM concept and points, Spark identify and instruction, image edit, compose; owner overlay review for U01.
- Consultant review (2026-10-28):
  - Nemotron 3 Super returned 404; the fallback Nemotron 3.5 reviewed the Lua files and common.py; Gemini reviewed imaging.py.
  - Adopted:
    - An exception in charge() or dispatch now settles "unknown" instead of leaving the reservation stuck.
    - load_prices fails closed.
    - Dilation no longer crashes when the radius exceeds the mask height.
    - Palette transparency and CMYK/ICC handling fixed.
    - A 200 MP decompression bomb now maps to TOO_LARGE.
    - Integer resize steps; APNG `is_animated` check; zero-size click guard; no dithering in mask PNGs.
  - Rejected:
    - Coercing corrupt Redis numbers to 0 (that would fail open).
    - Retrying paid calls on 5xx, and retrying Redis (the spec forbids both).
    - Per-write TTL refresh (harmless).
    - Memory and performance concerns about transient numpy arrays (fine for the spike).
    - A symmetric aspect formula (SPEC fixes the formula).
    - The claimed upstream body leak (only the error code and type are kept).
  - Rechecked: local_images 35 passed, 0 failed, 5 skipped; smoke dry run shapes ok.

### T0 session 2 — 2026-10-28 (Upstash ledger, about 0.25 h)

- Owner created the Upstash Redis database: regional, free plan, eviction off. URL and token are only in `.env.local`, which is gitignored.
- Checks run (Redis only, no Meta calls, $0.00):
  - `python spike/ledger.py status`: connected. All buckets missing, as expected before init. No halt flag, 0 ledger entries.
  - `python spike/ledger.py selftest`: 8 of 8 passed. Covered: missing lifetime fails closed, duplicate ID refused (pending and settled), settle refunds the difference, unknown outcome keeps the full reservation, released 429 keeps the attempt count, concurrent reservations stay under the cap (granted=8, used=940000 µ$), and a charge above the reservation halts further calls.
  - After the selftest: DBSIZE 0, no `{dreambike:selftest-*` keys left.
- Owner reports setting a $50 Meta Billing spend limit on 2026-10-28 ("for now"). Claude can't see the Billing page. The ledger caps are still the defaults ($5/ticket, $5/day, $50 development, $100 project), so the ledger stops before Billing would. The $100 project cap can't be reached until the owner raises the Billing limit.
- Owner checked the Meta Billing page: $0.01 spent since the start, from calls made before the ledger existed (none from T0). `ledger.py init --spent-usd 0.01 --confirm-reconciled`: ok. Status shows lifetime spent=10000 µ$, reserved=0.
- Still open for U06: PRICING_VERIFIED_AT and the per-request search bound before grounded calls.

### T0 session 3 — 2026-10-28, ended 07:39 ET (pricing check and owner fixtures, about 1 h active)

- Status: in progress. The fixtures are built. Live profiles wait for owner sign-offs.
- Files committed:
  - budget/prices.json: documentedAt and note only; values unchanged.
  - docs/api-evidence.md: Pricing check section, U06 and U09 rows, ledger rows. Part of this landed in the T2 commit b70a0f7, staged by the T2 session.
- Files gitignored, not committed: fixtures/plain-wall-right.jpg, plain-wall-left.jpg, cluttered.jpg, exif-rotated.jpg, heic.heic, expected.json.
- Pricing: every value in budget/prices.json matches the live page (table in docs/api-evidence.md). The owner chose to review the page before PRICING_VERIFIED_AT is set, so it stays blank.
- Source photos in my_bike/:
  - 5 iPhone 14 HEIC files, taken 2025-05-26 at 17:10 +02:00 (EXIF), all with GPS.
  - IMG_1570 and IMG_1572 are portrait (Orientation 6).
- Roles:
  - right ← IMG_1568
  - left ← IMG_1574
  - cluttered ← IMG_1575
  - exif-rotated ← IMG_1572
  - heic ← IMG_1572.HEIC
  - IMG_1570 not used (5 or more readable third-party plates).
- Covered with solid fills (owner approved boxes A–F):
  - IMG_1568: two identifiable people in the garage, and the photographer's reflection on the tank.
  - Three third-party plates: IMG_1568 once, IMG_1574 twice.
  - IMG_1572: a possible reflection on the tank.
  - The bike's own plate holder is empty in every photo.
  - The owner kept the shop logo and dealer signs.
- Metadata: the JPEG fixtures have no EXIF, XMP or GPS (checked with Pillow and mdls). exif-rotated keeps only Orientation=6.
- Bike truth (owner): BMW R nineT base model, 2014–2016, 1170 cc air/oil-cooled boxer, ABS yes. Photographer: Tom.
- expected.json holds:
  - the owner facts above
  - facing, visibleSlots, pointTest (rear hub), paint box (tank) and text box (seat), measured by Claude and checked on an overlay
  - paint and text requests, which are Claude's test proposals
  - identifiersReviewed and noPeople set to false, consentRecord set to null
- Checks: `python spike/local_images.py --fixture-set all`: 40 passed, 0 failed, 0 skipped (before: 35 passed, 5 skipped).
- Cost: $0.00. No paid calls.
- Remaining before the live T0 profiles:
  - Done 2026-10-28: the owner reviewed the pricing page and added PRICING_VERIFIED_AT=2026-10-28T07:47:28-04:00 to `.env.local` themselves. Auto mode blocked Claude's shell append, in line with the new `.env.local` deny rule. `ledger.py status` readiness: pricing_verified true.
  - Done 2026-10-28: the owner checked fixtures/ in Preview and saw no people and no readable plates. identifiersReviewed and noPeople are now true for all 5 entries.
  - Done 2026-10-28: the consent record. At the owner's request Claude drafted it in the session scratchpad; the deny rule on consent/** keeps Claude out of that folder. The owner moved it to consent/2026-10-28-dreambike-photos.md, edited it and saved it. Claude hasn't read it. The draft is gone from the scratchpad, so the move worked. consentRecord in expected.json now points to it.
  - Next: the paid live T0 profiles, on the owner's go.
  - Then the live profiles:
    - SAM concept, including the zero-match lane behaviour the T3 session asked about
    - SAM points with an overlay for U01; report the placement mode to the T3 session for VERIFIED_SAM_PLACEMENT
    - Spark identify and instruction (U02)
    - image edit (U04)
    - compose

### T1 — 2026-10-28, 00:00–00:25 ET (about 0.5 h)

- Status: done.
- Files: package.json and lockfile, .node-version, tsconfig.json, next.config.ts, eslint.config.mjs, postcss.config.mjs, vitest.config.ts, AGENTS.md (generated by `next dev`), src/app/layout.tsx, page.tsx, globals.css, src/styles/tokens.css, src/components/ModeBanner.tsx, src/lib/contracts.ts, types.ts, errors.ts, slots.ts, src/lib/mocks/index.ts, src/lib/server/config.ts, meta.ts, budget.ts, tests/contracts.test.ts, config.test.ts, budget.test.ts, tests/support/server-only.ts, prompts/schemas/*.json (now generated from Zod), .gitignore (my_bike/).
- Install note: npm 10.9.9, which ships with Node 22.23.4, crashes in arborist (`edgesOut` of null). The install used Homebrew's npm 11.19.1 running under Node 22: `node /opt/homebrew/Cellar/node@24/24.22.0/lib/node_modules/npm/bin/npm-cli.js install`. That installed 402 packages, 553 MB, with a single sharp 0.35.5. `npm run` scripts work with npm 10.
- Checks run, all with Node 22.23.4:
  - `npm run typecheck`: ok.
  - `npm run lint`: ok, 0 problems.
  - `npm test`: 22 passed (3 files).
  - `npm run build`: ok.
  - `next dev` with MOCK=1 renders the "Mock" banner.
  - `next start` with MOCK=1 returns 500 with "MOCK=1 is not allowed in production". Default `next start` shows the "Demo only" banner.
  - A build with a canary MODEL_API_KEY leaves no key value, env names, or api.meta.ai in `.next/static`.
  - No hex colors outside tokens.css.
  - Python validator agrees with the Zod-generated Spark schemas.
- Schema change: Zod emits the non-standard `format: "starts_with"` for https URLs. `modelJsonSchema()` drops non-standard formats and keeps the `^https://` pattern (U02 risk noted).
- Consultants:
  - Nemotron 3.5 reviewed contracts.ts, config.ts, and budget.ts.
  - Gemini timed out (idle 300 s) and was not retried.
  - Adopted: BikeChecked in IdentifyResponse and SearchRequest; MOCK refused on any Vercel deployment (VERCEL_ENV); Box positive-area check; live mode blocked in production without APP_ORIGIN.
  - Rejected:
    - "startsWith not emitted" (it is emitted as a pattern).
    - "Use optional instead of nullable" (SPEC requires every key, which strict output needs).
    - "Settle ordering in Lua" (the scripts are atomic).
    - "DST gap at midnight" (ET switches at 02:00).
    - Retrying or unmasking accounting errors (SPEC says fail closed without detail).
    - Treating a charge() exception as an error instead of unknown (unknown keeps the full reservation, which is the safe side).
    - process.cwd() for Lua paths: kept, to be verified on Vercel in T14 (U08).
- Owner photos noticed (my_bike/, 5 HEIC files from 2025-05-26, ignored by git and not opened):
  - All 5 are rejected offline with the exact HEIC message.
  - Local JPEG copies made with macOS sips into my_bike/jpeg/. All normalize: 2048×1536 or 1536×2048, 0.52–1.02 MB.
  - IMG_1570 and IMG_1572 carry EXIF Orientation 6, so they are EXIF-fixture candidates.
  - Roles, identifier review, and consent are still the owner's.
- Cost ledger: $0.00. No paid calls.
- Remaining gates: U01–U04 and U06 need the ledger and the fixtures; T3+ live handlers must call budget.ts reserve() before dispatch.

### T2 — 2026-10-28, 00:22–00:42 ET (about 0.5 h)

- Status: done.
  - Still open for the owner: the Safari check and the roles for the five owned fixtures (U09).
  - `/build-ticket` could not run in this session: the agents in .claude/ load only in sessions started after ea62a19. The same loop ran by hand: the lead built; imaging, security, and general reviewers (general-purpose agents following their .claude/agents definitions) reviewed; the lead fixed; general-reviewer rechecked.
- Files:
  - New: src/lib/imageFormat.ts (pure helpers shared by browser and server), src/lib/server/images.ts (sharp), src/lib/server/http.ts, src/app/api/normalize/route.ts, src/lib/browser/preflight.ts, src/lib/browser/normalizeClient.ts, src/components/UploadNotice.tsx, UploadDropzone.tsx, ImageCanvas.tsx, Workspace.tsx, tests/images.test.ts, tests/preflight.test.ts.
  - Changed: src/app/page.tsx, src/lib/types.ts (NormalizedImage, NormalizeOptions, NormalizedPhoto).
- Checks run (Node 22):
  - `npm run typecheck`: ok.
  - `npm run lint`, repo-wide: ok.
  - `npm test`: 41 passed in 5 files.
  - `npm run build`: ok; the client bundle canary scan was clean; no hex outside tokens.css.
  - `python spike/local_images.py --fixture-set all`: 35 passed, 0 failed, 5 skipped (U09 fixtures).
  - Real server (`next start`):
    - The owner's Orientation-6 JPEG (sips, 1600×1200 stored) came back 1200×1600.
    - A 4 MB JPEG gave 413; a foreign Origin gave 403.
  - Real headless Chrome 156 over CDP, using the actual notice and dropzone on `next dev`:
    - The owner's IMG_1570 (Orientation 6, 4032×3024 stored) came back 1536×2048.
    - The browser-path output differs from Pillow by a mean of 4.21 per channel; a 180°-rotated reference differs by 84.71.
    - The real IMG_1572.HEIC showed the exact HEIC message with 0 /api/normalize requests.
  - Vitest compares Pillow and sharp on the owner JPEG copies: same size, mean difference under 4.
- Review round 1:
  - general-reviewer: 2 major and 4 minor.
  - imaging-reviewer: 2 major and 4 minor.
  - security-reviewer: approved, with 6 minor.
  - Nemotron 3.5 (PAL) and Gemini also reviewed.
  - Fixed:
    - HEIC or unsupported files sent with their real MIME now get 415.
    - Browser header checks have tests.
    - The server rejects APNG.
    - Body limit for this route is 1.30 MB, with streamed, duplicate-part, and forged-Host tests.
    - Origin allowlist: APP_ORIGIN, plus localhost only when not deployed; never derived from Host.
    - Retry with the same file.
    - Types moved to types.ts.
    - Sharp resizes during decode, with an 8 s timeout per pipeline.
    - The quality ladder now matches Python, and a 1×1 no-progress loop is stopped.
    - JPEG fill bytes and SOS, VP8 sync, HEIF compatible brands.
    - The browser reads a 1 MB header, guards 40 MP after decode, falls back to `<img>` where createImageBitmap options are unsupported, and detects WebP encoding once.
    - Unexpected errors log class and request ID only.
  - Round 2 (general-reviewer): approved all 12 items. Its minor notes on non-JSON 5xx retry and the WebP flag were fixed; a large HEIC posted straight to the API gets 413 before the HEIC message, accepted because the browser rejects HEIC first.
  - Rejected, verified against the code:
    - Nemotron "PNG chunk length at pos+4": the length is at pos.
    - "errorResponse can throw": every code has an entry.
    - "MIME-only validation": the file signature decides.
    - "Deadline thunk": no effect.
  - Left as is:
    - Browser APNG detection beyond the first 1 MB; the server catches it.
    - TS resamples each shrink step from the decoded raster; the pixel sizes are the same as Python's.
  - Deferred to T13: the signed session cookie on POST routes (SPEC 5). This route makes no paid call and is Origin-checked.
- Cost ledger: $0.00 (no paid calls).
- Remaining gates:
  - U05 stays PARTIAL until the Safari check, the owned exif-rotated fixture (U09), and the deployed envelope (T14).
  - Owner Safari check: drop IMG_1570.jpg into `npm run dev`; it should show upright with 1536 × 2048 in the caption. Drop a .HEIC; the exact message should appear.

### T3 — 2026-10-28, 00:43–01:18 ET (about 0.6 h)

- Status: offline and mock scope done. Live part detection is blocked by U01.
  - `VERIFIED_SAM_PLACEMENT` is null, so `/api/segment` live returns FEATURE_DISABLED before any reservation.
  - `/build-ticket` was unavailable in this session, so the challenge loop ran by hand. Round 1: models-, imaging-, security- and general-reviewer. Round 2: general-reviewer covering all round-1 items.
- Files:
  - New: src/lib/coordinates.ts, src/lib/parts.ts, src/lib/queue.ts, src/lib/server/sse.ts, src/lib/server/paid.ts, src/app/api/segment/route.ts, src/lib/mocks/segment.ts, src/lib/browser/segmentClient.ts, src/lib/browser/partMap.ts, src/components/PartOverlay.tsx, PartSelector.tsx, tests/coordinates.test.ts, masks.test.ts, paid.test.ts, partmap.test.ts.
  - Changed: src/lib/server/meta.ts (SAM wire), src/lib/server/images.ts (mask placement and PNG), src/lib/server/budget.ts, src/lib/types.ts, src/components/ImageCanvas.tsx, Workspace.tsx, package.json (dev binds 127.0.0.1), .env.example (BUDGET_TICKET), SPEC.md 6.1 implementation note.
- Checks run:
  - `npm run typecheck`: ok.
  - `npm run lint`: ok.
  - `npm test`: 72 passed in 9 files.
  - `npm run build`: ok; client bundle canary clean; no hex outside tokens.css.
  - Headless Chrome 156 over CDP, MOCK=1, on landscape 1440×900 and portrait 1280×800 owner photos (re-run after every fix round):
    - 15 /api/segment requests: the cutout, then 14 phrases at most 4 in flight.
    - Answering "Right" assigned the front and rear wheels.
    - Clicking the mock tank position selected Tank.
    - The overlay painted at image resolution.
    - "Select by point" added Mirrors.
- What the tests cover:
  - Clicks through both letterboxes, within 3 px at two canvas sizes with fractional sizes, exclusive edges.
  - Hit test: smallest mask wins; stale, wrong-size and other-photo masks are ignored.
  - SAM stream:
    - the same records for every byte split, pairing by object ID, confidence, half-open bounds, an empty lane;
    - eof without a terminal event, a non-SSE body, an error event, a refusal, 429 with Retry-After, 4xx, and a mid-stream stall that becomes a timeout.
  - SSE CR/CRLF and multi-line data.
  - Mask placement refused until verified; box-relative placement stays inside the box; PNG round trip.
  - Part rules: the 60% rule (also on unions), front/rear by facing, same-side or merged candidates, no bike outline.
  - Queue: at most 4 in flight, partial results kept.
  - withReservation against a fake Upstash: settled, released only on 429, unknown otherwise; no dispatch when deployed, not live, without a ticket, or on a duplicate or conflict.
  - Derivation: the facing answer survives late results, plural union, bike switch, other-photo point parts ignored.
- Round 1 (CHANGES REQUESTED from models, imaging, security, and general), fixed:
  - Detection now only writes raw results; parts are derived (no facing race).
  - Image-hash guards against late results from an earlier photo.
  - "Motorcycle outline" point target to recover the bike; next-bike switch for photos with more than one bike.
  - Plural union; 2-screen-px outline by erosion.
  - withReservation tests.
  - `next dev -H 127.0.0.1`.
  - Stream errors mapped honestly: mid-stream timeout, eof, content type, error events.
  - SSE CR handling, linear scan, cancel.
  - Envelope: skip rather than break; more than 16 objects gives a warning; real JSON measured; response schema-checked.
  - One total deadline; Retry-After; frame-0 filter; redirect "error" on the Meta and Redis fetches; conflict maps to INVALID_REQUEST; a paid result is kept if settle fails.
  - BUDGET_TICKET must look like T3.
  - Live segmentation refused before any reservation until U01.
  - Neutral "no bike" state; same-side duplicates need a point; point selection clips first and requires the clicked pixel; wrong-size mask is visible as complete=false.
  - Types moved to types.ts.
- Round 2 (general-reviewer): approved. Its minors were also fixed: double-click guard in point mode, hash test for hit testing, "Swap front and rear", derive cache.
- Consultants:
  - Nemotron 3.5 saw only part of the files (its token limit). Adopted: reply-shape check on reserve; measured envelope. Rejected: settle NOOP handling (fails closed already), spike charge handling (decided in T0), sliding TTL (harmless).
  - Gemini, adopted: union must pass the 60% rule; two wheels without a bike outline need a point; build stops on abort; point parts filtered by hash; derive cache and faster clip loop. Rejected: fractional click coordinates (screenToImage already returns integers).
- Deviations recorded:
  - SPEC 6.1 implementation note on the segment signature.
  - Cutout feather at sigma 1.5 deferred to the first ticket that displays the cutout.
  - A completed stream with no lane stays SCHEMA_INVALID until U01 records a real zero-match stream.
  - T13 carry-overs: visitor HMAC in the fingerprint, visitor count limits, 48 h identifier TTL, session cookie.
- Cost ledger: $0.00 (no paid calls).
- Remaining gates:
  - U01: owned off-origin overlays.
  - Then set `VERIFIED_SAM_PLACEMENT`, run one live segment smoke with BUDGET_TICKET=T3, and recheck "a wheel click highlights its real pixels".

### T4 — 2026-10-28, 01:20–01:34 ET (about 0.25 h of build plus review rounds)

- Status: offline and mock scope done. Live identify and instruction run through withReservation (local, BUDGET_TICKET required), but their answers are unverified until U02.
- Files:
  - New: src/app/api/identify/route.ts, src/app/api/instruction/route.ts, src/lib/editPolicy.ts, src/lib/bikeForm.ts, src/lib/browser/sparkClient.ts, src/components/BikeConfirm.tsx, DescribeForm.tsx, PaintForm.tsx, InstructionPreview.tsx, tests/spark.test.ts.
  - Changed: src/lib/server/meta.ts (sparkBody, readSparkResponse, sparkCharge, usageOf, fetchSparkJson, promptText), src/lib/server/http.ts (payloadAndFiles, requireRequestId), src/lib/server/images.ts (assertWebpSize), src/components/Workspace.tsx, prompts/instruction.v1.md (trust boundary; no live call had used v1 yet, so the text was revised in place).
- Checks run:
  - typecheck: ok. lint: ok.
  - `npm test`: 89 passed in 10 files.
  - `npm run build`: ok; client bundle canary clean; no hex outside tokens.css.
  - Headless Chrome 156 (CDP), MOCK=1, 1440×900:
    - The identify hint appears.
    - Typing "2", "20", "201", "2018" keeps each value; an error shows and Confirm is disabled until the year is complete.
    - Confirm bike works and lists the limitations.
    - Tank → Describe → Prepare gives the mock instruction (replace).
    - "Render change" is disabled with "not built yet".
    - Paint tab: the paint form appears.
    - The T3 flow is intact.
- Live-path tests use a fake Upstash and a fake Meta: a refusal, or a bike with reversed years, settles the real token charge (400 µ$) and returns a safe error. The bike's limitation text is never sent to the model.
- Review round 1:
  - models-reviewer: 1 major (bike free text trusted in the prompt) and 7 minors.
  - general-reviewer, also covering security: 2 majors (year typing broken; a late suggestion overwrote confirmed values) and 5 minors.
  - Gemini: 3 high-severity items, all real (year touch, confirm lock, handlebar regex).
- Fixed:
  - Prompt trust boundary; bike.limitations not sent.
  - Year input keeps what was typed; confirm error clears on edit; panel keyed by photo.
  - Suggestions ignored after any confirmation.
  - The real charge is settled before the answer is judged; reasoning and total token sanity checks.
  - Malformed answer shapes are handled; status is read first.
  - Intent rules: fork and wheel size or replacement words force geometry; a finish change stays paint.
  - Broader handlebar keyword list (English and German, with word boundaries).
  - The preview is tied to the bike state.
  - aria attributes added; the doubled period removed.
- Review round 2 (general-reviewer): approved all 10 items. Its minors were fixed too (finish words, limitations test, test for the German "höher").
- Rejected:
  - "No test that committed schemas match the generator": tests/contracts.test.ts already compares them.
  - "Recompute limitations on suggestion": the model's notes are kept and confirm recomputes the unknowns.
  - "Do not trim to null": only a fully blank field becomes unknown.
- Deferred:
  - SPEC 10 manual retry with estimated cost and a cancel note: T5 and T13.
  - A prepared preview stays visible while the request is retyped: cosmetic.
- Process note: the round-1 models-reviewer ran `npx tsx` for a one-off check. That downloaded tsx into the npm cache only; nothing in the project changed. It broke the subagent no-install rule, so later prompts forbid npx downloads.
- Cost ledger: $0.00 (no paid calls).
- Remaining gates:
  - U02: live identify and instruction smoke with BUDGET_TICKET=T4, owned photo, strict schema acceptance including minLength/maxLength/min/max.
  - If strict mode rejects those keywords, fall back to stripping them in modelJsonSchema; Zod still enforces the limits after the call.

### T5 — 2026-10-28, 01:36–01:53 ET (build plus two review rounds)

- Status: offline and mock scope done.
  - /api/edit live goes through withReservation (local, BUDGET_TICKET) but is unverified until U04.
  - Live re-segmentation of the edited part is off until U01, so live renders take the documented missing_mask full-image path.
- Files:
  - New: src/app/api/edit/route.ts, src/app/api/composite/route.ts, prompts/edit.v1.md (added to the SPEC 8 table), src/lib/browser/renderClient.ts, src/lib/browser/renderFlow.ts, src/components/EditReview.tsx, BeforeAfter.tsx, ProgressStatus.tsx, tests/composite.test.ts, tests/edit.test.ts, tests/renderflow.test.ts.
  - Changed:
    - src/lib/server/images.ts: composite math port, decodeRgb, encodeRgbBounded, webpSize.
    - src/lib/server/meta.ts: Muse Image wire, renderTemplate, readJsonLimited.
    - src/lib/parts.ts: boxIoU, chooseCandidate, interiorPoint.
    - src/lib/browser/partMap.ts: stale state after accept, recutBike, refreshedPart.
    - src/lib/types.ts; src/components/Workspace.tsx, PartSelector.tsx, InstructionPreview.tsx.
    - SPEC.md 8 (edit.v1 row); docs/api-evidence.md (U04 row).
- Checks run:
  - typecheck: ok. lint: ok.
  - `npm test`: 108 passed in 13 files. The Python parity test against spike/imaging.py ran: dilation exact, feather within 1 step, drift within 1e-9, blend within 1 step, including a non-zero drift case.
  - `npm run build`: ok; client bundle canary clean; no hex outside tokens.css.
  - Headless Chrome 156 over CDP, MOCK=1, 1440×900:
    - Prepare → Render change. The stages showed, with exactly 1 /api/edit.
    - Preview "Blended: everything outside the part is kept from your photo." with the slider.
    - Accept gives a new image hash. Only the refreshed Tank is selectable, and "Other parts are not checked on this version yet" appears.
    - "Detect parts again" restores the map.
    - No re-identification: 1 /api/identify in total.
    - 33 /api/segment in total: 15 initial, 1 point, 1 edited-part refresh, 1 bike recut, 15 manual re-detect.
- Review round 1:
  - imaging-reviewer, 3 majors:
    - the protection test could pass even with wrong feather settings;
    - bike width fell back to the photo width after an accept;
    - the resized raster could exceed 1.25 MB.
  - models/security reviewer: approved with 6 minors.
  - general-reviewer, 1 major: the same oversized raster, plus Safari PNG instead of WebP.
- Fixed:
  - The protection test now differs everywhere (+8 outside the part) and asserts both the band and the drift range; the parity test has a non-zero drift case.
  - Bike width: no bike outline means the full edit; the old outline is carried forward for same-size results until the recut replaces it.
  - Raster size: quality ladder, WebP type check, otherwise the full edit.
  - The template inserts text verbatim (no "$" patterns).
  - Upstream bodies are capped at 40 MB.
  - Edit route: 12 s kept for post-processing; bad generated output is INVALID_IMAGE.
  - Composite route checks the real WebP format and animation; encodeRgbBounded never resizes silently.
  - A non-blended result shows the render at its own size.
  - "Retry blend" can never turn into a paid render; cancelling keeps a paid render for Retry blend.
  - Cancel button with a billing note; "Render again" only for retryable errors, with cost notes.
  - Wording: "nothing changes until you accept".
  - Render disabled while any render runs.
- Round 2 (general-reviewer): approved all items. Its N1 (tests for the upstream cap and animated WebP) and N2 (keep the paid render on cancel) were fixed.
- Recorded, not changed:
  - SPEC 7 deviation: the browser resizes the render to the base size with canvas smoothing, not Lanczos3. The effect is small, well under the drift threshold. A sharp Lanczos3 raster would need an EditResponse contract change. Owner accepted the deviation 2026-10-28; SPEC 7 and PLAN updated.
  - The client does not know COMPOSITE_ENABLED, so SAM may run before a "disabled" answer.
  - Grayscale drift misses a hue-only global shift (U04 note).
  - Stale masks are dropped after accept; T6 owns stale flags.
  - N3: after a failed recut, the carried-forward outline may be off for a drift-fallback result.
  - N4: switching parts during a render hides its progress.
  - N5: an oversized blend gives INVALID_IMAGE rather than the full edit.
- Cost ledger: $0.00 (no paid calls).
- Remaining gates:
  - U04: one live render with BUDGET_TICKET=T5 on an owned photo and an owner before/after review.
  - U01: real masks, which enable real composition.

### T6 — 2026-10-28, about 02:00–02:40 and 08:15–08:40 ET (build-ticket workflow, fix round, browser check)

- Status: done offline and in mock. History and storage are local only and make no paid calls.
- Dependency: fake-indexeddb 6.2.6 as an exact devDependency for tests only. It is 491 KB unpacked, Apache-2.0, and not in the client bundle; under the 1 MB approval threshold.
- Files:
  - New:
    - src/lib/db.ts: idb layer and transactions.
    - src/lib/project.ts: pure version tree.
    - src/lib/cache.ts: derivation cache, byte ledger, LRU, quota.
    - src/lib/browser/projectSession.ts: UI glue.
    - src/components/AppShell.tsx: client header with Undo and Redo; page.tsx stays a server component.
    - src/components/ProjectList.tsx, src/components/VersionStrip.tsx.
    - tests/db.test.ts, cache.test.ts, project.test.ts, projectsession.test.ts, bikeform.test.ts, tests/support/idb.ts.
  - Changed:
    - src/lib/contracts.ts: persisted schemas (ImageRef, StoredImage, StoredMask, Part, BikeRevision, Version with tree refinements, Project, CacheEntry, meta).
    - src/lib/types.ts: persisted types inferred from those schemas; EditModeId.
    - src/lib/browser/partMap.ts: restoredPartMap, mask conversion, partsToPersisted, stale parts carried forward.
    - src/lib/bikeForm.ts: bikeFormFromRevision.
    - src/components/Workspace.tsx, EditReview.tsx, PartOverlay.tsx, PartSelector.tsx; src/app/page.tsx; tests/partmap.test.ts.
  - TASKS lists fewer files for T6. These extra files were needed: projectSession, AppShell, partMap, bikeForm, contracts and types, and the db and projectsession tests.
- Design notes:
  - DB "dreambike" v1 with the stores and indexes from SPEC 9.
  - A newer schema opens read-only and never deletes. Another tab's upgrade closes this connection with a "reload the page" message.
  - acceptVisual writes image, masks, version and head in one transaction. It checks expectedHeadId inside the transaction (stale_head), is idempotent for a retry with the same IDs, and accepts kind "visual" only (sheet versions come with T8).
  - Undo, redo and jump load the target view first, then move the head with an expected-head guard.
  - attachParts updates display data (parts and outline) only when the image hash matches.
  - Quota: one safe cache cleanup, one retry with the same IDs, then STORAGE_FULL. Writes pause when protected data alone exceeds 200 MB.
  - Reload and open never start a paid call. The identify result is cached as id:<hash>:identify-v1.
- Checks run:
  - typecheck: ok. lint: ok. build: ok.
  - `npm test`: 213 passed in 18 files, all on fake-indexeddb:
    - three accepts survive close and reopen;
    - undo restores the image ref and items together;
    - redo with a branch chooser, and a branch from an earlier node;
    - the same slot edited twice gives one active item and two change records;
    - an injected failure inside acceptVisual keeps the head and leaves no orphan;
    - a stale expectedHeadId is refused;
    - an idempotent retry;
    - quota as a put error and as a transaction abort, with exactly 2 attempts and then STORAGE_FULL with projects intact;
    - read-only on a newer schema;
    - deleteProject keeps shared blobs;
    - invalid persisted records are rejected;
    - the head is unchanged when the target photo is missing on undo or jump.
  - Headless Chrome 156 over CDP, MOCK=1, 1440×1000, synthetic gradient JPEG (no owner photo):
    - import created the project ("Saved on this device");
    - three accepts (Tank, Tank again, then Front wheel after "Detect parts again");
    - reload, the project list, Open: head image hash, four history steps, sheet (Tank, Front wheel) and confirmed bike all came back, with 0 /api/segment, /api/identify, /api/edit or /api/instruction calls after the reload;
    - Undo and Redo change the image and the sheet together;
    - a branch from step 1 gives the branch chooser (titles plus accept time), and picking one works;
    - jumping to step 0 works;
    - Undo while a preview is open discards it with "no new render was started";
    - two consecutive opens leave identical mask IDs, so opening writes nothing;
    - no page exceptions.
- Workflow result: needs_lead.
  - All 4 units (history, store, restore, ui) were approved by their reviewers, and the checks were green.
  - Gate majors: STORAGE_FULL offered no delete without closing the project; the browser inspection was missing.
- Fix round:
  - shop-builder fixed 13 items:
    - blocking() closes the connection;
    - navigation loads the view before moving the head;
    - jump is guarded;
    - invalid input gives InvalidWriteError, not "corrupt";
    - image dedupe skips damaged records;
    - unreferenced masks are refused;
    - acceptVisual accepts visual versions only;
    - the storage limit is checked in attachParts;
    - cutout size is checked;
    - the childParts slot is checked;
    - EditMode comes from contracts;
    - Version tree refinements;
    - quota as a transaction abort, which exposed a real gap in runTx that is now fixed.
  - ui-builder fixed six items:
    - inline delete-only project list on STORAGE_FULL, keeping the preview and the IDs;
    - delete for damaged projects;
    - read-only Accept stays in memory without a fake retry;
    - the openSaved token guard;
    - navigation waits for pending part saves;
    - stale parts are drawn dashed on the photo.
  - Lead: the browser run showed the root version saved only [tank], because detection was saved before the front/rear answer. Facing and bike-choice changes now mark the parts for saving, only when a detected front/rear phrase can change. The branch chooser shows the accept time.
- Review of the fix round:
  - shop-reviewer approved, with no auto-commit hazard found (every await in a transaction is an IDB request).
  - general-reviewer found 2 majors, both fixed:
    - opening an unconfirmed project with a cached facing suggestion rewrote the masks;
    - "Save this photo" could hide a paid preview. It is now disabled until the preview is accepted or discarded.
  - Its minors were also fixed:
    - the storage-full notice clears on Reject;
    - the save-photo token check now also runs on error;
    - a failed part save on full storage gets a free "Save the parts" retry.
  - The shop-reviewer's m1 (redo passes the previewed target) was fixed.
- Consultants: unavailable this round.
  - PAL nim-nemotron35 codereview skipped db.ts both times (file token limit), so it returned no findings.
  - Gemini (agy) was denied a tool permission in headless mode.
  - The limits for this task are used up; no retries.
- Recorded, not changed:
  - m2: a same-ID retry after the head has moved on reports "not saved" although the version exists.
  - m3: putCache links a same-hash image without validating it.
  - SHOP-H2: an undo followed by redo back to the same head is not detected in storage; the UI discards the preview on any navigation.
  - Stale parts on a full-image fallback are dropped by design (SPEC 9 invalidation table).
  - The STORAGE_FULL UI paths are unit-tested at the storage layer only; fake quota was not driven through the browser.
- Cost ledger: $0.00 (no paid calls).
- Remaining gates: none for T6. Safari should get one manual pass (IndexedDB Blob storage), together with the T2 Safari check.

### Handoff — 2026-10-28 (owner inputs for the next session; nothing run)

- New owner input for T7: a photo of the father's bike, which the owner calls "Bike Rumble". The owner says they hold the rights and wants its golden wheels on the R nineT.
  - The photo is in my_bike/. The deny rule in .claude/settings.json keeps Claude out of that folder, and it stays.
  - Owner decision 2026-10-28: the owner copies a JPEG export to fixtures/reference-source.jpg. Claude then proposes the wheel crop and cover boxes on a scratchpad overlay, writes fixtures/reference-wheel.jpg with no metadata after the owner approves, and fills the `reference` entry in fixtures/expected.json (file, slot, box, description, identifiersReviewed).
  - Record the bike's identity only as the owner states it; don't guess the model.
  - Done 2026-10-28: the copy is fixtures/Rumble.tiff (1920x1281, no EXIF, GPS or date; a studio shot with a MOTOR Visionen logo). The owner says MOTOR Visionen is the father's shop and the rights are fine. The owner named no photographer and no date; both are null.
  - Done 2026-10-28: Claude cut two crops without metadata (Pillow and mdls checked), front [1290,560,1905,1160] and rear [70,560,660,1160]. Claude couldn't write into fixtures/ (the image deny rule), so they wait in the session scratchpad for the owner to move them as fixtures/reference-wheel-front.jpg and reference-wheel-rear.jpg. Both are about 600 px, so normalization warns about low resolution.
  - Done 2026-10-28: expected.json `reference` (front, used by the spike) and `referenceRear` are filled. Description in the owner's words: "Gold multi-spoke wheel with chrome hub, about 20 inch" (the 20 inch is the owner's estimate). identifiersReviewed stays false until the owner checks both crops in Preview.
  - Done 2026-10-28: the owner checked both crops in Preview ("crops ok") and moved them to fixtures/. identifiersReviewed is now true for `reference` and `referenceRear`. `images_edits.py --mode compose --dry-run` builds the request (base first, reference second, search and shell off). The paid compose run still needs the owner's go and the consent addendum.
  - Checks: `python spike/local_images.py --fixture-set all` 40 passed, 0 failed, 0 skipped; the `images_edits.py --mode compose --dry-run` body puts the base first, the reference second, with search tools off.
- Owner decision 2026-10-28, edit type: the father's wheels on the R nineT (T7 reference mode). A wheel replacement counts as geometry under the T4 rule, so it takes the full-image path without the blend.
- Settle with the owner before the first paid call that uses this photo:
  - Who took the photo, and when.
  - Whether the private consent record covers this photo, including contributor mode (Meta may train on submitted content). The owner updates the record; Claude doesn't write it.
  - People, plates and reflections covered, and metadata stripped, as for the U09 fixtures. The owner checks the crop in Preview before identifiersReviewed is set.
- Decided 2026-10-28:
  - Resize method: the owner accepted browser canvas smoothing instead of Lanczos3. SPEC 7, PLAN and the T5 note now say so. No code change.
  - The planning prompts and answers moved to review/planning/ (commit a73d7ed).
- Still open:
  - Done 2026-10-28: the paid T0 smoke run (see T0 session 4).
  - The Safari check for T2 and T6.
- Checks: none. Cost: $0.00.

### T0 session 4 — 2026-10-28, 09:22–09:23 ET run (paid smoke, about 0.3 h with review)

- Owner go-ahead with a hard $1 limit: TICKET_CAP_USD=1 and DAILY_CAP_USD=1 in the process env, enforced by the shared reserve.lua.
- Command: `python spike/run_all.py --mode smoke --fixture-set plain`, after a dry run (exit 0). Exit 0; all six steps passed.
- Cost: $0.022121 settled (SAM 4 × 0.0025, Spark 3 calls 0.002121, edit 0.010). Lifetime $0.032121. No halt flag.
- Results, private files in spike/out/ (gitignored); sanitized evidence in docs/api-evidence.md U01–U04:
  - SAM concept "wheel": three box-sized masks on the front wheel, the rear wheel (within 1 px of the expected box) and the red car's wheel. "giraffe": zero objects.
  - SAM point click on the rear hub: the whole bike area at confidence 0.45, not the wheel. Masks larger than 1024 px come back downscaled to fit their bounds (placement "other").
  - Spark identify: BMW R nineT, 1170 cc boxer, 2014–2023, ABS unknown. Text and paint instructions parsed cleanly.
  - Paint edit (tank matte olive): 1792×1344 WebP in 11.9 s; the roundel and side panels are kept.
- For the T3 session (not changed here): VERIFIED_SAM_PLACEMENT stays null until the owner checks the overlays. If set, the adapter must also handle masks downscaled to a 1024 px long edge, and a point click can return the whole bike, so the concept lane is the safer default for wheels.
- Done 2026-10-28, owner checks: overlays "the detected parts are fine" (U01); paint edit "fine" (U04). The point click returning the whole bike stays a T3 item; VERIFIED_SAM_PLACEMENT is decided in T3.

### T7 spike — 2026-10-28, 09:37 ET paid compose run (about 0.1 h)

- Owner go-ahead with a hard $1 limit (TICKET_CAP_USD=1, DAILY_CAP_USD=1 in the process env). Owner reports the consent addendum for the Bike Rumble photo is saved in consent/ (Claude did not open it).
- Command: `python spike/images_edits.py --fixture-set plain --mode compose --ticket T7`, after a dry run (exit 0). Exit 0, HTTP 200 in 9.0 s.
- Cost: $0.010 reserved and settled. Lifetime $0.042121.
- Result (private, spike/out/edits/image_compose-high.webp): front wheel replaced by a gold multi-spoke wheel with chrome hub at matching size and position; rear wheel unchanged, because the spike sends only the front reference; rest of the scene looks unchanged.
- Note for the T7 build: the front brake discs are mostly hidden or gone behind the new spokes. A wheel swap must keep the brakes, so the T7 prompt should say so, and the build sheet should flag brake-disc fit as "verify". Rear-wheel swaps need a second reference or a second run.
- Done 2026-10-28, owner check: front wheel "great"; the rear wheel didn't change, as expected with one front reference. Swapping both wheels in one result is T7 work (both references in one request, or two steps).
- Fixture tank patch, owner request 2026-10-28: the solid fill over the photographer's reflection on the tank in plain-wall-right.jpg looked like a dark square. The owner rejected a first blurred version ("too much") and chose a subtle one: only the old square [2345,1180,2465,1320) is refilled with tank paint from its edge pixels (the hidden reflection can't come back). It was inserted losslessly with `jpegtran -drop` into the 16 px blocks around it; outside those blocks the JPEG data is unchanged (decoded max difference 2 from chroma upsampling at block edges). Waiting in the scratchpad for the owner to check it and move it into fixtures/.
- Paint edit 2, 2026-10-28 09:52–09:53 ET (owner: "use red, candy red", $1 cap): paintTest.request changed in expected.json; the Spark paint instruction was re-run because the cached one still said olive (`responses_spark.py --mode instruction`, which also ran the uncached reference instruction), then `images_edits.py --mode edit`. Cost $0.011150; lifetime $0.053271.
  - Result: tank glossy candy red, roundel and lower panels kept. Two misses: the upper aluminium inlay turned red, and the model kept the dark cover patch despite the instruction.
  - For T5/T7: the model does not paint over cover patches. A local fill of known cover boxes in the result, from the surrounding new paint, hides it well (scratchpad test, no model call). Note for the spike: `cached_edit_prompt` ignores a changed request, so a new paint request needs a fresh Spark instruction.
  - Owner check open: spike/out/edits/image_edit-high.webp and the locally filled version in the session scratchpad.
- Paint edit 3, 2026-10-28 09:58 ET (owner: "delete the rectangle before", $1 cap): one-off scratchpad script reusing images_edits.run_edit (profile image_edit_nosquare, rights check on plain-wall-right.jpg). Base was the scratchpad copy with the cover square refilled from its edge pixels, so the hidden reflection was never sent. The edit prompt was written by Claude (no Spark call) and names the silver tank area to keep. Cost $0.010; lifetime $0.063271.
  - Result (spike/out/edits/image_edit_nosquare-high.webp): candy red tank, no square, roundel, silver tank area and lower panels kept, rest of the scene unchanged. The "nineT" lettering is slightly garbled.
  - For T5/T7: removing cover squares before upload beats filling them afterwards, and naming the parts to keep fixed the painted-over silver area. Owner check open.
- Owner decision 2026-10-28 (result approved: "perfect"): from now on, cover squares on the motorcycle itself (such as the tank reflection) are refilled from their edge pixels before a photo is sent for an edit. Covers over VINs and number plates stay. The hidden content is never uncovered.

### T7 — 2026-10-28, offline part done; live render pending (build-ticket workflow)

- Owner decisions this session: swap both wheels in two steps (front reference, accept, then rear reference, accept), so SPEC 5 "exactly one reference" stays. Cover refill lives in fixtures and the spike only: on-bike cover boxes are refilled before upload, VIN and plate covers stay, and there is no in-app touch-up tool.
- Paused 2026-10-28 by the owner (usage limit). Run wf_84e34d8b-817 was stopped in round 2: the models round-2 reviews and the spike round-2 build were still running, so spike files may hold partial edits. The ui unit is not built yet. Nothing is committed. The workflow path fix (absolute builder paths falsely flagged as outside ownership) is in .claude/workflows/build-ticket.js and fix-until-green.js. To continue: resume the run from this session, or start /build-ticket T7 with the units again in a new session.
- Resumed 2026-10-28: spike files checked first (syntax ok, local_images.py 58 passed, compose dry-run exit 0); run wf_84e34d8b-817 resumed from cache.
- Run result: needs_lead with no blocking items. All three units approved: models (2 rounds), spike (2 rounds), ui (1 round). The resumed run took 13 min with 27 agents. Paid cost this run: $0.
- Files: src/lib/server/meta.ts, src/lib/editPolicy.ts, src/app/api/edit/route.ts, src/app/api/instruction/route.ts, src/app/page.tsx, src/components/ReferenceDropzone.tsx (new), src/components/Workspace.tsx, src/components/EditReview.tsx, src/lib/browser/renderClient.ts, src/lib/browser/sparkClient.ts, prompts/compose.v1.md, prompts/edit.v1.md, prompts/instruction.v1.md, spike/imaging.py, spike/images_edits.py, spike/expected.example.json, spike/local_images.py, tests/edit.test.ts, tests/spark.test.ts, tests/renderflow.test.ts, tests/projectsession.test.ts. projectSession.ts needed no change.
- Checks (Verify phase, rerun by the gate): npm run typecheck pass; npm run lint pass; npm test 225/225 in 18 files; npm run build pass; local_images.py --fixture-set all 64 passed; images_edits.py compose dry-run exit 0. The lead reran local_images.py after filling covers: 64 passed.
- Done-when: met: missing or extra reference files fail validation; disabled reference mode is explained; base and reference roles are not swapped; the reference is absent from public assets and the PDF export (reference kept in React state only, change record keys unchanged, no public/ dir, PDF export not built yet: T11 must keep a regression check); contract and build checks run; fallback not needed and mocks are labeled. OPEN: "an owner's own part crop can render a reference edit" and "inspect one result". The only live evidence is the 2026-10-28 spike compose run (front wheel, owner: "great"), made through spike/images_edits.py before the brake sentence was added to compose.v1.md. The app's live reference path has not rendered yet and needs a paid run with the owner's go.
- Lead decisions:
  - enforceIntent in reference mode: wheels and fork are forced to geometry; elsewhere only a model "paint" becomes "replace" and a model "geometry" is kept. This is narrower than the task text ("other slots become replace") and follows SPEC 6.2: geometry is enforced for fork/wheel replacements only. Accepted.
  - The change record stays {slot, itemId, instruction, mode}, with no referenceImageId (plan-check correction). Adding it would change the contract and the DB schema, and the owner ruled out a contract change. This also keeps the reference out of the export by design.
  - The spike does not append its own KEEP_BRAKES text; it sends only the versioned compose.v1.md, which holds the brake sentence.
  - The magic-byte question on reference uploads is settled: the server re-encodes every reference through normalize(), so a mislabeled PNG or JPEG cannot pass undecoded.
- Fixture covers (lead): fixtures/expected.json plain-wall-right.jpg gets covers [{box [1189,597,1255,673), kind bike}]. This is the tank-reflection fill, converted from the source JPEG box [2345,1180,2465,1320) by the scale 2048/4032, rounded outward, plus 2 px for resampling bleed. The other fills listed in derivedFrom (two people, the red car's plate) are off the bike and are not refilled. No other fixture is used for edits.
- Consultants: Nemotron 3 (nim-nemotron) returned 404 "function not found", so PAL codereview ran on the fallback nim-nemotron35. Gemini (agy) went idle for 300 s and timed out; no retry. The first Gemini call was lost to a lead error: the code placeholder was not filled in. Codereview points, all checked and rejected:
  - reservation not released on throw: by design, an ambiguous paid call settles "unknown" (paid.ts:62-67);
  - duplicate reference parts: rejected at http.ts:90 and tested;
  - reference size unchecked: ImageFile max 1.25 MB and normalize bounds the output;
  - base/reference order relies on the client: the server builds it at route.ts:72;
  - reference must match the base size: a crop is meant to differ;
  - other points were SPEC-intended or predate T7.
  Precommit (nim-nemotron35) points, also rejected:
  - "refill must not change interior pixels": refilling the interior is the purpose; the rule is that it never READS them, and local_images.py tests that;
  - stale instruction after a reference swap: prepKey includes reference.hash, so current is null;
  - client should pre-check every 400/503: server rejections happen before any reservation, so no paid call is made;
  - empty SAM mask crash at images_edits.py:138: pre-existing code from before T7.
- Follow-ups (minor, not blocking):
  - /api/instruction lacks route tests for a duplicate or PNG reference and for the reference-mode mock label (models-reviewer m1).
  - There is no DOM test for the dropzone gating (no DOM test setup in the repo).
  - The Reference tab was not checked in a browser.
  - T8/T9: flag brake-disc fit as "verify" on wheel references.
  - The workflow path fix in .claude/workflows/*.js is not in this commit; it needs its own /review-changes.
