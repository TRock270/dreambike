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
| U01 SAM mask placement | UNVERIFIED (doc-supported hypothesis) | Doc + Offline: the parser 0.1.0 README record decodes to a 60×27 raster for a 60×27 box, which means box-sized and box-relative. The parser normalizes inclusive `x2/y2` to half-open `right/bottom`. Our adapter raises MASK_PLACEMENT_UNKNOWN until a mode is verified. | Owned off-origin concept and point overlays (`responses_sam.py --mode concept/points`), checked by the owner; TypeScript repeat in T3 |
| U02 Spark strict JSON with image and with web_search | UNVERIFIED | Request bodies built and shape-checked in dry run; schemas in `prompts/schemas/` | Live identify and instruction profiles; grounded profile after U06 |
| U03 Account models, quotas, image sizes | UNVERIFIED | None | First live profiles record model access and rate-limit headers |
| U04 Edit quality, latency, drift | UNVERIFIED | Offline: composite and drift math with all 7 fallback reasons | Live `images_edits.py --mode edit` plus owner before/after review |
| U05 EXIF, byte envelopes, HEIC | PARTIAL (offline only) | Offline: EXIF orientation 6 is applied once and stripped, with the marker within 0.8 px; 4000×3000 input reduced to 2048×1536 at 1,200,814 bytes (q=70); HEIC rejected by signature with the exact message; >25 MB, >40 MP, animated, and corrupt inputs give distinct errors | Owned EXIF fixture compared across browser, Pillow, and sharp (T2); deployed envelope (T14) |
| U06 Search query bound and durable accounting | PARTIAL (atomic ledger verified) | Live Redis 2026-10-28: Upstash (regional, eviction off); `ledger.py selftest` 8/8 passed against the real reserve.lua/settle.lua, including a concurrency cap and fail-closed cases; selftest keys deleted afterwards. Owner reports a $50 Meta Billing limit (2026-10-28). Billing reconciled at $0.01; lifetime total initialized at 10000 µ$ |  PRICING_VERIFIED_AT; documented per-request search bound before grounded calls |
| U07 Shops, product sources, fetch | UNVERIFIED | None (T12, optional) | Owner domains, T12 tests |
| U08 Vercel project limits | UNVERIFIED | None | T14 |
| U09 Fixtures, bike truth, consent, identifiers | BLOCKED | `fixtures/` and `consent/` don't exist; all 5 fixture checks reported as skipped | Owner supplies the photos, `fixtures/expected.json`, and private consent |
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
| pdf-lib / @pdf-lib/fontkit | 1.17.1 / 1.1.1 | 19.5 / 4.3 MB | Approved; loaded only on PDF export |
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

## Proposed corrections and deviations

| Item | Spec | Proposal or decision | Status |
| --- | --- | --- | --- |
| sharp version | >=0.34 <0.35 | 0.35.5, same as Next 16.4.3's own dependency | Owner approved; SPEC section 2 updated |
| Click rounding | SPEC 7 and PLAN 9.1 say "round" | Use floor, which is pixel containment and what the SAM parser docs use; error under 1 px | Applied in `spike/imaging.py`; SPEC note added |
| Redis namespace | `dreambike:hackathon-2026` | `{dreambike:hackathon-2026}`: the braces are a Redis hash tag, so all keys of one EVAL share a slot | Applied; SPEC note added |
| Files pricing | Not listed | `budget/prices.json` has `files: null`, so the Files profile stays blocked until pricing is verified | Open (optional profile) |
| Extra spike files | Not in SPEC file list | `spike/imaging.py` (image math shared by scripts), `spike/ledger.py` (init/status/selftest), `spike/expected.example.json` (template), `prompts/schemas/*.json`, `budget/prices.json` | Added |

## Ledger and cost log

The local audit is `spike/out/ledger.jsonl` (gitignored). Shared totals come from `python spike/ledger.py status`.

| Date ET | Ticket | Profile | Calls | Settled USD | Notes |
| --- | --- | --- | --- | --- | --- |
| — | — | — | 0 | 0.00 | No paid calls yet |
