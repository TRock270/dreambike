## Part A: Change log

- **Section 3**: Added real-shop consultation friction: cluttered workshop backgrounds, customer standing at the counter, WhatsApp-compressed photos, mechanic already knows the bike model.
- **Section 5**: Added `forward_controls`, `mirrors`, `turn_signals` to MVP part map. Moved `saddlebags`, `fairing`, `primary_cover`, `sissy_bar`, `grips` to Should-have. Added paperwork-summary line to quote. No net scope increase.
- **Section 5**: Added cut-order item: new should-have slots are first to drop if SAM struggles.
- **Section 6**: Rewrote user flow for shop reality. Quick bike confirm (mechanic types or one-click confirms). Cluttered-background handling. Customer-at-the-counter interaction. WhatsApp-compressed image note.
- **Section 9.3**: Expanded to 21 slots (16 MVP + 5 should-have). Two SAM phrase candidates per slot. Best-side visibility notes. Fallback phrase strategy.
- **Section 9.7**: Added per-slot fit-check table: 3–6 mechanic checks, typical German approval, Änderungsabnahme likelihood. All marked "(assumption)".
- **Section 9.7**: Added Harley-specific examples: handlebar cable lengths, exhaust noise limits, forward-control brake-line routing.
- **Section 9.8**: Added labor defaults table (placeholders, owner replaces). Added paperwork summary block to quote PDF.
- **Section 12**: Rewrote 3-minute script. First 20 seconds establish shop problem. Build sheet + paperwork get 55 seconds. Realistic catch: ape hangers need longer cables + TÜV Änderungsabnahme; US exhaust has no EU approval.
- **Section 14**: Added risks: cluttered workshop backgrounds, WhatsApp-compressed photos.
- **Section 4**: Strengthened with paperwork-summary-in-quote point.
- **Section 9.4**: Added multi-part paint prompt pattern (tank + fenders in one edit).
- **Section 6**: Added "quick confirm" for bike ID so the mechanic is not stuck in a wizard.
- **Section 9.3**: Noted SAM fallback strategy: try phrase 1, if no detection try phrase 2, then point prompt.
- **Section 15**: Added open question about which Harley families the shop works on most (affects default slot priorities).

---

## Part B: Revised PLAN.md

````markdown
DreamBike: hackathon plan
Status: draft v3, Oct 28, 2026. Product and domain review by Qwen applied. Next: DeepSeek (technical risk), then Codex (implementation spec), then Claude Code builds it.
1. Summary
DreamBike is a web app for a custom motorcycle shop in Germany that mostly works on Harley-Davidsons. [One sentence about the shop's owner removed on 2026-10-30.] The shop takes a photo of a customer's bike and drops it into the app. The app cuts the bike out of the background and finds its parts: wheels, fork, tank, handlebar, exhaust, air cleaner, seat, forward controls, mirrors, turn signals and so on. The user clicks a part and changes it in one of three ways: describe it, drop in a photo of a part, or search for real parts online. Muse Image renders the change on the actual bike.

Every change becomes a line on a build sheet. Each line has the part (a real product with a euro price when possible), a fit check against this specific bike, the German paperwork the part needs (ABE, E-mark, Teilegutachten, TÜV inspection, Eintragung), and a labor estimate. At the end the shop exports a quote PDF with before and after images and a paperwork summary that lists every inspection the finished build will need.

The image editing is the hook. The build sheet, the fit and paperwork check, the labor estimates and the quote are what make it a shop tool and not a generic image editor.

2. Hackathon context
| Item|Value|
| ---|---|
| Event|Meta Global AI Developer Hackathon (Cerebral Valley)|
| Team|Solo|
| Building period|Oct 27 to Nov 4, 2026|
| Deadline|Wed Nov 4, 9:00 PM ET, via the CV platform|
| Internal target|Submitted by Wed Nov 4, 6:00 PM ET|
| Problem statement|Build for Your World|
| Prize track|Indie Developer|
| Time budget|About 5 hours a day, more on Friday. About 43 hours in total (section 11)|
| Judges look at|3-minute demo video, code, live product|

Judging rubric (all tracks). Source: a third-party summary of the official waiver, because the CV page wasn't reachable from here. The owner should check it against the CV page.
| Criterion|Weight|What it covers|What it means for DreamBike|
| ---|---|---|---|
| Impact|30%|Who benefits, how much, fit with the problem statement|Real shop, real bikes, German paperwork and quotes take real time today|
| Use of Meta AI tooling|25%|Creative use beyond a basic integration|SAM, Muse Image and Muse Spark work together in one pipeline; each does a job the others can't|
| Demo|25%|Live demo holds up, quality of the video|Live URL with a preloaded demo bike, spend cap, rehearsed video|
| Technical depth and execution|20%|Sound engineering, craft|Masked compositing, coordinate handling, structured outputs, clean repo|

Indie track lens (no weight given): creativity, technical ambition, and whether it works.

Indie prizes: $150k, $100k, $75k, $50k, $25k for places 1 to 5.

Rules that shape this plan:
Repository must be public.
Only work built during the hackathon may appear in the demo, and the submission must make clear what was built during the event. Unclear attribution can mean disqualification.
The project must use Meta models (Model API and/or open weights).
No code, data or assets we don't have rights to. Product photos found online stay out of the repo and the video.
Anti-project list includes "simple image analyzers". DreamBike must not look like one. At least half the demo shows the workflow after the image.
Our own constraint: no people in photos or video. The demo uses photos of the owner's own bikes, screen recordings and a voice-over.

3. Problem and users
A customer conversation in a custom shop usually starts with "what would it look like with...". Today the shop answers with words, photos of other builds, catalog pages or a rough Photoshop job. The customer has trouble picturing the result, and the shop spends time on consultations that never turn into jobs.

When the customer decides, someone still has to turn the idea into a parts list, check that each part fits this exact bike, find out which papers each part has, and whether the bike needs a TÜV inspection and an Eintragung afterwards. Then someone writes the quote. In Germany the paperwork question decides whether a part is a quick swap or an expensive project.

Real shop friction this app must handle:
- The bike is in the workshop or showroom, not a studio. Background has tools, tires, other bikes, parts shelves. Lighting is fluorescent and uneven. The photo is taken where the bike stands.
- The customer is standing next to the mechanic, pointing at the screen, saying "make that one look like..." The mechanic has greasy hands and is switching between the bike, the laptop and the conversation.
- The mechanic already knows what bike it is. They do not need a wizard to tell them it is a 2019 Street Bob. Bike identification should be a one-click confirmation, not a multi-step process.
- Photos come from a phone. AirDrop is the fastest path on a Mac. But the customer may have sent the photo via WhatsApp (compressed, reduced resolution) or email. The app should handle lower-quality images gracefully and note when quality is low.
- The customer wants to see something within 30 seconds. The first visual change should happen fast.
- The customer asks two money questions: "How much?" and "Is that legal?" The build sheet and quote answer the first. The fit and paperwork check answers the second.

Users:
Shop owner or mechanic. Uses the app on a Mac laptop at the counter. Photos come from a phone (AirDrop or cable, sometimes WhatsApp or email).
Customer. Looks at the screen with the mechanic and receives the quote.

4. What makes this more than an image editor
Each visual change is tied to a part slot and, when possible, a real product with a euro price and a link to a German or EU shop.
Muse Spark identifies the bike (for Harleys: family such as Sportster, Softail, Dyna or Touring, engine generation, year range, ABS or not) and checks every change against it.
The check covers German approval rules: which paper the part has, whether the shop needs a TÜV Änderungsabnahme, whether an Einzelabnahme would be needed, and what to measure.
The quote uses the shop's own labor times, hourly rate and inspection fees. The quote includes a paperwork summary: "This build requires 1× Änderungsabnahme and 1× Eintragung. Estimated inspection cost: €XXX." This is the line that makes a shop owner say "this saves me an hour of research."
It is tested on the owner's own bikes.

5. Scope
Sized for about 43 hours of solo work with Claude Code writing most of the code.

MVP (the demo depends on these)
Drag and drop a photo (JPEG, PNG, WebP; HEIC converted or rejected with a clear message). Normalize orientation and size.
Automatic cutout of the motorcycle (shown on a neutral background).
Part map: automatic detection of the main part types, shown as clickable overlays. Clicking a spot with no detected part runs a point prompt to segment whatever is there. MVP slots: wheel_front, wheel_rear, fork, tank, handlebar, exhaust, air_cleaner, seat, headlight, fender_front, fender_rear, frame (paint only), engine (paint only), forward_controls, mirrors, turn_signals. That is 16 slots.
Change the selected part by text description. Paint and color changes use the same path.
Change the selected part with a dropped-in reference photo.
Version history with undo and a before/after slider.
Bike identification with user confirmation. Quick confirm: the mechanic types the model or clicks "yes" in one step. No wizard.
Build sheet: one line per change (slot, description, product if known, fit and paperwork status, labor).
Fit and paperwork check per build sheet line.
Quote export as PDF (EUR, 19% VAT, labor, inspection fees, paperwork summary).
Preloaded demo project and spend cap, so judges can try the live URL safely.

Should have
Part search: Muse Spark with web search returns 3 to 5 real products from German or EU shops (name, price in EUR as listed, shop URL, image, approval type if the listing states it). Picking one uses its image as the reference for the edit.
Additional part slots: saddlebags, fairing/windscreen, primary_cover, sissy_bar, grips. These are less common or model-specific. Add them if SAM handles them well on the owner's bikes.
Voice input with Muse Voice Transcribe. Lower value at a laptop, but it adds a fourth Meta model.

Stretch
Side-by-side comparison of 2 or 3 variants.
Engine swap.
Several photos of the same bike with consistent edits.
German version of the quote PDF.

Out of scope
Accounts and multi-user, payments, ordering parts, 3D, cars, mobile layout.

Cut order if behind schedule
1. Voice input.
2. Additional should-have slots (saddlebags, fairing, primary_cover, sissy_bar, grips). Drop from part map. The point-prompt fallback still covers them.
3. Part search falls back to "paste a product URL" (Muse Spark reads the page and fills in the product).
4. Reference photo mode.
Never cut: fit and paperwork check, build sheet, quote. They carry the Impact score.

6. User flow
Take a photo of the bike with a phone. Any angle works. A side view is best because it shows the most parts. On a Harley, the right side shows the exhaust and air cleaner. The left side shows the primary cover. A plain wall helps but is not required in a real shop. The SAM cutout handles cluttered backgrounds. Move the photo to the Mac via AirDrop. If the customer sent it via WhatsApp, the image is compressed. The app should still work but may lose fine detail. If quality is too low, show a message: "Photo is low resolution. For best results, AirDrop the original."

New project, drag the photo in. The app normalizes it and cuts out the bike. The part map runs in the background with a progress indicator (about 5–15 seconds for 16 SAM calls). Muse Spark suggests the bike ("Looks like a 2019 Harley-Davidson Softail Street Bob, Milwaukee-Eight 107, ABS. Correct?") and the user confirms with one click or types a correction. This is fast. The mechanic already knows the bike.

The user clicks the handlebar. It lights up and a panel opens with three tabs: Describe, Use a photo, Search parts.

Describe: "14 inch ape hanger, black". Muse Spark turns that into a precise edit instruction and a part spec. Muse Image renders it. A new version appears with a before/after slider, and a build sheet line is added. The customer is watching the screen. The result should appear within about 15 seconds.

Repeat for other parts. The customer points at the screen: "What about the exhaust?" The mechanic clicks the exhaust. Every version can be undone. Switching between parts should be fast: click a different part, the panel updates.

Build sheet tab, "Check fit and papers". Each line gets a status, the paperwork it needs, and reasons. Example: the ape hanger needs longer clutch cable, throttle cables and brake line, and its Teilegutachten means a TÜV Änderungsabnahme. The exhaust is a US import with no E-mark, so it needs an Einzelabnahme or the shop should find an EU-approved alternative.

Quote: labor, rate and fees come from settings. The quote includes a paperwork summary: "This build requires 1× Änderungsabnahme (ape hangers) and 1× Einzelabnahme (exhaust, if no EU-approved alternative is found). Estimated inspection cost: €250–€400." Export the PDF.

7. Meta models and verified API facts
Checked against Meta's docs on Oct 27, 2026. Reviewers: do not change anything in this section without a doc link. Add questions to 7.2 instead.

7.1 What we use
| Job|Model ID|Endpoint|Notes|
| ---|---|---|---|
| Cutout, part masks, click selection|sam-3.1|POST /v1/responses , streaming recommended|Concept prompt is one short noun phrase per request; lists like  "wheel, fork " return nothing. Box and point prompts use a token grammar, for example  <0f>1<\|point;x=..;y=..;w=..;h=..\|> , with negative points allowed. Up to 16 prompted objects per request. Coordinates in the image's own pixels after EXIF rotation; wrong aspect ratio returns 400. Output is text: on e record per object with box and base85 mask. Parsers:  @meta-sam/parser  (TS, 0.0.13+ for confidence) and  meta-sam-parser  (Python, 0.0.6+ for confidence).  metadata.include_confidence: "true"  adds a score. Results vary slightly between runs. Price $2.50 per 1k images.|
| Part edits, paint, compose with a reference|muse-image-1.0|POST /v1/images/edits  (single shot) or  POST /v1/responses  (multi-turn)|1 to 10 input images per edit. No mask parameter:  mask  returns 400. Output is always opaque.  size  sets only the aspect ratio; returned pixel size differs from the input. Formats webp (default), png, jpeg. Built-in web and image search is on by default; turn off with  tool_enablement  on the images endpoints.  reasoning_strength  is  high  (default) or  low . Multi-turn via  previous_response_id . Price $0.01 per image.|
| Bike ID, instruction rewriting, part search, fit and paperwork check, part labels|muse-spark-1.3|POST /v1/responses|Image input, structured output, search grounding through a  web_search  tool, 1M token context. Audio input on 1.3 is degraded, so voice goes through Muse Voice Transcribe.|
| Voice input (should have)|muse-voice-transcribe-1.0|POST /v1/asr/transcribe  (file) or  wss://api.meta.ai/v1/asr/realtime|Transcript text only. 25 languages, keyword biasing.|
| Uploads|n/a|POST /v1/files ,  purpose: user_data|Upload once, reference by  file_id . Muse Image accepts  file_id ; for SAM images the docs only show  image_url  (URL or base64 data URL).|

General: base URL `https://api.meta.ai/v1`, header `Authorization: Bearer $MODEL_API_KEY`. The OpenAI SDK works if you pass the key explicitly (it doesn't read `MODEL_API_KEY` by itself).

7.2 Not confirmed yet (check in the day 0 spike)
SAM mask placement. In the doc examples the mask raster has exactly the box size (for example box 444 to 679 by 625 to 850, mask `226,236`), so the mask is probably box-relative at full resolution. Confirm with the client library's decode helper before writing compositing code.
Exact request shape for Muse Spark structured output and the `web_search` tool.
Rate limits for each model on our account.
Latency of a Muse Image edit with `reasoning_strength` high vs low.
How stable Muse Image keeps the geometry of untouched parts. Section 9.5 depends on this.
Max input image size for SAM and Muse Image.
How well SAM finds Harley-specific parts ("air cleaner", "primary cover", "forward control", "saddlebag") on real photos, especially with cluttered workshop backgrounds.
How well SAM handles WhatsApp-compressed images (lower resolution, JPEG artifacts).

8. Architecture
8.1 Stack (decided)
App: Next.js (App Router) with TypeScript, one repo, deployed on Vercel. Claude Code writes most of it. The owner knows Python best, so code stays plain and readable, and Claude Code explains TypeScript-specific parts briefly when asked.
Day 0 spike and smoke tests: Python scripts in `/spike` (requests, Pillow, numpy, `meta-sam-parser`). The owner can read, run and change them.
Local development on a MacBook (M1).
Server route handlers proxy every Meta call. `MODEL_API_KEY` stays on the server.
`sharp` on the server for EXIF rotation, resizing, alpha masks and compositing. Canvas in the browser for overlays and click handling.
HEIC: sharp's prebuilt binaries don't decode HEIC. Convert in the browser with a small library, or reject with "export as JPEG". The spike decides.
Project state in the browser (IndexedDB). The server stays stateless. Images are stored as blobs.
PDF with `@react-pdf/renderer` or `pdf-lib`.
UI with Tailwind and shadcn/ui. Desktop layout only.
Vercel function request bodies are capped at about 4.5 MB. Send images as webp at max 2048 px, or upload them to the Meta Files API and pass `file_id` where supported.
Public live URL: a spend cap per visitor and per day, a preloaded demo project with cached results, and a clear message when the cap is reached.

8.2 Route handlers
| Route|In|Out|
| ---|---|---|
| POST /api/normalize|photo file|normalized webp, width, height|
| POST /api/segment|image, mode  concept  or  points , phrase or points|width, height, objects: id, box, mask, confidence|
| POST /api/identify|image|make, model, family, engine, year range, ABS, style, facing direction, confidence|
| POST /api/instruction|slot, user text or reference, bike|edit prompt, part spec, build item title|
| POST /api/edit|base image, reference images, edit prompt, tool settings|edited image, width, height|
| POST /api/search-parts|bike, slot, query, preferred shops|products: name, brand, price text, currency, URL, image URL, approval type, source|
| POST /api/check|bike, build items, shop rules|per item: status, approval, inspection needed, reasons, what to measure, sources|
| POST /api/transcribe|audio|text|

8.3 Data model (sketch)
```
type Bike = { make: string; model: string; family?: string; engine?: string;
   yearFrom?: number; yearTo?: number; abs?: boolean | "unknown";
   style?: string; facing: "left" | "right"; confirmed: boolean };
 type Part = { id: string; slot: SlotId; label: string;
   box: [number, number, number, number]; mask: Uint8Array; maskW: number; maskH: number;
   source: "concept" | "point"; confidence?: number };
 type Version = { id: string; parentId?: string; image: Blob; width: number; height: number;
   cutout?: Blob; parts: Part[]; change?: BuildItem; createdAt: number };
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

9. Pipeline details

9.1 Normalize
Apply EXIF rotation, convert to RGB, scale the long side to at most 2048 px, store width and height. All coordinates in the app are pixels of the normalized image. Clicks on the screen are converted to these pixels before any SAM call. If the input image is below 800 px on the long side (common with WhatsApp), show a non-blocking warning: "Low-resolution photo. Results may be less detailed."

9.2 Cutout
SAM concept prompt "motorcycle". Pick the record with the largest mask area (or the highest confidence). If nothing fits, ask the user to click the bike and use a point prompt. Build an alpha mask, feather the edge by 1 to 2 px, and show the cutout on neutral gray.

Muse Image always returns opaque images, so the cutout is recomputed after every edit by running SAM again. Spike question: do edits look better on the original photo or on the cutout placed on flat light gray? Hypothesis: flat gray gives cleaner edits and an easier re-cut.

9.3 Part map
Harley-first list. Two SAM phrase candidates per slot. Try phrase 1 first. If no detection or confidence is very low, try phrase 2. If both fail, the slot is hidden and the user can still click to trigger a point prompt. One SAM request per phrase. Run in parallel with a concurrency limit of 4. Cost is about 16 requests per photo at MVP, around 4 cents.

Each part mask is clipped to the bike mask. When masks overlap, a click selects the smallest mask that contains the clicked pixel. Cache the part map per version.

Click with no part under it: send a point prompt with one positive point, add the result as a custom part, and let Muse Spark name it from a crop ("which motorcycle part is this?").

MVP slots (16):

| Slot | UI label | SAM phrase 1 | SAM phrase 2 | Best side on Harley | Post-processing |
| --- | --- | --- | --- | --- | --- |
| wheel_front | Front wheel | "motorcycle wheel" | "front wheel" | Both | Split by position using facing direction |
| wheel_rear | Rear wheel | "motorcycle wheel" | "rear wheel" | Both | Split by position using facing direction |
| fork | Fork | "front fork" | "motorcycle fork" | Both | |
| tank | Tank | "fuel tank" | "gas tank" | Both | |
| handlebar | Handlebar | "handlebar" | "motorcycle handlebar" | Both | |
| exhaust | Exhaust | "exhaust pipe" | "motorcycle muffler" | Right | |
| air_cleaner | Air cleaner | "air cleaner" | "air filter" | Right | Right side on most Harleys |
| seat | Seat | "motorcycle seat" | "bike seat" | Both | |
| headlight | Headlight | "headlight" | "motorcycle headlight" | Both | |
| fender_front | Front fender | "front fender" | "motorcycle fender" | Both | Split by position |
| fender_rear | Rear fender | "rear fender" | "motorcycle fender" | Both | Split by position |
| frame | Frame | "motorcycle frame" | "bike frame" | Both | Paint only |
| engine | Engine | "motorcycle engine" | "engine block" | Right | Paint in MVP, swap is stretch |
| forward_controls | Forward controls | "foot peg" | "forward control" | Right | Also try "floorboard" for Touring. Right side shows the exhaust-side controls |
| mirrors | Mirrors | "mirror" | "handlebar mirror" | Both | |
| turn_signals | Turn signals | "turn signal" | "indicator light" | Both | |

Should-have slots (5, add if SAM handles them well):

| Slot | UI label | SAM phrase 1 | SAM phrase 2 | Best side | Notes |
| --- | --- | --- | --- | --- | --- |
| saddlebags | Saddlebags | "saddlebag" | "luggage bag" | Both | Touring models only |
| fairing | Fairing / windscreen | "fairing" | "windscreen" | Both | Touring, Road Glide, Street Glide |
| primary_cover | Primary cover | "primary cover" | "clutch cover" | Left | Left side on Harleys |
| sissy_bar | Sissy bar | "sissy bar" | "backrest" | Rear | |
| grips | Grips | "handlebar grip" | "hand grip" | Both | Cosmetic, no approval needed |

Note: Sportster-specific parts (oil tank, side covers) are not in the default list. The point-prompt fallback covers them. If the shop works mostly on Sportsters, the owner can add them to settings later.

9.4 Edit modes
All modes end in the same call: base image, slot, part box, edit prompt, optional reference images.

Describe (also used for paint). Muse Spark turns the user's words into structured output: an English edit prompt that names the part and its position and says to keep everything else identical, a part spec (for a wheel: type, diameter, color, finish) and a short build item title.

Use a photo. `images[0]` is the base, `images[1]` is the reference. Prompt pattern: "In image 1, replace the motorcycle's front wheel with the wheel shown in image 2. Match the perspective, scale and lighting of image 1. Keep everything else in image 1 unchanged."

Paint prompt pattern (single part): "Repaint the fuel tank in metallic candy red with a thin gold pinstripe. Do not change any shapes or other parts."

Paint prompt pattern (multi-part): "Repaint the fuel tank and both fenders in metallic candy red with a thin gold pinstripe. Keep all shapes, gaps and other parts unchanged. Do not change the frame, engine or any other component." This handles the common "tank and fenders match" request in one edit.

Tool settings: turn image search off when we pass our own reference (faster, more faithful to the reference). Leave it on for text descriptions of named products such as "Screamin' Eagle air cleaner". Test `reasoning_strength` low for previews and high for the final render.

9.5 Keeping the rest of the bike unchanged
Muse Image has no mask input, so we protect the rest of the bike in three layers:
The prompt names the part and its position (front or rear, left or right side of the image).
Optional visual hint: a second input image, a copy of the base with the target part outlined, referred to as "the part outlined in image 2". Test in the spike; it may confuse the model.
Masked composite after the edit. Resize the edited image to the base size. Run SAM on the edited image for the same slot. Region = union of old and new part masks, dilated by about 2 percent of the bike width, edges feathered. Copy edited pixels into the base only inside the region.
Drift check before compositing: compare base and edited image outside the region. If the difference is large (the model shifted or rescaled the whole bike), skip the composite and use the full edited image. Shape changes that move other parts (longer fork, different wheel size, ape hangers) also use the full edited image. The original photo is always kept for before/after.

9.6 Part search
Muse Spark with the `web_search` tool. Input: confirmed bike, slot, user query, preferred shop domains from settings. Output: a JSON list of products, each with a source URL, a price in EUR if listed, and the approval type if the listing states it (ABE, E-mark, Teilegutachten). Prefer German and EU shops. The UI shows "price as listed, check the shop". The server fetches the product image to use as a reference input. It isn't stored in the repo or shown publicly outside the user's project. If search finds nothing usable, the user can paste a product URL or drop in a photo.

9.7 Bike identification, fit and paperwork check

Identify: Muse Spark looks at the photo and returns make, model, family (for Harleys: Sportster, Softail, Dyna, Touring, Street, other), engine generation (Evolution, Twin Cam, Milwaukee-Eight, Revolution Max, other), year range, ABS (yes, no, unknown), style, facing direction and confidence. The user confirms or corrects. Quick confirm: one click if correct, type over if not. The confirmed bike drives every check.

Fit check per slot. This table is the checklist the fit-check prompt uses. All approval and inspection entries are assumptions. The owner must confirm or correct them before the demo. The mechanic checks column lists what a real mechanic looks at before saying "this fits."

| Slot | Mechanic checks (3–6 facts) | Typical German approval | Änderungsabnahme typical? |
| --- | --- | --- | --- |
| wheel_front | Axle diameter (25 mm common on HD), rim width, tire size, ABS sensor ring fit, brake rotor bolt pattern, fender clearance | Teilegutachten or ABE for aftermarket; none for custom one-offs | Yes with Teilegutachten (assumption) |
| wheel_rear | Axle diameter, rim width, tire size, belt or chain clearance, ABS sensor ring, fender clearance, brake rotor bolt pattern | Teilegutachten or ABE | Yes with Teilegutachten (assumption) |
| fork | Triple tree bolt pattern, steering head bearing size, fork length, axle diameter match, fender mount, caliper mount | Teilegutachten for aftermarket (e.g. Öhlins) | Yes if length or geometry changes (assumption) |
| tank | Mounting points, fuel line connection, fuel pump compatibility (EFI), petcock location, frame clearance | Often none or Teilegutachten for aftermarket | Often Einzelabnahme if no Teilegutachten (assumption) |
| handlebar | 1-inch diameter (Harley standard) vs 22 mm, riser bolt pattern, cable length (clutch, throttle, idle), brake line length, wiring harness reach, switch housing compatibility | ABE or Teilegutachten | Yes with Teilegutachten. ABE = carry papers. Taller bars need longer cables (assumption) |
| exhaust | Header pipe diameter, mounting brackets, O2 sensor bungs, ground clearance, heat shielding, noise level in dB(A), catalytic converter if required | ABE or E-mark for EU road-legal. US imports often have none | ABE = carry. No approval = Einzelabnahme. Noise is a frequent issue (assumption) |
| air_cleaner | Intake manifold fit, backing plate bolt pattern, EFI tuning if airflow changes, frame and oil tank clearance | ABE or Teilegutachten | Yes with Teilegutachten (assumption) |
| seat | Mounting bolt pattern, fender clearance, passenger peg compatibility, seat height | Usually no approval needed (not safety-relevant) | Usually no (assumption) |
| headlight | Mounting bracket, wiring connector, bulb type, beam pattern, ECE approval mark | E-mark required for road use | No with E-mark. Einzelabnahme without (assumption) |
| fender_front / fender_rear | Mounting points, tire clearance, width, turn signal mount location | Teilegutachten or none | Depends on approval. Dimensional changes more likely to need inspection (assumption) |
| frame (paint) | N/A for paint. For structural changes: not in MVP scope | N/A | No for paint |
| engine (paint) | N/A for paint. For swap: mounts, wiring, ECU, transmission, frame clearance | N/A for paint. Swap = Einzelabnahme | No for paint. Swap = yes (assumption) |
| forward_controls | Mounting bracket compatibility, brake line routing, shift linkage adjustment, peg position, exhaust clearance | Teilegutachten for aftermarket kits | Yes with Teilegutachten (assumption) |
| mirrors | Thread size (5/16-18 or 10 mm on Harley), mount style (bar-end, riser, fairing), E-mark | E-mark required for road use | No with E-mark. Not road-legal without (assumption) |
| turn_signals | Mounting, wiring, bulb vs LED, flasher relay compatibility, E-mark | E-mark required for road use | No with E-mark (assumption) |
| saddlebags | Mounting bracket, exhaust and rear wheel clearance, lock mechanism, overall width | ABE or Teilegutachten | Depends on approval (assumption) |
| fairing / windscreen | Mounting bracket, headlight clearance, wiring routing, E-mark for windscreen | E-mark for windscreen. Teilegutachten for fairing | Depends (assumption) |
| primary_cover | Gasket surface, bolt pattern, frame and exhaust clearance | Usually no approval needed (cosmetic) | Usually no (assumption) |
| sissy_bar | Mounting on fender struts, height, width, passenger backrest pad | ABE or Teilegutachten | Depends on approval (assumption) |
| grips | Handlebar diameter (1-inch for Harley), throttle tube compatibility, heated grip wiring | Usually no approval needed (cosmetic) | No (assumption) |

Harley-specific examples the check should catch (assumptions, owner to confirm):
Handlebar: Harleys use 1 inch bars, many other bikes 22 mm. Taller bars (ape hangers, 12 inch and above) need longer clutch and throttle cables, a longer brake line and often a wiring extension. On a 2019 Street Bob with stock low-rise bars, switching to 14-inch ape hangers means all three cables and the brake line are too short.
Wheels: axle diameter and ABS sensor ring must match the bike; tire size and belt or fender clearance. On a Milwaukee-Eight Softail, the rear axle is 25 mm. A wheel from a Dyna may not fit without spacer changes.
Exhaust: needs an EU approval for road use in Germany, and noise rules apply. A US-market Vance & Hines or Bassani exhaust typically has no E-mark and no ABE. Without EU approval it needs an Einzelabnahme and may fail on noise. The German noise limit for a 2019 Street Bob is around 80 dB(A) at the registration number (assumption, owner to confirm). Many US exhausts exceed this.
Forward controls: changing from mid-controls to forward controls changes the brake line routing and shift linkage. The brake line may need to be longer. The shift linkage geometry changes.
Lights and indicators: need an E-mark. LED turn signals from a US shop without E-mark are not road-legal.

German approval rules (from TÜV Rheinland and a summary of the StVZO, owner to confirm; not legal advice):
| Part has|What usually happens|
| ---|---|
| ABE|Carry the ABE with the bike. An inspection may still be needed, depending on the conditions written in the ABE.|
| E-mark or EU/ECE type approval|The bike's operating permit stays valid. Check the conditions; an Änderungsabnahme can still be required.|
| Teilegutachten|Always needs an Änderungsabnahme by TÜV, DEKRA or similar (§ 19 Abs. 3 StVZO). Existing Teilegutachten are accepted until June 19, 2028 (§ 72 StVZO transition).|
| Nothing, or the bike isn't covered|Einzelabnahme (§ 19 Abs. 2 with § 21 StVZO). Expensive. The report goes to the registration office.|

After an Änderungsabnahme, the report is usually carried with the bike until the registration papers next change. The owner can add shop rules in settings, and they go into the prompt.

9.8 Quote
Settings: shop name, logo, hourly rate, currency (EUR), VAT (19%), labor hours per slot, fee for an Änderungsabnahme, fee for an Einzelabnahme, note text. Real labor times and rates come from the owner.

Labor defaults (placeholders). The owner must replace these with the shop's real times. These are rough estimates for a German custom shop.

| Slot | Labor range (hours) | Notes |
| --- | --- | --- |
| wheel_front | 1.5–2.5 | Remove, install, balance, ABS check |
| wheel_rear | 2.0–3.5 | Belt adjustment adds time |
| fork | 3.0–6.0 | Triple tree, bearings, alignment |
| tank | 2.0–4.0 | Fuel line, EFI pump, mounting |
| handlebar | 2.0–5.0 | Cables, wiring, brake line, switches |
| exhaust (slip-on) | 1.5–3.0 | Mounting, O2 sensors |
| exhaust (full system) | 3.0–5.0 | Headers, tuning check |
| air_cleaner | 0.5–1.5 | Backing plate, EFI check |
| seat | 0.5–1.0 | Bolt on |
| headlight | 1.0–2.0 | Wiring, mounting, aim |
| fender (each) | 1.0–3.0 | Mounting, clearance, signals |
| frame (paint) | 8.0–20.0 | Strip, prep, paint, cure, reassemble. Multi-day |
| engine (paint) | 4.0–8.0 | Mask, prep, paint, cure |
| forward_controls | 2.0–4.0 | Brake line, shift linkage, mounting |
| mirrors | 0.25–0.5 | Thread, angle |
| turn_signals | 0.5–1.5 | Wiring, flasher relay |
| saddlebags | 1.0–2.0 | Brackets, mounting, locks |
| fairing / windscreen | 2.0–4.0 | Brackets, wiring, headlight |
| primary_cover | 2.0–3.0 | Gasket, bolts, primary fluid |
| sissy_bar | 1.0–2.0 | Brackets, mounting |
| grips | 0.25–0.5 | Remove, install, throttle check |

PDF contents: before/after images, one line per change with part, price as listed, labor hours and line total, inspection fees as their own lines, net, VAT and total, fit and paperwork notes, and a note that the image is a visualization and the real bike may look different.

Paperwork summary block in the quote. After the line items, a summary section: "Paperwork for this build: 1× TÜV Änderungsabnahme (handlebar, Teilegutachten). 1× Einzelabnahme (exhaust, no EU approval). Estimated inspection cost: €250–€400. After inspection, carry reports with the bike until next registration change." The fees use the shop's settings. This block is what makes the quote a shop tool and not just a parts list.

PDF in English for the hackathon; German is stretch.

10. App prompts (written during the build)
Stored as versioned files in `/prompts`, each tested on 5 fixture photos:
`identify`: photo to bike JSON
`instruction`: user text (or reference) plus slot plus bike to edit prompt, spec and title
`compose`: template for edits with a reference image
`paint`: template for color changes (single part and multi-part)
`search-parts`: bike plus slot plus query to product JSON
`fit-check`: bike plus build items plus German rules plus shop rules plus per-slot checklist to fit results
`label-part`: crop to part name

11. Day plan
About 43 hours. Friday hours are an assumption.
| Day|Hours|Goal|Done when|
| ---|---|---|---|
| Tue Oct 27|1|API key works; run Qwen and DeepSeek reviews|One working call to each model; revised plan saved|
| Wed Oct 28|5|Codex spec; Python spike on 5 own bike photos; scaffold app|Spike results in 7.2; app runs locally|
| Thu Oct 29|5|Upload, normalize, cutout, part map, click selection|Click a wheel and it lights up|
| Fri Oct 30|8|Describe mode, compositing, versions, undo, before/after, reference photo mode|Three changes in a row on one bike without breaking other parts|
| Sat Oct 31|5|Bike ID, build sheet, fit and paperwork check|Build sheet shows status, approval and inspection with reasons|
| Sun Nov 1|5|Quote PDF and settings; part search|PDF exports with paperwork summary; search returns real products with EUR prices|
| Mon Nov 2|5|Demo project, spend cap, deploy, test on all own bikes; voice if time|Live URL works on a second laptop|
| Tue Nov 3|5|Record and edit the demo video; README|Video under 3:00 uploaded|
| Wed Nov 4|4|Buffer, final checks, submit by 6 PM ET|Submission confirmed|

12. Demo video (3 minutes)
No people on camera. Screen recording, still photos of the owner's own bikes, voice-over by the owner. The demo bike is a 2019 Harley-Davidson Softail Street Bob, Milwaukee-Eight 107, ABS.

The first 20 seconds must make a judge understand this is a shop tool, not an image editor. The build sheet, paperwork check and quote get at least half the video.

| Time|Content|Voice-over notes|
| ---|---|---|
| 0:00–0:20|Problem. A customer brings in a Street Bob. He wants ape hangers, a new exhaust and a candy red tank. In a normal shop, the mechanic pulls up catalogs, maybe does a rough Photoshop, and spends an hour figuring out fit and TÜV paperwork. | "A customer walks in and says: I want my Street Bob to look like this. In my shop, that used to mean an hour with catalogs and a rough sketch. And then the real question: does it fit, and what does TÜV say?" |
| 0:20–0:35|Drop in a photo. Cutout on gray background. Part map appears with clickable overlays. Bike identified: "2019 Street Bob, Milwaukee-Eight 107, ABS." One click to confirm. | "Drop in a photo. DreamBike cuts out the bike, finds the parts, and identifies it." |
| 0:35–0:55|Click the handlebar. Describe: "14 inch ape hanger, matte black." Muse Image renders it. Before/after slider. Build sheet line appears. | "Click the handlebar. Describe what you want. There it is." |
| 0:55–1:10|Click the exhaust. Search parts. Muse Spark returns 3 results from German shops with EUR prices and approval types. Pick one. It renders on the bike. | "Search for a real exhaust. Prices in euros, from German shops." |
| 1:10–1:25|Paint the tank and fenders: "metallic candy red." Before/after slider. Quick undo and redo to show version history. | "Paint the tank and fenders. Every step can be undone." |
| 1:25–2:20|Build sheet tab. Click "Check fit and papers." The ape hanger line shows: "Teilegutachten → TÜV Änderungsabnahme. Needs longer clutch cable, throttle cables, brake line. Measure cable reach at full lock." The exhaust line shows: "No E-mark, no ABE. US import. Einzelabnahme required (§21 StVZO). Noise may exceed limit. Recommend EU-approved alternative." The mechanic reads the reasons. This is the key moment. | "Now the part that saves real time. The fit check catches that the ape hangers need longer cables and a TÜV inspection. And the exhaust is a US import with no EU approval. That means an Einzelabnahme, or I find an EU-approved alternative." |
| 2:20–2:45|Quote PDF. Before/after images. Line items with EUR prices and labor. Inspection fees. Paperwork summary: "1× Änderungsabnahme, 1× Einzelabnahme. Estimated inspection cost: €250–€400." Net, 19% VAT, total. | "The quote has parts, labor, inspection fees and the paperwork summary. Ready to hand to the customer." |
| 2:45–3:00|Meta models used: SAM for cutout and part masks, Muse Image for edits, Muse Spark for bike ID, fit check and search. Built in 8 days during the hackathon. | "Four Meta models, one pipeline. Built in eight days." |

13. Submission checklist
Public GitHub repo. README covers what it does, which Meta models are used and where, setup, an architecture diagram, and a clear statement that everything was built between Oct 27 and Nov 4, 2026. Commit history shows the progress.
Video at most 3:00, link public.
Live URL works without login, has the demo project, and the spend cap is on.
Meta credits claimed (done) and a spend limit set on the Billing page.
Only the owner's own bike photos in the repo and video. No product images from shops in the repo. No people.

14. Risks
| Risk|Impact|Mitigation|
| ---|---|---|
| Muse Image changes more than the target part|High|Prompt wording, masked composite (9.5),  reasoning_strength  high|
| Edited image shifts the whole bike|Medium|Drift check, fall back to the full edited image|
| SAM misses parts on cluttered photos|Medium|Plain wall preferred but not required. Point prompt fallback. If SAM fails on a slot, hide it. Suggest retake against a less busy background|
| WhatsApp-compressed photos lose detail|Medium|Show warning when resolution is below 800 px. Suggest AirDrop original|
| Edit latency is long (unknown)|Medium|Progress UI, low strength previews, measure in the spike|
| Fit or paperwork check sounds sure but is wrong|High|Sources required,  "verify " by default,  "pre-check, shop decides " in the UI, owner reviews the rule table|
| Search returns dead links, wrong prices or US-only shops|Medium|Preferred EU shops, show source, user can paste a URL|
| HEIC photos from the iPhone|Medium|Convert in the browser or ask for JPEG|
| Judges burn through credits on the live URL|Medium|Spend cap, demo project with cached results|
| Request body limit on Vercel|Medium|webp at max 2048 px, Files API|
| Image rights|High (disqualification)|Own bike photos only in repo and video|
| Scope creep|High|Cut order in section 5|
| Judges see  "just an image editor "|High|Half the demo shows build sheet, paperwork check and quote|
| SAM struggles with new slots (forward controls, mirrors, turn signals)|Low|These are MVP slots but if SAM misses them, the point-prompt fallback covers them. Should-have slots are first to drop|

15. Open questions for the owner
Answered on Oct 27: solo; Python best, other languages fine through Claude Code; Germany (TÜV, ABE, Eintragung), English UI, EUR; Indie track; own bike photos, no people; Harley-Davidson focus plus other bikes; real parts preferred; labor times and rates will come from the owner; Mac M1 laptop; credits claimed; about 5 hours a day, more on Friday; name DreamBike.

Still open:
Labor times per part, hourly rate, and what the shop charges for a TÜV Änderungsabnahme and an Einzelabnahme. The table in 9.8 has placeholders.
Which parts shops do you buy from? Their domains go into the search settings.
Model and year of each bike in your photos (needed to judge the bike ID test).
Do you have photos from the right side and against a plain background? If not, can you take some? A cluttered workshop background is fine, but one clean shot helps the spike.
Is Vercel fine for hosting, and do you have a GitHub account ready for a public repo?
Do the 5 hours a day include the weekend, and how many hours on Friday?
Which Harley families does the shop work on most? This affects which slots to prioritize in the part map. If it is mostly Touring, saddlebags and fairing should move up. If mostly Sportster, add oil tank.
Confirm or correct the per-slot fit-check table in 9.7. The approval and inspection entries are assumptions.

16. Sources
Hackathon participant guide (RULES.md, provided by the owner)
Rubric and prizes (third-party summary of the waiver): https://reconscribe.com/meta-global-ai-developer-hackathon-2026/
Meta Model API quickstart: https://dev.meta.ai/docs/quickstart
Models: https://dev.meta.ai/docs/models
SAM segmenting with prompts: https://dev.meta.ai/docs/sam/segmenting
SAM reading segmentation output: https://dev.meta.ai/docs/sam/reading-segmentation
SAM client libraries: https://dev.meta.ai/docs/sam/client-libraries
Image generation with Muse Image: https://dev.meta.ai/docs/image-generation
Edit an image (API reference): https://dev.meta.ai/docs/api-reference/images/edit-image
Search grounding: https://dev.meta.ai/docs/search-grounding
Structured output: https://dev.meta.ai/docs/structured-output
Speech to text: https://dev.meta.ai/docs/speech-to-text
File handling: https://dev.meta.ai/docs/file-handling
TÜV Rheinland on ABE, Teilegutachten, Änderungsabnahme and Einzelabnahme: https://www.tuv.com/germany/de/lp/mobilit%C3%A4t/vollabnahme/main-navigation/tuner/
StVZO paragraphs summary (§ 19, § 21, § 72): https://kfz-dietrich.com/quellen/motorsport-einzelabnahme-paragraph-21-umbau-eintragung/
````