# DreamBike: hackathon rules and guidelines

What the official rules require and what we decided on top of them. Sources: the official participant guide (https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details, local copy in gitignored `RULES.md`, not republished) and the ground rules from the dropped DJ Muse idea, adapted here. When this file and RULES.md disagree, RULES.md wins.

## 1. Official rules (from RULES.md)

### Theme and models

- Problem statement for DreamBike: **Build for Your World** (bring Meta's models into a domain you know firsthand). The other option is "Push the Frontier".
- The project must use Meta's models. Allowed: Muse Spark series, Muse Wonder, Muse Image, Muse Voice Transcribe and SAM 3.1 through the Meta Model API. Muse Glimmer and Muse Spark Open as open weights. Muse Code as a coding agent.

### Rules

- Repository **must be public**.
- Team: at most 4 people. Solo is allowed (we are solo).
- The demo **must only show features, code and functionality built during the hackathon**. Judges must be able to tell clearly what was built during the event. If they can't, the judges can disqualify the project at their sole discretion.
- New work only: what we present must have been built during the event, and the submission must make that clear.
- Disqualified: projects that violate legal, ethical or platform policies, or that use code, data or assets we don't have the rights to.
- Anti-projects to avoid (generic or against policy): medical advice, basic RAG apps, **simple image analyzers**, simple education chatbots, job application screeners, nutrition coaches, personality analyzers, sports analyzers or coaches, anything political or about war. DreamBike must not look like an image analyzer. At least half the demo shows the build sheet, the fit and paperwork check and the quote.

### Schedule (all times ET)

| Date | What |
|---|---|
| Mon Oct 26, 12:00 PM | Kickoff |
| Oct 27 to Nov 4 | Building period |
| Tue Oct 27, 12 to 1 PM | Agents 101: Build a Multimodal AI Agent |
| Wed Oct 28, 12 to 1 PM | Agents 102: Best Practices for Verifiable Agents |
| Fri Oct 30, 12 to 1 PM | Building Specialized Intelligence on Fireworks |
| Weekdays, 10 to 11 AM | Office hours in Discord #office-hours (text only) |
| Tue Nov 3 | Last full day for submission questions and troubleshooting |
| **Wed Nov 4, 9:00 PM** | **Submissions due on the CV platform.** Late submissions are not considered. Meta credit claim deadline too |
| Thu Nov 5 to Sun Nov 8 | Judging |
| Mon Nov 9, 12:00 PM | Closing ceremony, top 10 (5 per track), live final round, community vote opens |
| Mon Nov 16 | Community vote winner announced |

Our internal target: submitted by **Wed Nov 4, 6:00 PM ET**.

### Submission

- Submit at https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit. One submission per team, entered by the Representative (for us, Tom).
- Required: a **three-minute demo video** of the features, code and functionality built during the hackathon. Judges use the video, the code and the live product.
- Check before submitting: the repo is public, the video link opens, and everyone who worked on it is listed.

### Judging

1. Pass or fail: does the project fit the theme and reasonably use the Meta Model API or open-weight models built into it during the hackathon?
2. Score 0 to 10 per criterion of the rubric.
3. Top 5 per track: final judges watch the videos live and rank them with the same rubric.

### Credits and resources

- $150 Meta Model API credits per participant, claimed via the form by Nov 4, 9:00 PM ET (done). A credit card is required for API calls. **Set a spend limit on the Billing page.**
- Partner credits, not guaranteed: Baseten $100 (use `meta-models/muse-spark-open-1026`, not the ID in their docs), Modal $100, Fireworks $25.
- Docs: https://dev.meta.ai/docs/overview, cookbook: https://github.com/meta-models/meta-model-cookbook

### VERIFY (missing from the local copy or not official yet)

- The rubric table is missing from RULES.md (`[table]`). The weights used in PLAN.md (Impact 30%, Meta AI tooling 25%, Demo 25%, Technical depth 20%) come from a third-party summary. Check them on the CV page.
- The prize tables for the Indie track and the bonus prizes are missing too.
- Whether a submission can be edited after it is sent, and whether the video has to be hosted somewhere specific.

## 2. Provenance: what was built when

The contribution boundary must be explicit in the README, the submission and the video.

- Only work actually built between Oct 27 and Nov 4, 2026 is claimed as hackathon work. Record actual dates, not planned ones.
- Commit after every ticket with a clear message. The commit history is our evidence.
- Existing tools and libraries may be used with attribution. Their implementation is not our work.
- No DreamBike code existed before Oct 27. On Oct 27, only planning documents and review prompts were written.

README table, filled with what actually happened:

| Category | Contents | Claimed as our work |
|---|---|---|
| Pre-existing third-party work | Meta Model API and models, Next.js, npm and Python libraries, Vercel, IBM Plex fonts (SIL OFL) | No |
| Our work made before Oct 27 | Nordlicht design system: only its color, type and spacing values are reused, the stylesheet is written new (PLAN.md 8.4) | No |
| Our work built Oct 27 to Nov 4 | Fill in per day from the commit history | Yes |
| Media | Own bike photos with date taken, see CREDITS.md | Disclosed separately |

Disclosure for the README, submission and the end of the video (adapt to what was really built):

> DreamBike was built from scratch during the hackathon, Oct 27 to Nov 4, 2026. It uses Meta's SAM 3.1, Muse Image and Muse Spark through the Meta Model API, plus open-source libraries listed in the README. The bike photos are our own. Everything in this demo is new work from the event.

## 3. Rights: code, photos and other assets

Every file in the repo, the app and the video needs a clear source and a clear right to use it. This holds even if it blocks a feature.

- **Photos**: only the owner's own bike photos in the repo, the video and the Meta calls. No people. No stock photos.
- **Product images from shops**: may be fetched at runtime as a reference input inside a user's project. Never committed, never shown in the demo video, never published outside the user's project.
- **Code**: no code copied from other repositories. Read docs and examples, then write our own. Dependencies keep their own licenses and are listed in `package.json` and `requirements.txt`.
- **License**: our original code is MIT. The MIT license does not cover dependencies, Meta services or photos.
- **Graphics**: no downloaded icons, templates or fonts without a clear license. Keep visuals original and simple (shadcn/ui and Tailwind are MIT).
- **No endorsement**: do not claim Meta, Harley-Davidson, TÜV or any shop endorses DreamBike. Brand names are used only to describe parts and bikes.
- **Legal content**: the fit and paperwork check is a pre-check, not legal advice. The UI says so.

CREDITS.md format for photos:

| File | Bike | Photographer | Date taken | License | Sent to Meta |
|---|---|---|---|---|---|
| fixtures/bike_01.jpg | Actual model and year | Actual person | Actual date | Own photo | Yes, Contributor mode, plate blurred |

## 4. Contributor mode

We use `muse-spark-1.3-contributor`. In Contributor mode, **Meta may use what we send to train its models**. That sets these rules:

- Send only our own bike photos. Tom records a dated written permission for model analysis, possible Meta training and the public demo, kept privately in `consent/` (gitignored). Claude does not write or sign this on Tom's behalf.
- **Blur or crop license plates** and anything else with personal data (addresses, papers, VIN plates) before a photo is uploaded or committed.
- No people in any photo.
- Customer photos only with the customer's consent for the same uses. For the hackathon: none.
- Do not switch to Standard mode to get around a missing approval, and don't switch to Contributor to rescue one.
- The live URL is a public app. Visitors may upload their own photos. Show a short notice before upload that the photo is processed by Meta's models and may be used for training.
- Spike question: is Contributor mode a Spark-only variant, or do SAM and Muse Image have one too? Record the answer in PLAN.md §7.2.

## 5. Budget for the $150 credits

- Spend limit set on the Billing page before the first call.
- Keep a cost ledger (date, route, model, count, estimated cost) that survives restarts. It never stores images, prompts, responses or keys.
- At most about $5 per ticket. Ask Tom before going over.
- Warn at $50 total. Stop development calls at $50. The next $50 is for the demo recording and the judges' live URL. Hard cap: $100, so $50 of the credits stay untouched.
- Live URL: a spend cap per visitor and per day, a preloaded demo project with cached results, and a clear message when the cap is reached.
- If usage or price can't be accounted for, show the cost as unknown and stop paid calls until it is checked.

## 6. Secrets and repo hygiene

- `.env` and `.env.local` never go into git. Only `.env.example` without values.
- `MODEL_API_KEY` stays on the server. Every Meta call goes through a route handler.
- Before the repo goes public: check the full git history for keys, `.env` files, consent records and unblurred photos.
- `RULES.md` stays gitignored. Link to the official page instead.

## 7. Honest demo

- The video shows only what works and was built during the event. No unbuilt features, not even as "coming soon" mockups. Future work is said out loud and labeled as future.
- Label cached or preloaded demo results as such.
- If a step is done by hand in the demo, say so.
- Keep a full-length backup recording of a successful run.

## 8. Submission checklist

- [ ] Rules checked against the CV page; VERIFY items in §1 resolved or noted
- [ ] Repo public; no keys, `.env`, consent records or unblurred photos in files or history
- [ ] README: what it does, why, which Meta models are used and where, setup, architecture diagram, rights, limitations, provenance table and disclosure (§2)
- [ ] MIT LICENSE for our code only; dependencies attributed
- [ ] CREDITS.md lists every photo used, with date and consent coverage
- [ ] Video at most 3:00, shows only event-built work, about half of it on the build sheet, check and quote, link tested in a private window
- [ ] Live URL works without login on a second laptop, demo project loaded, spend cap on
- [ ] Spend checked against the caps in §5; Billing spend limit on
- [ ] Indie Developer track and Build for Your World selected, all fields filled, Tom listed as the Representative
- [ ] Submitted by Wed Nov 4, 6:00 PM ET (official deadline 9:00 PM ET)
