# DreamBike submission notes

Working file for the submission. T15 adds the repository, video and README fields; T18 records the actual submission.

## Live URL

- Production: https://dreambike-pied.vercel.app (Vercel Hobby, region iad1, Node 22 pinned by `package.json` engines, deployed from the `main` branch of this repository). Recorded 2026-10-30.
- Opens without login. The first page shows the demo project with precomputed results; it makes no AI calls.

## When live AI edits are available

**Status: set up, not yet confirmed on the live site.** This section becomes final once the window and the $5 cap are deployed and checked (TASKS.md T14).

- Live edits on the public site run only from **Thursday, November 5 to Monday, November 9, 2026, US Eastern time**: the official judging days (November 5–8) and the live final round on November 9 ([official participant guide](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details)). The owner chose this window. Outside these days the site shows the cached demo only, and "Try editing" still copies the demo into your browser.
- During that window the site spends at most $5 per day in total and $0.50 per visitor per day. When a limit is reached the site says so and the cached demo keeps working.
- The fit check with web search is off on the public site, because its search cost per request cannot be counted exactly. The demo shows the results of a real fit check made on 2026-10-29.
- Voice input and product search are not part of this build.

## Checked on the deployed site (2026-10-30)

- `python spike/deployment.py --origin https://dreambike-pied.vercel.app` passed all 26 checks, in demo-only and in live mode: demo files match their hashes, requests from other sites and oversized uploads are refused, and the browser code holds no secret values or names.
- The cached demo opened without login in Chrome (macOS) and Safari (iPhone), both in private windows, without a Vercel login.
- One real edit (part mask, instruction, image) finished in under 30 seconds and cost $0.013. The edit route allows 120 seconds; the platform limit is 300 seconds.
- The daily limit was tested on the live site: at the limit the site refused the edit with the budget message and nothing was charged.
