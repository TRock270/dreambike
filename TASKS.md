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

- Status: IN PROGRESS. Offline part done 2026-10-27; live profiles blocked on U09 fixtures/consent and U06 ledger (see log).
- Priority: MVP. Estimate: 3h, split Oct 27/28. Depends on: none.
- Files: budget/reserve.lua/settle.lua, spike/requirements.txt, common.py, run_all.py, responses_sam.py, responses_spark.py, images_edits.py, asr_transcribe.py, files.py, local_images.py, deployment.py; docs/api-evidence.md; fixtures/expected.json locally; .gitignore; PLAN.md 7.2 status references.
- Work: inspect installed Python/Node and package availability; record package sizes before installing >1MB packages; obtain owner fixture/consent/Billing inputs; implement the command contracts in SPEC 12; create the shared atomic reserve/settle policy and connect the cost ledger before paid dispatch. Start with one owned baseline. Test concept, off-origin point, identify JSON, text edit, and owned reference. Visit all five fixture input cases with local tests. Grounded checks wait for U06 billing bounds. Files and ASR remain opt-in.
- Done when: the venv setup works; `python spike/local_images.py --fixture-set all` reports real pass/fail/skips; core commands from SPEC 12 produce saved private overlays and sanitized evidence; U01–U06 have explicit results or a blocking reason/fallback; total ticket spend is at most $5. The owner can see the mask landing correctly on an off-origin part. No guessed mask placement or fabricated API pass is accepted. If a core gate fails, stop that dependency and report it; scaffold can continue in mock mode.

## T1 — Scaffold, contracts, configuration, and offline mocks

- Priority: MVP. Estimate: 2h, Oct 28. Depends on: T0 contract findings; paid failures do not block offline scaffold.
- Files: package.json/lock, Next/TS/ESLint/PostCSS/Vitest configs, src/app/layout.tsx/page.tsx/globals.css, src/styles/tokens.css, src/lib/contracts.ts/types.ts/errors.ts/slots.ts, src/lib/server/config.ts/meta.ts boundaries and budget.ts wrapper for the shared Lua files, src/lib/mocks/, .env.example, tests/contracts.test.ts.
- Work: create the chosen stack without overwriting planning files; generate all declared schemas/types and safe flags; implement server-only boundary and mock response dispatch; add original native controls and Nordlicht tokens. No paid API calls from mock mode. A live server handler must use the already-tested shared atomic budget policy before its first dispatch; no temporary uncounted path. Collect any >1MB install approvals with concrete sizes first.
- Done when: `npm run dev` opens the shell; `npm run build`, `npm run lint`, `npm run typecheck`, and `npm test` pass; MOCK=1 shows a visible mock label; production rejects MOCK=1; no MODEL_API_KEY value or server import enters the client bundle. Schemas validate representative success/error fixtures and reject unexpected fields. All colors live in tokens.css.

## T2 — Photo import, preflight, normalization, and upload notice

- Priority: MVP. Estimate: 2h, Oct 29. Depends on: T1.
- Files: src/components/UploadDropzone.tsx/UploadNotice.tsx/ImageCanvas.tsx, src/app/api/normalize/route.ts, src/lib/server/images.ts, browser image adapter, tests/images.test.ts, spike/local_images.py.
- Work: owned-photo notice; MIME/signature checks; client orientation-aware bounded WebP; server decode/EXIF/sRGB/metadata stripping; dimensions/hash; HEIC rejection; low-resolution warning. Enforce actual total body bytes.
- Done when: all five input cases are visibly handled; EXIF fixture agrees across browser/Pillow/sharp; HEIC shows the exact JPEG export message and makes zero Meta calls; corrupt/animated/over-limit cases do not 500; a large source is reduced before upload; normalized image is <=2048 px and <=1,250,000 bytes. Run image tests, build, and types. Record U05 evidence.

## T3 — Bike cutout, part map, and point selection

- Priority: MVP. Estimate: 3h, Oct 29. Depends on: T2 and U01 resolved for mask display.
- Files: src/app/api/segment/route.ts, src/lib/server/meta.ts/images.ts, src/lib/coordinates.ts/slots.ts, src/components/PartOverlay.tsx/PartSelector.tsx, tests/coordinates.test.ts/masks.test.ts.
- Work: exact SAM SSE body/parser; full-image binary mask adapter; cutout; core phrase queue at concurrency 4; fixed colors; front/rear by facing; smallest-mask hit test; point fallback; manual custom name. All live calls use the Node wrapper over the same atomic policy created in T0/T1. Public visitor hardening and demo integration arrive in T13; local accounting already enforces project, development, ticket, and day caps.
- Done when: a wheel click highlights its real pixels; letterboxed clicks land within 3 px at two canvas sizes; zero matches is an empty state; merged wheels use point selection; a >60% bike mask is rejected as a part but accepted in cutout mode; queue never exceeds 4; partial results remain usable. Tests cover SSE byte splits, confidence records, half-open borders, and dimension mismatch. No stale/wrong-image mask is clickable.

## T4 — Bike confirmation and edit instruction

- Priority: MVP. Estimate: 2h, Oct 30. Depends on: T3 and U02 identify/instruction profiles.
- Files: prompts/identify.v1.md/instruction.v1.md/paint.v1.md/compose.v1.md, src/app/api/identify/route.ts/instruction/route.ts, src/lib/server/meta.ts, src/components/BikeConfirm.tsx/DescribeForm.tsx/PaintForm.tsx.
- Work: exact Spark text.format schema; editable one-panel bike ID; allow unknown ABS/year/facing; instruction preview and geometry intent; paint-only engine/frame. Model response traversal handles reasoning/tool items before message output.
- Done when: manual bike data can be entered before ID finishes and is never overwritten; text/paint requests return validated English instruction/title/spec; fork/wheel replacement and taller bar intent is geometry; missing bike details become limitations; malformed/incomplete/refused responses are safe errors. Run contract/type/build checks and the cached smoke profiles; only force a paid rerun if needed.

## T5 — One render, compositing, drift, and preview acceptance

- Priority: MVP. Estimate: 3h, Oct 30. Depends on: T4 and U04 edit profile; U01 for composition.
- Files: src/app/api/edit/route.ts/composite/route.ts, src/lib/server/meta.ts/images.ts, src/components/ProgressStatus.tsx/EditReview.tsx/BeforeAfter.tsx, tests/composite.test.ts.
- Work: single-shot JSON edit; no mask field; one render per click; bounded result cached before new masks; selected-slot SAM refresh; local composite route with exact dilation/feather/drift; clear full-image fallback. Implement the staged progress UI and manual resume after a mask/composite failure.
- Done when: paint preview changes the target; protected pixels outside feather support match base; drift >0.05, wrong aspect, small result, missing mask, geometry, and disabled composition all take the documented full-image path; no retry of segment/composite repeats generation; duplicate request IDs cannot dispatch twice; all fallback badges display. Run image math tests plus one budgeted live visual review if a valid cached result is unavailable. Record U04 findings, not a claimed performance number.

## T6 — Durable local projects and history tree

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
- Still open for U06: owner reconciliation, then `ledger.py init`, PRICING_VERIFIED_AT, and the per-request search bound before grounded calls.
