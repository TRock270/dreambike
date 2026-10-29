# DreamBike API and spike evidence

Sanitized results only: field structures, status codes, counts, timings, and costs. No keys, Authorization headers, data URLs, photos, prompts, model outputs, consent records, or raw request/response dumps. Private artifacts stay in the gitignored `spike/out/`.

Evidence levels used below:

- **Doc**: read in primary documentation or package source. Shows syntax, not account behavior.
- **Offline**: our own code checked locally without any Meta call.
- **Live**: an actual call on this account. This is the only level that resolves a U-gate.

## Status summary

Last updated 2026-10-27 23:55 ET (T0 session 1). **Paid calls so far: none. Spend recorded by DreamBike: $0.00.** The shared ledger isn't configured yet, so no paid dispatch is possible.

| Gate | Status | Evidence so far | What resolves it |
| --- | --- | --- | --- |
| U01 SAM mask placement | PASS for concept masks (box-sized and downscaled), owner-checked 2026-10-28; point clicks still open (refused live before any reservation) | Owner 2026-10-28: "the detected parts are fine". Live smoke 2026-10-28 on plain-wall-right: concept "wheel" gave 3 masks with maskSize equal to bounds (box_sized), front [1461,810,1826,1224], rear [394,753,821,1181] (expected target box [394,750,822,1182]), and the red car's wheel [225,675,427,854]; Claude saw them land on the parts in overlay-wheel.png. Concept "motorcycle" and the rear-hub point click returned masks larger than 1024 px downscaled to fit bounds (1024×702 for 1431×981; 1024×808 for 1539×1214), placement "other". The point click gave the whole bike area at confidence 0.45, not the rear wheel. "giraffe" gave zero objects. Earlier: Doc + Offline: the parser 0.1.0 README record decodes to a 60×27 raster for a 60×27 box, which means box-sized and box-relative. The parser normalizes inclusive `x2/y2` to half-open `right/bottom`. Our adapter raises MASK_PLACEMENT_UNKNOWN until a mode is verified. Update 2026-10-28 13:47 ET (T3 ticket, $0.010, 4 SAM calls, `responses_sam.py --mode concept/points --force`): "motorcycle" again 1024x702 for box [394,241,1825,1222) (1431x981); drawn by a nearest-neighbour upscale to the box; owner: "looks good". Point click: 1024x808 for [285,7,1824,1221), the whole bike at confidence 0.45; placement looks aligned but no owner OK and the content is wrong, so points stay off (VERIFIED_SAM_POINTS=false). App: VERIFIED_SAM_PLACEMENT = "box_relative", VERIFIED_SAM_DOWNSCALED = true. Note: this run, like the T0 smoke, sent the photo with the tank cover square; from now on common.fixture_image refills on-bike covers before every spike upload (owner rule). | Owned off-origin concept and point overlays (`responses_sam.py --mode concept/points`), checked by the owner; TypeScript repeat in T3 Note T3 2026-10-28: the app first refused live segmentation (VERIFIED_SAM_PLACEMENT = null); since the 13:47 ET update it allows concept masks and refuses only point clicks before reserving. |
| U02 Spark strict JSON with image and with web_search | PARTIAL (image JSON live; grounded JSON live 1 of 3, see T9 probes) | T9 probes 2026-10-29 12:05–12:20 ET (`responses_spark.py --mode grounded`, text only, no image): the request with tools [{type web_search, search_context_size low, user_location approximate DE}], max_tool_calls 2 and include [web_search_call.results] was accepted (HTTP 200; max_tool_calls is echoed in the response). Output order: reasoning, message (a one-sentence preamble), web_search_call, web_search_call, reasoning, message (the JSON answer). Joining every output_text broke the JSON in probe 1; the answer is the last message item (meta.ts and the spike fixed). Probe 2: strict fit_check_v1 JSON, ids match, no problems; handlebar verify (clamp, cable/hose reach, throttle type), US exhaust problem, front wheel verify (ABS ring, axle, spacers), all approval/coverage/inspection/Eintragung unknown, no sources claimed. Probe 3 (ABE part): status incomplete, output 4096 of 4096 tokens (3941 reasoning) after both searches, no answer. url_citation annotations: 0 in all three; web_search_call results came back through include (1–12 hits per call). Earlier: Live smoke 2026-10-28: identify, text instruction and paint instruction returned HTTP 200 with parsed strict JSON and no problems (about 20–22 s each). Identify: BMW R nineT, 1170 cc boxer, right-facing, 2014–2023, ABS unknown, confidence 0.95 (owner truth: 2014–2016 base, ABS yes). Earlier: Request bodies built and shape-checked in dry run; schemas in `prompts/schemas/` | Live identify and instruction profiles; grounded profile after U06 |
| U03 Account models, quotas, image sizes | PARTIAL (live 2026-10-28) | sam-3.1, muse-spark-1.3-contributor and muse-image-1.0 all answered. Rate-limit headers: 150 requests and 3,000,000 tokens per window. Edit of a 2048×1536 base returned 1792×1344 WebP (aspect difference 0.0) with VP8X and XMP chunks. | First live profiles record model access and rate-limit headers |
| U04 Edit quality, latency, drift | PARTIAL (owner approved both live edits 2026-10-28; drift not measured) | Paint edit 2 2026-10-28 (candy red, owner's request): HTTP 200 in 8.1 s; Claude's look: tank glossy candy red, roundel and lower "nineT" panels kept, but the upper brushed-aluminium tank inlay was painted red too, and the model kept the dark cover patch although the instruction said to paint over it. A local harmonic fill of the patch from the surrounding red (no model call) hides it well. Owner review of the red edit open. Paint edit 3 2026-10-28 (owner: remove the square first): base with the square refilled from its edge pixels, Claude-written edit prompt that names the silver tank area to keep; HTTP 200 in 10.0 s; Claude's look: candy red tank, no square, roundel, silver tank area and lower panels kept, rest of scene unchanged; the "nineT" lettering is slightly garbled. Owner 2026-10-28: paint edit "fine"; compose front wheel "great", rear wheel unchanged as expected. Live compose 2026-10-28 (T7, owner go, $1 cap): base plain-wall-right plus the owner-cleared front-wheel reference crop, HTTP 200 in 9.0 s, 1792×1344 WebP with XMP; Claude's look: front wheel replaced by a gold multi-spoke wheel with chrome hub in matching size and position, rear wheel unchanged (the spike sends only the front reference), rest of scene looks unchanged, but the front brake discs are mostly hidden or gone behind the new spokes (a fit/brake point for T7, not a pass); drift not measured. Live smoke 2026-10-28: high paint edit (tank matte olive) HTTP 200 in 11.9 s; Claude's look: tank recoloured, roundel and side panels kept, rest of scene looks unchanged; drift not measured (no target mask from the points profile). Resize deviation accepted by the owner 2026-10-28. Earlier: Offline: composite and drift math with all 7 fallback reasons; TypeScript port matches spike/imaging.py (dilation exact, feather ≤1 step, drift within 1e-9, blend ≤1 step) on identical inputs. Observation (T5 mock): grayscale drift misses a hue-only global shift (sharp modulate hue 35°, saturation 1.3 composited with drift < 0.05); review real renders for colour casts outside the part. Deviation for owner decision: the browser resizes the render to the base size with canvas smoothing, not Lanczos3 (SPEC 7). T7 app run 2026-10-28 (reference mode, Muse Image with base first and reference second): 7 renders in 14–28 s each, all 1792x1344 for a 2048x1536 base. compose.v1 dropped the front brakes in 3 of 3 renders; v2 kept disc, caliper and fender (owner accepted); v2 dropped the rear swingarm and final drive; v3 kept them on the second try (owner accepted). Drift is not measured because geometry edits take the full-image path. | Live `images_edits.py --mode edit` plus owner before/after review; live app render with BUDGET_TICKET=T5 |
| U05 EXIF, byte envelopes, HEIC | PARTIAL (Chrome + server done; Safari and deployed envelope open) | T2 2026-10-28: real headless Chrome 156 (CDP) through the actual dropzone: owner Orientation-6 JPEG → 1536×2048, mean abs diff vs Pillow 4.21 (180° reference 84.71); real HEIC → exact message, 0 /api/normalize requests. Server (sharp): owner Orientation-6 JPEG 1600×1200 → 1200×1600; Pillow-vs-sharp vitest on owner JPEGs mean diff <4; HEIC (signature or real MIME) → 415 with exact message; APNG/animated, corrupt, >40 MP, >1.30 MB body → distinct 4xx, never 500. Offline: 5 owner HEICs rejected by signature; synthetic checks in local_images.py | Owner Safari check; owned exif-rotated fixture (U09); deployed envelope (T14) |
| U06 Search query bound and durable accounting | PARTIAL (atomic ledger verified; query count not reported) | T9 probes 2026-10-29: usage has only input_tokens, cached_tokens, output_tokens, reasoning_tokens and total_tokens, with no search or query count. Every probe made exactly 2 web_search_call items, each with one `action.query`. Token cost per probe from usage: 1764, 1697 and 2017 µ$. Each probe kept its full 380000 µ$ reservation (charge unknown). Expected Billing: 5478 µ$ tokens + 2500 µ$ × queries (6 if one query per call), so about $0.02 for all three. Waits for the owner's Billing reading. Earlier: Live Redis 2026-10-28: Upstash (regional, eviction off); `ledger.py selftest` 8/8 passed against the real reserve.lua/settle.lua, including a concurrency cap and fail-closed cases; selftest keys deleted afterwards. Owner reports a $50 Meta Billing limit (2026-10-28). Billing reconciled at $0.01; lifetime total initialized at 10000 µ$. Pricing compared with the live page 2026-10-28, all values match (see Pricing check); owner reviewed it and set PRICING_VERIFIED_AT 2026-10-28T07:47:28-04:00; readiness pricing_verified=true | Documented per-request search bound before grounded calls (grounded and Files stay disabled) |
| U07 Shops, product sources, fetch | UNVERIFIED (owner shop list provided 2026-10-29) | Owner domains provided 2026-10-29 in the local, gitignored shop-links.txt (18 shops, first and second choice; see TASKS T12). Not yet tested (T12, optional) | Owner domains, T12 tests |
| U08 Vercel project limits | UNVERIFIED | None | T14 |
| U09 Fixtures, bike truth, consent, identifiers | RESOLVED (owner-confirmed 2026-10-28) | 2026-10-28: 5 fixtures built from the owner's photos, with people, third-party plates and reflections covered and metadata stripped (TASKS T0 session 3); `local_images.py --fixture-set all` 40/40 including all 5 fixture checks; bike truth owner-confirmed (BMW R nineT 2014–2016, ABS yes); owner confirmed no people and no readable plates (identifiersReviewed and noPeople true); owner saved the private consent record in `consent/` (Claude hasn't read it) and consentRecord points to it | Paid calls still check per fixture through `require_rights`; CREDITS.md lists the photos in T15 |
| U10 Shop values, legal applicability, submission details | UNVERIFIED | Package-size approvals recorded below | Owner and mechanic review |

## Environment (2026-10-27)

- macOS 27.0.1, arm64 (M1).
- Python 3.11.16 from uv (`python3.11` isn't on PATH), venv at `.venv/`.
- Node 22.23.4 (Homebrew `node@22`, keg-only, owner-approved). Node 24.22 stays the system default. Use `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"` in this repo.
- Installed Python packages: certifi 2026.10.23, charset-normalizer 3.5.2, idna 3.20, meta-sam-parser 0.1.0, numpy 2.4.5, Pillow 12.3.0 (WebP support present), python-dotenv 1.2.4, requests 2.34.2, urllib3 2.8.0.

## Dependency size approvals (owner, 2026-10-27)

Sizes are published unpacked sizes from the npm registry and wheel archives. The npm tree was resolved with a lockfile-only dry resolution, without installing.

| Package | Version | Unpacked | Decision |
| --- | --- | --- | --- |
| Pillow | 12.3.0 | 13.3 MB | Approved |
| numpy | 2.4.5 | 49.9 MB | Approved. numpy 2.5 needs Python ≥3.12, so 2.4.x is the last 3.11 line |
| charset-normalizer (required by requests) | 3.5.2 | 1.14 MB | Installed before approval by mistake, then approved retroactively |
| npm set for T1 | see TASKS T1 | 421 packages, ~524 MB on disk (382 MB prod, 142 MB dev) | Approved |
| next | 16.4.3 | 192.1 MB + 90.5 MB `@next/swc-darwin-arm64` | Approved |
| typescript | 5.9.3 | 23.6 MB | Approved |
| pdf-lib / @pdf-lib/fontkit | 1.17.1 / 1.1.1 | 19.5 / 4.3 MB | Approved. A separate chunk, never in the first page load (final T11 production build, 2026-10-29 18:21 ET: one chunk, 1135 KiB minified, 496 KiB gzip measured locally). Owner decision 2026-10-29 (T11) replaced the earlier "loaded only on PDF export": the chunk and the three PDF fonts (562 KiB) preload in idle time once a project is open. Offline export verified in headless Chrome against a production build (TASKS.md T11 log) |
| react-dom | 19.2.9 | 7.3 MB | Approved |
| zod | 4.6.7 | 6.1 MB | Approved |
| eslint | 9.39.5 | 3.0 MB | Approved |
| @types/node | 22.x | 2.4 MB | Approved |
| vitest | 4.1.12 | 1.9 MB | Approved |
| sharp | **0.35.5** (spec range was <0.35) | 0.96 MB + libvips darwin-arm64 18.2 MB | Approved. Next 16.4.3 already depends on `sharp ^0.35.5`; staying below 0.35 would install a second libvips copy |
| node@22 (Homebrew, not a project dependency) | 22.23.4 | system tool | Approved |

## Documentation evidence: SAM parser 0.1.0

Read from the package source (npm `@meta-sam/parser@0.1.0` and PyPI `meta-sam-parser==0.1.0`) in an isolated scratch folder, without running it. License: SAM License, which allows use and redistribution and must be credited in CREDITS.md.

- TS API: `parseImageStream`, `recordsOfKind`, `decodeMaskToRaster`, `buildObjectPrompt({size:{width,height}, objects:[{id, prompts:[{frame, points:[{x,y,label?}]}]}]})`.
- Python API: `parse_responses_stream(events, image_segmentation_format()).final_result()`, `decode_mask_to_raster`, `build_object_prompt(size=(w,h), objects=[PromptObject(id, [FramePrompt(frame, points=[PromptPoint(x,y,label)])])])`.
- Mask wire format: `data=H,W,<enc>payload`. H and W are the raster's own size, not the frame's. The mask record carries `bounds`, the half-open box the raster covers.
- The README says the live SAM API finalizes the output lane with `response.content_part.done` only. The parser accepts that.
- The point prompt we built for a 1024×768 image is `<0f>1<|point;x=768;y=512;w=1024;h=768|>-<|point;x=512;y=96;w=1024;h=768|>`, matching SPEC 6.1.
- Pixel mapping in the README uses floor: `floor((x - left) * width / shownWidth)`, clamped.

## Offline results

`python spike/local_images.py --fixture-set all`, 2026-10-27: **35 passed, 0 failed, 5 skipped** (after review fixes, 2026-10-28). The skips are the five owned fixtures (U09). Covered:

- Formats: HEIC signature with the exact message, GIF, truncated JPEG, animated WebP, 48 MP header, <256 px reject, <800 px warning, >25 MB source.
- Byte bound and metadata stripping (only a `VP8 ` chunk remains).
- EXIF orientation 6 and alpha flattening.
- Dilation checked against brute force, including borders. Feather, drift, and composite radius/sigma clamps.
- Composite preserves base pixels outside the feather support. All 7 fallback reasons: geometry, disabled, small, aspect, missing_mask, no_outside_area, drift.
- Contain-fit clicks for both letterbox types, the round trip at two canvas sizes, and edge clamping.
- Parser reassembly across delta splits. Box-sized documented raster. Unverified placement raises.

Dry runs (`run_all.py --mode smoke --dry-run`) produced valid request shapes for SAM concept and points, Spark identify and instruction (text/paint), and image edit and compose. Shape only, no HTTP.

Gate behavior observed: paid scripts exit 3 without a ledger; grounded exits 3 without `SEARCH_QUERY_RESERVE`; Files exits 3 (pricing unknown); ASR exits 5 (no recording); `deployment.py` exits 2 (app not built).

## Pricing check (2026-10-28)

Claude compared `budget/prices.json` with the live page https://dev.meta.ai/docs/pricing-rate-limits. The page shows no "last updated" date. The owner still has to review it before PRICING_VERIFIED_AT is set.

| Item | Live page | prices.json | Match |
| --- | --- | --- | --- |
| sam-3.1 image segmentation | $2.50 per 1,000 images | 2,500 µ$ per image | yes |
| muse-image-1.0 | $0.01 per image, billed only for images generated and returned | 10,000 µ$ per returned image | yes |
| muse-spark-1.3-contributor | input $0.10, output $0.20 per 1M tokens | 100,000 / 200,000 µ$ per 1M | yes |
| Web search grounding | "$2.50 per 1,000 search queries, in addition to the request's token cost" | 2,500 µ$ per query | yes |
| muse-voice-transcribe-1.0 | $0.18 per hour, whole seconds rounded down | 180,000 µ$ per hour; 30 s reserves 1,500 | yes |
| Files API | not listed | `null` | yes (profile stays blocked) |

- The reservations still cover the worst case. Ungrounded Spark costs at most 1,048,576 input tokens × $0.10/M plus 4,096 output tokens × $0.20/M = 105,677 µ$, under the 110,000 reserved.
- The contributor cached-input rate ($0.002/M) isn't used. Settlement assumes no cache discount (SPEC).
- Not stated on the page:
  - how many search queries one web_search tool call can bill. Grounded calls stay disabled under U06.
  - how reasoning tokens are billed. The first live Spark call compares reported `usage` with `max_output_tokens`; a charge above the reservation halts further calls (selftest case).
  - Files pricing.
- Contributor rate limits (per team): `muse-spark-1.3-contributor` 150 RPM and 3M TPM, `muse-image-1.0` 150 RPM, `sam-3.1` 3,000 RPM.
- Contributor mode gives "discounted pricing or more usage in exchange for permission to use your content". The owner's consent record must cover this.

## Proposed corrections and deviations

| Item | Spec | Proposal or decision | Status |
| --- | --- | --- | --- |
| sharp version | >=0.34 <0.35 | 0.35.5, same as Next 16.4.3's own dependency | Owner approved; SPEC section 2 updated |
| Click rounding | SPEC 7 and PLAN 9.1 say "round" | Use floor, which is pixel containment and what the SAM parser docs use; error under 1 px | Applied in `spike/imaging.py`; SPEC note added |
| Redis namespace | `dreambike:hackathon-2026` | `{dreambike:hackathon-2026}`: the braces are a Redis hash tag, so all keys of one EVAL share a slot | Applied; SPEC note added |
| Zod JSON Schema for Spark | Generated by z.toJSONSchema | Zod emits non-standard `format: "starts_with"`; dropped in modelJsonSchema(), pattern kept | Applied (T1); confirm in U02 live test |
| npm install on Node 22 | npm ci | npm 10.9.9 crashes (arborist edgesOut); use npm 11.19.1 under Node 22 for installs | Workaround recorded in TASKS T1 |
| Files pricing | Not listed | `budget/prices.json` has `files: null`, so the Files profile stays blocked until pricing is verified | Open (optional profile) |
| Extra spike files | Not in SPEC file list | `spike/imaging.py` (image math shared by scripts), `spike/ledger.py` (init/status/selftest), `spike/expected.example.json` (template), `prompts/schemas/*.json`, `budget/prices.json` | Added |

## Ledger and cost log

The local audit is `spike/out/ledger.jsonl` (gitignored). Shared totals come from `python spike/ledger.py status`.

| Date ET | Ticket | Profile | Calls | Settled USD | Notes |
| --- | --- | --- | --- | --- | --- |
| before 2026-10-28 | — | Owner calls before the ledger existed | unknown | 0.01 | From the Billing page; used as the lifetime starting total in `ledger.py init` |
| 2026-10-28 09:22–09:23 | T0 | run_all smoke, plain | 4 SAM, 3 Spark, 1 edit | 0.022121 | Owner go-ahead with a $1 cap: TICKET_CAP_USD=1 and DAILY_CAP_USD=1 in the process env. Reserved vs settled: SAM 0.010/0.010, Spark 0.33/0.002121, edit 0.010/0.010. Lifetime now 0.032121. |
| 2026-10-28 09:37 | T7 | images_edits compose, plain, front-wheel reference | 1 edit | 0.010 | Owner go-ahead with a $1 cap (TICKET_CAP_USD=1, DAILY_CAP_USD=1). Reserved 0.010, settled 0.010. Lifetime now 0.042121. |
| 2026-10-28 09:52–09:53 | T0 | Spark instruction (paint, reference) and paint edit, plain, candy red | 2 Spark, 1 edit | 0.011150 | Owner asked for candy red; $1 cap (TICKET_CAP_USD=1, DAILY_CAP_USD=1). Reserved vs settled: Spark 0.22/0.001150, edit 0.010/0.010. The text instruction was a cached pass. Lifetime now 0.053271. |
| 2026-10-28 09:58 | T0 | paint edit, candy red, base without the cover square | 1 edit | 0.010 | Owner asked to remove the square first; $1 cap. Base: scratchpad copy of plain-wall-right.jpg with the square refilled from its edge pixels. Reserved 0.010, settled 0.010. Lifetime now 0.063271. |
| 2026-10-28 13:47 | T3 | responses_sam concept (motorcycle, wheel, giraffe) and points, plain, --force | 4 SAM | 0.010 | U01 overlay for the downscaled placement; $1 cap (TICKET_CAP_USD=1, DAILY_CAP_USD=1). Reserved 0.010, settled 0.010. Lifetime now 0.073271. |
| 2026-10-28 14:06–14:34 | T7 | App live run, reference mode, plain-wall-right.nocover.jpg: import, front wheel, rear wheel | 33 SAM, 3 Spark, 7 edits | 0.154870 | Owner go-ahead with a $1 cap (TICKET_CAP_USD=1, DAILY_CAP_USD=1, BUDGET_TICKET=T7) in the dev server process env. 33 SAM: import 15, outline recuts 2, re-detect 15, one lead probe. 7 edits: front 3 with compose.v1 and 1 with v2 (accepted), rear 1 with v2 and 2 with v3 (second accepted). Nothing left reserved, no halt flag. Lifetime now 0.228141; day 0.218141. |
| 2026-10-29 | — | Reconciliation, no call | 0 | 0 | Owner read the Meta Billing page: $0.71 spent. `ledger.py status`: lifetime spent 714096 µ$ ($0.714), reserved 0, no halt flag, so the two agree. The rows between 14:34 and here (T3 owner checks of 2026-10-28) were not logged one by one; the ledger total covers them. Owner set a $5 daily Billing limit with alerts at $1, $2 and so on (2026-10-29). |
| 2026-10-29 12:05–12:20 | T9 | responses_spark grounded, plain, batch 1 (twice) and batch 2 | 3 grounded Spark | 1.140000 booked (reservations kept) | Owner go with TICKET_CAP_USD=2, DAILY_CAP_USD=2, SEARCH_QUERY_RESERVE=20, --ticket T9. The query count is not reported, so each call kept 380000 µ$. Token cost from usage 5478 µ$; real cost expected about $0.02. Lifetime in the ledger now 1.854096 (over-counted by the kept reservations until the Billing reconciliation). |
| 2026-10-29 13:00–13:12 | T9 | App live run in the owner's Chrome, project fadf4f99: 1 SAM, 1 instruction, 2 edits, 1 grounded check | 1 SAM, 2 Spark, 2 edits | 0.393253 booked | BUDGET_TICKET=T9, caps $2/$2/$2 (ticket, day, visitor) and SEARCH_QUERY_RESERVE=16 in the process env. The check (one batch, 46 s) kept its 370000 µ$ reservation; renders, SAM and instruction settled from usage (23253 µ$). Ledger lifetime 2.247349, over-counted by about 1.5 USD of kept grounded reservations. |
