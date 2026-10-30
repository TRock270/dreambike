Part A: Change log

- Section 7.2: Expanded unknowns — SAM mask placement, Muse Image geometry, HEIC, Muse Spark search shape, Harley phrase quality, Vercel duration — each tied to a spike number. Why: red-team the doc assumptions before Claude Code writes anything.
- Section 8.1: Made server-side sharp the compositor (not browser canvas), added the response-size budget. Why: masks live on the server, sharp is fast at 2048 px, and the composited webp fits under Vercel's 4.5 MB cap.
- Section 8.2: Added `/api/health` and `/api/budget`; noted `/api/edit` returns the composited image. Why: the client needs budget info; the composite is what the user sees.
- Section 9.1: Added the full coordinate transform chain and six round-trip tests. Why: coordinates are the most common source of silent bugs in an image pipeline.
- Section 9.1: Stated that the uploaded-to-SAM image is exactly the normalized image, so SAM pixels equal normalized pixels. Why: eliminates the EXIF and resize coordinate risk.
- Section 9.2: Added a fallback when SAM finds no motorcycle (user click + point prompt). Why: real photos sometimes fail on concept prompts.
- Section 9.3: Added the "stale part mask" rule — after an edit, recompute only the edited slot; other masks reused lazily. Why: 13 SAM calls per edit is too slow and too expensive.
- Section 9.4: Added low-strength preview then high-strength final; web search off for reference edits. Why: cuts latency on the common case and keeps reference edits faithful.
- Section 9.5: Replaced the three-layer prose with an exact algorithm: parameters, drift metric, threshold, pseudocode, runtime, server-side. Why: this is the highest-risk part of the edit pipeline.
- Section 9.5: Added hard fallback — if drift exceeds threshold, use the full edited image and mark the version unaligned. Why: a broken composite is worse than an unaligned edit.
- Section 9.6: Added link HEAD checks, EU shop allowlist, second-pass "is this the right product type?", server-side image proxy. Why: search results are the most likely source of embarrassing demo content.
- Section 9.7: Made "verify" the default status, required sources, batched fit checks 3 at a time. Why: an overconfident "ok" is the highest-impact LLM failure in the app.
- Section 9.8: Added default hours per slot, pre-export prompt for missing hours, VAT unit test. Why: a quote with a zero line looks broken to a judge.
- Section 9.9: New section — failure-mode table, spend cap, demo project layout, feature flags, route durations, error codes, fixtures, cache storage, mock mode.
- Section 10: Added a `validate-product` prompt (second-pass search validation).
- Section 11: Marked the critical path, added the no-composite fallback if spike 5 fails, added what to cut first if Friday is under 8h.
- Section 5: Added "multi-turn edit" and "composite fallback" to the cut order.
- Section 6: Noted the demo project loads from `/public/demo/` with no API call. Why: protects judges' first impression from latency and budget.
- Section 13: Added checklist items for the no-composite fallback and the budget message.
- Section 14: Added "spike reveals a showstopper" and "route times out on Vercel" risks.

Part B: Revised PLAN.md

````markdown
# DreamBike: hackathon plan

Status: draft v3 (technical risk review), Oct 27, 2026. Review chain: Qwen (product and domain), DeepSeek (technical risk), Codex (implementation spec), Claude Code builds it.

## 1. Summary

DreamBike is a web app for a custom motorcycle shop in Germany that mostly works on Harley-Davidsons. [One sentence about the shop's owner removed on 2026-10-30.] The shop takes a photo of a customer's bike and drops it into the app. The app cuts the bike out of the background and finds its parts: wheels, fork, tank, handlebar, exhaust, air cleaner, seat and so on. The user clicks a part and changes it in one of three ways: describe it, drop in a photo of a part, or search for real parts online. Muse Image renders the change on the actual bike.

Every change becomes a line on a build sheet. Each line has the part (a real product with a euro price when possible), a fit check against this specific bike, the German paperwork the part needs (ABE, E-mark, Teilegutachten, TÜV inspection, Eintragung), and a labor estimate. At the end the shop exports a quote PDF with before and after images.

The image editing is the hook. The build sheet, the fit and paperwork check and the quote are what make it a shop tool and not a generic image editor.

## 2. Hackathon context

| Item | Value |
| --- | --- |
| Event | Meta Global AI Developer Hackathon (Cerebral Valley) |
| Team | Solo |
| Building period | Oct 27 to Nov 4, 2026 |
| Deadline | Wed Nov 4, 9:00 PM ET, via the CV platform |
| Internal target | Submitted by Wed Nov 4, 6:00 PM ET |
| Problem statement | Build for Your World |
| Prize track | Indie Developer |
| Time budget | About 5 hours a day, more on Friday. About 43 hours in total (section 11) |
| Judges look at | 3-minute demo video, code, live product |

Judging rubric (all tracks). Source: a third-party summary of the official waiver, because the CV page wasn't reachable from here. The owner should check it against the CV page.

| Criterion | Weight | What it covers | What it means for DreamBike |
| --- | --- | --- | --- |
| Impact | 30% | Who benefits, how much, fit with the problem statement | Real shop, real bikes, German paperwork and quotes take real time today |
| Use of Meta AI tooling | 25% | Creative use beyond a basic integration | SAM, Muse Image and Muse Spark work together in one pipeline; each does a job the others can't |
| Demo | 25% | Live demo holds up, quality of the video | Live URL with a preloaded demo bike, spend cap, rehearsed video |
| Technical depth and execution | 20% | Sound engineering, craft | Masked compositing, coordinate handling, structured outputs, clean repo |

Indie track lens (no weight given): creativity, technical ambition, and whether it works.

Indie prizes: $150k, $100k, $75k, $50k, $25k for places 1 to 5.

Rules that shape this plan:

- Repository must be public.
- Only work built during the hackathon may appear in the demo, and the submission must make clear what was built during the event. Unclear attribution can mean disqualification.
- The project must use Meta models (Model API and/or open weights).
- No code, data or assets we don't have rights to. Product photos found online stay out of the repo and the video.
- Anti-project list includes "simple image analyzers". DreamBike must not look like one. At least half the demo shows the workflow after the image.
- Our own constraint: no people in photos or video. The demo uses photos of the owner's own bikes, screen recordings and a voice-over.

## 3. Problem and users

A customer conversation in a custom shop usually starts with "what would it look like with...". Today the shop answers with words, photos of other builds, catalog pages or a rough Photoshop job. The customer has trouble picturing the result, and the shop spends time on consultations that never turn into jobs.

When the customer decides, someone still has to turn the idea into a parts list, check that each part fits this exact bike, find out which papers each part has, and whether the bike needs a TÜV inspection and an Eintragung afterwards. Then someone writes the quote. In Germany the paperwork question decides whether a part is a quick swap or an expensive project.

Users:

- Shop owner or mechanic. Uses the app on a Mac laptop at the counter. Photos come from a phone (AirDrop or cable).
- Customer. Looks at the screen with the mechanic and receives the quote.

## 4. What makes this more than an image editor

- Each visual change is tied to a part slot and, when possible, a real product with a euro price and a link to a German or EU shop.
- Muse Spark identifies the bike (for Harleys: family such as Sportster, Softail, Dyna or Touring, engine generation, year range, ABS or not) and checks every change against it.
- The check covers German approval rules: which paper the part has, whether the shop needs a TÜV Änderungsabnahme, whether an Einzelabnahme would be needed, and what to measure.
- The quote uses the shop's own labor times, hourly rate and inspection fees.
- It is tested on the owner's own bikes.

## 5. Scope

Sized for about 43 hours of solo work with Claude Code writing most of the code.

### MVP (the demo depends on these)

1. Drag and drop a photo (JPEG, PNG, WebP; HEIC converted or rejected with a clear message). Normalize orientation and size.
2. Automatic cutout of the motorcycle (shown on a neutral background).
3. Part map: automatic detection of the main part types, shown as clickable overlays. Clicking a spot with no detected part runs a point prompt to segment whatever is there.
4. Change the selected part by text description. Paint and color changes use the same path.
5. Change the selected part with a dropped-in reference photo.
6. Version history with undo and a before/after slider.
7. Bike identification with user confirmation.
8. Build sheet: one line per change (slot, description, product if known, fit and paperwork status, labor).
9. Fit and paperwork check per build sheet line.
10. Quote export as PDF (EUR, 19% VAT, labor, inspection fees).
11. Preloaded demo project and spend cap, so judges can try the live URL safely.

### Should have

- Part search: Muse Spark with web search returns 3 to 5 real products from German or EU shops (name, price in EUR as listed, shop URL, image, approval type if the listing states it). Picking one uses its image as the reference for the edit.
- Voice input with Muse Voice Transcribe. Lower value at a laptop, but it adds a fourth Meta model.

### Stretch

- Side-by-side comparison of 2 or 3 variants.
- Engine swap.
- Several photos of the same bike with consistent edits.
- German version of the quote PDF.

### Out of scope

Accounts and multi-user, payments, ordering parts, 3D, cars, mobile layout.

### Cut order if behind schedule

1. Voice input.
2. Part search falls back to "paste a product URL" (Muse Spark reads the page and fills in the product).
3. Reference photo mode.
4. Multi-turn edit (single-shot only).
5. Composite (use the full edited image; mark the version unaligned). See 9.5.
6. Part map down to 3 slots (handlebar, tank, exhaust). Click-anywhere still works.

Never cut: fit and paperwork check, build sheet, quote. They carry the Impact score.

## 6. User flow

1. Take a photo of the bike with a phone, from the side, ideally against a plain wall. On a Harley, the right side shows the exhaust and air cleaner. Move the photo to the Mac.
2. New project, drag the photo in. The app normalizes it and cuts out the bike. The part map runs in the background. Muse Spark suggests the bike ("Looks like a 2019 Harley-Davidson Softail Street Bob, Milwaukee-Eight 107, ABS. Correct?") and the user confirms or corrects it.
3. The user clicks the handlebar. It lights up and a panel opens with three tabs: Describe, Use a photo, Search parts.
4. Describe: "14 inch ape hanger, black". Muse Spark turns that into a precise edit instruction and a part spec. Muse Image renders it. A new version appears with a before/after slider, and a build sheet line is added.
5. Repeat for other parts. Every version can be undone.
6. Build sheet tab, "Check fit and papers". Each line gets a status, the paperwork it needs, and reasons. Example: the ape hanger needs longer clutch cable, throttle cables and brake line, and its Teilegutachten means a TÜV Änderungsabnahme (assumption, owner to confirm).
7. Quote: labor, rate and fees come from settings. Export the PDF.

The preloaded demo project at `/public/demo/` loads on the first visit with no API call. The first click on the live URL never waits on a model.

## 7. Meta models and verified API facts

Checked against Meta's docs on Oct 27, 2026. Reviewers: do not change anything in this section without a doc link. Add questions to 7.2 instead.

### 7.1 What we use

| Job | Model ID | Endpoint | Notes |
| --- | --- | --- | --- |
| Cutout, part masks, click selection | `sam-3.1` | `POST /v1/responses`, streaming recommended | Concept prompt is one short noun phrase per request; lists like "wheel, fork" return nothing. Box and point prompts use a token grammar, for example `<0f>1<\|point;x=..;y=..;w=..;h=..\|>`, with negative points allowed. Up to 16 prompted objects per request. Coordinates in the image's own pixels after EXIF rotation; wrong aspect ratio returns 400. Output is text: one record per object with box and base85 mask. Parsers: `@meta-sam/parser` (TS, 0.0.13+ for confidence) and `meta-sam-parser` (Python, 0.0.6+ for confidence). `metadata.include_confidence: "true"` adds a score. Results vary slightly between runs. Price $2.50 per 1k images. |
| Part edits, paint, compose with a reference | `muse-image-1.0` | `POST /v1/images/edits` (single shot) or `POST /v1/responses` (multi-turn) | 1 to 10 input images per edit. No mask parameter: `mask` returns 400. Output is always opaque. `size` sets only the aspect ratio; returned pixel size differs from the input. Formats webp (default), png, jpeg. Built-in web and image search is on by default; turn off with `tool_enablement` on the images endpoints. `reasoning_strength` is `high` (default) or `low`. Multi-turn via `previous_response_id`. Price $0.01 per image. |
| Bike ID, instruction rewriting, part search, fit and paperwork check, part labels | `muse-spark-1.3` | `POST /v1/responses` | Image input, structured output, search grounding through a `web_search` tool, 1M token context. Audio input on 1.3 is degraded, so voice goes through Muse Voice Transcribe. |
| Voice input (should have) | `muse-voice-transcribe-1.0` | `POST /v1/asr/transcribe` (file) or `wss://api.meta.ai/v1/asr/realtime` | Transcript text only. 25 languages, keyword biasing. |
| Uploads | n/a | `POST /v1/files`, `purpose: user_data` | Upload once, reference by `file_id`. Muse Image accepts `file_id`; for SAM images the docs only show `image_url` (URL or base64 data URL). |

General: base URL `https://api.meta.ai/v1`, header `Authorization: Bearer $MODEL_API_KEY`. The OpenAI SDK works if you pass the key explicitly (it doesn't read `MODEL_API_KEY` by itself).

### 7.2 Not confirmed yet (check in the day 0 spike)

- SAM mask placement. In the doc examples the mask raster has exactly the box size (for example box 444 to 679 by 625 to 850, mask `226,236`), so the mask is probably box-relative at full resolution. Confirm with the client library's decode helper before writing compositing code. Spike 2.
- Exact request shape for Muse Spark structured output and the `web_search` tool. Spike 7.
- Rate limits for each model on our account. Spike 1.
- Latency of a Muse Image edit with `reasoning_strength` high vs low. Spike 7.
- How stable Muse Image keeps the geometry of untouched parts. Section 9.5 depends on this. Spike 5.
- Max input image size for SAM and Muse Image. Spike 1.
- How well SAM finds Harley-specific parts ("air cleaner", "primary cover", "saddlebag") on real photos. Spike 3.
- Whether editing on the original photo or on the cutout placed on flat gray gives better, more stable edits. Spike 4.
- HEIC decode path on the M1 Mac with sharp's prebuilt binaries. Spike 1.
- Vercel function max duration on the owner's plan (Hobby default 10s, Fluid 60s; Pro up to 300s). Spike 1.

## 8. Architecture

### 8.1 Stack (decided)

- App: Next.js (App Router) with TypeScript, one repo, deployed on Vercel. Claude Code writes most of it. The owner knows Python best, so code stays plain and readable, and Claude Code explains TypeScript-specific parts briefly when asked.
- Day 0 spike and smoke tests: Python scripts in `/spike` (requests, Pillow, pillow-heif, numpy, `meta-sam-parser`). The owner can read, run and change them.
- Local development on a MacBook (M1).
- Server route handlers proxy every Meta call. `MODEL_API_KEY` stays on the server.
- `sharp` on the server for EXIF rotation, resizing, alpha masks and compositing. Server-side because the masks are already on the server, sharp is fast at 2048 px (see 9.5), and the composited webp fits under Vercel's ~4.5 MB response cap. Browser canvas is the fallback if sharp causes trouble.
- HEIC: sharp's prebuilt binaries don't decode HEIC. Convert in the browser with `heic2any`, or reject with "export as JPEG". Spike 1 decides.
- Project state in the browser (IndexedDB). The server stays stateless. Images are stored as blobs.
- PDF with `@react-pdf/renderer` or `pdf-lib`.
- UI with Tailwind and shadcn/ui. Desktop layout only.
- Vercel function request bodies are capped at about 4.5 MB. Send images as webp at max 2048 px, or upload them to the Meta Files API and pass `file_id` where supported. The composited response is a single webp, so it fits.
- Public live URL: a spend cap per visitor and per day, a preloaded demo project with cached results, and a clear message when the cap is reached. See 9.9.2.

### 8.2 Route handlers

| Route | In | Out |
| --- | --- | --- |
| `POST /api/normalize` | photo file | normalized webp, width, height |
| `POST /api/segment` | image, mode `concept` or `points`, phrase or points | width, height, objects: id, box, mask, confidence |
| `POST /api/identify` | image | make, model, family, engine, year range, ABS, style, facing direction, confidence |
| `POST /api/instruction` | slot, user text or reference, bike | edit prompt, part spec, build item title |
| `POST /api/edit` | base image, reference images, edit prompt, tool settings | composited image, width, height, `composed` flag, `drift` |
| `POST /api/search-parts` | bike, slot, query, preferred shops | products: name, brand, price text, currency, URL, image URL, approval type, source |
| `POST /api/check` | bike, build items, shop rules | per item: status, approval, inspection needed, reasons, what to measure, sources |
| `POST /api/transcribe` | audio | text |
| `GET /api/health` | — | `{ ok: true, model: "up" }` |
| `GET /api/budget` | — | `{ spentTodayUsd, capUsd, remainingEditsForVisitor }` |

`/api/edit` always returns the composited image. Raw Muse Image output is kept for the before/after slider but is not the artifact the user sees.

### 8.3 Data model (sketch)

```ts
type Bike = { make: string; model: string; family?: string; engine?: string;
  yearFrom?: number; yearTo?: number; abs?: boolean | "unknown";
  style?: string; facing: "left" | "right"; confirmed: boolean };

type Part = { id: string; slot: SlotId; label: string;
  box: [number, number, number, number]; mask: Uint8Array; maskW: number; maskH: number;
  source: "concept" | "point"; confidence?: number; stale?: boolean };

type Version = { id: string; parentId?: string; image: Blob; width: number; height: number;
  cutout?: Blob; parts: Part[]; change?: BuildItem; createdAt: number;
  aligned?: boolean; drift?: number };

type BuildItem = { id: string; slot: SlotId; title: string; spec: Record<string, string>;
  product?: Product; fit?: FitResult; laborHours?: number };

type Product = { name: string; brand?: string; priceText?: string; currency?: string;
  url: string; imageUrl?: string; approval?: Approval; source: string };

type Approval = "abe" | "e_mark" | "teilegutachten" | "none" | "unknown";

type FitResult = { status: "ok" | "verify" | "problem";
  approval: Approval;
  inspection: "none" | "aenderungsabnahme" | "einzelabnahme" | "unknown";
  reasons: string[]; toMeasure: string[]; extraParts: string[]; sources: string[] };

type Project = { id: string; bike?: Bike; versions: Version[]; headVersionId: string;
  items: BuildItem[]; createdAt: number };
```

## 9. Pipeline details

Each stage's failure modes are listed in 9.9.1.

### 9.1 Normalize

Apply EXIF rotation (`sharp().rotate()`), convert to RGB, scale the long side to at most 2048 px, store width and height. All coordinates in the app are pixels of the normalized image. Clicks on the screen are converted to these pixels before any SAM call.

**The normalized image is the single source of truth.** Every model call (SAM, Muse Spark, Muse Image) receives exactly the normalized image. SAM coordinates are therefore identical to app coordinates. This kills the EXIF and resize coordinate risk in one move.

#### 9.1.1 Coordinate transforms

Screen → normalized. Let `(cx, cy)` be the click in client coordinates, `rect` the bounding rect of the `<img>`, `(dispW, dispH)` its displayed size (after CSS `object-fit: contain`), `(offX, offY)` the offset of the image inside its container, `(normW, normH)` the natural size.

```
dx = cx - rect.left - offX
dy = cy - rect.top - offY
if dx < 0 or dy < 0 or dx > dispW or dy > dispH: reject   // click outside image
nx = dx * normW / dispW
ny = dy * normH / dispH
nx = round(nx); ny = round(ny)
```

Normalized → SAM. Send `x=nx; y=ny; w=normW; h=normH` (or a box in normalized pixels). No further transform.

SAM output → normalized. The mask raster arrives base85-encoded. Use `meta-sam-parser`'s decode helper, do not hand-roll. If the mask is box-relative (7.2 open), `mask[r][c]` maps to normalized `(boxX1 + c, boxY1 + r)`. If the mask is full-image, `mask[r][c]` maps to `(c, r)`. Spike 2 settles this and it gets frozen in a single helper `maskToNormalized()`.

Muse Image output → normalized. Resize with lanczos3 to `(normW, normH)`. After the resize, pixel `(x, y)` in the edited image equals pixel `(x, y)` in the base. Re-run SAM on the resized edited image, so masks are already in base pixel space for compositing.

EXIF. `sharp().rotate()` applies the orientation tag and strips it. The normalized image has no EXIF. The browser, SAM and Muse Image all see the same orientation. Everything downstream inherits that.

Tests.

- T1. Take a photo with EXIF Orientation=6. Run through `sharp().rotate().toFile()`. Open the result in a browser and in Pillow. Both must show the same orientation. Pass: both agree.
- T2. On the normalized image, draw a 10×10 red square at (100, 100), save, read back. Pass: red pixel at (100, 100).
- T3. Click on a visible feature on screen (e.g., mirror tip). Convert with the formula. Draw a dot at the computed normalized pixel. Pass: dot lands on the mirror tip within 3 px.
- T4. SAM point prompt at `(normW/2, normH/2)`. Pass: mask centroid within 10 px of center.
- T5. SAM box prompt around the front wheel. Pass: returned mask bbox within 5% of the prompt bbox.
- T6. Resize a Muse Image output to normalized size. Draw a dot at the same normalized coord on base and edited. Pass: both dots land on the same bike feature.

Each test is a small script in `/spike` and runs in the day 0 spike.

### 9.2 Cutout

SAM concept prompt "motorcycle". Pick the record with the largest mask area (or the highest confidence). If nothing fits, ask the user to click the bike and use a point prompt. Build an alpha mask, feather the edge by 1 to 2 px, and show the cutout on neutral gray.

Muse Image always returns opaque images, so the cutout is recomputed after every edit by running SAM again. Spike 4 decides whether edits look better on the original photo or on the cutout placed on flat light gray. Hypothesis: flat gray gives cleaner edits and an easier re-cut.

### 9.3 Part map

Harley-first list. Qwen will refine the phrases and slots.

| Slot | UI label | SAM phrase (first try) | Post-processing |
| --- | --- | --- | --- |
| `wheel_front`, `wheel_rear` | Front wheel, Rear wheel | "wheel" | Split by position using the bike's facing direction |
| `fork` | Fork | "front fork" | |
| `tank` | Tank | "fuel tank" | |
| `handlebar` | Handlebar | "handlebar" | |
| `exhaust` | Exhaust | "exhaust pipe" | Also try "muffler" |
| `air_cleaner` | Air cleaner | "air cleaner" | Also try "air filter". Right side on most Harleys |
| `seat` | Seat | "motorcycle seat" | |
| `headlight` | Headlight | "headlight" | |
| `fender_front`, `fender_rear` | Fenders | "fender" | Split by position |
| `frame` | Frame | "motorcycle frame" | Paint only |
| `engine` | Engine | "engine" | Select and paint in MVP, swap is stretch |

One SAM request per phrase, run in parallel with a concurrency limit of 4. Cost is about 13 requests per photo, around 3 cents. Clip each part mask to the bike mask. When masks overlap, a click selects the smallest mask that contains the clicked pixel. Cache the part map per version.

Click with no part under it: send a point prompt with one positive point, add the result as a custom part, and let Muse Spark name it from a crop ("which motorcycle part is this?"). Reject the result if the returned mask covers more than 60% of the bike mask — ask the user to click again.

**Stale masks after an edit.** A new version recomputes only the edited slot's mask. All other parts keep their parent's mask and are flagged `stale: true`. They are refreshed lazily when the user clicks them, or in the background after 5 seconds idle. This keeps an edit at 2 SAM calls instead of 13. See 5.1.

### 9.4 Edit modes

All modes end in the same call: base image, slot, part box, edit prompt, optional reference images.

Describe (also used for paint). Muse Spark turns the user's words into structured output: an English edit prompt that names the part and its position and says to keep everything else identical, a part spec (for a wheel: type, diameter, color, finish) and a short build item title.

Use a photo. `images[0]` is the base, `images[1]` is the reference. Prompt pattern: "In image 1, replace the motorcycle's front wheel with the wheel shown in image 2. Match the perspective, scale and lighting of image 1. Keep everything else in image 1 unchanged."

Paint prompt pattern: "Repaint the fuel tank and both fenders in metallic candy red with a thin gold pinstripe. Do not change any shapes or other parts."

Tool settings. Turn image search off when we pass our own reference (faster, more faithful to the reference). Leave it on for text descriptions of named products such as "Screamin' Eagle air cleaner". Use `reasoning_strength: low` for the first render, show it to the user, then immediately request `high` in the background and replace when it returns. The user sees a result in ~5 s and a final in ~15 s. The final replaces the preview in place; the build sheet line is written once, on the final.

### 9.5 Keeping the rest of the bike unchanged

Muse Image has no mask input. Protection in four layers:

1. The prompt names the part and its position (front or rear, left or right side of the image).
2. Optional visual hint: a second input image, a copy of the base with the target part outlined, referred to as "the part outlined in image 2". Spike 6 tests whether it helps or confuses.
3. Masked composite after the edit (below).
4. Drift check with a hard fallback.

Composite algorithm. Runs server-side inside `/api/edit` with sharp.

- Resize the raw edit to `(baseW, baseH)` with lanczos3. Guard: skip composite if either output dimension is below 1024 px, or if the aspect ratio differs from the base by more than 2% (resize would distort).
- Old mask = part mask of the edited slot from the base version. New mask = SAM mask on the resized edited image, same slot phrase. `maskU = union(old, new)`.
- Dilation radius `d = clamp(0.015 * bikeWidth, 6, 24)` px. Feathered mask: Gaussian blur, `sigma = clamp(0.005 * bikeWidth, 3, 8)` px.
- Drift metric: mean absolute difference of grayscale base vs edited, computed only outside the dilated region, divided by 255. Threshold `0.05`.
- If `drift > 0.05`: return the full edited image, `composed: false`.
- Else: `out = base * (1 - alpha) + edited * alpha`, where `alpha` is the feathered mask.

Pseudocode.

```
function composite(base, editedRaw, oldMask, newMask, bikeWidth):
  if min(editedRaw.w, editedRaw.h) < 1024: return { image: editedRaw, composed: false, reason: "small" }
  if abs(aspect(editedRaw) - aspect(base)) > 0.02: return { image: editedRaw, composed: false, reason: "aspect" }
  edited = resize(editedRaw, base.w, base.h, "lanczos3")
  maskU  = union(oldMask, newMask)                 // both at base size
  d      = clamp(0.015 * bikeWidth, 6, 24)
  maskD  = dilate(maskU, d)
  sigma  = clamp(0.005 * bikeWidth, 3, 8)
  alpha  = gaussianBlur(maskD, sigma)
  drift  = meanAbsDiff(gray(base), gray(edited), outside = maskD) / 255
  if drift > 0.05:
    return { image: edited, composed: false, reason: "drift", drift }
  out = blend(base, edited, alpha)
  return { image: out, composed: true, drift }
```

Runtime on a 2048 px image, Node 20 + sharp on Vercel: resize ~60 ms, dilate ~20 ms, blur ~10 ms, blend ~30 ms, total under 150 ms.

Where. Server, inside `/api/edit`. Reasons: masks are already on the server; sharp is installed and fast; the return body is one webp that fits under 4.5 MB; a browser-canvas version would have to ship masks down and re-implement morphology in TS.

On failure. Use the full edited image, set `version.aligned = false` and `version.drift`, and show a small UI badge "the model moved the bike — showing the raw edit". The before/after slider still works. Shape-changing slots (`fork`, `wheel_front`, `wheel_rear`) always use the full edited image; they skip the composite by design.

### 9.6 Part search

Muse Spark with the `web_search` tool. Input: confirmed bike, slot, user query, preferred shop domains from settings. Output: a JSON list of products, each with a source URL, a price in EUR if listed, and the approval type if the listing states it (ABE, E-mark, Teilegutachten). Prefer German and EU shops. The UI shows "price as listed, check the shop". The server fetches the product image to use as a reference input. It isn't stored in the repo or shown publicly outside the user's project. If search finds nothing usable, the user can paste a product URL or drop in a photo.

Validation pipeline before showing results:

1. HEAD the URL, 5 s timeout. Drop 4xx/5xx and DNS failures. Keep a `linkOk` flag for soft 3xx.
2. Shop allowlist: `.de`, `.at`, `.ch`, and known EU moto retailers (Thunderbike, Custom Chrome Europe, Zodiac, Louis, Polo, Detlev Louis, eBay.de sellers with > 100 reviews). Non-EU results are kept but badged "outside EU".
3. Missing price: keep, show "price on request". Never invent a number.
4. Second-pass product-type check with the `validate-product` prompt (section 10): "Is this listing a {slot} for a {bike}? yes/no with one-line reason." Drop on `no`.
5. Product image: server fetches and inlines as data URL for the edit call. If fetch fails, show a placeholder and offer "use the listing's photo manually".

### 9.7 Bike identification, fit and paperwork check

Identify: Muse Spark looks at the photo and returns make, model, family (for Harleys: Sportster, Softail, Dyna, Touring, Street, other), engine generation (Evolution, Twin Cam, Milwaukee-Eight, Revolution Max, other), year range, ABS (yes, no, unknown), style, facing direction and confidence. The user confirms or corrects. The confirmed bike drives every check.

Fit check: Muse Spark with web search and reasoning. Output per item: status (ok, verify, problem), approval type, inspection needed, reasons, things to measure, extra parts needed, sources. Default status is `verify`. `ok` requires at least one cited source in `sources` and a model confidence flag; if either is missing, downgrade to `verify`. The UI says this is a pre-check and the shop decides.

Batch size: at most 3 items per call. Larger batches are split; each batch is independent, so one bad batch doesn't sink the whole check.

Harley examples it should catch (assumptions, owner to confirm):

- Handlebar: Harleys use 1 inch bars, many other bikes 22 mm. Taller bars need longer clutch and throttle cables, brake line and often a wiring extension.
- Wheels: axle diameter and ABS sensor ring must match the bike; tire size and belt or fender clearance.
- Exhaust: needs an EU approval for road use in Germany, and noise rules apply; may need engine tuning.
- Lights and indicators: need an E-mark.

German approval rules (from TÜV Rheinland and a summary of the StVZO, owner to confirm; not legal advice):

| Part has | What usually happens |
| --- | --- |
| ABE | Carry the ABE with the bike. An inspection may still be needed, depending on the conditions written in the ABE. |
| E-mark or EU/ECE type approval | The bike's operating permit stays valid. Check the conditions; an Änderungsabnahme can still be required. |
| Teilegutachten | Always needs an Änderungsabnahme by TÜV, DEKRA or similar (§ 19 Abs. 3 StVZO). Existing Teilegutachten are accepted until June 19, 2028 (§ 72 StVZO transition). |
| Nothing, or the bike isn't covered | Einzelabnahme (§ 19 Abs. 2 with § 21 StVZO). Expensive. The report goes to the registration office. |

After an Änderungsabnahme, the report is usually carried with the bike until the registration papers next change. The owner can add shop rules in settings, and they go into the prompt.

### 9.8 Quote

Settings: shop name, logo, hourly rate, currency (EUR), VAT (19%), labor hours per slot, fee for an Änderungsabnahme, note text. Real labor times and rates come from the owner. Default hours per slot ship in the app so the demo quote is never empty (e.g., exhaust 1.0 h, handlebar 2.0 h, wheel 0.5 h). Before export, if any line has zero hours, show "Set hours for: <list>" and let the user fill them in inline. PDF: before/after images, one line per change with part, price as listed, labor hours and line total, inspection fees as their own lines, net, VAT and total, fit and paperwork notes, and a note that the image is a visualization and the real bike may look different. PDF in English for the hackathon; German is stretch.

VAT and totals have a unit test (`lib/quote.test.ts`). The PDF renderer loads images as base64 from the version blobs; no network at render time.

### 9.9 Engineering details

#### 9.9.1 Failure modes per stage

| Stage | Failure | Likelihood | Impact | Detection | Mitigation | Breaks demo? |
| --- | --- | --- | --- | --- | --- | --- |
| Normalize | HEIC not decoded | High (iPhone) | Medium | 500 from sharp | Client `heic2any` convert, or reject with "export as JPEG" | No (if spike 1 lands) |
| Normalize | EXIF rotation lost | Medium | High | Masks offset | `sharp().rotate()`, test T1 | No |
| Normalize | Body over 4.5 MB | High | Medium | 413 | Client downscale to webp 2048 before upload | No |
| Cutout | SAM returns no motorcycle | Medium | High | Empty records | User-click point prompt, section 9.2 | No |
| Cutout | Wrong object picked (truck, wall) | Medium | Medium | Multiple masks, largest not bike-shaped | Largest mask + click override | No |
| Part map | Phrase returns nothing | High | Medium | Missing part | Alternate phrase, click fallback | No |
| Part map | 13 parallel calls time out | Medium | High | 504 | Concurrency 4, cache partial results, `maxDuration=30` | No |
| Part map | Wrong part merged (both wheels as one) | Medium | Low | One box for two slots | Split by facing direction | No |
| Click | Click hits nothing | Medium | Low | No mask contains point | Point prompt, label crop | No |
| Click | Point prompt returns whole bike | Medium | Medium | Box > 60% of bike mask | Reject, ask to click again | No |
| Edit | Changes wrong part | High | High | Visual | Prompt wording, outline hint, `reasoning_strength=high`, composite | Maybe (mitigated) |
| Edit | Shifts/rescales whole bike | Medium | Medium | Drift metric | Fall back to full edited image, mark unaligned | No |
| Edit | Latency long | Unknown | High | Timeout | Low-strength preview, progress UI, `maxDuration=60` | Maybe |
| Composite | Mask placement wrong (7.2) | High if unresolved | High | Visual seam or mask offset | Spike 2 first, freeze `maskToNormalized()` | Yes |
| Composite | Seam visible | Medium | Low | Visual | Feather 3-8 px | No |
| Search | Dead links | High | Medium | HEAD 4xx/5xx | Drop | No |
| Search | Wrong product type | Medium | Medium | Second-pass LLM | Drop | No |
| Search | Non-EU shop | High | Medium | Domain allowlist | Badge "outside EU" or filter | No |
| Search | Product image CORS / hotlink blocked | High | Medium | Fetch fail | Server-side proxy, placeholder | No |
| Identify | Wrong model or ABS | Medium | Medium | Confidence + user confirmation | User override, `unknown` allowed | No |
| Fit | Overconfident `ok` | Medium | High | No sources | Require sources, default `verify` | Maybe |
| Quote | Zero-hour line | Medium | Medium | Pre-export check | Defaults, inline prompt | No |

#### 9.9.2 Spend cap

Upstash Redis free tier (10k commands/day, no card). One client in `lib/redis.ts`. Keys:

- `spend:{YYYY-MM-DD}` — estimated USD spent today, `INCRBYFLOAT` per model call. Check before each call: if `> DAILY_CAP_USD` (default $5), return 429 `BUDGET_EXCEEDED`.
- `v:{sha1(ip)}:{YYYY-MM-DD}:edits` — per-visitor edits, limit 5/day.
- `v:{sha1(ip)}:{YYYY-MM-DD}:sam` — per-visitor SAM calls, limit 40/day.
- `sem:{sha1(ip)}` — optional per-visitor concurrency lock, `SET NX EX 20`. Not required on first pass.

Cost estimates baked in:
- SAM: $0.0025/call
- Muse Image: $0.01/call
- Muse Spark: $0.005/call (assumed, confirm in spike 7)
- ASR: $0.001/call (assumed)

Budget message: "Daily budget reached. Try again tomorrow, or explore the demo project (no API calls)."

If a Redis dependency is not acceptable, the fallback is: the live URL serves only the pre-computed demo project and disables live edits. Judges can still try the demo. The demo video shows live edits. This is the no-database path.

#### 9.9.3 Demo project

Built on Nov 2. Stored in `/public/demo/` as:

- `project.json` — bike, versions (with pre-baked `aligned`, `drift`), items, pre-baked fit results
- `v0.webp`, `v1.webp`, `v2.webp` — version images
- `quote.pdf`

The client loads this on `?demo=1` or on first visit, with a banner "Demo project — pre-computed. Live edits use the daily budget." No IndexedDB needed; just read the JSON and images. No API call, so the first impression is instant and free.

#### 9.9.4 Feature flags

`lib/flags.ts`, one JSON env var `NEXT_PUBLIC_FLAGS`, redeployable in < 1 min.

- `composite_enabled` — flip off if spike 5 fails or it misbehaves in the field. When off, `/api/edit` returns the full edited image and marks it unaligned.
- `reference_mode_enabled` — off if reference edits are flaky.
- `search_enabled` — off → paste URL fallback.
- `voice_enabled` — off by default.
- `preview_then_final` — on by default; off if low-strength previews mislead.

#### 9.9.5 Route durations

`export const maxDuration` per route:

- `/api/normalize`: 15s
- `/api/segment`: 30s
- `/api/identify`: 15s
- `/api/instruction`: 15s
- `/api/edit`: 60s
- `/api/search-parts`: 30s
- `/api/check`: 60s
- `/api/transcribe`: 30s

Vercel Hobby default is 10s without Fluid Compute. If the owner is on Hobby without Fluid, the edit pipeline must be re-chunked into two calls (Muse Image, then SAM + composite), each under 10s. Confirm in spike 1.

#### 9.9.6 Error codes

Uniform shape:

```
{ error: { code: string, message: string, retryable: boolean } }
```

Codes: `INVALID_IMAGE`, `TOO_LARGE`, `UPSTREAM_TIMEOUT`, `UPSTREAM_4XX`, `UPSTREAM_5XX`, `SCHEMA_INVALID`, `BUDGET_EXCEEDED`, `RATE_LIMITED`, `NO_RESULT`, `MASK_PLACEMENT_UNKNOWN`. Client maps each to a user message in `lib/errors.ts`. `retryable: true` triggers one client-side retry with a 1 s backoff.

#### 9.9.7 Fixtures

Five photos in `/spike/fixtures/` (owner's own, not in repo):

- `plain-wall-right.jpg`
- `plain-wall-left.jpg`
- `cluttered.jpg`
- `exif-rotated.jpg`
- `heic.heic`

Used by the spike and by a dev-only `/api/selftest` route that runs the pipeline and compares against expected outputs.

#### 9.9.8 Cache storage

IndexedDB, four object stores:

- `images` (Blob)
- `masks` (Uint8Array)
- `json` (Project, Bike, FitResult, Product[])
- `manifest` (key → `{ createdAt, lastAccessedAt, version }`)

Eviction: LRU by `lastAccessedAt`, cap at 200 MB. Cache keys per section 4 of the reviewer notes: `norm:{sha256}`, `cut:{sha256}`, `parts:{sha256}:v1`, `id:{sha256}:v1`, `edit:{...}`, `fit:{...}`, `search:{...}`. Demo project bypasses IndexedDB and reads `/public/demo/`.

#### 9.9.9 Mock mode

`MOCK=1`: `/api/*` returns fixture responses from `lib/mocks/`. Lets the UI be built on Oct 29 without burning API calls. Turn off before deploy.

### 9.10 Versions and invalidation

Version graph is a tree, each `Version` has `parentId`. Undo creates a new version whose parent is the current head's parent. No data is deleted; the user can navigate the tree in the UI.

Derived data per version:
- `image` — source of truth.
- `cutout` — derived from `image`.
- `parts` — derived from `image` + `cutout`.
- `bike` — derived from `image`.
- `fit` — derived from `bike` + `items`.

Invalidation rule on a new version V from parent P via edit on slot S:

- `V.image = new`. Recompute `V.cutout` (1 SAM call, background).
- `V.parts`: recompute S. Reuse P's masks for all other slots, marked `stale: true`. Refresh lazily on click.
- `V.bike`: reuse P.bike, unless S ∈ `{frame, engine}`. Then show "re-identify?" prompt.
- `V.items`: inherit. Fit for the new item is computed now. Other items' fit results are reused unless the bike changed.
- User corrects the bike: invalidate all fit results. Keep image, cutout, parts.

Rule: an image edit invalidates the cutout and the edited slot's mask. A bike correction invalidates all fit results. Nothing else invalidates anything.

## 10. App prompts (written during the build)

Stored as versioned files in `/prompts`, each tested on 5 fixture photos:

- `identify`: photo to bike JSON
- `instruction`: user text (or reference) plus slot plus bike to edit prompt, spec and title
- `compose`: template for edits with a reference image
- `paint`: template for color changes
- `search-parts`: bike plus slot plus query to product JSON
- `validate-product`: bike plus slot plus one listing to `{ isCorrectType: boolean, reason: string }`
- `fit-check`: bike plus build items plus German rules plus shop rules to fit results
- `label-part`: crop to part name

## 11. Day plan

About 43 hours. Friday hours are an assumption. Critical path marked with *.

| Day | Hours | Goal | Done when |
| --- | --- | --- | --- |
| Tue Oct 27 | 1 | API key works; run Qwen and DeepSeek reviews | One working call to each model; revised plan saved |
| Wed Oct 28 | 5 | *Codex spec; Python spike on 5 own bike photos; scaffold app | Spike results in 7.2; app runs locally |
| Thu Oct 29 | 5 | *Upload, normalize, cutout, part map, click selection | Click a wheel and it lights up |
| Fri Oct 30 | 8 | *Describe mode, compositing, versions, undo, before/after, reference photo mode | Three changes in a row on one bike without breaking other parts |
| Sat Oct 31 | 5 | *Bike ID, build sheet, fit and paperwork check | Build sheet shows status, approval and inspection with reasons |
| Sun Nov 1 | 5 | Quote PDF and settings; part search | PDF exports; search returns real products with EUR prices |
| Mon Nov 2 | 5 | *Demo project, spend cap, deploy, test on all own bikes; voice if time | Live URL works on a second laptop |
| Tue Nov 3 | 5 | *Record and edit the demo video; README | Video under 3:00 uploaded |
| Wed Nov 4 | 4 | *Buffer, final checks, submit by 6 PM ET | Submission confirmed |

Hours sum to 43. Friday 8 h is an assumption; if it is 5 h, cut in the section 5 order (voice, part search to paste-URL, reference mode, multi-turn) to recover ~4 h.

Critical path: Oct 28 spike → Oct 29 pipeline → Oct 30 edit/composite → Oct 31 fit → Nov 2 deploy → Nov 3 video → Nov 4 submit. Missing any of these delays submission.

Fallback if spike 5 fails (drift is always high): Oct 30 becomes "edit + versions + before/after + reference" with composite as stretch. Set `composite_enabled = false`, ship the full-edited-image path. The demo still works; the "technical depth" story leans on the build sheet instead.

## 12. Demo video (3 minutes)

No people on camera. Screen recording, still photos of the owner's bikes, voice-over by the owner.

| Time | Content |
| --- | --- |
| 0:00 to 0:20 | The problem: a customer wants a custom Harley; the shop has to show it, check the parts and sort out TÜV papers |
| 0:20 to 0:45 | Drag in a photo, cutout, part map, bike identified |
| 0:45 to 1:30 | Change parts: describe the handlebar, use a photo for the wheels, search a real exhaust |
| 1:30 to 1:50 | Paint, versions, before/after |
| 1:50 to 2:30 | Build sheet: fit and paperwork check catches a real problem (for example ape hangers need longer cables and a TÜV Änderungsabnahme) |
| 2:30 to 2:50 | Quote PDF in euros with inspection fees |
| 2:50 to 3:00 | Meta models used and what was built during the hackathon |

## 13. Submission checklist

- Public GitHub repo. README covers what it does, which Meta models are used and where, setup, an architecture diagram, and a clear statement that everything was built between Oct 27 and Nov 4, 2026. Commit history shows the progress.
- Video at most 3:00, link public.
- Live URL works without login, has the demo project, and the spend cap is on.
- Budget message renders correctly when the cap is hit (test by curling `/api/budget`).
- `composite_enabled = false` path tested end to end (full edited image, unaligned badge, before/after still works).
- Meta credits claimed (done) and a spend limit set on the Billing page.
- Only the owner's own bike photos in the repo and video. No product images from shops in the repo. No people.

## 14. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Muse Image changes more than the target part | High | Prompt wording, masked composite (9.5), `reasoning_strength` high |
| Edited image shifts the whole bike | Medium | Drift check, fall back to the full edited image |
| Spike reveals a showstopper (e.g., drift always high, SAM mask placement wrong) | High | Spikes 2 and 5 run before any UI work; `composite_enabled=false` fallback is a shippable demo |
| SAM misses parts on cluttered photos | Medium | Plain wall, point prompt fallback |
| Edit latency is long (unknown) | Medium | Progress UI, low-strength previews, measure in the spike |
| Vercel route times out (edit pipeline + SAM + composite > 60 s) | Medium | `maxDuration=60`, re-chunk into two calls on Hobby, cache per stage |
| Fit or paperwork check sounds sure but is wrong | High | Sources required, `verify` by default, "pre-check, shop decides" in the UI, owner reviews the rule table |
| Search returns dead links, wrong prices or US-only shops | Medium | HEAD checks, EU allowlist, second-pass product-type check, user can paste a URL |
| HEIC photos from the iPhone | Medium | Convert in the browser or ask for JPEG |
| Judges burn through credits on the live URL | Medium | Spend cap (9.9.2), demo project with cached results |
| Request body limit on Vercel | Medium | webp at max 2048 px, Files API, composited response is one webp |
| Image rights | High (disqualification) | Own bike photos only in repo and video |
| Scope creep | High | Cut order in section 5 |
| Judges see "just an image editor" | High | Half the demo shows build sheet, paperwork check and quote |

## 15. Open questions for the owner

Answered on Oct 27: solo; Python best, other languages fine through Claude Code; Germany (TÜV, ABE, Eintragung), English UI, EUR; Indie track; own bike photos, no people; Harley-Davidson focus plus other bikes; real parts preferred; labor times and rates will come from the owner; Mac M1 laptop; credits claimed; about 5 hours a day, more on Friday; name DreamBike.

Still open:

1. Labor times per part, hourly rate, and what the shop charges for a TÜV Änderungsabnahme.
2. Which parts shops do you buy from? Their domains go into the search settings.
3. Model and year of each bike in your photos (needed to judge the bike ID test).
4. Do you have photos from the right side and against a plain background? If not, can you take some?
5. Is Vercel fine for hosting, and do you have a GitHub account ready for a public repo?
6. Do the 5 hours a day include the weekend, and how many hours on Friday?
7. Is a free Upstash Redis account acceptable for the spend cap, or should the live URL ship demo-only?

## 16. Sources

- Hackathon participant guide (RULES.md, provided by the owner)
- Rubric and prizes (third-party summary of the waiver): https://reconscribe.com/meta-global-ai-developer-hackathon-2026/
- Meta Model API quickstart: https://dev.meta.ai/docs/quickstart
- Models: https://dev.meta.ai/docs/models
- SAM segmenting with prompts: https://dev.meta.ai/docs/sam/segmenting
- SAM reading segmentation output: https://dev.meta.ai/docs/sam/reading-segmentation
- SAM client libraries: https://dev.meta.ai/docs/sam/client-libraries
- Image generation with Muse Image: https://dev.meta.ai/docs/image-generation
- Edit an image (API reference): https://dev.meta.ai/docs/api-reference/images/edit-image
- Search grounding: https://dev.meta.ai/docs/search-grounding
- Structured output: https://dev.meta.ai/docs/structured-output
- Speech to text: https://dev.meta.ai/docs/speech-to-text
- File handling: https://dev.meta.ai/docs/file-handling
- Vercel function duration limits: https://vercel.com/docs/functions/configuring-functions/duration
- Upstash Redis free tier: https://upstash.com/docs/redis/overall/pricing
- TÜV Rheinland on ABE, Teilegutachten, Änderungsabnahme and Einzelabnahme: https://www.tuv.com/germany/de/lp/mobilit%C3%A4t/vollabnahme/main-navigation/tuner/
- StVZO paragraphs summary (§ 19, § 21, § 72): https://kfz-dietrich.com/quellen/motorsport-einzelabnahme-paragraph-21-umbau-eintragung/
````