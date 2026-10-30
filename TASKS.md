# DreamBike build tickets

Status: implementation under way; see each ticket's status line and the newest "Handoff" entry at the end of the progress log. Estimated hours are coding-agent work plus the stated owner checks, not runtime promises. Before every ticket read this file's ticket cards, the newest Handoff, and the SPEC sections the ticket needs (see CLAUDE.md). Follow CLAUDE.md. Record actual results and commit after each completed ticket. Never backdate work.

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

- Status: DONE OFFLINE AND IN MOCK 2026-10-28. U01 2026-10-28 13:47 ET: concept masks verified live (box-sized and downscaled); live point clicks stay refused before any reservation. "A wheel click highlights its real pixels" is still open (point lane). See log.
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

- Status: DONE 2026-10-28. Offline part in d220d74; live app run 14:06–14:34 ET with the owner's checks (front and rear wheel accepted). See log.
- Priority: MVP with documented cut fallback. Estimate: 1h, Oct 30. Depends on: T5, T6 and U04 compose profile.
- Files: src/components/ReferenceDropzone.tsx, prompts/compose.v1.md, src/lib/server/meta.ts, instruction/edit route reference branches.
- Work: normalize one owned reference, base first/reference second, force image/web search off, share preview/accept/version path. No second build-item write on accept.
- Done when: an owner's own part crop can render a reference edit; missing/extra reference files fail validation; disabled reference mode is explained; base and reference roles are not swapped; reference image is absent from public assets and PDF export. Inspect one result, run contract/build checks. If spike evidence makes this unsuitable, record the fallback and cut explicitly; do not present a mock as shipped.

## T8 — Build sheet and manual product input

- Status: DONE 2026-10-28 (offline and in mock; no paid calls involved). "Seed mock product/check data" deferred to T9/T13. Owner check on a real project passed 2026-10-29. See log.
- Priority: MVP. Estimate: 2h, Oct 31. Depends on: T6; T7 is not a dependency.
- Files: src/components/BuildSheet.tsx/ProductFields.tsx, src/lib/project.ts, tests/project.test.ts, seed mock product/check data.
- Work: active slot lines, title/spec, manual source URL, price-as-listed and gross/net/unknown basis, labor minutes, explicit labor-only switch, remove/replace, semantic sheet revisions. No automated product fetching yet.
- Done when: accepted render creates one line; repeated same-slot edits replace its active line; changing a product preserves prior history and invalidates checks; unknown part price is displayed as unknown; explicit labor-only permits zero part cost; undo restores the prior sheet. Test invalidation and money-field validation. Build and lint pass.

## T9 — Sourced fit and German paperwork pre-check

- Status: DONE 2026-10-29 (offline, mock, 3 paid spike probes, one live app check on the owned bike). Open: the ledger over-counts kept grounded reservations (no reconcile path); a fit result does not trigger the folder save; the fit cache is not read back; the live ABE case used a mismatched part, so a fitting ABE part with a condition has offline evidence only. See log.
- Priority: MVP. Estimate: 3h, Oct 31. Depends on: T8, U02 grounded profile, U06 cost bound; owner's rule review remains visible if pending.
- Files: prompts/fit-check.v1.md, src/app/api/check/route.ts, src/lib/server/meta.ts, src/lib/project.ts/cache.ts, src/components/FitBadge.tsx/EvidenceLinks.tsx/PaperworkSummary.tsx, tests/fit-policy.test.ts.
- Work: <=3 target items plus whole-build context; exact IDs; citation/result extraction; conservative source applicability; all German fields; batch progress/failure; stale hash protection; interaction invalidation. No standalone legal chatbot.
- Done when: owned-bike live or genuinely recorded smoke results show evidence and unknowns; ABE conditions, unknown ABS/wheel fit, tall handlebar cable reach, and unsupported US exhaust do not receive unjustified ok; unsupported citation URLs are removed; one failed batch leaves other completed results; changing bike/part/shop rules invalidates every active fit. Offline policy tests and contract checks pass. If grounded dispatch remains gated, keep fresh checking disabled and record T9 blocked; cached demo results alone do not complete this live capability.

## T10 — Settings and integer EUR estimate math

- Status: DONE 2026-10-29 (offline, mock browser check; no paid calls). Open: a complete estimate in the browser needs a real reviewed fit (mock fits never count; the complete path is covered by unit tests); the official fee is suggested but not required when an inspection is needed. See log.
- Priority: MVP. Estimate: 2h, Nov 1. Depends on: T8, T9 schema integration; offline math work need not wait for a live call.
- Files: src/components/ShopSettingsForm.tsx/InspectionFees.tsx/EstimatePreview.tsx/MissingCosts.tsx, src/lib/quote.ts/db.ts, tests/quote.test.ts.
- Work: real vs isolated demo settings, owned logo, default minutes, editable net rates/allowances, fixed 19%, preferred domains/rules, gross-to-net conversion, missing values, fee deduplication and acknowledgment.
- Done when: SPEC 11's €416.50 total matches; adding an unknown part makes grand totals null while known subtotal stays €350; two affected items do not double-charge one inspection; zero labor is explicitly confirmed; real settings never silently inherit demo rates. Unit tests cover rounding and invalidation. Settings survive reload.

## T11 — Estimate PDF with paperwork summary

- Status: DONE 2026-10-29 (offline, mock and production browser checks, owner's visual check; no paid calls). The complete one-page QA PDF uses a labeled test fixture fit, not a real reviewed fit. Open minors for T17 are in the log. See log.
- Priority: MVP. Estimate: 2h, Nov 1. Depends on: T10.
- Files: src/lib/pdf.ts, src/components/ExportButton.tsx, public/fonts/ plus licenses, tests/quote.test.ts, local PDF QA artifacts in spike/out/.
- Work: A4 PDF, owned before/after images, line items, net/VAT/gross or incomplete draft, inspection allowances, German paperwork fields, evidence links, visualization/pre-check notes, multi-page layout.
- Done when: a complete one-page and long three-page PDF are opened and visually checked locally; no clipping or overlapping rows; fonts and EUR/German terms render; export works offline with no external photo/network fetch; unknown-cost draft has no grand total and a clear warning; complete export requires mechanic review. Record observed QA and run build/types.

## T12 — Optional grounded part search and safe product images

- Priority: Should-have. Estimate: 2h, Nov 1/2. Depends on: T9, T11, U06; domains/rights inputs under U07.
- Owner input 2026-10-29: the shop list for U07 is provided in shop-links.txt (repo root, local and gitignored because its links carry ad-tracking parameters; never commit it). 18 shops in a first and a second choice. Owner rules from that note: use only these shops for parts and part data; prefer the first choice; up-to-date data only; for each result say where it is available; when a site gives no usable information, name the site and why so the owner can review it. Some links are not the direct shop address (the Louis link points to the Shin Yo brand page). Ideas noted there, not in scope: a RAG system, a motorcycle spec database. Lead decision 2026-10-29: T12 is deferred until T13 and T14 are live; then decide between a reduced T12 (search mode only, no URL fetch or product images) and T21.
- Files: prompts/search-parts.v1.md, src/app/api/search-parts/route.ts/product-image/route.ts, src/lib/server/fetch-product.ts/meta.ts, search panel in ProductFields.tsx, tests/fetch-product.test.ts.
- Work: query and URL modes, up to five cited candidates, source timestamps, EUR price only when stated, exact-host allowlist and public-DNS fetch policy, redirect rechecks, one optional runtime reference image with explicit rights confirmation. No extra product-validation model call.
- Done when: an actual supported listing produces its exact listed price/source or explicit unknown; no-result and dead-link cases are usable; localhost/private-IP/credentialed URL and redirect-to-private tests are blocked before a fetch; remote image failure leaves manual input; external image never enters public assets/fixtures/PDF. Search remains off if any required safety/cost/rights gate fails. Stop this ticket by Monday's cutoff; manual product fields already work.

## T13 — Cached demo and atomic public cost protection

- Status: DONE 2026-10-30 (offline build and review, real Redis runs on the new ledger, one paid demo fit check, owner-cleared public/demo, browser checks without the key and API checks at the cap). Open for T14: per-IP limit on GET /api/budget, the BUDGET_PHASE=demo switch after the Billing reconciliation, deployment.py for the new manifest. See log.
- Priority: MVP. Estimate: 2h, Nov 2. Depends on: T6, T9, T11; T12 is not required.
- Files: src/lib/server/budget.ts, src/app/api/budget/route.ts/health/route.ts, all paid handler budget guards, public/demo/, src/components/DemoBanner.tsx/BudgetBanner.tsx, tests/budget.test.ts, spike/common.py ledger integration.
- Work: shared Redis REST/Lua reserve/settle, all model/cost/count limits, lifetime/development/ticket accounting, ET dates/DST, duplicate IDs, cookie/IP HMAC, unknown charge retention, fail closed; static genuine demo manifest/images/masks/checks/PDF. Harden the already-working T0/T1 shared ledger with public identity buckets, not a second ledger.
- Done when: races cannot overspend; duplicate ID dispatches once; crash/timeout keeps its reservation; missing Redis or missing lifetime key disables paid work; simulated deployment keeps total; DST/ET tests pass. Real atomic Redis integration is exercised without Meta calls. Cached demo works at caps and with API key removed; static requests cause zero Meta calls. Unknown query bounds keep grounded calls disabled. Public rights cleared by owner; no invented demo checks.

## T14 — Vercel deploy and end-to-end reliability

- Status: DONE 2026-10-30. Live at https://dreambike-pied.vercel.app (Vercel Hobby, iad1, Node 22): deployment.py 26/26 in demo-only and live mode, cached demo without login (Chrome macOS, Safari iPhone), one live edit under 30 s for 0.013068 USD, cap checked live, U08 PASS. Public live edits only 2026-11-05 to 2026-11-09 ET at $5/day (LIVE_FROM_ET/LIVE_UNTIL_ET); check on Nov 5 that /api/budget reports liveEnabled true. See log.
- Priority: MVP. Estimate: 2h, Nov 2. Depends on: T13 and actual repository/hosting access.
- Files: Next/Vercel configuration as needed, docs/api-evidence.md/submission.md, README live URL placeholder, spike/deployment.py, targeted tests for fixes.
- Work: verify actual plan/runtime/duration/body caps; production env and no MOCK; deploy the reviewed result with owner publishing authorization; record real URL; test second-laptop cached flow and one controlled live change if gates allow. Cache-only fallback is clearly labeled.
- Done when: `npm run build`, lint/types/tests pass; `python spike/deployment.py --origin <actual-origin>` passes; cache demo opens without login on a second laptop; cap/disabled/composition-off cases work; key is absent from browser source/network; no input exceeds bounded envelope. A real edit fits the actual platform deadline or live mode stays disabled with the exact limitation disclosed. Record U08.

## T15 — README, attribution, and submission package

- Status: DONE 2026-10-30 for the agent part: README, LICENSE, CREDITS, submission notes and demo-script draft written and reviewed; history scan clean for secrets; README steps run in a clean export. Owner items open (rubric/fields check, video URL in T16, history identifiers decision, second-laptop check, Billing limit and final spend check, push). See log.
- Priority: MVP. Estimate: 2h, Nov 3. Depends on: T14.
- Files: README.md, LICENSE, CREDITS.md, docs/submission.md/demo-script.md, .gitignore, TASKS.md evidence entries.
- Open credits noted in T11 (2026-10-29): CREDITS.md so far lists only the PDF fonts; add the SAM License for @meta-sam/parser (docs/api-evidence.md), the MIT notices of pdf-lib and @pdf-lib/fontkit, and the photo table with date and consent coverage.
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

## OF1 — Open project from folder and honest local save (owner follow-up, 2026-10-29)

- Priority: owner request. Estimate: 2h. Depends on: T6, T8 and the folder save (e6747c5). No paid calls.
- Status: DONE 2026-10-29 (offline and in mock; no paid calls). Owner checked the Chrome folder round trip and the Safari retest 2026-10-29: "Funktioniert alles". See log.
- Owner decisions 2026-10-29: build "Open project from folder" now (overrides SPEC 614 "not an import format"); Safari lost a project on reload, so a failed local save must never look saved.
- Files: src/lib/contracts.ts, src/lib/types.ts, src/lib/project.ts, src/lib/db.ts, src/lib/browser/folderExport.ts, src/components/Workspace.tsx, src/components/ProjectList.tsx, tests/project.test.ts, tests/db.test.ts, tests/folderexport.test.ts.
- Work: the folder save also writes a versioned project.json snapshot (full Project and every Version as stored, image table with ImageRef and file name including cutouts, mask table) and masks/<id>.bin; one atomic importProject in db.ts; readProjectFolder with a read-mode picker that validates everything before any write; an "Open project from folder" button where the browser supports it; a lasting "Not saved" warning with the error name when the project cannot be stored; a reload reopens the last open project.
- Done when: a saved folder imports back into an empty browser store with the same head, history tree, items, fees, bike revision, images and masks, and Undo works after import; a wrong hash, wrong dimensions, a missing file, invalid project.json, a cycle or foreign root, or an existing project id is refused before anything is written, and a failure inside the import transaction leaves no partial project; a folder without project.json shows the "saved before import existed" message; the button is hidden where folder access is unsupported; when the project cannot be stored, the user sees a lasting "Not saved" warning with the error name and Accept never looks saved; a reload reopens the last open project, or shows the project list if it is gone. Run build, lint, types, tests and the image checks.

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

### T3 U01 follow-up — 2026-10-28, about 13:20–14:10 ET (needed for the T7 live run)

- Why: the T7 app run needs live part detection, and `/api/segment` refused every live call while `VERIFIED_SAM_PLACEMENT` was null.
- Owner decisions: turn on box-relative placement from the U01 overlay check; then "fix it properly first" for downscaled masks, after review found that the bike outline (needed to tell front from rear) always comes back shrunk to a 1024 px long edge.
- Files: src/lib/server/images.ts (VERIFIED_SAM_PLACEMENT "box_relative", isDownscaled, nearest-neighbour upscale to the box, VERIFIED_SAM_DOWNSCALED true, VERIFIED_SAM_POINTS false, placeSamRasters, malformed raster = SCHEMA_INVALID), src/app/api/segment/route.ts (drops unplaceable objects with a warning, 422 MASK_PLACEMENT_UNKNOWN when all are dropped, points refused before reserving), tests/masks.test.ts, spike/imaging.py (is_downscaled, place_mask allow_downscaled), spike/responses_sam.py ("downscaled" class, overlay by the hypothesis), spike/local_images.py (downscaled and upload-refill checks), spike/common.py (fixture_image refills on-bike covers for every upload), spike/images_edits.py (uses the common refill). SPEC 7 implementation note.
- Paid: `responses_sam.py --fixture-set plain --mode concept --ticket T3 --force` and `--mode points`, $1 cap, 4 SAM calls, $0.010 settled. Lifetime $0.073271.
- Owner check: overlay-motorcycle "looks good". Owner on the points overlay: "green point is at rear axis, red is in front down of the bike in the middle"; the mask is the whole bike, so points stay off. Owner also pointed out the tank cover square was still in the SAM upload; rule now covers every upload and the spike enforces it in fixture_image.
- Reviews (/review-changes): round 1 four confirmed majors (outline and points paid then dropped; empty 200 instead of 422), fixed by the downscaled placement and the 422. Round 2 green (minors: huge bounds allocation fixed by clipping the upscale loop; comment wording fixed). Round 3: SEC-1 major (points lane opened without an owner-checked overlay), fixed with VERIFIED_SAM_POINTS=false; minors: comment reworded, SCHEMA_INVALID code asserted; "unused imports in images_edits.py" rejected (io and Image are still used). Round 4 (points flag): green; minor fixed: drop and envelope warnings no longer send live users to the closed point lane ("pick another part from the list"). Accepted as is: SCHEMA_INVALID is retryable (a retry is a new capped reservation); other phrases over 1024 px are paid and now placed by the same rule.
- Checks: typecheck, lint, build pass; npm test 407 passed in 19 files (includes the owner's parallel workflow tests); local_images.py --fixture-set all 71 passed; spike dry runs (sam concept/points, spark identify, compose front/rear) exit 0.
- Open for T3: point clicks (whole-bike answer), "a wheel click highlights its real pixels".

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

- New owner input for T7: a studio photo of another bike, which the owner calls "Bike Rumble". The owner says they may use it and wants its golden wheels on the R nineT.
  - The photo is in my_bike/. The deny rule in .claude/settings.json keeps Claude out of that folder, and it stays.
  - Owner decision 2026-10-28: the owner copies a JPEG export to fixtures/reference-source.jpg. Claude then proposes the wheel crop and cover boxes on a scratchpad overlay, writes fixtures/reference-wheel.jpg with no metadata after the owner approves, and fills the `reference` entry in fixtures/expected.json (file, slot, box, description, identifiersReviewed).
  - Record the bike's identity only as the owner states it; don't guess the model.
  - Done 2026-10-28: the copy is fixtures/Rumble.tiff (1920x1281, no EXIF, GPS or date; a studio shot with a shop logo). The owner says the rights holder gave permission. The owner named no photographer and no date; both are null.
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

### T7 live app run — 2026-10-28, about 13:00–14:40 ET (including the U01 follow-up above)

- Owner go-ahead: one front-wheel render, then one rear-wheel render, in the app with reference mode, cap $1. Claude drove the local app in headless Chrome over CDP (scratchpad script, not committed); the owner judged every preview and decided each accept.
- Preconditions:
  - Live part detection was blocked by U01. Fixed first; see "T3 U01 follow-up" (commit 4e3427d).
  - The dev server showed "Demo only": VISITOR_HASH_SECRET is missing or under 32 bytes in .env.local (checked by name only, values never printed). For this run the dev server got a random 64-hex key in the process env only. The owner should add a permanent one to .env.local.
  - Free rehearsal first: MOCK=1, the whole click path front and rear, $0.
- Setup: `LIVE_API_ENABLED=true BUDGET_TICKET=T7 TICKET_CAP_USD=1 DAILY_CAP_USD=1 npm run dev`. Fresh Chrome profile, 1440x1000. Base: fixtures/plain-wall-right.nocover.jpg (the owner-approved tank patch). References: fixtures/reference-wheel-front.jpg and reference-wheel-rear.jpg. Owner's description: "Gold multi-spoke wheel with chrome hub, about 20 inch."
- Flow and results (previews private, in the session scratchpad only):
  - Import: 1 identify, 15 segment; front and rear wheel found and assigned (front on the right).
  - Front: the Spark instruction kept the brakes in its text. compose.v1 renders 1–3 replaced the wheel well but dropped the brake discs and calipers (and twice the fender); the owner rejected all three. compose.v2 (commit 40b4182): render 4 kept the disc, caliper and fender; owner accepted (Step 1). Caliper lettering slightly garbled.
  - After accepting: re-detection on the render found the wheels plus a 93x37 px fragment, so wheels needed a point (off live). Fix: wheel candidates under 25% of the largest are ignored (commit 78d707d); hot reload re-derived the parts with no new SAM call.
  - Rear: v2 render 5 dropped the swingarm and final drive across the wheel; the owner chose to tighten the prompt. compose.v3 (commit 9835298): render 6 brought the swingarm back but lost the disc and fender bracket; render 7 kept final drive, disc and bracket. The owner accepted it (Step 2) after viewing it. The rear gold is slightly darker than the front.
  - Final state: history Start, Step 1 front wheel, Step 2 rear wheel; the sheet has both wheels ("Full image, not blended", as SPEC 6.2 says for geometry).
- Requests (dev log): normalize 3, identify 1, segment 33 (one a lead probe on the accepted front render), instruction 2, edit 7, composite 7; all HTTP 200.
- Cost: $0.154870 settled (SAM 0.0825, edits 0.070, Spark about 0.0024). Nothing left reserved. Lifetime $0.228141; T7 ticket about $0.165 including the 09:37 spike; day $0.218141.
- Done-when: met: "an owner's own part crop can render a reference edit" (front and rear, live in the app), and "Inspect one result" (the owner inspected all 7). The rest were met offline (see the T7 entry above). The reference image stays in React state only; the PDF export (T11) must keep its regression check.
- Checks: typecheck, lint, build pass; npm test 408 passed in 19 files; local_images.py --fixture-set all 71 passed; spike dry runs exit 0.
- Reviews (review-changes): compose.v2 green (one minor, PLAN note applied); wheel fragment filter green (minor: a heavily hidden real wheel under 25% would be dropped; recorded, not changed); compose.v3 green with no findings.
- Consultants: PAL chat nim-nemotron35 on src/lib/server/images.ts and src/app/api/segment/route.ts. Points, each checked against the code and rejected:
  - isDownscaled accepts a 1-px-wide box: does not occur, and harmless.
  - length overflow: JS numbers are doubles, 2^32 is exact.
  - zero-size box division: unreachable, because isDownscaled requires both sides > 0.
  - an empty 0x0 box: gives no object, and the parser does not produce one.
  - 0 objects reported as complete: SPEC says empty detections return objects=[].
  - 422 after paying: intended.
  Gemini was not asked.
- Follow-ups: the owner adds VISITOR_HASH_SECRET to .env.local; point clicks (T3); T8/T9 flag brake, axle and final-drive fit as "verify" on wheel references; there is no DOM test for the dropzone gating; reference renders vary a lot from run to run (7 renders for 2 accepts), so the demo should budget retries.


### T7 owner follow-ups — 2026-10-28, about 17:00–18:00 ET (build-ticket workflow, lead fixes, mock browser check)

- Owner's own live session (owner-run, BUDGET_TICKET=T8, caps $1): no banner, notice, import and detection fine, describe "works perfectly", Close project fine; point selection does not work (known, T3). The owner added VISITOR_HASH_SECRET to .env.local (checked by length only, value never printed). Owner asks: a larger preview before Accept or Render again, a "Do the same for the other wheel?" step, and a Download button (results otherwise live only in the browser's IndexedDB "dreambike"). Owner choice: Yes does everything up to Render.
- Files:
  - src/components/BeforeAfter.tsx: "View larger" (also a click on the image) opens a native modal dialog with Fit / Actual size, Download image and Close. Download re-encodes the after image as JPEG on the device. A mock result gets MOCK in its file name and a label band in its pixels.
  - src/components/EditReview.tsx: passes the mock flag.
  - src/lib/browser/partMap.ts: otherWheelSlot, followUpPart.
  - src/lib/editPolicy.ts: paintRequestText, retargetPaintText (PaintForm uses the same helper).
  - src/components/Workspace.tsx: offer card after a wheel accept. Yes re-detects (skipped when the other wheel is already fresh), selects the other wheel in the same mode, and prepares once (text; paint retargeted). Reference mode only prefills and asks for the other wheel's own reference photo. Render stays a manual click. Accepting the follow-up wheel makes no new offer. A manual selection, point pick or Prepare ends the follow-up.
  - src/components/DescribeForm.tsx, PaintForm.tsx, ReferenceDropzone.tsx: initialText or the shared paint helper.
  - tests/partmap.test.ts, tests/spark.test.ts: new helper tests.
- Workflow: build-ticket, 4 units (A, B1, B2 split off as editPolicy, B3), all approved; B3 needed round 2 (shop-reviewer: the front/rear offer loop, fixed). Verify checks all passed. The done-when gate did not run (the account's spend limit was hit); this work adds no T7 acceptance items, so the gate is not needed for it.
- Lead fixes of reviewer minors after the run:
  - reference-off notice order;
  - prefill cleared in resetWork;
  - Yes skips a second detection;
  - point pick and manual Prepare end the follow-up;
  - "not found" vs "detection failed" notice;
  - step 2 waits while saving or navigating;
  - the dialog fit uses both aspects and 70vh;
  - no aria-pressed on the swapping label;
  - delayed revoke of the download URL;
  - mock text uses MOCK_LABEL.
  review-changes quick: green with two minors, then the mock label band and the slot clear were added; review-changes quick again: green; minors recorded, not changed: no test drives the two follow-up effects (no DOM test setup; the helpers are tested and the mock browser run covered the flow), and toJpeg has no white fill under transparent pixels (renders are opaque).
- Browser check ($0, MOCK=1, headless Chrome, fresh profile deleted after):
  - The dialog opens with Close focused, Actual size / Fit toggle.
  - Download gives dreambike-preview-MOCK-20261028-1739.jpg, image/jpeg, 2048x1536. Headless Chrome does not write files, so the anchor was intercepted. This was before the label band, which is untested in a browser.
  - Front accept shows "Do the same for the rear wheel?". Yes selects Rear wheel, prefills the same text and prepares it.
  - Requests: instruction 2 (front manual, rear automatic once), edit 1 until the manual Render click.
  - Rear accept: no new offer. History Start, Step 1, Step 2.
- Checks: typecheck, lint, build pass; npm test 417 passed in 19 files; local_images.py --fixture-set all 71 passed.
- Consultants: PAL chat nim-nemotron35 on BeforeAfter.tsx, editPolicy.ts and a follow-up excerpt of Workspace.tsx. 15 points, each checked against the code:
  - Adopted: clear the remembered follow-up slot when the wheel is not found. It was harmless, because every manual selection clears it too.
  - Rejected:
    - "the dialog opens empty": tested, the content and the focus are there;
    - "clickable div not keyboard reachable": the View larger button is the keyboard path;
    - "Yes always re-detects": misread, the detection runs only when the wheel is missing;
    - "stuck followUpSent flag" and "effect overrides a manual choice": the follow-up is cleared in the same pass, and manual selection clears it;
    - "mode mismatch": caught by the first branch;
    - "unhandled prepare rejection": prepare catches internally;
    - the rest are flicker, performance or abort nits with no user-visible failure.
  Gemini was not asked.
- Open: an owner check in a real browser (the Download file in Finder, and the follow-up with real parts, about $0.07); point clicks (T3).

### Owner requests run 1 — 2026-10-28, about 18:05–18:50 ET (box selection, adding a missing part)

- Owner's live check of the follow-ups: "works all good". New owner requests:
  - add a part the bike does not have (a sissy bar);
  - select parts the app did not find, for example the café-racer tail extensions behind the seat. The owner asked for no café-racer logic, only manual selection;
  - fold the right panel and fit the layout (run 2).
- Owner decisions:
  - drag a box with no AI: the rectangle is the part mask, free. Live SAM points return the whole bike;
  - add: mark the spot by box, tick "Not on the bike yet", describe, Prepare, Render;
  - the layout and history choices are for run 2.
- Files:
  - types.ts, contracts.ts: Part.source "box", optional absent; InstructionPayload absent, default false.
  - coordinates.ts: dragToImageBox.
  - partMap.ts: boxPart, boxAcceptable (the 60% rule for present boxes), withPointPart.
  - renderFlow.ts: no SAM recut for box parts; the rectangle is the old and the new mask, so the server's union, drift and feather path stays.
  - ImageCanvas.tsx: box mode with a live rectangle.
  - editPolicy.ts: absentAllowed; enforceIntent forces geometry.
  - prompts/instruction.v2.md (v1 kept); meta.ts uses v2 with the header stripped.
  - instruction route: absent only in text mode.
  - sparkClient.ts.
  - PartSelector.tsx, Workspace.tsx: "Mark with a box", "Not on the bike yet (add it)", "Marked by box[, to add]", Select by point kept as secondary.
  - SPEC.md: implementation notes on Part, InstructionPayload and the instruction.v2 row.
  - Tests: coordinates, partmap, renderflow, spark.
- Workflow build-ticket T3: U1, U2 and U3 approved; U1 and U3 needed round 2. Verify checks passed.
  - The done-when gate checks T3's own items, which this work does not add to. Still open, as before:
    - "a wheel click highlights its real pixels" (live points closed);
    - "merged wheels use point selection" (blocked: points are off live; the box is the working fallback).
- Lead fixes after the run:
  - the add checkbox resets after use;
  - promptBody throws on a prompt file with no header block instead of cutting the first character;
  - the box drag uses the pointer-down rect for both corners;
  - no text selection while dragging;
  - nothing is placed when box mode ends mid-drag.
  review-changes quick: green, with 2 minors not changed: Escape mid-drag lets the next click through, and the live preview is not scroll-corrected.
- Browser check ($0, MOCK=1, headless Chrome, profile deleted after):
  - The tail section was marked as Rear fender by box (the screenshot shows the rectangle on the tail). It rendered "Blended: everything outside the part is kept" and was accepted.
  - A sissy bar marked "to add": the prepared change was "Mock: add sissy bar" with "Shape change: shown as a full edit"; the render gave the full image and was accepted.
  - The fieldset add checkbox is unticked again. History shows Step 1 Rear fender, Step 2 Sissy bar.
  - Requests: segment 17 (15 import plus 2 bike recuts, none for box parts), instruction 2, edit 2.
- Checks: typecheck, lint, build pass; npm test 434 passed in 19 files; local_images.py --fixture-set all 71 passed.
- Consultants: PAL chat nim-nemotron35 (2 calls: the files, then the types it asked for). Its points were checked and rejected:
  - "empty box mask sent": impossible, because boxes under 8 px and empty masks return null;
  - "absent frame or engine can't be added": intended, an engine or frame swap is out of scope;
  - "reference intent downgrade": existing T7 behaviour, not this change;
  - the rest were message wording and performance nits.
  Gemini was not asked.
- Open:
  - instruction.v2 has no live evidence yet. All live instruction calls now use it, so the owner's paid check covers it (about $0.06, BUDGET_TICKET=T3): mark the tail and paint it, then add a sissy bar.
  - The absent flag is stored with the part.
  - Run 2: fitted layout, folding sections, later steps in History.

### Owner requests run 2 — 2026-10-28, about 18:52–19:20 ET (fitted layout, folding sections, later steps in History)

- Owner decisions:
  - the photo stays fixed and fitted, with History directly under it, and the right panel scrolls on its own;
  - every right-panel section folds;
  - Bike folds itself after Confirm with a one-line summary;
  - "the steps should not disappear if I go back".
- Files:
  - project.ts: laterSteps follows the newest subtree at forks and has a cycle guard.
  - VersionStrip.tsx: "Step n (later)" chips with a dashed border and words, clickable through onJump; "+k other branches"; the sheet sits beside the steps.
  - page.tsx, AppShell.tsx: one h-dvh layout; header, banner and nav do not shrink.
  - Workspace.tsx: the photo section takes the free height; native details folds for Parts, Change and Project. Change reopens on a new selection, prepare, render or accept state, so Accept and its errors are never hidden.
  - ImageCanvas.tsx: the photo box fills the section; the contain-fit and click math are unchanged.
  - BikeConfirm.tsx: a details fold; the summary is "<make model>, confirmed", plus "· N notes, open to read" when limitations exist. The old "Hide details" toggle is gone.
  - tests/project.test.ts: 5 laterSteps tests.
- Workflow build-ticket T6:
  - U4 approved in round 1;
  - U5 approved in round 3 (photo height floor and fit fixes);
  - Verify checks passed.
  - The gate was not met only on "inspect in the browser"; done below.
- Lead fixes after the browser check:
  - the photo used a guessed reserve of 400 px and pushed History under the nav. Now it is flex-1 with a min of 300 px, and the canvas box fills it;
  - History is two columns (steps and sheet);
  - the "No accepted changes yet" note is hidden when later steps exist;
  - the duplicate "N branches" label on later steps is removed;
  - the no-photo notice scrolls instead of being cut off at the top;
  - Change also reopens on accept saving or error;
  - the Bike summary says when notes are inside the fold.
  review-changes quick: green, with 2 minors not changed:
  - h-full needs a definite parent height; the browser check shows the photo filling it;
  - a year error is hidden when Bike is folded by hand.
- Browser check ($0, MOCK=1, headless Chrome, inner size 1440x813, profile deleted after):
  - The document does not scroll (scrollHeight 813). The photo is 392 px tall, filling the free height. History is fully above the nav (bottom 740, nav top 755), and the aside scrolls on its own.
  - Confirm bike folded Bike to "Bike, confirmed · 4 notes, open to read".
  - Two accepted steps, then Undo twice: Start (shown now), Step 1 (later), Step 2 (later), "Redo goes to the next later step". A click on Step 2 (later) jumped there.
  - Clicking the summaries opened Bike and closed Parts and Project.
- Checks: typecheck, lint, build pass; npm test 439 passed in 19 files; local_images.py --fixture-set all 71 passed.
- Consultants: no PAL call. The two calls for this owner request were used in run 1; the review subagents carry this review. Gemini was not asked.
- Open:
  - The owner checks the layout on their own screen.
  - Minor: the Next dev overlay badge covers the "Build sheet" button in dev only.
- Owner check after run 2 (2026-10-28): the free mock test of layout, folding and history works "perfectly". The owner asked to gitignore shop-links.txt (an owner note with ad-tracking parameters); done, review-changes quick green. Ledger lifetime $0.659602; whether the paid T3 check (tail box plus sissy bar) ran is not yet reported.

### Owner request: save the history to a folder — 2026-10-28, about 20:00–20:30 ET

- The owner's paid check of run 1 (tail section by box and painted, sissy bar added) is "good"; this is the first live use of instruction.v2.
- The owner wants every result kept outside Downloads and outside browser storage.
- Owner decisions:
  - folder ~/Projekte/Hackathon/dreambike-results, outside the repo;
  - a button plus an automatic save on every Accept;
  - move the downloads and copy the test renders.
- Done by the lead (local files only, nothing in the repo):
  - the 7 downloaded previews moved from ~/Downloads to "dreambike-results/2026-10-28 downloaded previews";
  - the 8 live T7 renders and 2 mock images copied from the session scratchpad to "dreambike-results/2026-10-28 T7 live wheel renders", with a README.txt saying which renders were accepted.
- Files:
  - project.ts exportPlan: folder name, file names "NN-<slot>-<id8>.webp" for all versions (branches included), history.json and history.md. Only owner/visitor-rights images are written. Free text is put on one line in history.md. Folder names cut by characters, not UTF-16 units.
  - src/lib/browser/folderExport.ts (new): the picker, the handle in its own "dreambike-folder" IndexedDB, permission, writing missing files and then both histories.
  - Workspace.tsx: Project fold actions "Choose folder and save", "Save project to folder", "Choose another folder" and "Reconnect folder", with a status line in words; auto-save after a saved Accept in the background with a single-writer queue; a warning notice on failure.
  - tests/folderexport.test.ts (new), tests/project.test.ts.
  - SPEC.md: owner override note on "no extra export format".
- Workflow build-ticket T6: E1, E2 and E3 approved (E3 in round 2). Verify checks passed. The gate was not met only on browser inspection; done below.
- Lead fixes: one-line Markdown text; character-safe folder name cut; comment order. review-changes quick green (1 minor comment-order note, fixed).
- Browser check ($0, MOCK=1, headless Chrome). Headless has no folder picker, so showDirectoryPicker was replaced by a folder of the origin-private file system; the native permission methods exist. Profile deleted after.
  - "Choose folder and save" gave "Saving to dreambike-results/Bike photo 2026-10-28 20-19 (4da26943): last saved 20:21 (1 new files)", writing 00-start-…webp, history.json and history.md.
  - Accepting a tank change auto-saved 01-tank-…webp and rewrote history.md: Start, "Step 1 — Tank (shown now)", the instruction, "Full image, not blended (drift)", the file and the sheet line.
  - The real picker and the permission prompt are untested here; that is the owner's check in Chrome.
- Checks: typecheck, lint, build pass; npm test 454 passed in 20 files; local_images.py --fixture-set all 71 passed.
- Consultants: PAL chat nim-nemotron35 on folderExport.ts and project.ts. Its points were checked and rejected:
  - "same-size skip keeps a stale image": file names carry the immutable version id;
  - "createWritable loses the old file on failure": writes go to a swap file that replaces the original only on close, and abort discards it;
  - "missing images look like success": the status line counts files not exported;
  - "startIn unsupported": only Chrome and Edge get the button;
  - "no guard inside the function": the caller is single-writer;
  - Windows reserved names: the owner uses macOS;
  - "bad slot or cycle throws": schemas validate slots, and a cycle must fail.
  Gemini was not asked.
- For the owner:
  - The new test file needs an exact allow line in .claude/settings.json for subagent targeted runs ("npx --no-install vitest run tests/folderexport.test.ts"). npm test already covers it.
  - The folder copy does not free browser storage; "Open project from folder" would be the next step.

### Handoff — 2026-10-28, end of session (start here next session)

- Repo state: main is pushed to origin up to 73e50be; the T8 preparation commit after it is local. No dev server running. Working tree clean (shop-links.txt is ignored).
- Done so far: T1, T2, T4, T5, T6, T7 (see status lines); T3 except the live point lane. Owner follow-ups on top, all committed:
  - 5220bf8 larger preview with Download; "Do the same for the other wheel?";
  - addc445 mark a part with a box (no AI) and add a part the bike does not have (instruction.v2, `absent`);
  - aba8b72 page fits the window, every right-panel section folds, later steps stay in History after Undo;
  - e6747c5 save the project history to a folder, auto-save on every Accept.
- Spend: ledger lifetime at least $0.659602 (a lower bound: it was read before the owner's paid T3 check (tail box plus sissy bar, owner: "good"). That check's cost was not read in this session). The current total is unknown; read the ledger before the next paid call.
- Owner's own results live outside the repo in ~/Projekte/Hackathon/dreambike-results/ ("2026-10-28 downloaded previews", "2026-10-28 T7 live wheel renders" with a README.txt naming the accepted renders).
- Waiting for the owner:
  1. Done 2026-10-28: the owner tried the folder save in their own Chrome (real picker and permission prompt); owner: "works".
  2. The allow line `npx --no-install vitest run tests/folderexport.test.ts` in .claude/settings.json (owner edits that file).
  3. Decide whether to build "Open project from folder". The folder copy does not free browser storage; this would let old projects be deleted from the browser safely.
  4. The Safari check for T2 and T6.
- Still open in tickets: T0 live profiles (see T0 session 3); T3 live point clicks (SAM points return the whole bike; the box is the workaround); U02 strict-JSON note on T4; minor: the Next dev overlay badge covers the "Build sheet" button in dev only.
- Next ticket on the critical path: T8, build sheet and manual product input. It is prepared in docs/t8-start.md: owner decision (wide right panel, photo stays visible), unit split with exact files, the `/build-ticket` args, the done-when map and the steps after the run. The owner wants it started without further questions; stop after T8. T9 follows and needs U02 grounded and U06 cost bounds.

### T8 — 2026-10-28, about 23:10–23:55 ET (build-ticket workflow, lead checks; about 0.75 h)

- Plan: docs/t8-start.md (owner decision: wide right panel, the photo stays visible). Units S1, S2, U1 as written there.
- Files:
  - src/lib/project.ts: sheetChild, sheetChangeLabel, editItem, removeItem, manualProduct, parseEuroInput, formatEuroCents, priceDisplay, laborDisplay; exportPlan reuses the parent's image file for a sheet version and writes "Sheet change: <label>" plus price/labor per line in history.md.
    - A physical change (title, spec, product identity, approval, cost type) or a removal clears fit, fitInputHash, fitCheckedAt and fitReviewedHash on every item; price, basis, labor and notes keep them.
    - Labor only gives part price 0 and no product; switching back gives price null and basis unknown. A part with price 0 is refused ("Use Labor only for no part cost."). Zero labor needs the box and a note.
    - parseEuroInput: "1.234,56" is 123456 cents; "1.234" is refused with "Write 1234 or 1.234,00"; more than 2 decimals, negatives, empty text and too-large values are refused.
  - src/lib/db.ts: acceptSheet (one write transaction; project_missing and stale_head like acceptVisual; idempotent per version id; image must match the parent; parts, cutout and mask are taken from the stored parent; enforceTarget).
  - src/lib/browser/projectSession.ts: saveSheet (unchanged sheet writes nothing; after a save the session is reloaded from storage).
  - src/components/BuildSheet.tsx, ProductFields.tsx (new); AppShell.tsx ("Build sheet" toggle with aria-pressed, "Estimate (comes later)" disabled); Workspace.tsx (wide panel, folds stay mounted, photo inert while the sheet is open, saves blocked while a preview waits, folder auto-save after a sheet save); VersionStrip.tsx ("Sheet: <label>" steps).
  - tests/project.test.ts, tests/db.test.ts, tests/projectsession.test.ts.
  - SPEC.md section 10: dated owner-override note for the wide sheet panel.
- Workflow build-ticket T8: green.
  - Plan check passed. S1 was approved in round 1.
  - S2 was approved in round 2: imaging-reviewer found that the returned session kept stale parent parts; fixed by reloading from storage.
  - U1 was approved in round 2: 3 findings were fixed (draft id cleared after a save; a labor-only item starts as unknown price/basis when switched back).
  - Verify checks all passed. The done-when gate met all 8 items with one minor (F1): no test showed that editItem leaves the parent's items unchanged.
- Lead fixes: F1, snapshot assertions in the editItem and removeItem tests; the SPEC 10 note. review-changes quick on both: green, no findings.
- Deferred, lead decision in docs/t8-start.md: "seed mock product/check data". Check data needs T9's FitResult flow, and seeded products belong to the T13 cached demo; mock products in T8 would risk mock data in real projects.
- Browser check ($0, MOCK=1, headless Chrome over CDP, 1440x900, synthetic gradient JPEG, fresh profile deleted after): 22 of 23 script checks passed. The one failure was a script error (it looked for "MOCK" in upper case; the banner reads "Mock: Mock mode …" and is visible).
  - While the preview waits, the sheet says "Accept or reject the preview first." The panel is wide and the photo stays visible next to it.
  - After Accept, the tank line shows "Price unknown" with an icon, "Labor unknown" and "No product yet".
  - "1.234" shows the hint. Saving "Test tank", https link, "1.234,56", gross and 90 min shows "€1,234.56 gross" and "90 min". The link opens in a new tab with noopener. History: "Step 2 — Sheet: Tank: product, Tank: price, …".
  - 0 minutes without the box and a note is refused in words, and nothing is saved.
  - Labor only shows "Labor only, no part cost" and removes the product. Undo brings back €1,234.56; Redo goes back to labor only.
  - Remove asks to confirm, then shows the empty state; Undo brings the tank back. The toggle closes the panel.
- Checks after the lead fixes: typecheck, lint, build pass; npm test 498 passed in 20 files; local_images.py --fixture-set all 71 passed.
- Consultants: PAL chat nim-nemotron35, 2 calls on excerpts under 400 lines (project.ts lines 1–335; acceptVisual, acceptSheet and saveSheet), because PAL skips files of about 800 lines. Every point was checked against the code. None was adopted; the rejected points:
  - "labor only turns an unknown price into 0": specified, labor only means no part cost;
  - "the labor-only branch resets fields on every edit": those fields already have these values on a labor-only item;
  - "zero labor reuses the old box and note": the rule checks the resulting item (SPEC 11), and the form always sends its own box value;
  - "spec with undefined compares equal": stored data is schema-parsed JSON and has no undefined;
  - "same text, new product id keeps fits": intended, identity is the visible product text;
  - "removal should not clear other fits": SPEC 9 lists removing a part as a physical change, and combinations matter;
  - "sheetChild aliases the input arrays": editItem and removeItem always build new arrays, and acceptSheet stores a parsed copy;
  - "eleven zeros then ',50' is accepted": it is €0.50, the correct value;
  - "same id, different content counts as idempotent": the version id is random per draft, and a changed draft gets a new id;
  - "enforceTarget after the puts can leave a partial write": runTx aborts the transaction on any throw;
  - "non-IDB awaits inside the transaction": checkMaskReferences and enforceTarget only await IDB requests;
  - "a stale head from another tab leaves the session stale": same as the T6 visual accept path. The message tells the mechanic, and reopening the project loads the current head. This stays an open minor for multi-tab use.
  Gemini was not asked.
- Spend: $0 (no paid calls). The ledger total is unchanged from the last handoff; it is still unread.
- Open:
  - Done 2026-10-29: the owner checked a real project in their own Chrome (the same steps, plus the folder copy: history.md shows the sheet change, no duplicate image). Owner: "passt".
  - No component (DOM) test drives BuildSheet; the logic is unit-tested and the mock browser run covered the flow.
  - The Next dev overlay badge covers the "Build sheet" button in dev only (known).
  - The handoff item "allow line for tests/folderexport.test.ts" is done (4c21ec2).
  - Next on the critical path: T9, which needs U02 grounded and U06 cost bounds (paid, owner gates). Not started.

### Owner inputs before T9 — 2026-10-29

- Billing: the owner read $0.71 on the Meta Billing page; `ledger.py status` shows lifetime 714096 µ$ ($0.714), reserved 0, no halt flag. They agree. The owner set a $5 daily Billing limit with alerts at $1, $2 and so on. Recorded in docs/api-evidence.md.
- Safari check (T2/T6), owner 2026-10-29: dropping a photo works; the .HEIC shows the JPEG message. A reload loses the whole project, and Back does not bring it back. Cause not yet proven. Code reading: a failed project write is caught and work continues in memory without a clear warning (Workspace.tsx choosePhoto and acceptRender), and a reload never reopens the last project. Fix planned as an owner follow-up (honest "Not saved" warning with the error name, reopen the last project); the owner retests in Safari afterwards.
- Owner decision: build "Open project from folder" now (overrides the SPEC 614 "no import format" note; SPEC gets a dated note with that work).
- Owner inputs for T10 (a fictional example shop, labeled as example values in UI and PDF):
  - Rate: 100 € net per hour (10000 cents).
  - Labor (minutes): tank 120, wheel_front 180, wheel_rear 180, sissy_bar 300, handlebar 60, grips 150 ("Armaturen", owner mapped it to grips), fender_front 180, fender_rear 180, exhaust 480. Wheels and fenders are per piece.
  - Inspection: Einzelabnahme 180 € gross, so 15126 net cents (180/1.19). Änderungsabnahme with Teilegutachten 60 € gross, so 5042 net cents, plus about 15 € at the Zulassungsstelle. With ABE 0 €.
  - The owner's research ranges (not a legal source): ABE 0–15 € (12–20 € if entered in the papers); Teilegutachten 35–80 € at TÜV plus 12–20 € Zulassungsstelle; Einzelabnahme 90–300 € or more plus Zulassungsstelle fees.
  - Open for T10: the Zulassungsstelle fee is an official fee without VAT; SPEC only knows net allowances with 19 % VAT. T10 decides whether it becomes its own line without VAT.
  - Shop: a fictional name (proposal "Nordwerk Customs", the owner confirms in T10) and a simple text logo as PNG that Claude makes in T10.

### OF1 — 2026-10-29, about 08:50–10:05 ET (build-ticket workflow, lead fix, mock browser check)

- Status: done offline and in mock. No paid calls.
- Files: src/lib/contracts.ts (ProjectSnapshot, SnapshotImage, SnapshotMask with plain file names and count caps), src/lib/types.ts, src/lib/project.ts (projectSnapshot builder), src/lib/db.ts (snapshotSources, importProject in one writeTx, openDreamDb keeps the browser error name), src/lib/browser/folderExport.ts (writes cutouts, masks/<id>.bin and project.json last; removes a stale project.json when the snapshot is incomplete; pickProjectFolderForImport, readProjectFolder, folderImportErrorText), src/components/Workspace.tsx and ProjectList.tsx ("Open project from folder", lasting "Not saved" warning with the error name, reload reopens the last project), tests/project.test.ts, tests/db.test.ts, tests/folderexport.test.ts; SPEC.md 614 dated owner override.
- Workflow build-ticket OF1, 3 units, all approved, 21 agents:
  - F1 (shop): round 1 had 4 blocking findings (sha256 not checked in importProject, unreferenced images/masks and duplicate file names accepted); fixed in round 2.
  - F2 (imaging routing): approved in round 1.
  - U1 (ui): round 1 had 2 (the reload restore could replace a photo dropped while storage opened; a restored project kept a false "Not saved"); fixed in round 2.
  - Verify: all five checks passed. Done-when gate: all 7 items met, 4 minors.
- Lead decisions on the gate minors:
  - G1 (a failed Accept in a stored session dropped the error name): fixed; the message is now "Not saved: <name>: <message>" except for STORAGE_FULL.
  - G2 (a sheet or bike save on the stored head clears the "Not saved" warning while an in-memory photo is shown): kept as an open minor; an in-memory photo only exists without a stored session, and sheet and bike saves need one.
  - G3 (types.ts missing from the OF1 Files line): fixed.
  - G4 (sha256 computed twice per image on import): kept; harmless at about 20 images.
- review-changes quick on the lead fix and docs: one unverified major from general-reviewer ("a new photo never writes lastOpenProject, so a reload does not reopen it"). Refuted: createProject writes lastOpenProject in the same transaction (db.ts:538), and the mock browser check below reopened a freshly imported project after reload.
- Mock browser check (MOCK=1, headless Chrome 156, fresh profile, deleted afterwards):
  - import a photo, Tank change, Accept: "Saved on this device"; reload: the project reopens by itself with Step 1 and the photo, still "Saved on this device" (3/3).
  - IndexedDB open blocked with a simulated UnknownError: the lasting warning "Not saved: this browser did not store the project. Local storage is not available in this browser (UnknownError: Simulated Safari failure) …" and the header "Not saved"; after Accept still "Not saved", never "Saved on this device". The script's wait for "Step 1" timed out because History shows no steps without storage; that was a script error, checked by reading the page text.
  - The folder picker cannot be driven headless; the round trip is covered by tests/folderexport.test.ts and tests/db.test.ts.
- Checks after the lead fix: typecheck, lint, build pass; npm test 543/543 in 20 files; local_images.py 71 passed, 0 failed, 0 skipped.
- Consultant: PAL chat nim-nemotron35 on an excerpt of importProject and the folder reader (272 lines, files_embedded 1). 15 points, none adopted:
  - path tricks, count caps, mask bytes: already validated (SnapshotFileName regex, MAX_SNAPSHOT_* caps, StoredMaskSchema and the reader's 0/1 check);
  - auto-commit inside writeTx: the helpers await only IDB requests (checked in F1 review), and runTx aborts on any throw;
  - double hashing and holding about 20 MB of blobs: harmless at this size;
  - decoding a hostile tiny file with huge dimensions before the size check: the folder is the owner's own export; noted, not fixed;
  - cutout hash equal to the version hash: wrong, a cutout is a different image.
  Gemini was not asked.
- Spend: $0.
- Open:
  - Owner in Chrome: save a project to a folder, delete it in the browser, "Open project from folder"; image, History, sheet and Undo should match. A folder saved before OF1 has no project.json; save it once again first.
  - Owner in Safari: drop a photo and Accept. If the "Not saved" warning appears, send the error name; otherwise reload and the project should reopen. If Blob storage is the cause, a separate plan follows (images as ArrayBuffer, DB v2 migration).
  - G2 minor (above); no component tests for the new UI paths.

### OF1 owner checks and results cleanup — 2026-10-29, about 10:20–10:40 ET

- Owner 2026-10-29, after OF1: "Funktioniert alles" (Chrome: save to folder, delete in the browser, open from folder; Safari: the retest). The T2/T6 Safari check is done with it: drop, HEIC message, and the project survives a reload. Owner approved the push.
- Owner question: "2 images not exported" on project b2deea8d. Cause: a counting bug in Workspace.tsx, which subtracted the image files from the number of versions; the project's two sheet steps reuse their parent's image, so they counted as missing. Nothing was missing (project.json was written, which only happens with no missing file). Fixed: distinct version images minus exported files, plus missing files.
- Results folder cleanup (owner request: keep only projects with AI changes, no duplicates), in ~/Projekte/Hackathon/dreambike-results, outside the repo. Moved to ~/.Trash/dreambike-results-cleanup-2026-10-29, nothing deleted:
  - two nested copies of b2deea8d inside fadf4f99 and 053e84d9 (the folder had been picked as the save root); project.json equal to the top-level copy apart from exportedAt;
  - 5480911b and 053e84d9: only the start photo, no AI change;
  - the two MOCK-*.webp placeholders in "2026-10-28 T7 live wheel renders" (README line removed).
  - Kept: fadf4f99 (rear wheel), 6be8cba2 (front and rear wheel, tank, fork paint), b2deea8d (rear fender paint, sissy bar, two sheet steps), the T7 live renders and the downloaded previews. fadf4f99 and b2deea8d start from the same photo with different AI changes, so they are not duplicates.

### Handoff — 2026-10-29, T9 prepared (start here next session)

- Repo state: main pushed up to b41e999; the T9 preparation commit after it holds docs/t9-start.md and this entry.
- Done: T1–T8 and OF1 (see status lines); T3 except the live point lane. Safari check for T2/T6 done (owner, 2026-10-29).
- Spend: ledger lifetime 714096 µ$ ($0.714), matching Meta Billing $0.71; Meta daily limit $5.
- Next: T9, prepared in docs/t9-start.md: code state, the U06 research (Meta documents no query bound per search call), three owner decisions (probe or stay gated, the T9 cap, the four live test items), the `/build-ticket` units M1, S1, R1, U1, the paid steps and the done-when map. The offline build needs no decision; paid steps need the owner's go.
- Owner inputs for T10 are recorded in "Owner inputs before T9".

### T9 — 2026-10-29, started about 10:30 ET

- Owner decisions, asked once (docs/t9-start.md):
  1. U06: A, probe. Up to 3 grounded spike calls, max_tool_calls 2, search_context_size low, user_location DE, SEARCH_QUERY_RESERVE=20.
  2. Cap: TICKET_CAP_USD=2 and DAILY_CAP_USD=2 with BUDGET_TICKET=T9, in the process env only.
  3. Live items: the four proposed ones (taller handlebar, US-market exhaust without papers, front wheel swap with ABS ring, a part with ABE and an inspection condition).
- Paid steps run only after the owner's explicit go, once the offline part is done.
- Offline build, about 10:30–11:20 ET: `/build-ticket` with units M1, S1, R1, U1 from docs/t9-start.md (37 agents, about 36 min).
  - Plan check changes: S1 also owns db.ts, cache.ts, tests/db.test.ts and tests/cache.test.ts (attachFitResponse, the fit:<hash> cache); LEGAL_SEED and the canonical hash moved to client-safe project.ts; R1 owns requestCheck in sparkClient.ts; R1 dropped the 429 retry (SPEC 405 allows it only as a new reserved attempt) and refuses SEARCH_QUERY_RESERVE=0; U1 got security-reviewer (one click fans out into paid batches).
  - M1 (models): round 1 had 5 blocking findings (prompt used `build` instead of `activeBuild`, wrong legalSources shape); fixed in round 2, all 4 reviewers approved.
  - S1 (shop): round 1 had 7; fixed in round 2, approved.
  - R1 (models route): round 1 had 4 (duplicate item ids, unchecked price and reservation values); fixed in round 2, all 4 approved.
  - U1 (ui): round 1 had 3 (current batches resent, an answered but unsaved batch paid again, no cost text); fixed in round 2, approved.
  - Verify: all five checks passed. Done-when gate: 5 of 7 items met offline; item 1 (live evidence) and item 7 (gated or not) wait for the probe. Status needs_lead for these and one lint warning.
- Files: prompts/fit-check.v1.md, src/lib/server/meta.ts, spike/responses_spark.py, src/lib/server/fitPolicy.ts, src/lib/project.ts, src/lib/db.ts, src/lib/cache.ts, src/app/api/check/route.ts, src/lib/mocks/index.ts, src/lib/browser/sparkClient.ts, src/components/FitBadge.tsx, EvidenceLinks.tsx, PaperworkSummary.tsx, BuildSheet.tsx, Workspace.tsx, tests/spark.test.ts, tests/fit-policy.test.ts, tests/check.test.ts, tests/project.test.ts, tests/db.test.ts; SPEC.md 475 dated note.
- Lead fixes after the run (review-changes quick: models, shop, security, general; green, 1 minor):
  - spike/responses_spark.py: the evidence parsing after a paid answer now skips non-object entries and writes the response structure, so a paid probe always leaves evidence (minor raised by 4 reviewers); test item slot `mirror` → `mirrors`; the exhaust test item has no product; the ABE test part keeps url null on purpose.
  - prompts/fit-check.v1.md: asks for the throttle type (cable or ride-by-wire); never says an Änderungsabnahme or Einzelabnahme will succeed (SPEC 578-579).
  - meta.ts sparkChargeGrounded: null when the per-query price is not a known integer; comment that the count must be API-reported, never the number of web_search_call items.
  - BuildSheet.tsx: a labeled mock result never counts as a current check, so a later live run checks those parts again (gate F2).
  - tests/check.test.ts: lint warning removed.
  - SPEC.md 475: dated note on search_context_size "low" and user_location DE; max_tool_calls is not on Meta's grounding page, so a rejection would be a SPEC conflict for the owner.
- Lead decisions on open minors:
  - Gate F1 (fit:<hash> cache is written but never read back, SPEC 594): kept open; cache reuse comes with T13/T17. The live run is one run on fresh input.
  - Review minor (the sheet's hash and 24 h TTL are only recomputed when head or bike change; display only, persisting rechecks): kept open.
  - S1's list of general hosts (law and authority sites never count as part-specific evidence) is the builder's choice, not in SPEC; kept because it only makes results more conservative.
  - In mock mode the Check fit text still says each request costs money; minor, left.
- Mock browser check ($0, MOCK=1, headless Chrome 156, synthetic gradient JPEG, fresh profile deleted afterwards): bike confirmed, four mock parts (tank, front wheel, rear wheel, handlebar).
  - Check fit on two parts: one batch, "✓ saved", both "Verify fit" with "⚠ Mock result", the mock banner, and the pre-check sentence; the details show approval, coverage, inspection, Eintragung, documents to carry as "?unknown"; the source link has target _blank and rel noopener noreferrer, with an accessed date.
  - Product edit on the tank: every fit goes back to "Not checked".
  - Four parts, second request forced to 503: batch 1 (handlebar, tank, front wheel) saved with "Verify fit", batch 2 (rear wheel) "✕ The request failed." with "Retry batch 2" and its cost text; the retry saved it; all four results survived a reload.
- Checks after the lead fixes: typecheck, lint (0 problems), build exit 0; npm test 595/595 in 22 files; local_images.py 71 passed, 0 failed, 0 skipped. Grounded dry-runs (SEARCH_QUERY_RESERVE=20, batch 1 and 2) print tools with search_context_size low and user_location DE, max_tool_calls 2, include web_search_call.results, reserve 380000 µ$.
- Consultant: PAL chat nim-nemotron35 on fitPolicy.ts and the check route (319 lines). 10 points, none adopted:
  - unknown query count charges zero: wrong, sparkChargeGrounded returns null and the reservation is kept;
  - reservation leak on exceptions: withReservation keeps the reservation on unknown outcomes (budget tests);
  - url_citation annotations are model-controlled: they are API metadata, and SPEC 477 defines exactly this check;
  - inspection none with an ABE and no condition: that is a legitimate result;
  - a tangential specific source keeps ok: ok also needs covered documents, known inspection and Eintragung and no open measurement; a page check cannot be done mechanically;
  - non-null byId, more than 3 items, prices.reservations missing: unreachable (exact id check, schema max 3, and the price guard fails closed before reserving);
  - withAdded drops server entries: wrong, server additions keep their room first.
  Gemini was not asked.
- Spend: $0 so far.
- Owner go for the paid probes (2026-10-29, "yes"). Note: responses_spark.py charges --ticket (default T0), not BUDGET_TICKET, so every probe ran with `--ticket T9`; caps TICKET_CAP_USD=2 and DAILY_CAP_USD=2, SEARCH_QUERY_RESERVE=20 in the process env. Dry-run first.
- Probe 1, 12:05 ET, batch 1 (handlebar, exhaust, front wheel): HTTP 200, 2 completed searches, but "output_text is not JSON": the answer has a preamble message before the searches and the final JSON message after them, and both the spike and meta.ts readSparkResponse joined them.
- Lead repair (models-builder, then review-changes quick: models, security, general; green, 2 minors): the answer is the last message item with string output_text, joined within that item only; citations still from every message; spike evidence lists each message's length and first 160 characters. Minor F1 (unguarded b["text"]) refuted: the comprehension checks isinstance first. Minor S1 (TS and Python could pick a different last message when text is not a string) fixed in meta.ts. spark and check tests 51/51, typecheck exit 0.
- Probe 2, batch 1 again: passed. Handlebar verify, US exhaust problem, front wheel verify; every approval field unknown; no sources claimed; reasons name the throttle type, cable reach and ABS ring.
- Probe 3, batch 2 (ABE part with an inspection condition): status incomplete after both searches, output 4096 of 4096 tokens (3941 reasoning). The route refuses an incomplete answer; no ABE case evidence yet.
- U06: no query count in usage in any probe; each call made exactly 2 web_search_call items with one query each. Every probe kept its 380000 µ$ reservation: ledger T9 1.14 USD booked, lifetime 1.854096 (expected real cost about $0.02). Evidence in docs/api-evidence.md.
- Waiting for the owner: the Meta Billing reading (to settle queries per call), and a decision on the grounded output cap (probe 3 ran out of tokens).
- Owner 2026-10-29: Meta Billing now $0.73 (was $0.71). Delta about $0.01–0.03 at cent rounding minus 5478 µ$ tokens gives 2–8 billed queries for the three probes, which fits one query per web_search_call (6). No single call can exceed 8, so SEARCH_QUERY_RESERVE=16 (8 × 2); reservation per grounded call 370000 µ$. Calls still keep the whole reservation because no count is reported; the ledger stays over-counted (lifetime 1.854096 vs Billing 0.73) until a reconcile path exists.
- Owner decision 2026-10-29: grounded fit checks use max_output_tokens 8192 (identify and instruction keep 4096). 3 × (1048576 input + 8192 output) = 319488 µ$ ≤ 330000. meta.ts GROUNDED_FIELDS, spike GROUNDED_FIELDS, SPEC 461 and 712 dated notes; new test ties the cap to prices.json. review-changes quick (models, security, general): green, 2 minors, both adopted (SPEC 461 cross-reference, reservation-bound test). npm test 597/597 in 22 files.
- Risk for the live run: a longer answer may approach the 70 s route deadline (probes took about 48 s with 4096 tokens).
- Live app run, 13:00–13:12 ET (owner in their own Chrome, dev server `LIVE_API_ENABLED=true MOCK=0 SEARCH_ENABLED=true SEARCH_QUERY_RESERVE=16 BUDGET_TICKET=T9 TICKET_CAP_USD=2 DAILY_CAP_USD=2 VISITOR_DAILY_CAP_USD=2` plus a random VISITOR_HASH_SECRET in the process env only; the default $0.50 visitor cap would have blocked a second batch). The owner worked in project fadf4f99: confirmed the bike (BMW R nineT 2014–2016, ABS yes), rendered a front wheel from Start (2 edits, 1 SAM, 1 instruction; a new branch beside the 5-spoke rear wheel), entered a real listing (BST Star TEK 15×3.5, listed fitment Yamaha XMAX 300) with approval ABE and the text "ABE, fitting must be inspected (Abnahme)", then clicked Check fit once.
  - One batch, POST /api/check 200 in 46 s (under the 70 s deadline with the 8192 cap).
  - Result: problem, confidence 0.88; approval, coverage, inspection, Eintragung and documents all unknown. Reasons: the listing is for a 15-inch scooter wheel, the R nineT uses 17 inch; the seller's ABE text is treated as untrusted and would at most cover the Yamaha; axle, discs, ABS ring, load rating and fender clearance not shown. toMeasure lists rim and tyre size, axle and spacers, disc and caliper, ABS ring and sensor, load rating, fender clearance. Server conditions for wheel/ABS/fender were added. No sources claimed, so EvidenceLinks had nothing to show live.
  - Inspection "none" was not inferred from the ABE text; the result never reached ok.
  - Finding: the folder save ran at 13:09:21 for the product edit, before the check; attaching a fit result updates the version in place and does not trigger the folder save, so the owner had to save again (13:12:37). The owner picked the 6be8cba2 folder as the save root again, so the complete copy of fadf4f99 is nested in it; the top-level fadf4f99 folder is the 10:14 copy without the front wheel. Left for the owner to tidy.
  - Owner question: the 5-spoke rear wheel (version ada8ed48) is still stored; it is the other branch after Start. Start, then Redo shows the branch choice.
- Spend: ledger T9 1.533253 USD booked (3 probes 1.14 kept, check 0.37 kept, the owner's renders 0.023253). Lifetime in the ledger 2.247349; Billing before the app run $0.73, expected real total about $0.77. Nothing reserved, no halt flag.
- Done-when: owned-bike live results show evidence and unknowns (probe 2, app run; search hits recorded, model cited no sources); no unjustified ok for handlebar, US exhaust, wheel/ABS and an ABE text with an inspection condition (live: problem/verify; offline tests); unsupported URLs removed (offline tests; no live sources to strip); a failed batch keeps the others (mock browser check, tests); changing bike/part/rules invalidates every fit (tests, mock browser check); offline checks pass; grounded dispatch is enabled with the owner-approved reserve 16 and stays off by default (.env.example SEARCH_ENABLED=false).
- Not done: Codex gate for the new paid route (optional per docs/t9-start.md; a review package can be prepared on request).
- Owner 2026-10-29: the branch switch (Start, Redo, choose the rear wheel) works. Live dev server stopped. Results tidied on the owner's request, nothing deleted: the older top-level fadf4f99 copy (10:14, rear wheel only; its images and masks byte-identical to the newer copy, all its versions contained in it) moved to ~/.Trash/dreambike-results-cleanup-2026-10-29-T9; the complete fadf4f99 copy (both branches and the fit result) moved from inside the 6be8cba2 folder to the top level. No project folder is nested now.

### T10 — 2026-10-29, started about 13:55 ET

- Owner decisions, asked once:
  1. The Zulassungsstelle fee becomes its own line without VAT: new Fee kind `official_fee`, counted in the net total, VAT only on the other lines (SPEC 647/649 get a dated note). The €416.50 test is unaffected.
  2. Example shop name: "Nordwerk Customs", always labeled as example values with illustrative rates; Claude makes a simple text logo PNG.
  3. Example-shop minutes: the owner's 9 values win (see "Owner inputs before T9"); every other slot uses the SPEC 641 illustrative minutes; custom stays unset.
- Lead decisions: the owner's example values replace the SPEC 639 demo values (10000/25000) for the isolated example record (SPEC dated note). Real settings start empty as SPEC 639 says, with laborBySlot []. Each project chooses its shop record (real or example); a new project uses the real record. Spend: $0, no paid calls in this ticket.

- Logo: `nordwerk-customs-logo.png` (512×119 px, 6984 bytes, transparent) made with IBM Plex Sans (variable font from google/fonts, SIL OFL 1.1) and the Nordlicht text and primary-ink colors. Stored outside the repo in ~/Projekte/Hackathon/dreambike-results/example-shop/ with the script, the OFL text and a README; it is uploaded through Settings.
- Offline build, 14:05–14:39 ET: `/build-ticket` with units Q1, D1, L1, U1 (35 agents, about 34 min). Status green: all units approved, no open findings or disputes.
  - Plan check changes: project.ts and tests/project.test.ts moved to Q1 (quote.ts needs stableJson; fitReviewHash and acknowledgeFit sit next to clearFit); D1 also owns src/lib/browser/projectSession.ts and tests/projectsession.test.ts (saveSheet treated a review-only save as unchanged); U1 also owns BuildSheet.tsx (SheetChange type); Q1 got models- and imaging-reviewer (contracts.ts routing), U1 got release-reviewer (example labels).
  - Q1 (shop): round 1 had 1 blocking finding (an acknowledgment from before the 24 h expiry still counted after it); fixed in round 2. computeQuote now computes the review hashes itself.
  - L1 (imaging): round 1 had 1 (a hex color literal in the JPEG fallback); fixed in round 2.
  - D1 (shop): round 1 had 4 (putShopSettings wrote the caller's logo id, which could orphan or dangle a logo); fixed in round 2: only putLogo and removeLogo change the logo.
  - U1 (ui): round 1 had 4 (form draft not reset to the stored values after a save, load failures waiting forever); fixed in round 2.
  - Verify: typecheck, lint, npm test 644/644 in 23 files, build passed. Done-when gate: all 7 items met from tests and code; 3 minors (F1 settingsId not a closed set on import, F2 no computeQuote test for one fee over two items, F3 reload checked only in fake-indexeddb).
- Files: src/lib/quote.ts (new), src/lib/contracts.ts, src/lib/types.ts, src/lib/project.ts, src/lib/db.ts, src/lib/browser/projectSession.ts, src/lib/browser/preflight.ts, src/components/ShopSettingsForm.tsx, InspectionFees.tsx, EstimatePreview.tsx, MissingCosts.tsx (new), AppShell.tsx, Workspace.tsx, BuildSheet.tsx, tests/quote.test.ts (new), tests/contracts.test.ts, tests/project.test.ts, tests/db.test.ts, tests/projectsession.test.ts, tests/preflight.test.ts; SPEC.md 639 and 647 dated notes.
- Lead repair after the run, 14:40–14:45 ET (three builders in parallel, then `/review-changes` quick on the 13 touched files: imaging, shop, models, security, general; green, 3 minors). Fixed minors raised by the run's reviewers:
  - putLogo enforces the logo limits (PNG/JPEG/WebP, at most 500000 bytes, 1–512 px), validates the record, and reuses a same-hash image only when its rights are owner (3 reviewers: a logo matching an external_runtime image lost the owner label).
  - Project.settingsId is z.enum(["default","example"]); an imported project with another id is refused (gate F1). Only "default" was ever written (git history).
  - History label "fit review removed" for an un-acknowledgment; suggested fee labels from the example shop end in " — example rate".
  - Tests: one fee over two items counted once through computeQuote (net 55042, VAT 10458, gross 65500); labor exactly on .5 (gate F2, IMG-Q1-2).
  - normalizeLogo: LOGO_MAX_BYTES 500000 (was 512000), "The logo could not be read.", decoded size checked.
  - UI: the switch warning compares the two records' shop rules instead of claiming every fit goes stale (3 reviewers); the example banner says only the rate, minutes and fee allowances are illustrative (part prices can be real); the logo hint says to use only the shop's own logo; no inspection review on an unconfirmed bike; a late settings save is stored under its own record's key.
  - After the browser check: a stray space before the colon in the switch warning (one character, JSX; checks rerun, not re-reviewed).
- Lead decisions on the remaining minors: official fee not required when an inspection is needed (review F1): kept open; the mechanic's inspection review is the explicit decision and the owner's figures say "about 15 €". Example-shop fee lines added by hand stay in the sheet after switching to the real shop (the mechanic confirmed them; suggested ones carry the example tag). A corrupt settings record replaced through the form leaves its old logo blob until cleanup (bounded by 500 KB). suggestFees also proposes an official fee line with amount unknown when the shop has none, so the missing amount shows; kept. buildSettings in the form has no unit test.
- Mock browser check, 14:46–14:51 ET ($0, MOCK=1, headless Chrome over CDP, fresh profile deleted afterwards, synthetic gradient JPEG): bike confirmed, a mock tank change rendered and accepted.
  - Estimate with the empty real shop: incomplete draft, known subtotal €0.00, 5 missing items in words (shop not confirmed, price, labor, fit, inspection review).
  - Settings: switched to the example shop (warning: rules are the same, fits stay current); every example value matches the owner's inputs (100,00; 50,42; 151,26; 15,00; the 9 owner minutes and the SPEC rest); logo uploaded (512×119); "Saved locally".
  - Page reload: the project reopens, the example shop is still selected, every value, the quote note and the logo (512×119) are back.
  - Tank product with 119,00 gross: part net €100.00, labor €200.00 "(shop default minutes)" (120 min × €100/h), known subtotal €300.00; mock fit "Verify fit ⚠ Mock result", "A mock result cannot be reviewed".
  - Fee lines Änderungsabnahme 50,42 (estimated) and Zulassungsstelle 15,00 (official fee, no VAT), both confirmed for the tank, review "fees added" saved: known subtotal €365.42; still an incomplete draft only because of the mock fit.
  - Back to "Your shop": the real record is still empty, no logo; labor goes back to unknown.
- Checks after all fixes: typecheck exit 0, lint exit 0, npm test 653/653 in 23 files, build exit 0.
- Consultant: PAL chat nim-nemotron35 on src/lib/quote.ts (255 lines). 5 points, none adopted:
  - VAT ignores vatBasisPoints: the schema fixes it to the literal 1900 and SPEC 649 fixes 19 %;
  - the quote hash misses `now`: quoteCanonical includes each item's fit status, which turns stale at 24 h, so the hash changes at expiry;
  - a confirmed 0-cent inspection fee completes the quote: the confirmed amount is the mechanic's explicit entry, settings are only defaults;
  - official fee suggested with an unknown amount: deliberate, the missing amount shows instead of being dropped;
  - no guard above safe-integer range: every input is schema-bounded (Cents ≤ 100,000,000, minutes ≤ 10080), far below 2^53.
  Gemini was not asked.
- Spend: $0 (no paid calls).
- Duration: about 1 h (13:55–14:55 ET), including the owner questions, the 34-minute workflow, the repair and the browser check.


### Handoff — 2026-10-29, T10 done (start here next session)

- Done: T1–T10 and OF1 (see status lines). Spend unchanged since T9: ledger lifetime 2.247349 USD booked (over-counted, see T9), Billing about $0.77 expected.
- Next on the critical path: T11, estimate PDF. It can use quote.ts as is; the example logo is uploaded through Settings (file in ~/Projekte/Hackathon/dreambike-results/example-shop/). T11 adds the Plex TTF fonts and their licenses under public/fonts/.
- Owner Safari check, 2026-10-29 about 15:00 ET (MOCK=1 dev server on localhost:3000, the owner's own Safari): new project from a photo (Safari has its own storage, so the Chrome projects are not listed there), mock tank change accepted; example shop chosen, values match, logo uploaded, settings saved; after a reload the project reopened and the example shop, the values, the quote note and the logo were back; estimate €100.00 part, €200.00 labor (shop default minutes), €300.00 known subtotal, €350.42 with a confirmed Änderungsabnahme line; switching back to "Your shop" shows the empty real record. Owner: all steps "good". So the earlier Safari reload loss (before OF1) did not recur. Dev server stopped.
- Owner decision 2026-10-29: the Zulassungsstelle line stays a suggestion; a needed inspection does not require it (the mechanic decides in the inspection review). Owner: push.

### T11 — 2026-10-29, started 15:30 ET

- Owner decision, asked once: the complete one-page QA PDF uses a clearly labeled test fixture fit (no paid fit check). The fixture text says "Test fixture — not a real check"; that PDF is not evidence of a real reviewed fit.
- Plan: lead downloads the fonts; `/build-ticket` with units P1 (shop: src/lib/estimate.ts, src/lib/pdf.ts, tests/pdf.test.ts, tests/quote.test.ts; plus release-reviewer) and P2 (shop: src/lib/browser/pdfExport.ts, src/lib/browser/jpeg.ts, BeforeAfter.tsx, ExportButton.tsx, EstimatePreview.tsx, Workspace.tsx, src/app/page.tsx; plus imaging-reviewer). A Plan-agent critique before dispatch added: fonts and the pdf module are prewarmed when the workspace opens (a dynamic import at click would be a network request), stale-fit and mock labels in the PDF, WebP logos, one shared estimate helper, content-stream tests and fixed dates.
- Routing: pdf.ts, ExportButton.tsx, tests/pdf.test.ts, tests/quote.test.ts and public/fonts/ were already routed, and tests/pdf.test.ts and tests/quote.test.ts already have allow lines in .claude/settings.json. The new src/lib/estimate.ts was not routed: lead added `estimate` to the shop rules in review-changes.js and fix-until-green.js (tests/workflows.test.ts 175/175). The QA command with the PDF_QA_DIR env prefix is not allowlisted; lead-run only.
- Fonts, 15:30 ET, official IBM/plex GitHub releases, unmodified static TTFs from `fonts/complete/ttf/`:
  - `@ibm/plex-sans@1.1.0` (2024-11-13), https://github.com/IBM/plex/releases/download/%40ibm/plex-sans%401.1.0/ibm-plex-sans.zip, zip sha256 fb365d910566e6d199cc2c15579a7dd9a267128e18431a394ed81f1970c69200 (9921777 bytes).
    - IBMPlexSans-Regular.ttf, version 3.005, 200500 bytes, sha256 975dcda37d80f038dcd143c22e33ca2d97a0cc5a929aace1c749153b0fe1afa5.
    - IBMPlexSans-SemiBold.ttf, version 3.005, 202632 bytes, sha256 a20caf8286023a6a7a85e40b1d2a4ae9fc3e3b1f9eda8f4c542dd4986af67bb1.
  - `@ibm/plex-mono@2.5.0` (2026-06-11, newest Mono release), https://github.com/IBM/plex/releases/download/%40ibm/plex-mono%402.5.0/ibm-plex-mono.zip, zip sha256 6d23f01257663d8cc49a0d64c22ced630b79e0e2a0ac08a0da86e9a38bbc481c (6940652 bytes).
    - IBMPlexMono-Regular.ttf, version 2.005, 173052 bytes, sha256 7c6fbddca4b700be918f5f6183d9bd4464fa427fe435f0b480d77fe2bb8c5a43.
  - public/fonts/OFL.txt: the `fonts/complete/ttf/license.txt` from the archives (byte-identical in both, 4360 bytes, sha256 91c25c350d3cac39da2736d74f7ba37ef648f5237a4e330a240615bc8d8c4360): "Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"", SIL OFL 1.1.
  - All three start with the TrueType signature 00 01 00 00. Glyphs present: € Ä Ö Ü ä ö ü ß – — · … × ≤ ≥ → ✓; missing: ⚠ ⓘ (the PDF uses words and vector icons instead).
  - CREDITS.md started with a Fonts section (SPEC 79); T15 completes it.
- Font release review, 15:31 ET: `/review-changes` quick on the 3 TTFs, OFL.txt, CREDITS.md and the two routing edits (release, security, general): green, 3 minors. CREDITS.md no longer names internal tickets (adopted). Kept open until the gate: CREDITS.md says the PDF embeds a subset; pdf.ts must really embed these files with subset true. Routing for estimate.ts checked by evaluating both rule tables (shop-reviewer, shop-builder); no test pins it (as for the other shop paths).
- Offline build, 15:36–17:11 ET, then paused on the owner's request (usage limit) and resumed 17:23 ET for the gate only: `/build-ticket` with P1 and P2 (16 agents).
  - Plan check changes: AppMode is "demo_only", not "demo"; security-reviewer added to P2 (page.tsx now passes the app mode to the client); the warm-up moved from workspace start to Estimate panel open because docs/api-evidence.md says pdf-lib is "loaded only on PDF export" (later overruled by the owner, see below); P2 also owns tests/pdf.test.ts; reuse sniffFormat; never band the real before photo.
  - P1 (shop + release): round 1 had 1 blocking finding (release: two QA PDFs printed invented fit results without a test-data label); fixed in round 2, all three approved.
  - P2 (shop + imaging + security + general): approved in round 1, minors only.
  - Verify: typecheck, lint, npm test 754 passed + 1 skipped (the env-gated QA block) in 24 files, build: all passed.
  - Done-when gate: needs_lead. Met: the draft has no grand total and a clear warning; a complete export needs the mechanic's review. Not met yet: the human look at the 1-page and 3-page PDFs, recorded QA, the offline browser run. One major finding F1: the warm-up ran only when the Estimate panel opened, so export failed offline if Estimate was first opened after the network dropped.
- Owner decision 2026-10-29 (F1): fonts and the pdf chunk load in idle time once a project is open (about 1 MB), so export needs no network in any order. docs/api-evidence.md pdf-lib row updated with a dated note.
- Lead decisions on the 24 minors: fixed in a lead repair (shop-builder): warm-up timeout; ExportButton outcome survives a head change (the "version changed" note was unreachable) and mismatchText is tested; one-line page-1 callout so the item table stays on page 1; "Reviewed by the mechanic" only for a current check; stale inspection review marked out of date; fit check date printed; fallback reason in words, not the raw code; table header never alone at a page bottom; rights type from ImageRef; import allowlist guard for pdf.ts; QA fixtures rewritten to match the owner's photos (BMW R nineT front wheel; green wheels, tank and chrome fork) with neutral "(test item)" titles and status-consistent fixture texts.
  - Known limit, not fixed: the MOCK band on the after image follows the current app mode. A version stores no mock marker, so a project made under MOCK=1 and exported later in live mode prints the hue-shifted mock image without the band (raised by 4 reviewers). Persisting a marker is a contract change for a later ticket; MOCK=1 is local development only and production refuses it.
  - T7 regression check kept: the PDF input has exactly three image slots (root, head, logo); tests pin the XObject count and that the export reads only those ids, so the reference photo cannot enter the PDF.
- Lead repair 1, 17:30–17:53 ET (shop-builder, one agent, all 12 items done): warm-up in idle time once a project is open (scheduleWarmup in Workspace; EstimatePreview and ExportButton join the same memo; one dynamic import of @/lib/pdf); 20 s warm-up timeout with AbortController; ExportButton renders whenever a head exists, so the "version changed" note can show; mismatchText exported and tested; estimateSnapshot test across the 24 h boundary; one-line page-1 callout (title, fit word, check date); reviewed chip only for a current check; out-of-date inspection review marked; "checked YYYY-MM-DD" in the paperwork header; fallback reasons in words; table header never alone at a page bottom; rights type from ImageRef; import allowlist for pdf.ts; QA-only fixtures matching the owner's photos (BMW R nineT, "(test item)" titles, fit texts that agree with their status). Checks: typecheck, lint, npm test 771 + 1 skipped.
- `/review-changes` quick on all 19 T11 paths, 17:54 ET (imaging, shop, release, security, general): green, 12 minors. Lead decisions:
  - Fixed inline: white ground under converted JPEGs (jpeg.ts); after-image caption "mock placeholder, not an AI result" in mock mode; each source's "supports" text printed under its title (as on screen); a test that the button's complete rule and the PDF draft flag agree; pdfExport.ts routed to shop-reviewer and shop-builder (it holds the rights gate); docs/api-evidence.md cell rewritten with measured sizes; T15 gets the pending credits (SAM License, pdf-lib MIT).
  - Tried and removed: treating a bike with MOCK_LABEL in its limitations as mock. The production browser check showed that confirming a bike recomputes its limitations, so the label never survives; the rule would have been dead code.
  - Refuted: "tests/pdf.test.ts misses shop-reviewer" (review-changes.js line 21 already routes it; checked by evaluating both rule tables).
  - Kept open (known limits): the MOCK band and label follow the running app mode only; a project made under MOCK=1 and exported in live or demo mode prints its tinted mock image without a band and captioned as an AI visualization (seen in the production check below; item titles still read "Mock: …"). A per-version mock marker is a contract change for a later ticket. The pixel MOCK band is about 3 pt at PDF scale (the page and footer labels carry it). Amounts of €100,000,000 or more would wrap in their column.
- QA PDFs (lead, `PDF_QA_DIR=spike/out/pdf-qa PDF_QA_IMAGES=spike/out/pdf-qa/input npx --no-install vitest run tests/pdf.test.ts`, 115/115 including the QA block), owner's photos from the saved projects fadf4f99 (start, carbon front wheel) and 6be8cba2 (start, green wheels, tank and chrome fork), example logo; files stay in spike/out/ (gitignored), never committed:
  - complete-1page.pdf: 1 page, example shop label, BMW R nineT test bike, one fixture wheel item, fit ok reviewed, allowance, net €955.46, VAT €181.54, gross €1,137.00. TEST FIXTURE: the fit, sources and bike line are test data (labeled on page 1); this is layout evidence only, never estimate or paperwork evidence.
  - long-3page.pdf: 3 pages, table header repeated on page 2, four fixture items (ok, verify, verify, problem), Änderungsabnahme, Einzelabnahme and official fee, VAT 19 % "(not on the official fee)", gross €3,036.95, long URL wrapped by character, acknowledged-findings callout, quote notes. Same fixture caveat.
  - draft-unknown.pdf: 2 pages, "Incomplete draft — costs missing" title and banner, "Unknown" cells with an icon, known subtotal only, missing list, no net/VAT/gross.
  - The lead read all three; the owner opened them (plus browser-draft-prod.pdf) in Preview: "All pass", including the reason bullet that breaks from page 2 to 3 in the long PDF and the draft's page 2 that holds only the pre-check note.
- Browser checks ($0, headless Chrome 156 over CDP, fresh profile in the scratchpad, deleted afterwards, synthetic gradient JPEG):
  - Dev, `MOCK=1 LIVE_API_ENABLED=false npm run dev`: project, mock tank change accepted, example shop and logo. Fonts, pdf-lib and fontkit loaded in idle time about 17 s after the project opened, before Estimate was ever opened. First offline attempt (Estimate opened for the first time after going offline, same page load) did not get ready: most likely the background warm-up timed out or failed while dev mode compiled pdf-lib on demand, which cleared the memo (not proven; dev log has no chunk timings). Second try in the same page and a fresh reload with the strict order (reload online, wait for the preload, go offline with Network.emulateNetworkConditions plus Fetch.enable failing every request, then open Estimate and export): ready at once, draft PDF downloaded, zero http(s) requests during export (a control fetch while offline was caught by the log). PDF: WebP photos converted to JPEG, MOCK band on the after image only, mock label on the page and footer, fallback reason in words, Nordlicht colors from the stylesheet.
  - Production, `npm run build` then `LIVE_API_ENABLED=false next start` (demo_only, no Meta calls possible), same origin so the test project stayed in IndexedDB: the initial HTML does not reference the pdf chunk; page load ended at 229 ms, the preload started at 339 ms (pdf chunk 496 KiB transferred, fonts from cache); strict offline order again: control blocked, Estimate opened for the first time offline, button ready at once, export downloaded, zero network requests. PDF colors correct under the minified CSS. It printed the mock-made project without a mock label (the known limit above).
- Consultant: PAL chat nim-nemotron35 on src/lib/pdf.ts in two excerpts (lines 1–747 and 748–1493, under PAL's ~800-line limit; neutral prompts, no project name). 20 points, none adopted:
  - supplementary-plane characters wrongly replaced by "?": the Plex fonts have no glyphs outside the BMP, so "?" is right;
  - a long word's last piece wider than the column: measured and drawn widths use the same glyph advances, and a test checks every URL line at real font widths;
  - keepLines is dead code: wrong, split() uses it for the first chunk (line 588);
  - a line taller than a page placed off the page: no FlowLine can be taller than a page (images are capped at 120 pt);
  - blank-text wrap, right-aligned indent, integer-cent validation: no caller produces them, and Cents is an integer schema;
  - non-null totals printed when complete: unreachable, draft is defined by null totals;
  - unconfirmed fee amounts shown: same as the screen, marked "(not counted)";
  - footer collisions, header repeat, baseline conventions: covered by geometry tests;
  - fill and stroke opacity coupled: no rectangle has both;
  - image format guard: validate() already checks the bytes against the kind.
  Gemini was not asked.
- Last `/review-changes` quick on the lead edits (pdf.ts, jpeg.ts, tests/pdf.test.ts, both workflows, api-evidence), 18:10 ET: green, 12 minors. Adopted: the api-evidence wording (KiB, sizes from the final build, offline claim pointing to this log). Open for T17: a confirmed zero-labor line prints €0.00 with no "(zero labor, confirmed)" note; validate() does not cross-check the inspection review and settings against a complete quote (unreachable from the only caller); no runtime test for the canvas order in jpeg.ts (covered by the browser check); some tests pin source text of other files; no test for an empty sheet; a null OffscreenCanvas context does not fall back to the DOM canvas.
- Gate F1 (CREDITS.md says the PDF embeds subsets of these fonts) checked: pdfExport.ts loads /fonts/IBMPlexSans-Regular.ttf, -SemiBold.ttf and IBMPlexMono-Regular.ttf, and pdf.ts embeds them with subset true.
- Final checks, 18:21 ET: typecheck exit 0, lint exit 0, npm test 774 passed + 1 skipped (the env-gated QA block) in 24 files, build exit 0. pdf chunk 1135 KiB minified, 496 KiB gzip; fonts 562 KiB.
- Done-when: a complete one-page and a long three-page PDF opened and checked visually (lead and owner; the complete one rests on a labeled test fixture by owner decision); no clipping or overlapping rows (geometry and content-stream tests, visual check); fonts, EUR and German terms render (glyph tests, visual check); export works offline with no external photo or network fetch (tests; dev and production browser runs with every request failed); the unknown-cost draft has no grand total and a clear warning; a complete export needs the mechanic's fit and inspection review (tests); the example-shop label is on every example page; build and types pass.
- Files: src/lib/estimate.ts, src/lib/pdf.ts, src/lib/browser/pdfExport.ts, src/lib/browser/jpeg.ts, src/components/ExportButton.tsx (new); src/components/EstimatePreview.tsx, Workspace.tsx, BeforeAfter.tsx, src/app/page.tsx; tests/pdf.test.ts (new), tests/quote.test.ts; public/fonts/IBMPlexSans-Regular.ttf, IBMPlexSans-SemiBold.ttf, IBMPlexMono-Regular.ttf, OFL.txt; CREDITS.md (new); docs/api-evidence.md; .claude/workflows/review-changes.js and fix-until-green.js (routing for estimate.ts and pdfExport.ts); TASKS.md.
- Spend: $0 (no paid calls).
- Duration: about 2 h 50 min (15:30–18:22 ET), including a 12-minute pause at the owner's request, the 16-agent workflow, two lead repairs, three reviews and the browser checks.

### Handoff — 2026-10-29, T11 done (start here next session)

- Done: T1–T11 and OF1. Spend unchanged since T9: ledger lifetime 2.247349 USD booked (over-counted, see T9), Billing about $0.77 expected.
- Next on the critical path: T13, cached demo and atomic public cost protection (T12 is optional). The demo's public/demo/quote.pdf must come from a real reviewed fit, never from the T11 QA fixtures.
- Open from T11 for T17: zero-labor note in the PDF, the mock marker per version (contract change), validate() cross-checks, canvas-order test, source-text tests, empty-sheet test.
- Owner go 2026-10-29: d089192 pushed to origin/main.
- After the T11 push (2026-10-29): the owner's shop list for T12/U07 is recorded (T12 ticket, U07 row); T12 is deferred until T13 and T14 are live. The owner has a start prompt for T13 for a new session.

### T13 — 2026-10-29, started 19:31 ET

- Owner decisions, asked once (plain-words round, recommendations accepted):
  - Demo content: saved project 6be8cba2, path Start → candy green front wheel → candy green rear wheel → green tank (v0–v3, head f5b26375); the fork branch stays out. Owner cleared all four images for public use after viewing them in Preview (no people; no cover squares on the bike; the red car's plate stays covered). The tank step is an owner scope extension of SPEC 13's v0/v1/v2. Final per-file clearance of public/demo, including quote.pdf, before the commit.
  - Demo fit: one paid grounded check on the three items in one batch (ticket T13 cap $1, day $1; the ledger keeps the 0.37 USD reservation, real cost about $0.01–0.03), after the owner fixes the bike name ("BWW R Nine T" → BMW R nineT) and enters prices labeled illustrative; owner reviews as the mechanic and exports quote.pdf with the example shop. Separate go right before the call.
  - Caps: SPEC defaults; the IP bucket has the same caps as the visitor ($0.50, 5 edits, 80 SAM, 12 Spark, 3 ASR). BUDGET_PHASE stays development in T13; switch to demo on Vercel in T14 after the Billing reconciliation. No new env variable.
  - Real Redis test: throwaway `{dreambike:it-…}` keys in the same Upstash database, deleted afterwards with a SCAN check; Node test and extended Python selftest.
- Plan critique (Plan agent, read-only) changed the design before dispatch: hard/daily caps stored in the lifetime hash and clamped in reserve.lua; the namespace on all nine keys; visitor/IP keys expire after 48 h; trusted IP only from x-vercel-forwarded-for (IPv6 /64); deployed live only on VERCEL_ENV=production with BUDGET_PHASE=demo; session cookie set by a Next proxy and by GET /api/budget; per-process key only outside deployments; fixed BudgetResponse.reason values; the demo copy keeps item, bike-revision, image and mask ids (fit hashes stay valid); masks as PNG loaded only on "Try editing"; races proven only by the real Redis run (no Lua runtime offline).

- Lead before dispatch, 19:32 ET: routing added for src/lib/demo.ts and tests/demo.test.ts (shop), DemoView.tsx (release), src/proxy.ts (platform builder), tests/support/session.ts (security, Opus fix review); later src/lib/server/demoPack.ts (shop and release reviewers, shop builder). paid.ts already had its own security-reviewer rule. tests/workflows.test.ts 175/175 after each edit.
- `/build-ticket` with units A (platform: ledger core), C (shop: demo data and contracts), B (platform: identity, guards, routes), D (ui: banners and demo view), 19:33–20:17 ET, 39 agents. Plan check added tests/paid.test.ts and tests/http.test.ts to A, moved packDemo into the Node-only src/lib/server/demoPack.ts (sharp must not reach the client bundle), added tests/contracts.test.ts to C and AppShell.tsx to D, and let D depend on C only.
  - A: round 1 one blocking finding (spike/common.py did not clamp caps like config.ts), fixed in round 2; approved. C: round 1 five blocking findings, fixed in round 2; approved by all six reviewers. B: approved in round 1. D: round 1 three blocking findings, fixed in round 2; approved.
  - Verify: npm run build (proxy compiled), lint, typecheck, npm test 864 passed + 21 skipped (budget-redis file skipped without BUDGET_REDIS_IT), local_images.py 71 passed, run_all smoke dry run: all passed. Exit codes of build/lint/typecheck were read through a pipe; the lead reruns them at the end.
  - Done-when gate: needs_lead. Met offline: crash/timeout keeps the reservation; missing Redis or lifetime disables paid work; DST/ET; unknown query bounds keep grounded calls disabled. Pending lead/owner steps: the real Redis run (races, duplicate ID, simulated deployment), the demo files (paid fit check, quote.pdf, pack, per-file clearance), and the browser checks at caps and without the key. 49 minor findings; the lead's repair follows.
- Lead repair after the run, 20:19–20:30 ET (three builders, in parallel where the files allowed):
  - platform-builder: caps and limits validated before EVAL and in reserve.lua (invalid_cap); status.lua as strict as reserve.lua (bad_total, never 0); NOOP missing maps to ACCOUNTING_UNAVAILABLE; set-caps takes explicit --project-usd/--daily-usd (lead later made both required); budget reasons: visitor_cap for used-up edit counts, live_disabled for BUDGET_TICKET unset, liveEnabled false whenever a reason is set; plain FORBIDDEN without a secret; health 200 demo_only on a config error; session renewed with the same id after 24 h.
  - shop-builder: demo refuses non-owner images, reference-mode versions and product image URLs; strict reviewed-fit check in the pack; pack builds everything in memory first and refuses a non-empty output folder; provenance tied to versions; images rewrapped as image/webp; loadDemoPreview.
  - ui-builder: banner texts imported from errors.ts, no storage claim in the unreachable text, 10 s timeout, "Close the project to open the cached demo." hint, refresh after every paid call, panel lock while the demo is shown, verified thumbnail, demo fit status by hash at the check time.
  - Routing: src/lib/server/demoPack.ts to shop and release reviewers and shop-builder (tests/workflows.test.ts 175/175).
- Owner go 2026-10-29 for the free Redis steps, run 20:21–20:24 ET:
  - `ledger.py set-caps --project-usd 100 --daily-usd 5` on the real ledger: capProjectMicroUsd=100000000, capDailyMicroUsd=5000000 (lifetime spent 2247349, reserved 0).
  - `BUDGET_REDIS_IT=1 npx --no-install vitest run tests/budget-redis.test.ts`: 22/22 passed against Upstash (8 bucket races, exactly 7 of 20 each; count race exactly 5 of 20; ip cap behind a fresh visitor bucket; duplicate pending/settled/conflict; settle refunds only the difference; unknown keeps; released 429 keeps the count; double settle one OK one NOOP; over-reservation halt; missing lifetime and missing stored caps; invalid caps; bad_total; settle without marker; 48 h TTL on visitor/ip keys; totals read by a separate process).
  - `ledger.py selftest`: 16/16 passed. A SCAN afterwards found 0 `it-`/`selftest-` keys.
- Checks after the repair, 20:31 ET: typecheck, lint, npm test (885 passed, 24 skipped), build: all exit 0.
- `/review-changes` quick on the 20 repaired paths (shop, security, release, models, imaging, general): green, 4 minors. Adopted inline: set-caps values are required; contracts.ts comment corrected. Kept: settle.lua does not re-expire visitor/ip keys after 48 h (needs a reservation open for over 48 h); the allow lines are for the owner.
- PAL chat nim-nemotron35, two calls (reserve.lua, status.lua, budget.ts; paid.ts, http.ts, budget and health routes, proxy.ts), neutral prompts. About 25 points, none adopted: the per-visitor and ticket caps are bounded by config, and only the global caps need stored ceilings; corrupt fields fail closed on purpose; values above 2^53 cannot occur (amounts and caps are validated safe integers); a duplicate request ID is refused atomically and a new attempt needs a new ID (SPEC 5); unknown outcomes keep the money (SPEC 13); settle.lua checks the keys against the marker; day keys carry the day in their name, so TTL resets cannot carry a day over; cookie clearing is bounded by the IP bucket; x-vercel-forwarded-for is set by Vercel; the health and budget reason values are the SPEC design. Gemini was not asked.
- Paid demo fit check, owner go 2026-10-29 with TICKET_CAP_USD=2 and DAILY_CAP_USD=2 (the day already held $1.53 from T9, so $1 caps would have refused it). Live dev server with BUDGET_TICKET=T13, SEARCH_QUERY_RESERVE=16 and a random VISITOR_HASH_SECRET in the process env only. The owner worked in their Chrome on project 6be8cba2: tank step as head, bike corrected to "BMW R NineT" (2014–2016, ABS yes), example shop, illustrative gross prices (front wheel €890, rear wheel €990, tank paint €450; labor 180/180/120 min from the example shop; no product, no link, approval unknown), Check fit once.
  - POST /api/check 200 in 52 s, one call. Ledger: reserve and settle unknown, 370000 µ$ kept (T13 ticket 0.37 USD); lifetime 2.617349 USD booked (over-counted by the kept grounded reservations until the Billing reconciliation), no halt.
  - Results, all "verify", no sources cited: front and rear wheel (confidence 0.25: no manufacturer, part number or approval; rim, offset, axle, load, ABS ring, clearance to measure; Änderungsabnahme or Einzelabnahme as the inspector decides); tank (0.55: paint needs no parts approval; the colour entry in Zulassungsbescheinigung Teil I may need updating).
  - Owner as mechanic: all three marked reviewed; fee "Einzelabnahme wheels" (Einzelabnahme, €151.26 net, covers both wheels, confirmed); inspection review "Inspection fees were added"; folder saved 21:04 ET. Example-shop quote note set to "Part prices are illustrative examples, not real listings." (it said "y" before).
  - quote.pdf: 3 pages, complete estimate: net €2,909.24, VAT €552.76, gross €3,462.00 (lead recomputed every line); open findings marked as reviewed by the mechanic; example-shop label on every page. Known display detail for T17: "checked 2026-10-30" is the UTC date of the check, the estimate date is local (29 Oct).
- Pack, 21:09 ET: the owner's saved folder was copied to the session scratchpad with the PDF as quote.pdf (the results folder stayed untouched). Provenance only from the ledger: per version the instruction and edit calls (front wheel 1 instruction + 3 edits, rear and tank 1 + 1 each, T8 tickets, 2026-10-28 21:55–21:59 UTC); asset calls for identify, the first SAM call of each detection run, and the T13 fit check; prompt files identify.v1, instruction.v1, edit.v1 (commit 5220bf8, HEAD at render time) and fit-check.v1. `DEMO_PACK_SRC=… DEMO_PACK_OUT=public/demo DEMO_PROVENANCE=… npx --no-install vitest run tests/demo.test.ts -t "pack the owner"`: passed after the lead gave the env-gated test a 300 s timeout (38+ mask conversions exceed the 5 s default). Result: public/demo with project.json, v0–v3.webp, 52 mask PNGs, quote.pdf; 4.1 MB; 12 versions (4 images plus 8 sheet steps); the fresh-copy import in the test passed. The lead listed every published text: titles, fit texts, bike data, project name "Bike photo 2026-10-28 17:54"; no URLs, no names, no shop links. All images have rights "owner".
- Owner clearance 2026-10-29, about 21:12 ET: all 58 files in public/demo cleared after viewing v0–v3, quote.pdf and a contact sheet of the 52 masks (black and white part outlines only). Credit line "Photo and motorcycle: the project owner".
- Browser checks ($0, headless Chrome 156 over CDP, fresh profile in the session scratchpad, deleted afterwards):
  - Production build, `MODEL_API_KEY= next start` (health: demo_only, apiConfigured false; budget: liveEnabled false, spend null, reason live_disabled): demo card, View demo, the exact DemoBanner text, steps v0–v3, three "Verify fit"; Try editing twice gave two independent projects with part outlines from the PNG masks and the whole history. 165 requests, all to localhost: only GET /api/budget plus static /demo/ files and app assets; 0 other hosts, 0 page errors. With IndexedDB blocked: the demo still shows, Try editing is disabled with "Local storage is not available, so a copy cannot be made. You can still look at the demo.", 35 requests, only GET /api/budget.
  - At the cap with the key present (live dev server, BUDGET_PHASE=demo, DAILY_CAP_USD=0): GET /api/budget gives liveEnabled false, reason global_cap; a paid POST /api/identify with the cookie got 429 BUDGET_EXCEEDED with the exact SPEC text, without a cookie 403 "Reload the page to continue."; ledger entries 484 before and after, no halt, so no reservation and no Meta call. In development phase the same test reports project_cap ("Live AI is off"), because config clamps the ticket cap to the daily cap and the ticket bucket is checked first; the public demo phase uses the hard cap as ticket cap, so the daily text applies there.
  - Not finished: the headless demo-view run on the dev server at the cap. In Next dev, headless Chrome reloads endlessly ("[Fast Refresh] rebuilding" right after each HMR connect; about 33,000 log lines). It stops as soon as the browser disconnects and did not happen with the production build or in the owner's Chrome. Next attempt: block the HMR socket in the script (Network.setBlockedURLs), or check the demo at the cap in the owner's Chrome.

### Handoff — 2026-10-29 21:47 ET, T13 paused (start here next session)

- State: the T13 code is built, reviewed, repaired and checked (all offline checks green at 20:31 ET); public/demo is packed and cleared by the owner; the real Redis run passed. Nothing is committed yet, and the working tree holds all T13 changes plus public/demo.
- Open before the commit:
  1. Optional: the demo-view check at the cap in a browser (see above; the API evidence at the cap is recorded).
  2. `/review-changes` on public/demo (release-reviewer), tests/demo.test.ts (timeout line) and the TASKS.md changes.
  3. Rerun typecheck, lint, npm test and build.
  4. docs/api-evidence.md: T13 rows (fit check 0.37 booked; set-caps; real Redis runs; U06 note) and the ledger state.
  5. SPEC/TASKS text updates proposed by the plan check: SPEC 1 tree (budget/status.lua, src/proxy.ts, src/lib/demo.ts, src/lib/server/demoPack.ts), SPEC 4/9 DemoManifest now inferred from contracts.ts, SPEC 5 BudgetResponse.reason enum and the proxy as a second cookie issuer, SPEC 13 demo v0–v3 (owner extension) and masks loaded only on Try editing.
  6. T13 status line, files, duration, commit; ask the owner before pushing.
- Owner to add to .claude/settings.json allow: `Bash(npx --no-install vitest run tests/budget-routes.test.ts)`, `Bash(npx --no-install vitest run tests/demo.test.ts)`, `Bash(npx --no-install vitest run tests/check.test.ts)`, `Bash(npx --no-install vitest run tests/http.test.ts)`, `Bash(npx --no-install vitest run tests/budget-redis.test.ts)`.
- For T14: the stored ledger caps are $100 project and $5 daily (set-caps). Rerun set-caps only with explicit values. Switch BUDGET_PHASE=demo on Vercel only after the Billing reconciliation (the ledger over-counts kept grounded reservations: lifetime 2.617349 USD booked, Billing expected well below). spike/deployment.py should check the new manifest (snapshot images, masks, quote hashes) — not done yet.
- Scratchpad (session only, not in the repo): staged pack source and provenance JSON, mask contact sheet, CDP scripts and screenshots. The demo PDF is also in ~/Downloads as "dreambike-estimate-…-20261029 (1).pdf". The live dev servers are stopped.

### T13 resumed — 2026-10-30, from 02:13 ET

- The at-cap browser check found the Upstash free plan exhausted: every command fails with "ERR max requests limit exceeded. Limit: 500000, Usage: 500010" (PING still works). Cause: the headless dev reload loop of 2026-10-29 21:16–21:47 ET sent 20,000 GET /api/budget (dev log); each ran status.lua with about 24 commands, and Upstash counts commands inside scripts. The app failed closed (health accountingReady false, budget accounting_unavailable, spend null); no Meta call, no spend. Dev servers stopped at once.
- Owner decisions 2026-10-30: move the ledger to a new free Upstash database (the old one stays unchanged as evidence; lifetime re-initialized from the Meta Billing page); add quota protection to T13.
- Quota protection (platform-builder, lead repair): status.lua reads each bucket with one HMGET, 8 commands per read instead of about 24, same reply and validation; readStatus has a 10 s per-instance display cache (bounded at 500 entries, failures cached too, concurrent callers share one read, `cache: false` for fresh reads; never used by reserve or settle); GET /api/budget reads a fixed "new" visitor bucket for requests without a valid cookie, so cookie-less clients from one IP share one cache entry; GET /api/health is cached through accountingHealth. Tests: 25 requests with one cookie, and 25 without a cookie from one IP, each cause one EVAL in 10 s; outage cached; reserve never cached; cache bounded.
- `/review-changes` quick on the quota files, tests/demo.test.ts and all 58 public/demo files (shop, security, release, general): needs_lead with one unverified major and 6 minors. Lead decisions:
  - F1 (general, major: "no release-reviewer covers public/demo"): refuted. The release-reviewer ran in the same review, viewed v0 and the sign at 6x zoom, found no EXIF/GPS in v0–v3 or quote.pdf and raised minors only; the owner's per-file clearance is recorded above.
  - R1 (clearance sentence named only the photos): fixed. New sentence for every file: "Owner viewed and cleared every file on 2026-10-29: start photo and 3 AI steps (no people, no readable plate or VIN, no covers on the bike), part masks, estimate PDF (example shop, illustrative prices)". Repacked (the 201-character first try was refused by the schema, nothing written); only project.json changed, the other 57 files are byte-identical to the cleared ones.
  - R3 (PDF text not readable by the reviewer): the lead read the full text of all three pages earlier: no personal data; "illustrative" and "Verify fit" labels present.
  - F2 (budget route reads the Redis env with non-null assertions): no change; the route reads Redis only after config reports accounting configured.
  - Open for T14: SEC-1, a client that collects many signed cookies can still force one Redis read per cookie; add a per-IP rate limit or a Vercel firewall rule before the public deploy. For T15: R2, CREDITS/README note that background signage and trademarks in the photo are incidental and belong to their owners.
- SPEC notes added (tree rows for budget/status.lua, src/proxy.ts, demo files; DemoManifest from contracts.ts; reason enum; proxy as cookie issuer; 10 s display cache). docs/api-evidence.md: T13 ledger rows (set-caps, real Redis runs, the fit check, the quota incident), deviation rows, U06 note.
- Checks 02:28 ET: typecheck, lint, npm test (896 passed, 24 skipped), build, tests/workflows.test.ts 175/175: all exit 0.
- Waiting for the owner: new Upstash database (free, regional, eviction off) in .env.local, and the Meta Billing amount for `ledger.py init`. Then set-caps, the real Redis runs on the new status.lua, and the commit.
- Owner 2026-10-30: new free Upstash database in .env.local (regional, eviction off); Meta Billing reading $0.77. Lead, 02:29–02:31 ET (Redis only, $0): PING ok, DBSIZE 0; `ledger.py init --spent-usd 0.77 --confirm-reconciled`; `ledger.py set-caps --project-usd 100 --daily-usd 5`; phase:development booked at 770000 µ$ as well (all spend so far was development, so the $50 stop keeps counting it). Ticket and day totals start empty; the old database's per-ticket totals stay there as evidence.
- Real Redis on the new database: `BUDGET_REDIS_IT=1 npx --no-install vitest run tests/budget-redis.test.ts` 22/22 (now including the 8-command status.lua), `ledger.py selftest` 16/16; SCAN afterwards: only `lifetime` and `phase:development` keys, DBSIZE 2.
- Done-when (T13):
  - races cannot overspend: real Redis, exactly floor(cap/amount) of 20 concurrent per bucket and exactly 5 of 20 for a count limit;
  - a duplicate ID dispatches once: real Redis (pending, settled, conflict) and offline (no dispatch on DUPLICATE);
  - crash/timeout keeps the reservation: offline (unknown outcome for every non-429 error, failed settle keeps it) and real Redis (unknown keeps, no refund path);
  - missing Redis or lifetime key disables paid work: offline and real Redis; also seen live in the quota incident (failed closed, demo still served);
  - simulated deployment keeps the total: real Redis totals read by a separate process; the ledger was also rebuilt from Billing on a new database;
  - DST/ET: offline tests (Nov 1 25-hour day);
  - real atomic Redis exercised without Meta calls: both runs above, fetch limited to the Upstash host;
  - cached demo works at the caps and without the key: production build without MODEL_API_KEY in headless Chrome (demo, steps, Try editing twice, no-storage state) and, at a $0 daily cap with the key present, 429 with the exact SPEC text and no ledger entry; the demo is static and needs no Redis (the browser view at the cap in dev mode was not finished because of the dev reload loop);
  - static requests cause zero Meta calls: 165 and 35 requests, all to localhost (/demo/ files, GET /api/budget, app assets);
  - unknown query bounds keep grounded calls disabled: tests (blank or 0 SEARCH_QUERY_RESERVE gives FEATURE_DISABLED before any reservation);
  - public rights cleared by the owner: all 58 files, 2026-10-29;
  - no invented demo checks: the fit results come from the real 2026-10-29 check, provenance only from ledger entries and version dates.
- Files: budget/reserve.lua, budget/status.lua (new); src/lib/server/budget.ts, config.ts, http.ts, paid.ts, demoPack.ts (new); src/proxy.ts (new); src/app/api/budget/route.ts and health/route.ts (new), segment, identify, instruction, edit and check routes; src/lib/contracts.ts, types.ts, errors.ts, demo.ts (new); src/components/BudgetBanner.tsx, DemoBanner.tsx, DemoView.tsx (new), AppShell.tsx, ProjectList.tsx, Workspace.tsx; spike/ledger.py, spike/common.py; .env.example; tests/budget, budget-routes (new), budget-redis (new), http (new), demo (new), support/session (new), paid, config, contracts, images, masks, edit, check, spark; public/demo/ (58 files, owner-cleared); .claude/workflows/review-changes.js and fix-until-green.js (routing); SPEC.md notes; docs/api-evidence.md; TASKS.md.
- Spend: one grounded fit check (0.37 USD booked in the old ledger, real cost inside the $0.77 Billing total). Upstash: free plan; the old database's quota was exhausted by the dev loop, no charge.
- Duration: about 2 h 40 min (2026-10-29 19:31–21:47 ET, then 2026-10-30 02:13–02:35 ET), including the 39-agent build workflow, three lead repairs, three reviews, the owner's fit review and the browser checks.
- Not done, recorded: the Codex gate for the paid routes and spend protection (optional, owner's choice).
- Owner 2026-10-30: added the five allow lines (budget-routes, demo, check, http, budget-redis) to .claude/settings.json; go to push: 28e3855 pushed to origin/main.

### T14 — 2026-10-30, started about 13:00 ET (build-ticket workflow, lead fixes, live deploy in progress)

- Owner decisions 2026-10-30: Vercel dashboard import (no CLI); Hobby plan, team "n8n Grundlagen"; demo-only first, then one controlled live edit test, then the owner decides on live; second laptop available. The import screen proposed a multi-service project with spike/ as a Python service; the lead advised against it and the owner imported only the Next.js app. `.vercelignore` now excludes spike/ (Vercel docs: ignored files are neither uploaded nor served).
- `/build-ticket T14` (15 agents, 2 units, both approved in round 2; status needs_lead only because the live done-when items need the deploy):
  - A: spike/deployment.py rewritten for the current manifest (4 images, 52 masks, quote, 57 rights), per-route foreign-Origin 403 and limit+1 413 probes for all 7 POST routes (with a signed cookie, never a valid body), `--expect demo_only|live`, `--expect-composite on|off`, and a secret scan of '/', every same-origin /_next/static JS (lazy chunks followed) and the API responses; values are never printed.
  - B (SEC-1): src/lib/server/paid.ts per-instance quota limiters, keyed by IP HMAC, bounded at 2000 entries: GET /api/budget lets 4 distinct visitors per IP per 10 min read their own bucket, later ones read the shared "new" bucket (degrade, never deny); paid POSTs 10 per minute and 300 per day per IP before reserve, 429 RATE_LIMITED. Quota protection only, NOT a spend cap: reserve.lua stays the only spend control (CLAUDE.md, SPEC 13); a cold instance starts empty, and many distinct IPs can evict entries (S2; Upstash exhaustion fails closed, demo still works). Shared NAT: 10 paid POSTs per minute are shared by everyone behind one IP (F4); check during the live test.
  - Lead fixes after the gate: daily-limit message says "Try again later." instead of "in a minute" (F2); json_of catches invalid JSON; the scan labels say they compare local .env values only (F3/S1).
- Lead decisions: gate F1 (live items open) accepted, T14 stays in progress. SEC1-Q3 (two weak route assertions): the direct mayUseOwnStatusBucket unit test covers the same cases; no change.
- Consultant: PAL chat nim-nemotron35 (2 calls; first asked for more files). 8 points, none taken: (1) daily counter already counts every admitted attempt; (2) config.ts refuses live on a deployment unless BUDGET_PHASE=demo; (3, 7) full reservation on unknown outcome is SPEC 13; (4) origin and cookie are separate probes; (5) postAttemptDenied is synchronous, no interleaving; (6) Secure is set on https origins; (8) already reported as local-only coverage.
- `/review-changes` quick on paid.ts, deployment.py, .vercelignore: green (security, models, general), minors S1/S2 above.
- Checks 13:40 ET: npm run typecheck, npm run lint, npm test (904 passed, 24 skipped), npm run build, tests/paid.test.ts 20/20: all exit 0.
- Local production server (`next start`, LIVE_API_ENABLED=false): `deployment.py --expect demo_only` 26/26 with all four local secret values scanned; with COMPOSITE_ENABLED=false `--expect-composite off` 26/26 and `on` fails as it should (negative control).
- Live URL (assigned by Vercel): https://dreambike-pied.vercel.app. First run 2026-10-30 (demo-only env, no APP_ORIGIN, no VISITOR_HASH_SECRET, no key, no Upstash): 11 passed, 2 failed. The failures are the designed fail-closed state: without the visitor secret a deployment issues no session cookie (http.ts visitorSecret), so the route probes cannot run. Health demo_only and no-store, budget live off with spend null, all 58 demo files match, no secret values or names in 10 JS files (2.15 MB). Header x-vercel-id: iad1.
- Vercel docs (Functions limits, updated 2026-08-24): Hobby with Fluid compute 300 s default and maximum duration, 4.5 MB request body, 2 GB memory, default region iad1. Largest route body 3.55 MB (composite), longest maxDuration 120 s (edit): both inside. Dashboard readings pending.
- Next: owner sets APP_ORIGIN and a fresh VISITOR_HASH_SECRET and redeploys; rerun deployment.py; second-laptop check; then the live test steps (Billing reconciliation first).
- Owner pushed go: 123ab89 pushed. Owner set APP_ORIGIN and a fresh VISITOR_HASH_SECRET (generated by the owner, not seen by the lead; so the value scan cannot search for it, only for its name). A protection change briefly put production behind Vercel login (302 to vercel.com/sso-api); the owner set it back so the production URL is public. Rerun: `deployment.py --expect demo_only` 26/26 on the live origin (all 7 routes 403/413, the 413 comes from the app below the 4.5 MB platform cap).
- Owner check without login: Chrome on macOS and Safari on iPhone, both private windows: demo loads, steps v0–v3, estimate PDF, "Try editing" copies the demo into a local project and opens it (designed T13 behaviour), live off message shown.
- Live test (owner go each step): Meta Billing $0.77 = ledger 770000 µ$, nothing reserved, so BUDGET_PHASE=demo. Owner added the key, Upstash URL/token, PRICING_VERIFIED_AT, LIVE_API_ENABLED=true, DAILY_CAP_USD=1 (Production only; plain flags also on Preview, harmless: previews have no key, no Redis, VERCEL_ENV is not production, and need a login). Two redeploys failed closed first (accountingReady false, then one live condition missing in the Production values); fixed by the owner, no spend. Then `deployment.py --expect live` 26/26. One edit in the copied demo by the owner: SAM + instruction + edit, under 30 s (owner's timing), 0.013068 USD settled, nothing reserved, image ok; the owner accepted it (local only). Cap on the live site: DAILY_CAP_USD=0.01 gave reason global_cap and the denial message, ledger unchanged.
- Owner decision: live on the public site only on the judging days, $5 per day. New optional LIVE_FROM_ET/LIVE_UNTIL_ET (America/New_York days, inclusive) in src/lib/server/config.ts; malformed or half-set values turn live off; tests/config.test.ts 13/13 including the Nov 1 DST change and ET midnight edges (platform-builder; `/review-changes` quick green, no findings). Production values to set: DAILY_CAP_USD=5, LIVE_FROM_ET=2026-11-05, LIVE_UNTIL_ET=2026-11-09 (at most $25).
- U08 PASS recorded in docs/api-evidence.md and SPEC 14 (owner dashboard: Hobby, Fluid compute on, iad1, production on Node 22.x; the project default showed 26.x and the owner is asked to set it to 22.x). SPEC 3 lists the window variables. docs/submission.md (new) records the live URL, the live days, limits and what was checked.
- `/review-changes` quick on the docs (release, general): first needs_lead (F1: the window was stated as fact before deploy), fixed by marking it pending and citing the official participant page; rerun green with minors only. Commit 02914df pushed (owner go). The lead could not stage .env.example (a permission rule blocks commands naming .env files); the owner commits that one-file doc change.
- Owner set DAILY_CAP_USD=5, LIVE_FROM_ET=2026-11-05, LIVE_UNTIL_ET=2026-11-09; the push deployed 02914df (owner: newest production deploy is 02914df). Live site 15:00 ET: health demo_only, accountingReady true; budget live_disabled, daily cap 5000000 µ$; `deployment.py --expect demo_only` 26/26; ledger unchanged at 783068 µ$. Owner readings: Deployment Protection Vercel Authentication on, Standard Protection (previews need a login, production public); Node project setting changed from 26.x to 22.x.
- Done-when (T14):
  - build, lint, types, tests pass: yes (13:40 ET and after the window change: npm test 908 passed, typecheck, lint; build 15:00 ET);
  - `deployment.py --origin https://dreambike-pied.vercel.app` passes: 26/26 in demo-only (twice) and live mode;
  - cached demo opens without login on a second device: Chrome macOS and Safari iPhone, private windows (owner);
  - cap/disabled/composition-off: cap on the live site (global_cap at $0.01, denial message, no reservation), disabled on the live site (demo-only before the window), composite off on the local production build (the flag is reported per deployment);
  - key absent from browser source/network: secret scan 0 hits for all four local values and the names in 10 JS files and the API responses; the production VISITOR_HASH_SECRET is not known locally, only its name was scanned;
  - no input exceeds the bounded envelope: every route 413 at limit+1 from the app, all limits below the 4.5 MB platform cap;
  - a real edit fits the platform deadline: under 30 s against 120 s route and 300 s platform limits;
  - U08 recorded: PASS.
- Open: on 2026-11-05 check that /api/budget reports liveEnabled true and on 2026-11-10 false (T17/T18 or the owner); Codex gate for the public paid routes remains optional (owner's choice). For T15: README with the live URL and the live days from docs/submission.md.
- Spend: 0.013068 USD (one public live edit). Ledger lifetime 0.783068 USD.
- Duration: about 2 h (2026-10-30 13:00–15:05 ET), including the 15-agent build workflow, three quick reviews, the window unit and the owner's Vercel setup.


### T15 — 2026-10-30, about 19:00–19:45 ET (build-ticket workflow, lead scan and fixes)

- Owner decisions 2026-10-30: public name "Tom (GitHub TRock270), solo"; the studio reference photo is described neutrally in CREDITS, and the family detail and the shop name are removed from the current TASKS.md (T7 handoff lines). Older commits still contain them (owner item 6 in docs/submission.md).
- `/build-ticket T15` (11 agents, 1 unit "docs", release domain): approved in round 2 by release, security and general reviewers (round 1: 8 findings, all fixed with wording, e.g. point selection is offline/mock only (U01), the studio photo shows another motorcycle, the fit check found no citable source, the full ledger steps for live mode). Checks typecheck, lint, npm test 908 passed / 24 skipped. Gate needs_lead: F1 history identifiers and no recorded scan, F2 owner items incomplete, F3 the Oct 30 commit count in README.
- Lead fixes: README Oct 30 row no longer gives a count that T15 would break (F3); README disclosure also names NVIDIA Nemotron and Google Gemini as reviewers; a missing blank line in the live-mode section; docs/submission.md records the scan and the clean-export run and adds owner items 6–8 (history identifiers, second laptop, Billing limit and final spend) (F1, F2); CREDITS: quote.pdf date 2026-10-29 (exported 21:09 ET), v1–v3 each made from the step before, SAM License wording limited to what the license text says.
- History scan (scratchpad script, `.venv/bin/python`, prints names and counts only): working tree and all 661 blobs reachable from any local ref, plus commit messages. 0 hits for the values of MODEL_API_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN and the local VISITOR_HASH_SECRET (MUSE_MODEL hits are the public model name); 0 Bearer/sk-/ghp_/AKIA/PEM/Upstash-URL shapes (one .env.example hit was the regex spanning an empty value and the next line); no RULES.md sentence in history; no EXIF/XMP in public/demo images and no Info/XMP metadata in quote.pdf. Private paths: one blob of the owner's shop-link note exists only under local Codex checkpoint refs (refs/codex/turn-diffs/…), never in a commit; `git ls-remote origin` shows only main, and the blob is not reachable from origin/main. Identifiers: the shop name in old TASKS/PLAN commits (e.g. 27638c4) and the commit author email (owner item 6; no history rewrite).
- Clean-export run of the README steps: `git archive HEAD` into the scratchpad (git clone into the scratchpad was refused by the permission rules), no env files; `npm ci`, `npm run build` passed (that shell used Node 24.22; npm only warned about the engines range), `PORT=3155 npm start`: /api/health demo_only with accountingReady false, /api/budget live_disabled, / and /demo/project.json, v0, v3, quote.pdf 200, demo card rendered, POST /api/normalize 403. All public URLs in the T15 docs return 200.
- Consultant: PAL chat nim-nemotron35 on README.md and CREDITS.md (one call, files embedded). 28 points; taken: say plainly that the cached demo needs no variables or key (14–17), and state that the live path was tested during the event, because the public live window follows the deadline (19). Not taken: most points ask for evidence "a judge cannot verify", but the repository, lockfile and history are public (1–4, 9–10, 12–13, 21, 24); the before-Oct-27 row is meant to be "not claimed" (22); a pre-check disclaimer and a no-endorsement line are required by HACKATHON_GUIDELINES 3 (20, 26); the libvips LGPL note is a credit, it does not change the MIT scope of our code (27); studio photo permission is recorded by the owner in the consent addendum (5–7).
- `/review-changes` quick on the six T15 files after the lead fixes: green (security, release, general), two minors (studio photo photographer/date unknown; the $0.013 figure, which matches the 0.013068 USD in the T14 log).
- Checks 19:41 ET: npm run typecheck, npm run lint (no errors), npm test 908 passed / 24 skipped, git diff --check clean.
- Done-when (T15):
  - another reader can run the cached demo using README: yes, clean export without env files (above); the owner's second-laptop run is owner item 7;
  - no fake URL or unbuilt feature is claimed: yes (gate met; video marked pending T16; not-built list in README);
  - source photos/consent/RULES.md remain private: yes (gate met; scan above);
  - current files and full history checked for secrets and identifiers without printing values: yes (scan above); identifiers in history await the owner's decision (item 6);
  - public asset credits have real photographer/date/rights: yes (CREDITS photo table; the studio photo is private, its photographer and date are unknown);
  - owner checks official rubric and required fields: open, owner item 1;
  - missing owner decisions listed precisely: docs/submission.md items 1–8.
- Files: README.md, LICENSE, docs/demo-script.md (new); CREDITS.md, docs/submission.md, .gitignore, TASKS.md.
- Spend: $0.00. No paid calls.
- Duration: about 0.75 h (19:00–19:45 ET), including the 11-agent build workflow and the 3-agent quick review.
