# DreamBike submission notes

Working file for the submission. T15 added the repository, video and README fields below; T18 records the actual submission.

## Links

- Repository: https://github.com/TRock270/dreambike (public)
- Live site: https://dreambike-pied.vercel.app
- Demo video: https://youtu.be/BC1Q0AY_HWk (2:56, English subtitles, unlisted on YouTube)
- Official participant page: https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details

## CV form values

| Field | Value |
| --- | --- |
| Track | Indie Developer |
| Theme | Build for Your World |
| Representative | Tom (GitHub TRock270) |
| Team | Solo |

Meta models to name: SAM 3.1, Muse Spark (`muse-spark-1.3-contributor`), Muse Image (`muse-image-1.0`). Voice is not used.

## Live URL

- Production: https://dreambike-pied.vercel.app (Vercel Hobby, region iad1, Node 22 pinned by `package.json` engines, deployed from the `main` branch of this repository). Recorded 2026-10-30.
- Opens without login. The first page shows the demo project with precomputed results; it makes no AI calls.

## When live AI edits are available

**Status: deployed and checked on 2026-10-30.** Outside the window the live site reports demo-only with a $5 daily cap. The switch to live on November 5 follows from the same rule and is tested offline, including the US daylight-saving change; it will be checked on the live site that day.

- Live edits on the public site run only from **Thursday, November 5 to Monday, November 9, 2026, US Eastern time**: the official judging days (November 5–8) and the live final round on November 9 ([official participant guide](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details)). The owner chose this window. Outside these days the site shows the cached demo only, and "Try editing" still copies the demo into your browser.
- During that window the site spends at most $5 per day in total and $0.50 per visitor per day. When a limit is reached the site says so and the cached demo keeps working.
- The fit check with web search is off on the public site, because its search cost per request cannot be counted exactly. The demo shows the results of a real fit check made on 2026-10-29.
- Part lookup by product link and product photos work only for the shops in the server's shop list. That list is not set on the public site yet (owner item 9), so part lookup is off there until it is. Text search with web search runs only on a local machine. Voice input is not part of this build.

## Checked on the deployed site (2026-10-30)

- `python spike/deployment.py --origin https://dreambike-pied.vercel.app` passed all 26 checks, in demo-only and in live mode: demo files match their hashes, requests from other sites and oversized uploads are refused, and the browser code holds no secret values or names.
- The cached demo opened without login in Chrome (macOS) and Safari (iPhone), both in private windows, without a Vercel login.
- One real edit (part mask, instruction, image) finished in under 30 seconds and cost $0.013. The edit route allows 120 seconds; the platform limit is 300 seconds.
- The daily limit was tested on the live site: at the limit the site refused the edit with the budget message and nothing was charged.

## Checklist (HACKATHON_GUIDELINES.md section 8), state on 2026-11-02

- [x] Rules checked against the CV page; VERIFY items resolved or noted. Rubric: asked to compare the CV page with the weights used in PLAN.md (Impact 30%, Meta AI tooling 25%, Demo 25%, Technical depth 20%, from a third-party summary), the owner replied on 2026-11-02 "bewertungstabelle ist so, wie du sie gefunden hast" (the rubric table is as you found it). The lead reads this as the same weights, but it could also mean the table is missing on the CV page too; the weights stay unverified by the lead.
- [x] Repo public; no keys, `.env`, consent records or unblurred photos in files or history. Scan of 2026-10-30 over the working tree and all 661 blobs in history (counts only, no values printed): 0 hits for the API key, the Redis URL and token and the visitor secret; 0 generic key shapes; no private folder, consent record, rules copy or env file ever in the public history; no EXIF/XMP in the public images. Identifiers left in the public history are owner item 6 below.
- [x] README: what it does, why, Meta models and where, setup, architecture diagram, rights, limitations, provenance table and disclosure. Written in T15. Its steps were run on 2026-10-30 in a clean export of the repository without any env file: `npm ci`, `npm run build`, `npm start`; health reported demo_only, the demo page and files loaded, and a POST was refused (403).
- [x] MIT LICENSE for our code only; dependencies attributed (`LICENSE`, `CREDITS.md`).
- [x] CREDITS.md lists every photo used, with date and consent coverage.
- [x] Video at most 3:00, shows only event-built work, about half on build sheet, check and quote, link tested in a private window. Current cut: on 2026-11-02 the lead asked whether the new link opens in a private window, whether the voice at 1:24–1:32 says 19% VAT (and sounds clean), and whether the video is unlisted; the owner replied "Ja, alles bestätigt" (yes, all confirmed). No agent listened to the audio. History (T16): the first cut (2:54, https://youtu.be/Cvz3Yg3ld2M) was checked on 2026-11-01; the owner replied "video link klappt" (the link works) after the lead asked for a private-window check. Current cut (2:56, https://youtu.be/BC1Q0AY_HWk, uploaded by the owner on 2026-11-02): the same recording and voice, post-produced by OpenAI Codex (subtitles, zooms, audio levelling, end card). Duration 2:56.04 (ffprobe). In the lead's frame check (one frame every 3 s) the chapter labels show build sheet, fit, fees, estimate and PDF from about 0:40 to 2:23, and no person, readable plate, shop product photo or studio photo. The YouTube oEmbed for the new link answered 200 without a login on 2026-11-02 08:35 ET.
- [x] Live URL works without login on a second device. Checked 2026-10-30 in private windows on Chrome macOS and Safari iPhone, and again by the owner on 2026-11-02 at about 9:00 ET in a private Safari window on the iPhone: "Live AI is off" banner, demo steps v0–v3, the demo PDF and "Try editing" worked. No second laptop was used. The demo project is loaded and the spend cap is on.
- [x] Spend checked against the caps: the owner read a Meta Billing total of $1.69 on 2026-11-02 (it was $0.77 on 2026-10-30, see `docs/api-evidence.md`), far below the $50 development stop and the $100 project cap. The Billing spend limit is set by the owner.
- [x] Indie Developer track and Build for Your World selected, all fields filled, Tom listed as the Representative. Done (T18): team name Tom Sickert, solo member TRock270; repo, video and descriptions as above; the description and Meta-use texts were drafted by the lead and pasted by the owner.
- [x] Submitted by Wed Nov 4, 6:00 PM ET (official deadline 9:00 PM ET). Done (T18), by the owner's report only: the owner submitted the form on cerebralvalley.ai and reported "alles submitted" on 2026-11-02 at about 09:10 ET. No confirmation email or receipt was shown to the lead. In the optional survey, the lead advised moving the search-cost note from "Muse Code capability missing" to "Something else"; the owner confirmed on 2026-11-02: "ja habe das feld geändert" (yes, I changed the field).

## Missing owner items

1. Done 2026-11-02: required fields filled on the CV page; rubric answer recorded in the checklist (weights not verified by the lead).
2. Done 2026-11-02 (T16): video recorded, URL checked in a private window, in README and here.
3. Done: T15 pushed (later pushes up to e6f3b74 on 2026-11-02).
4. Done 2026-11-02: asked to confirm the Claude Code disclosure wording in the README provenance section and on the video end card, the owner replied "ja".
5. Nov 5: check that `GET /api/budget` on the live site reports `liveEnabled` true. Nov 10: check that it reports false again.
6. Decide on the personal details already in the public Git history: older commits of TASKS.md and PLAN.md name the shop on the studio photo and the family relation (for example commit 27638c4), and every commit carries the owner's university email as author. Decided by the owner on 2026-10-30: history stays unchanged (it is the dated evidence of the build); current files no longer name the shop or the family relation (README, PLAN.md, TASKS.md and one sentence in each of the two review answers in `review/planning/`, marked as removed).
7. Done 2026-11-02 with a second device instead of a second laptop: private Safari window on the iPhone, about 9:00 ET (see checklist).
8. Done 2026-11-02: Billing total $1.69, read by the owner before submitting.
9. Optional (T12): to offer part lookup on the public site, set PUBLIC_SHOP_DOMAINS in Vercel Production (the same 34 hosts as locally), redeploy and rerun `spike/deployment.py --expect demo_only`. Product photos from Thunderbike come from thunderbike.de, which is not in the list; add it only if you want those photos.
