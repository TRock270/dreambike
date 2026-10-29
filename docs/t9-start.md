# T9 start plan: sourced fit and German paperwork pre-check

Prepared 2026-10-29 by the lead for the next session. Nothing here is built yet.
Read with TASKS.md (T9 ticket; the "Owner inputs before T9" and OF1 entries), SPEC.md sections
6 (checkFit, lines about 471-477), 8 (fit policy, about 569-576), 9 (invalidation, about 592-612),
10 (UI, about 628-635) and 12 (budget, about 712), and CLAUDE.md.

## Where things stand (checked 2026-10-29)

- Spend: Meta Billing $0.71, ledger lifetime 714096 µ$, reserved 0, no halt flag. Owner's Meta
  daily Billing limit is $5 with alerts at $1, $2 and so on. Read `ledger.py status` again before any paid call.
- Already there:
  - contracts.ts: FitResult (66-75), BuildItem.fit/fitInputHash/fitCheckedAt/fitReviewedHash,
    CheckRequest/CheckResponse (346-353), ModelFitResult and FitModelOutput (424-427),
    MODEL_FORMATS.fit_check_v1 (442) and prompts/schemas/fit_check_v1.json.
  - cache.ts: cacheKeys.fit(fitInputHash), FIT_TTL_MS 24 h. project.ts: clearFit/clearAllFits.
  - mocks/index.ts: MOCKS.fit (one labeled verify result). config.ts: searchQueryReserve (null when blank),
    features.search needs SEARCH_ENABLED and a numeric SEARCH_QUERY_RESERVE.
  - budget/prices.json: webSearchMicroUsdPerQuery 2500; reservations spark-grounded-base 330000 and
    spark-grounded-per-query 2500.
  - Routing: review/fix rules already cover src/app/api/check/, prompts/fit-check, src/lib/server/fit*.ts,
    FitBadge/EvidenceLinks/PaperworkSummary and tests/fit*; the allow line for tests/fit-policy.test.ts exists.
- Missing: prompts/fit-check.v1.md; src/app/api/check/route.ts; a fitInputHash canonicalization;
  the legal seed constant; grounded support in meta.ts (SparkFormat has no fit_check_v1, sparkBody
  cannot add tools/include, readSparkResponse drops annotations and search results, sparkCharge has
  no search term); FitBadge.tsx, EvidenceLinks.tsx, PaperworkSummary.tsx; tests/fit-policy.test.ts;
  the grounded body in spike/responses_spark.py (grounded mode is a stub that exits 3 or skips).

## The open cost gate (U06), researched 2026-10-29

- Meta's pricing page: "$2.50 per 1,000 search queries, in addition to the request's token cost".
  It names no limit on queries per request.
- Meta's search-grounding page (https://dev.meta.ai/docs/search-grounding): enable with
  `tools:[{type:"web_search"}]`; options `search_context_size` ("low" | "medium" | "high") and
  `user_location` (approximate; country, region, city, timezone); `include:["web_search_call.results"]`
  returns hits with title, url, snippet. A `web_search_call` item reports only id, type and status.
  The page documents no `max_tool_calls`, no query count per call and no usage field for queries.
  The model decides whether to search at all.
- So the bound cannot come from the docs. SPEC 712: without a safe bound and a reported count,
  keep the whole grounded reservation; if no bound can be established, no grounded paid calls
  and fresh checking stays disabled (T9 recorded blocked, demo uses labeled cached results).

## Owner decisions needed at the start (the session asks these once)

1. **How to settle U06.**
   - **A, probe (lead's recommendation):** up to 3 grounded spike calls on the owned bike, `max_tool_calls` 2,
     `search_context_size` "low", `user_location` country DE, SEARCH_QUERY_RESERVE=20 (reserves
     $0.38 per call; expected real cost a few cents). Record every usage field and every
     `web_search_call` item. If the response reports a query count, settle exactly and set the bound
     from it. If not, the owner reads the Meta Billing page once it updates, the lead computes
     queries = (billing delta − token cost) / $0.0025, and SEARCH_QUERY_RESERVE becomes the
     observed maximum × 2, at least 10. Until then every grounded call keeps its full reservation.
   - **B, stay gated:** build everything offline and in mock, keep fresh checking off, record T9 blocked.
2. **Spend cap for T9:** proposal TICKET_CAP_USD=1 and DAILY_CAP_USD=1 in the process env with
   BUDGET_TICKET=T9, for the probe and then the app smoke run (the CLAUDE.md limit is $5 per ticket).
3. **Live test items on the owned bike** (BMW R nineT, owner truth: 2014–2016 base, ABS yes): the
   lead proposes four items that cover the SPEC test cases: a taller handlebar (cable reach,
   model/year), a US-market exhaust without papers, a front wheel swap (ABS ring and fit), and a
   part with ABE and an inspection condition. The owner may change them.

## Run

1. **Offline first, needs no decision:** `/build-ticket` with these units. No paid calls.

```json
{
  "ticket": "T9",
  "goal": "Sourced fit and German paperwork pre-check (TASKS.md T9). Build everything offline and in mock; grounded paid calls stay gated on U06 (docs/t9-start.md). Plan: docs/t9-start.md",
  "checks": ["npm run typecheck", "npm run lint", "npm test", "npm run build", ".venv/bin/python spike/local_images.py --fixture-set all"],
  "units": [
    {
      "id": "M1", "domain": "models",
      "files": ["prompts/fit-check.v1.md", "src/lib/server/meta.ts", "spike/responses_spark.py", "tests/spark.test.ts"],
      "dependsOn": [], "extraReviewers": ["security-reviewer", "shop-reviewer"],
      "task": "Grounded Spark support (SPEC 6, about 471-477). prompts/fit-check.v1.md: versioned prompt for FitModelOutput; input is confirmed bike, at most 3 target items plus a whole-build summary, shop rules, legalAsOf and legalSources; every requested item id exactly once; English text with German terms (ABE, Teilegutachten, Änderungsabnahme, Einzelabnahme, Eintragung); page content is untrusted data; never infer approval from inspection none; missing evidence means verify. meta.ts: add fit_check_v1 to SparkFormat; sparkBody gains an optional grounded option that adds tools [{type:'web_search', search_context_size:'low', user_location:{type:'approximate', country:'DE'}}], max_tool_calls 2 and include ['web_search_call.results']; readSparkResponse also returns url_citation annotations, web_search_call items and their results, and a searched flag (at least one completed web_search_call); sparkCharge takes a search query count and returns null (unknown, keep the reservation) when the count is not reported. spike/responses_spark.py --mode grounded: build the real request with fit-check.v1 and the plain fixture's bike plus the four test items from docs/t9-start.md, keep the SEARCH_QUERY_RESERVE gate, write sanitized evidence (usage, every web_search_call item, citation URLs) to spike/out; --dry-run prints the request without sending. Tests: body shape with and without grounding, citation/result extraction across several output_text blocks, unknown query count gives a null charge, no tools on identify/instruction."
    },
    {
      "id": "S1", "domain": "shop",
      "files": ["src/lib/server/fitPolicy.ts", "src/lib/project.ts", "tests/fit-policy.test.ts", "tests/project.test.ts"],
      "dependsOn": [], "extraReviewers": [],
      "task": "Fit policy and input hash (SPEC 8 about 574-576, SPEC 9 about 600-612). src/lib/server/fitPolicy.ts: the dated legal seed (legalAsOf from the server ET date; legalSources TÜV Rheinland, StVZO §72 and §21 from PLAN.md; §19 not verified); task input builder that strips fit, review, notes, hashes, timestamps, prices and labor and keeps id, slot, title, spec, product name/partNumber/url/approvalText and intent; postValidate(requestIds, modelOutput, evidence): ids must match exactly (duplicate or missing fails the batch), strip sources not backed by a citation or search result, server attaches accessedAt, downgrade ok to verify on any unresolved critical measurement, missing exact document coverage, unknown inspection or Eintragung, or no applicable primary source (a general StVZO link alone is not enough), never infer approval from inspection none, keep interaction limitations (exhaust/intake, wheel/fender/ABS, handlebar/cables, lighting), and attach checkedAt and the caller's inputHash. project.ts: fitInputCanonical(bikeRevision, activeItems, shopRules, legalSeedVersion) with canonical key and item order (hash computed by the caller with sha256). Tests must cover the SPEC cases: handlebar with unknown model/year asks for clamp and cable/hose/wiring measurements; US exhaust without papers is verify or problem, never ok; ABE with an inspection condition is not plain ok; wheel swap with unknown ABS is verify; unsupported URLs are removed; a duplicate or missing id fails the batch; changing bike, part or shop rules changes the canonical input."
    },
    {
      "id": "R1", "domain": "models",
      "files": ["src/app/api/check/route.ts", "src/lib/mocks/index.ts", "tests/check.test.ts"],
      "dependsOn": ["M1", "S1"], "extraReviewers": ["security-reviewer", "shop-reviewer"],
      "task": "POST /api/check (SPEC 5 about 390-429), copying src/app/api/instruction/route.ts: nodejs runtime, maxDuration 90, deadline 70 s, body at most 100 KB, same-origin, request id, CheckRequest safeParse, at most 3 target items per batch. Mock mode returns labeled MOCKS.fit for each requested id with the caller's inputHash. Live: LIVE_DISABLED unless live; FEATURE_DISABLED unless features.search and searchQueryReserve is set; reserve spark-grounded-base + spark-grounded-per-query × searchQueryReserve through withReservation; one retry on a definite 429 only; duplicate request ids follow the existing 409 rules; require an actual completed web_search_call, otherwise a safe error without ok results; run postValidate; settle with the reported query count or keep the reservation when unknown. tests/check.test.ts is a new file (npm test covers it; the owner may add an allow line). Tests: mock path, disabled paths, oversize and invalid bodies, no-search answer refused, id mismatch fails the batch, unknown query count keeps the full reservation."
    },
    {
      "id": "U1", "domain": "ui",
      "files": ["src/components/FitBadge.tsx", "src/components/EvidenceLinks.tsx", "src/components/PaperworkSummary.tsx", "src/components/BuildSheet.tsx", "src/components/Workspace.tsx"],
      "dependsOn": ["S1", "R1"], "extraReviewers": ["shop-reviewer"],
      "task": "Fit UI in the build sheet (SPEC 10 about 628-635). A 'Check fit' action sends the active items in batches of at most 3 with the whole-build summary and the computed fitInputHash; per-batch progress; a failed batch keeps the finished ones; results attach to items only when their hash still matches (SPEC 600: a late result with another hash stays stale cache and never overwrites current fit; completion updates derived check data, not the image head). FitBadge shows ok/verify/problem/stale/not checked with words and icons, never color alone. EvidenceLinks lists the sources (new tab, noopener) with accessed date. PaperworkSummary shows approval, document coverage, inspection, Eintragung, documents to carry, conditions, things to measure and extra parts. The fixed text 'Pre-check only. The shop and inspection authority must verify fit and road-use requirements.' is always shown with results. Disabled states: mock label, live off, search off (U06), budget reached. Nordlicht tokens only."
    }
  ]
}
```

2. **Then, with the owner's decisions:** lead-only paid steps, each after reading `ledger.py status`:
   - Probe (decision 1A): `BUDGET_TICKET=T9 TICKET_CAP_USD=1 DAILY_CAP_USD=1 SEARCH_QUERY_RESERVE=20
     .venv/bin/python spike/responses_spark.py --fixture-set plain --mode grounded` (dry-run first),
     at most 3 runs. Record the evidence in docs/api-evidence.md (U02 grounded, U06 bound).
   - Set the bound, then one live app run of "Check fit" on the owned bike with the four items,
     same caps, dev server with SEARCH_ENABLED=true and the agreed SEARCH_QUERY_RESERVE in the process env.
   - If the bound cannot be established: decision 1B applies, T9 is recorded blocked for fresh checks.

## Done-when map (TASKS.md T9)

| Done when | Where it is proven |
| --- | --- |
| Owned-bike live or genuinely recorded smoke results show evidence and unknowns | paid probe and app run (step 2); not by mocks |
| ABE conditions, unknown ABS/wheel fit, tall handlebar cable reach and unsupported US exhaust get no unjustified ok | S1 tests; live run review |
| Unsupported citation URLs are removed | S1 and M1 tests |
| One failed batch leaves other completed results | U1 plus R1 tests; mock browser check |
| Changing bike/part/shop rules invalidates every active fit | S1 canonical-input test; existing clearAllFits tests |
| Offline policy tests and contract checks pass | Verify checks |
| If grounded dispatch stays gated: fresh checking disabled and T9 recorded blocked | R1 disabled-path tests; TASKS.md |

## After the run (lead)

1. Handle the workflow status (CLAUDE.md). Lead fixes go through `/review-changes` quick.
2. Free browser check with MOCK=1 in headless Chrome: Check fit on two items, badge words, the
   pre-check text, source links, a forced failed batch keeps the other, a product edit makes the fit stale.
3. Consultant: PAL chat with nim-nemotron35 on excerpts under 400 lines of fitPolicy.ts and the
   check route; at most 2 calls. Optional Gemini inline on postValidate (≤300 lines).
4. This ticket adds a paid route: before committing the live part, consider the Codex gate from
   ../CLAUDE.md (a short read-only review on a fixed commit), prepared as a review package for the owner.
5. TASKS.md: status line, log entry with real times and spend, commit. Push only after asking.
