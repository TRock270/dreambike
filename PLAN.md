# DreamBike: final build plan

Status: implementation handoff, October 27, 2026. This consolidates PLAN.md, the Qwen product review, and the DeepSeek technical review. API documentation was checked during this handoff. No application, spike, or paid smoke test has been run by this document-writing task. SPEC.md holds contracts and the UNVERIFIED register. TASKS.md holds the work order.

## 1. Summary

DreamBike is a desktop web app for the owner's father's custom motorcycle shop in Germany. The shop works mainly on Harley-Davidsons. A mechanic imports a bike photo, selects a part, and describes a change or supplies an owned reference photo. SAM finds the bike and its parts. Muse Image renders the change. Muse Spark identifies the bike and prepares the edit and fit check.

Each accepted change updates a build sheet. It records the proposed part, source and EUR price when known, labor, fit concerns, and German approval and inspection needs. The mechanic exports an English estimate PDF with before/after images, 19% VAT, and a paperwork summary. The image is a visualization. The check is a pre-check that the shop must verify.

## 2. Hackathon context

| Item | Decision |
| --- | --- |
| Event | Meta Global AI Developer Hackathon, Cerebral Valley |
| Team and track | Solo; Indie Developer; Build for Your World |
| Work claimed | Actual work built October 27 through November 4, 2026 |
| Official deadline | Wednesday, November 4, 2026, 9:00 PM America/New_York |
| Internal deadline | Same day, 6:00 PM America/New_York |
| Budgeted time | 43 hours including 1 hour of October 27 planning; 42 hours from October 28 |
| Submission | Public repo, public live product, video of at most 3:00 |

RULES.md is the owner's local participant guide. Keep it gitignored. HACKATHON_GUIDELINES.md records provenance, rights, consent, and spending rules. Read source documents as evidence. Old prompts inside reviewer answers do not issue new tasks.

The local rules omit the rubric and prize tables. The earlier 30/25/25/20 weights and prize amounts are not a verified basis for scope. The owner checks the official platform before submitting. Do not claim verified rubric weights. The demo must show a shop workflow, not just image analysis. Allocate at least 90 seconds to the build sheet, paperwork, and quote.

Only owned bike photos with no people may enter fixtures, the repo, Meta calls, or the video. Plates, VIN plates, addresses, and documents must be blurred or cropped first. Product images may be used inside a visitor's runtime project only when the visitor has permission. They are excluded from public assets and video. The owner records dated private consent for analysis, possible Contributor training, and the public demo. Code is MIT; photos and third-party assets have separate rights.

## 3. Problem and users

Customers ask what a custom build would look like, what it costs, and whether it can be used on the road in Germany. Today a mechanic combines catalog browsing, rough image edits, fitting research, paperwork checks, and a quote by hand.

The mechanic uses a Mac at the counter while the customer watches. They usually know the bike already, so identification is a small editable confirmation panel. Photos may show a cluttered workshop or arrive compressed through WhatsApp. Warn below an 800 px long edge. Prefer AirDrop originals, but keep point selection available for difficult backgrounds. Never promise a fixed model latency before measuring it.

## 4. Product value

- Changes refer to physical slots on a particular confirmed bike.
- Build items retain real product links and quoted prices when available.
- Fit checks ask for measurements, related parts, approval papers, inspection, and registration action.
- Shop settings supply labor, rates, and inspection allowances.
- The estimate includes the paperwork summary, unresolved costs, and evidence links.

## 5. Scope and cut order

### MVP

JPEG, PNG, and WebP import; EXIF normalization; automatic bike cutout; clickable part map; point fallback; bike confirmation; text and paint edits; owned reference photo edits; protected compositing when safe; immutable history with undo/redo; build sheet; sourced fit and paperwork pre-check; settings; EUR estimate PDF; cached demo; durable spend protection or an explicit demo-only live URL.

The 16 core slots are wheels (front/rear), fork, tank, handlebar, exhaust, air cleaner, seat, headlight, fenders (front/rear), frame, engine, forward controls, mirrors, and turn signals. Frame and engine are paint only. Automatic recognition is best effort. A missed slot uses point selection. Do not delay shipping to perfect all masks.

### Should-have

Grounded part search and product URL lookup share one optional ticket. Additional slots are saddlebag, fairing/windscreen, primary cover, sissy bar, and grips; they use the generic slot path without bespoke UI. Voice transcription is optional and off by default.

### Stretch, outside the 43-hour commitment

Multi-part paint in one render, named custom-part labels from Spark, a multi-variant comparison screen, engine swap, consistent edits across multiple photos, and a German PDF. Each needs a separate approved ticket. Reference mode may be cut only if its day 0 capability test fails or the Friday time budget shrinks.

### Excluded

Accounts, collaboration, ordering, payments, 3D, cars, mobile layout, streaming voice, server project storage, background preview/final image pairs, image search in the owned-photo demo, automated legal decisions, and automatic checkout scraping.

### Cut sequence

1. Do not start voice or extra automatic slots.
2. Skip part search, automated URL lookup, product validation calls, and remote product image fetching. Manual product fields and a source link remain.
3. Cut reference mode only if its spike fails or Friday falls from 8 to 5 hours.
4. Turn compositing off if masks or alignment fail; show the full edit with a warning.

Never cut the build sheet, fit and paperwork check, estimate, cached demo, or spend protection. A demo-only live URL is an explicit fallback, not a claim of live AI functionality. The video can show actual recorded local AI calls.

## 6. User flow

1. Show the Meta processing and possible training notice before import. The visitor confirms ownership/permission and absence of people or personal identifiers.
2. Import and normalize. Show the photo immediately. Cut out the bike, start part detection, and identify in parallel under the request limit. Background failure leaves useful partial results.
3. Mechanic confirms or corrects make, model, year, engine, ABS, and facing direction. Unknown is valid. Fit checking requires this confirmation.
4. Click a mask. Smallest valid mask wins an overlap. If none exists, point segment the click. The mechanic supplies a name for a custom part.
5. Enter text, paint, or an owned reference. Show the prepared instruction and affected slot. One click creates one generation. The result is a preview until accepted.
6. Accept commits one image version and its build item together. Reject keeps the previous version and sheet. Repeat, undo, or branch from an earlier version.
7. In Build sheet, enter products and missing prices manually or use optional search. Check fit and papers in batches of at most 3 items. Read sources and unresolved measurements.
8. Review estimate, labor, inspection allowance, and missing prices. Export a draft if inputs remain unknown; a complete estimate requires complete inputs. The mechanic decides what work and inspections to quote.

## 7. Meta API facts and gates

### 7.1 Documentation-checked interfaces

Use native HTTP with base URL `https://api.meta.ai/v1` and Bearer authorization from server-only `MODEL_API_KEY`. Exact bodies and source links are in SPEC.md section 6. Documentation checks establish syntax, not account access or runtime quality.

| Job | Model | Endpoint | Settled choice |
| --- | --- | --- | --- |
| Concept and point segmentation | sam-3.1 | POST /v1/responses | One concept per call; SSE; confidence metadata; parser packages decode records |
| Text edit and reference composition | muse-image-1.0 | POST /v1/images/edits | Raw JSON images array; n=1; opaque WebP; no mask field; no SDK multipart translation |
| Bike ID and instruction | muse-spark-1.3-contributor | POST /v1/responses | text.format JSON schema; no search for these two tasks |
| Fit and optional search | Same Spark model | POST /v1/responses | web_search plus bounded output; retain URL citation annotations |
| Optional voice | muse-voice-transcribe-1.0 | POST /v1/asr/transcribe | PCM WAV, multipart request/audio, sessionId query; not a browser MediaRecorder WebM upload |
| Optional upload smoke test | No model | POST /v1/files | purpose=user_data; not needed in the app's bounded inline transport |

SAM records use base85 payloads, not base64. App coordinates are normalized image pixels. The current parser docs add prompt builders in version 0.1.0; use @meta-sam/parser >=0.1.0,<0.2 and meta-sam-parser >=0.1.0,<0.2. These exceed the required confidence-compatible minima of 0.0.13 and 0.0.6. Package availability is checked in ticket 0. Never invent helper signatures from memory.

Spark Contributor can use submitted content for training. Meta documents Contributor model IDs for Spark, not corresponding SAM or Muse Image suffixes. Use the listed IDs. Do not invent Contributor variants. Preserve the broader upload notice.

### 7.2 UNVERIFIED register

SPEC.md section 14 owns ten numbered gates, U01 through U10. Ticket 0 records documentation URLs, installed versions, sanitized response fields, timings, costs, and pass/fail results. Do not mark them resolved just because this plan specifies a test.

The gates cover mask placement; Spark schema/search composition; account models and quotas; edit latency and geometry; practical payloads; billable search bounds and durable accounting; product source/fetch quality; Vercel configuration; fixture rights and bike truth; and shop/legal/submission confirmations. A failing gate uses its documented fallback. No paid calls are authorized by this documentation handoff.

## 8. Architecture

### 8.1 Stack and transport

Next.js App Router, plain TypeScript and React, Node 22 on Vercel. Python scripts use requests, Pillow, numpy, and the SAM parser in /spike. The owner works on an M1 Mac. Use sharp on the server and canvas for browser overlays. HEIC is rejected in MVP with instructions to export JPEG; do not add a large converter.

The browser stores projects in IndexedDB. Route handlers are stateless for project content. Redis is a separate durable store for counters, reservations, and a content-free cost ledger. It never stores photos, prompts, products, or project data. Without configured durable accounting, the public site serves cached demo results only. Do not use a process-local Map or Vercel filesystem as the public cap.

Use pdf-lib for client PDF export. Use Tailwind and plain accessible controls with shadcn-compatible semantic tokens. Do not install a component suite. Add individual shadcn controls only if needed and attributed. Keep dependencies in SPEC.md. The owner must approve any dependency over 1 MB before installation, including selected packages.

Vercel documents a 4.5 MB request and response limit. Set an app envelope limit of 3,800,000 bytes. Client preflight decodes orientation and reduces image size before upload. Each WebP is at most 1,250,000 bytes and at most 2048 px on its long edge. All Meta images are inline normalized data URLs; there is no app file upload service in MVP. Files API support alone does not bypass Vercel's ingress cap.

### 8.2 Routes

SPEC.md section 5 defines all schemas, deadlines, and errors. Core routes: normalize, segment, identify, instruction, edit, composite, check, budget, and health. Optional routes: search-parts, product-image, transcribe. There is no public self-test route and no API health check that incurs a paid model call.

Generation and local compositing are separate requests. /api/edit produces one bounded image. The client obtains edited masks through /api/segment, then /api/composite blends locally on the server without another paid call. A SAM or blend failure can retry without generating the image again. A pending result cannot mutate a different project head.

### 8.3 State and data

SPEC.md defines the types. A project has a confirmed bike revision and an immutable tree of versions. Each version has a parent, image references, masks, alignment information, and a snapshot of active build items. A changed slot replaces that slot's quoted item; history still records each accepted visual change. This prevents charging three alternative handlebars in one quote.

Undo moves the head pointer to its parent. Redo selects an existing child. Editing an old version creates a child branch; no dummy undo versions. Product, labor, and check updates create sheet revisions with the same image. All mutations commit transactionally. Checks have input hashes so stale results cannot appear current.

### 8.4 Visual design

The owner's own design system Nordlicht, reduced for now to colors and typography. Light theme only and flat: no glass, no dark mode, no aurora background, no specular script. Glass, dark mode and further design come later.

Provenance: Nordlicht existed before Oct 27. We reuse only its token values (colors, type scale, spacing, radius), and write the stylesheet new during the hackathon. The README lists Nordlicht as pre-existing own work that isn't claimed (HACKATHON_GUIDELINES.md §2).

Implementation:

- One token file `src/styles/tokens.css` with `--nl-*` custom properties on `:root`. No hex value anywhere else in the code.
- shadcn/ui variables point to the tokens. shadcn's `accent` is a hover background, not the brand accent.

| shadcn variable | Nordlicht token | Light value |
| --- | --- | --- |
| `--background` | canvas | `#D3E3F5` |
| `--card` | surface 1 | `#E2EDFB` |
| `--muted`, `--accent` (hover) | surface 2 | `#EFF6FE` |
| `--popover` | surface 3 | `#F7FBFF` |
| `--foreground` | text | `#0D1A2B` |
| `--muted-foreground` | text muted | `#4A6378` |
| `--primary`, `--ring` | fill primary (Frost) | `#0A7C9E` |
| `--primary-foreground` | text on fill | `#FFFFFF` |
| `--destructive` | fill danger | `#D11440` |
| `--border`, `--input` | hairline | `rgba(13,26,43,.13)` |
| `--radius` | card radius | `14px` |

- Further tokens: text secondary `#395067`, recess (image trough, code) `#C3D8F0`. Three slots per role: fill carries white text, ink is for colored text, glow is decoration only and never carries text.

| Role | fill | ink | soft ground / text on it |
| --- | --- | --- | --- |
| primary (Frost) | `#0A7C9E` | `#0B6076` | `#B9EEF8` / `#07485A` |
| accent (Polarnacht) | `#5B50F0` | `#4338CA` | `#DAD8FF` / `#312E81` |
| success | `#15803D` | `#116B33` | `#BDF0D1` / `#0E5C2C` |
| warning | `#C2410C` | `#9A4708` | `#FDE6B8` / `#7A3706` |
| danger | `#D11440` | `#A50F34` | `#FFD3DC` / `#93102F` |
| neutral | — | — | `#C8DAEE` / `#25384D` |

- Polarnacht accent at most once per view: the "Render change" button (the Muse Image call). Every other main action uses primary.
- Fit check status: `ok` success, `verify` warning, `problem` danger. Badge on the soft ground with its text color, always with a word and an icon, never color alone. Approval types (ABE, E-mark, Teilegutachten) use the neutral badge.
- Part map overlays: each slot gets a fixed color from the series list, in this order and never reassigned: `#0891B2`, `#5B50F0`, `#E11D48`, `#0D9488`, `#D2600B`, `#8B5CF6`, `#4D7C0F`, `#475569`. Mask fill at about 35 % alpha, 2 px outline in the same color. More than eight slots: reuse by slot group, not by rank.
- Type: IBM Plex Sans for reading, IBM Plex Mono with `tabular-nums` for prices, labor hours, part numbers and measurements. Weights 400, 500 and 600 only. Load through `next/font/google` (SIL Open Font License, credited in the README). Sizes: h1 34/1.18, h2 26/1.25, h3 20/1.35, body 15/1.6, small 13/1.5, caption 12/1.45.
- Sentence case everywhere, including buttons, tabs and table headers.
- Spacing on the 4 px grid (4, 8, 12, 16, 24, 32, 48, 64, 96). Radius 6 inner, 10 chips, 14 cards, 18 dialogs, pill for buttons and inputs. No shadows; surfaces are separated by the hairline border.
- Focus: a hard visible ring in primary, never a glow.
- Quote PDF: same colors and Plex fonts (TTF registered in the PDF library), flat.


## 9. Pipeline and shop logic

### 9.1 Normalize and coordinates

Apply EXIF orientation, flatten alpha on the neutral background, convert to sRGB, strip metadata, and encode WebP at quality 82. Long edge is at most 2048 px; do not upscale. Reject animated, corrupt, or over-40-megapixel inputs. HEIC/HEIF returns a clear unsupported-format response. Warn below 800 px; reject a long edge below 256 px.

Client preflight uses an oriented decoded bitmap. It strips EXIF when encoding. Server normalization is authoritative and rechecks the actual raster dimensions. Model inputs, overlays, masks, and click conversion use this exact raster. Account for contain letterboxing; reject clicks outside the displayed photo; round and clamp to width-1 and height-1.

### 9.2 Cutout

Segment motorcycle. Rank by pixel area, then confidence; show a click override if another bike wins. Zero matches is an empty result, not a server error. Point selection can recover the bike. Convert the verified mask placement to a full-image binary mask. Feather the bike edge at sigma 1.5 px for display. Keep the opaque normalized original for editing. The cutout is a display artifact, not a different coordinate source.

After accepting an edit, recut the new bike in the background. Failure leaves the opaque result visible. Do not reidentify a confirmed bike after every paint change. The flat-background editing experiment belongs in the spike; changing the editing base later requires updating the cache key and root version explicitly.

### 9.3 Part map and fitting checklist

Use one phrase per request, at most 4 in flight per visitor. Initially run motorcycle plus the 14 distinct core phrases below. Front/rear wheels and fenders share requests. At most one alternate per empty phrase, on demand. Only the selected edited part and bike cutout are refreshed eagerly after an edit. This replaces the inaccurate fixed claim of 13 calls per photo.

All fit checks below are mechanic prompts and owner-review assumptions, not universal compatibility or approval rules. Exact model, year, variants, product papers, and combinations decide.

| Slot(s) | First phrase / fallback | Fit measurements and concerns | Demo labor hours per slot |
| --- | --- | --- | --- |
| wheel_front, wheel_rear | wheel / motorcycle wheel | Axle, bearings, ABS ring, tire, brake and belt/fender clearance | 1.0 each |
| fork | front fork / motorcycle fork | Yokes, stem, travel, geometry, brakes, line reach | 4.0 |
| tank | fuel tank / motorcycle tank | Mounts, fuel pump, hoses, wiring, clearance; paint scope | 4.0 |
| handlebar | handlebar / motorcycle handlebar | Actual clamp diameter, throttle type, cable/hose/wire reach at full lock | 3.0 |
| exhaust | exhaust pipe / muffler | Mounts, oxygen sensors, noise/emissions approval for this vehicle, tuning | 1.5 |
| air_cleaner | air cleaner / air filter | Engine, throttle body, breather routing, clearance, emissions/noise papers | 1.0 |
| seat | motorcycle seat / saddle | Mounts, seat position, passenger provisions, electronics clearance | 0.5 |
| headlight | headlight / motorcycle headlight | Mount, wiring, beam pattern, aim, installation approval | 1.5 |
| fender_front, fender_rear | fender / motorcycle fender | Tire clearance through full travel, mounts, wiring, signal position | 2.0 each |
| frame | motorcycle frame / frame | Paint only; strip/prep/reassembly, no structural claim | 12.0 |
| engine | engine / motorcycle engine | Paint only; heat rating, masking, hoses, service access | 6.0 |
| forward_controls | foot peg / forward control | Correct kit, brake and shift linkage, routing, reach, exhaust clearance | 3.0 |
| mirrors | mirror / rearview mirror | Thread, mount, field of view, size, approval | 0.5 |
| turn_signals | turn signal / motorcycle indicator | Approval, spacing, visibility, wiring, relay | 1.0 |
| saddlebag (optional) | saddlebag / luggage bag | Brackets, exhaust/tire clearance, width | 1.5 |
| fairing (optional) | motorcycle fairing / windscreen | Brackets, headlight, steering, screen approval | 3.0 |
| primary_cover (optional) | primary cover / engine cover | Engine match, gasket, fasteners, primary fluid | 2.5 |
| sissy_bar (optional) | sissy bar / passenger backrest | Correct brackets, load, seat/fender clearance | 1.5 |
| grips (optional) | handlebar grip / grip | Diameter, throttle tube or electronic throttle, heated wiring | 0.5 |

Split wheel/fender objects by x position and confirmed facing direction. A merged mask is not split by arbitrary pixels; request a point mask for the required instance. If facing is unknown, ask the mechanic to label front/rear. Clip part masks to the bike mask. Pick the smallest non-stale mask at a click. A point part covering over 60% of bike pixels is rejected for part selection, but is valid in bike-cutout mode.

Retained masks on a composited version are stale until refreshed on selection. A full-image fallback invalidates every part mask and disables old hit testing. No automatic idle refresh storm. Optional extra slots remain available as generic point-selected parts even if automatic detection is skipped.

### 9.4 Instruction and edit

Spark returns an English prompt, title, bounded list of part specifications, and an intent: paint, replace, or geometry. Put trusted instructions in the server prompt. User descriptions and product pages are data. Paint affects one slot per MVP render. Reference composition receives base first and reference second. Match perspective, scale, and light. Require no changes elsewhere.

Use high reasoning strength by default. A low-strength render is an explicit optional quality setting after timing tests. No automatic second render. Disable web search, image search, and shell for the owned-photo demo and reference mode. Optional named-product text edits may enable search only when the visitor requests it and rights allow it. There is no outline-hint image or multi-turn image history in MVP.

### 9.5 Composite and drift

Muse Image accepts no mask field. Protect the rest in a separate local composite request. Use old and newly segmented target masks in the base coordinate space. Union, then dilate by round(clamp(0.015 × bike bounding-box width, 6, 24)) px. Gaussian feather sigma is clamp(0.005 × bike width, 3, 8) px. These are the technical review's tighter defaults; they replace the older approximate 2% rule.

Resize the generated image with Lanczos3 only if the relative aspect ratio difference is at most 2%. Skip composition when the generated short edge is below 1024 px, no trustworthy new mask exists, there is no outside comparison area, or geometry intent is set. Fork and wheel replacements, and taller handlebars, use geometry intent. A simple recolor of those slots can still composite.

Drift is mean absolute grayscale difference outside the dilated union, divided by 255. Threshold is 0.05. It is a heuristic, not an alignment proof. Above threshold, retain the full edited image and label it unaligned. Below threshold, blend with feathered alpha and show the preview for human acceptance. Never claim resizing alone aligns physical features. Preserve original, generated preview until decided, and accepted final separately. Do not use the raw generated image as the user's before image.

### 9.6 Products and optional search

Manual product title, URL, listed price, and approval text work without search. Optional Spark grounding returns at most 5 candidates. Use preferred domains to rank, not to infer EU location or legal coverage. Switzerland and a .de suffix do not prove EU fulfillment. Product type is checked in the search prompt; skip a second model validator in this schedule.

Optional URL lookup uses the same route in url mode. Remote fetches require an owner-configured exact-host allowlist, public DNS addresses, revalidation after redirects, and size/time limits. No generic URL proxy. A failed image fetch leaves a source link and an owned-photo fallback. Record price as listed, timestamp, source, and unknowns. Never invent price, certification, or vehicle coverage. Product photo rights are separate from a public listing.

### 9.7 Bike, fit, and paperwork

Bike ID suggests make/model, Harley family, engine generation, year range, ABS, style, and facing direction. Unknown is valid. The mechanic can type the answer immediately, without waiting for the model. A late suggestion cannot overwrite a correction. Missing exact vehicle details are explicit check limitations.

Fit checking receives the confirmed bike, one batch of up to 3 active items, a summary of the full active build to catch interactions, shop rules, and dated legal reference links. Results include status, approval, document coverage, Änderungsabnahme/Einzelabnahme/unknown, Eintragung, whether papers must be carried, reasons, measurements, additional parts, and sources. A missing direct source or unresolved fit-critical measurement forces verify. Status ok requires positive evidence and compatible conditions. A confident model score alone is insufficient.

| Document situation | Conservative pre-check behavior |
| --- | --- |
| ABE | Read vehicle coverage and conditions. Carrying papers and inspection can depend on those conditions. |
| E-mark or EU/ECE approval | Verify the exact approval scope, installation conditions, vehicle applicability, and combined modifications. A mark alone is not a blanket road-use approval. |
| Teilegutachten | Check applicability and required Änderungsabnahme. StVZO §72(2) allows these reports for installation through June 19, 2028; this does not guarantee any particular part is approved. |
| No suitable document or uncovered vehicle | Flag a possible Einzelabnahme under §19/§21 and need for inspector review. Approval may be impossible. Do not promise that an inspection legalizes it. |

Registration timing and carrying requirements come from the actual documents and inspector. ABE/mark category does not determine them by itself. Preserve the German terms in an English UI. The shop reviews the seed rules before relying on results. Current legal sources are in section 16; §19 could not be retrieved during this handoff and remains within U10.

### 9.8 Estimate and settings

Settings: shop name, owned logo, net hourly rate in EUR, fixed 19% VAT, per-slot labor defaults, net allowance for Änderungsabnahme and Einzelabnahme, preferred shop domains, shop rules, and estimate notes. Use the table's illustrative hours until replaced. A demo can use €100 net/hour, €100 net Änderungsabnahme allowance, and €250 net Einzelabnahme allowance only with a visible Demo rates label. Real shop values remain unset until entered.

Prices retain gross/net/unknown basis. Convert gross input to net by rounding gross cents × 100 / 119; compute labor in integer minutes; sum rounded net lines and manual inspection allowances; round VAT once on the total net; gross = net + VAT. Preserve the original listed price. SPEC.md supplies exact examples. Unknown price, tax basis, labor, or fee is never zero. Allow a clearly labeled incomplete draft with a known subtotal and unresolved items, or block a complete estimate until resolved.

One active quoted item per slot avoids double billing repeated visual alternatives. A paint operation can have zero part cost only if explicitly marked labor only. Inspection allowances are added by the mechanic for the build, not multiplied automatically per item. A paperwork summary lists the affected items, inspection types, registration action, conditions, and unresolved decisions.

The PDF embeds owned before/after images, shop identity, items, labor, fees, totals, source links, and limitations. It uses local font files and no network during export. Exclude external reference/product photos. Reflow long notes and repeat headers on new A4 pages. Never shrink text to hide overflow.

### 9.9 Failures, caps, and demo

All errors have a stable code, safe message, retryable flag, and request ID. An upstream timeout is ambiguous; do not automatically repeat paid work. Only a definite upstream 429 can retry once within the deadline and reservation. User retries are explicit. Missing masks, interrupted storage, unknown pricing, budget denial, and partial batch failures leave existing project data intact.

Public caps default to $0.50 per visitor per ET day and $5 globally per ET day, plus 5 image edits, 80 SAM calls, 12 Spark calls, and 3 ASR calls per visitor. Every upstream attempt reserves cost atomically before dispatch. The $100 project hard cap and $50 development stop survive restarts and deployments. More detail, uncertainty handling, and race tests are in SPEC.md section 13.

Public first load uses a clearly labeled precomputed project. Its version images, masks, actual check results, and example PDF were created during the event using owned photos. The demo runs with no Meta calls and works after the cap. Copy it into IndexedDB only on Try editing. Cached data never pretends to be a fresh check. Cap message: "Daily budget reached. Try again tomorrow, or explore the demo project. The demo uses cached results and makes no AI calls."

### 9.10 Invalidation

Any active-build change invalidates fit for the whole active build, because parts interact. Bike correction or shop-rule change does the same. Price/labor-only changes invalidate the estimate but not physical fit. Image edits invalidate bike cutout; paint keeps the confirmed bike. Frame/engine visualization adds an identity-review notice. Never automatically infer a real engine swap from a painted image.

## 10. Prompt assets

Versioned files under /prompts: identify.v1.md, instruction.v1.md, compose.v1.md, paint.v1.md, fit-check.v1.md, search-parts.v1.md. label-part.v1.md is stretch. SPEC.md section 8 defines inputs, JSON schemas, and fixture expectations. Compose and paint are deterministic instruction templates; do not add a model call merely to expand a template.

## 11. Day plan

Tickets total 39 mandatory hours, 2 conditional search hours, and 2 unallocated hours. That is 43 hours. Voice and stretch tickets are outside that commitment. The time budget includes recording and submission work. Do not silently spend the final buffer on new features.

| Day, ET | Hours | Tickets and exit |
| --- | --- | --- |
| Tue Oct 27 | 1 | T0 preparation and fixture checklist. No claim that calls have passed. |
| Wed Oct 28 | 5 | T0 remaining 2, T1 2, 1 unallocated. Spike evidence, contracts, scaffold, safe mock mode. |
| Thu Oct 29 | 5 | T2 2, T3 3. Normalize, cutout, part selection. |
| Fri Oct 30 | 8 | T4 2, T5 3, T6 2, T7 1. Instruction, edit, history, reference. |
| Sat Oct 31 | 5 | T8 2, T9 3. Build sheet and sourced fit pre-check. |
| Sun Nov 1 | 5 | T10 2, T11 2, T12 first 1 only if core is green. Estimate and settings. |
| Mon Nov 2 | 5 | T12 remaining 1 if green, T13 2, T14 2. Cached demo, caps, deployment check. |
| Tue Nov 3 | 5 | T15 2, T16 3. README, rights, submission material, record a <=3:00 video. |
| Wed Nov 4 | 4 | T17 2, T18 1, 1 unallocated. Regression buffer and submission by 6:00 PM ET. |

Critical path: spike → normalization/masks → edits/history → build sheet/check → estimate → demo/caps/deploy → material/video → submission. If Friday is only 5 hours, skip T12 and use 1 unallocated hour; if the schedule slips further, apply section 5's cut order. No dependency may be bypassed by fabricating a result.

## 12. Three-minute video

Use owned bike photos, screen recording, and owner's voice-over. No people on camera. Only show working features built during the event. Use the actual fixture identity, not the reviewer's assumed 2019 Street Bob.

| Time | Content |
| --- | --- |
| 0:00–0:15 | Counter consultation problem and desired change |
| 0:15–0:30 | Import, masks, quick bike confirmation |
| 0:30–0:55 | One real edit, before/after, accept and undo; reference only if shipped |
| 0:55–1:35 | Build sheet and fit concerns with direct sources and missing measurements |
| 1:35–2:00 | Approval, inspection, registration, and related-parts summary |
| 2:00–2:35 | Estimate, EUR labor and fees, VAT, PDF paperwork summary |
| 2:35–2:50 | Labeled cached demo and public URL behavior |
| 2:50–3:00 | Actual Meta models used, event dates, asset provenance |

Build sheet, paperwork, and estimate occupy 100 seconds. Say three Meta models unless voice actually ships. Disclose cached results and manual actions. Keep a full-length successful backup recording.

## 13. Submission checks

- Public repo and links open without authentication on another laptop.
- README covers setup, models, architecture, rights, limitations, provenance, and actual build dates.
- MIT code license excludes photos, dependencies, and Meta services. CREDITS.md lists actual photo details and fonts.
- Check current files and full Git history for keys, consent, original rules copy, and personal identifiers.
- Live site loads cached demo without paid calls; caps and storage-failure fallback were exercised.
- Complete estimate math and incomplete-draft warnings are visible and correct.
- Video is at most 3:00, public, accurate, and has no unlicensed product images.
- Owner verifies rubric/submission fields and sends by internal 6:00 PM ET target; official cutoff 9:00 PM ET.

## 14. Main risks

| Risk | Response |
| --- | --- |
| Wrong masks or displaced edits | Test before UI; point fallback; reject preview or show full edit with warning |
| Spark sounds certain about legality | Require source applicability; verify unknowns; shop and inspector decide |
| Search cost or usage accounting unclear | Keep grounded public calls disabled until U06; cached demo remains |
| Input/response exceeds Vercel limit | Actual encoded-byte preflight and bounded multipart transport |
| Model call exceeds deployment duration | Split generation and local composition; test deployed request; no invented 5-second latency |
| Wrong or missing quote prices | Explicit unknowns; incomplete draft; no zeros inserted |
| No owned fixture or consent | Scaffold/mock work can continue; paid fixture tests and public demo wait |
| Schedule shrinks | Skip optional tickets, preserve shop workflow and final buffer |

## 15. Owner decisions and inputs

Needed before paid fixture work: 5 owned photos and actual bike identities, dated private permission, identifier blurring, a Meta Billing spend limit, and a configured shared Redis ledger. Without that ledger, Claude can build and test offline only. These are inputs, not permission this agent can fabricate. Use the JPEG path if an owned HEIC fixture is unavailable.

Needed before live deployment: GitHub/Vercel project access, verified Vercel limits, and a durable Redis budget store or acceptance of the documented demo-only fallback. Confirm any selected package over 1 MB before installation. The spec does not open accounts or incur charges.

Needed before a real shop estimate: shop name/logo, net rate, per-slot labor, net inspection allowances, trusted shop domains, and review of legal/checklist wording. Illustrative demo defaults can support UI work with labels. Confirm weekend/Friday availability; eight Friday hours are still an assumption. The owner also checks platform rubric, prize, and video requirements before submission.

## 16. Sources and evidence

Checked during this handoff unless noted. Documentation is not a successful smoke test.

- [Official participant page](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details): owner's local RULES.md remains the supplied source; omitted tables require owner check.
- [Meta quickstart](https://dev.meta.ai/docs/quickstart), [model catalog](https://dev.meta.ai/docs/models), and [pricing/rate limits](https://dev.meta.ai/docs/pricing-rate-limits).
- [SAM prompts](https://dev.meta.ai/docs/sam/segmenting), [wire records](https://dev.meta.ai/docs/sam/reading-segmentation), [client libraries](https://dev.meta.ai/docs/sam/client-libraries).
- [Image guide](https://dev.meta.ai/docs/image-generation), [edit endpoint](https://dev.meta.ai/docs/api-reference/images/edit-image), [image schemas](https://dev.meta.ai/docs/api-reference/images/schemas).
- [Responses schemas](https://dev.meta.ai/docs/api-reference/responses/schemas), [structured output](https://dev.meta.ai/docs/structured-output), [search grounding](https://dev.meta.ai/docs/search-grounding).
- [Speech to text](https://dev.meta.ai/docs/speech-to-text) and [file handling](https://dev.meta.ai/docs/file-handling).
- [Meta cookbook](https://github.com/meta-models/meta-model-cookbook), including [structured output](https://github.com/meta-models/meta-model-cookbook/blob/main/01_api_fundamentals/04_structured_output.ipynb) and [search grounding](https://github.com/meta-models/meta-model-cookbook/blob/main/01_api_fundamentals/10_search_grounding.ipynb). The first uses Chat Completions; do not copy its response_format field into a Responses request.
- [Next.js 16 guide](https://nextjs.org/docs/app/guides/upgrading/version-16), [Vercel limits](https://vercel.com/docs/functions/limitations), [function duration](https://vercel.com/docs/functions/configuring-functions/duration). Current Fluid limits replace the reviewer's older Hobby 10/60-second assumption; verify the actual project.
- [TÜV Rheinland](https://www.tuv.com/germany/de/lp/mobilit%C3%A4t/vollabnahme/main-navigation/tuner/), [StVZO §72](https://www.gesetze-im-internet.de/stvzo_2012/__72.html), [§21](https://www.gesetze-im-internet.de/stvzo_2012/__21.html). [§19](https://www.gesetze-im-internet.de/stvzo_2012/__19.html) timed out during this handoff; do not present it as verified here.
