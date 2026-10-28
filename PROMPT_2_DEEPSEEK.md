# Prompt 2 of 3: DeepSeek (technical risk review)

How to use: turn on DeepSeek's thinking mode (the "DeepThink" toggle). Paste everything below the line as a single user message (no system prompt), then paste the PLAN.md that came back from Qwen. Save DeepSeek's revised PLAN.md and pass it to prompt 3 (Codex).

________________________________________________________________

I'm building a hackathon project alone: DreamBike, a web app for a German custom motorcycle shop. I have about 43 hours between Oct 27 and Nov 4, 2026 (deadline Nov 4, 9 PM ET), roughly 5 hours a day and more on Friday. A coding agent (Claude Code) writes most of the code. I know Python best. The plan is below. A product reviewer already improved the product and domain parts. Act as a senior engineer who red-teams the technical plan before the coding agent starts.

Think it through carefully before answering. Work out the failure cases step by step. Keep the final answer concise and structured.

Hard constraints:
- Section 7.1 lists Meta API facts checked against the official docs. Treat them as true. The important ones: SAM 3.1 takes one noun phrase per request, or box and point prompts in a token grammar, coordinates in the image's own pixels; masks come back base85 encoded. Muse Image has no mask input, always returns opaque images, and returns a different pixel size than the input. If your analysis depends on something not stated there, add it to section 7.2 as a spike question instead of assuming it.
- The stack is decided: Next.js with TypeScript on Vercel for the app, Python scripts for the day 0 spike, local development on an M1 MacBook. Don't propose a different stack.
- Keep the product and domain content from the previous reviewer unless it is technically wrong. Say so in the change log if you change it.
- Judges will try the live URL, which runs on my API credits.
- One builder. Prefer simple solutions that work for a demo over general ones.

Do these nine things:

1. Failure modes. For each pipeline stage in section 9 (normalize, cutout, part map, click selection, edit, composite, search, identify, fit check, quote), list what can fail. For each: likelihood (low, medium, high), impact, how the app detects it, the mitigation, and whether it would break the demo.

2. Coordinates. Write the exact transform chain: screen click, displayed image, normalized image pixels, SAM prompt `w` and `h`, SAM box and mask back to normalized pixels, Muse Image output (different size) back to normalized pixels. Include EXIF rotation. Describe a small test that proves each step is right.

3. Compositing (section 9.5). Turn it into an exact algorithm with parameters: resize method, which masks, dilation radius, feather width, drift metric and threshold, what happens on failure. Give pseudocode. Say where it runs (server with sharp or browser canvas) and why. Estimate runtime for a 2048 px image.

4. Latency and cost. Budget per new photo and per edit: number of calls per model, rough latency (mark unknowns), cost. Propose concurrency limits, what to precompute while the user is still deciding, and cache keys.

5. Versions and invalidation. Define the version graph. After an edit, which data must be recomputed (cutout, part map, bike ID, fit results) and which can be reused? Give the rule.

6. Day 0 spike. Design 5 to 7 experiments in Python to run on the owner's real bike photos before building the app. For each: what to run, pass/fail threshold, and which plan decision it settles (for example: edit on the original photo or on the cutout on gray; does the outline hint help; is drift small enough for compositing; reasoning_strength low vs high; HEIC handling; how well SAM finds Harley parts).

7. Schedule. Check the hours per day in section 11. Mark the critical path. If it doesn't fit, say what to cut and in which order.

8. LLM output reliability. For bike ID, instruction rewriting, part search and the fit and paperwork check: schema validation, retries, timeouts, what to show when a call fails, how to stop the check from sounding certain when it isn't, and how to validate search results (dead links, missing prices, non-EU shops, wrong product type).

9. Public live URL. Design the spend cap, the preloaded demo project with cached results, and basic abuse protection, in the simplest form that works on Vercel without a database if possible.

Rules for your answer:
- Put new technical content into the right sections of the plan. Add a section "9.9 Engineering details" for anything that doesn't fit elsewhere.
- Keep section numbers and headings stable.
- No code beyond pseudocode and short type sketches.
- Plain American English, short sentences.

Output format, exactly two parts:

Part A: "Change log". At most 25 bullets, each "Section X: what changed and why".

Part B: the complete revised PLAN.md inside one code block that opens with ````markdown (four backticks) and closes with four backticks. Output the whole file.

Here is the plan:
