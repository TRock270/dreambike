# Demo script (T16)

The PLAN.md section 12 sequence, using only shipped features and the three Meta models (SAM 3.1, Muse Spark, Muse Image). At most 3:00. No people on camera; the owner's bike photos only; voice-over by the owner. Steps marked CACHED play precomputed demo results, and steps marked MANUAL are typed by hand, not model output. Say both aloud.

Recording before Nov 5: the public site shows only the cached demo until its live window opens. Live steps can be recorded on the owner's machine under `npm run dev` with the owner's key and the budget ledger (`BUDGET_TICKET=T16`); the owner clicks every paid action, one render per click. Otherwise play them CACHED.

| Time | On screen | Say | Label |
| --- | --- | --- | --- |
| 0:00-0:15 | The owner's bike photo | A customer cannot see a build at the counter, and the shop has to look up parts, fit and paperwork by hand | Photo is the owner's own |
| 0:15-0:30 | Import, bike cutout and part outlines, bike confirmation | SAM 3.1 finds the bike and its parts; Muse Spark names the bike and I confirm it | Live on the owner's machine, else CACHED |
| 0:30-0:55 | One edit: pick a part from the list or draw a box, instruction, render, before/after, accept, undo | One render per click (Muse Image); the result is composited back; I accept it; undo moves the pointer | Live on the owner's machine, else CACHED v1-v3 |
| 0:55-1:35 | Build sheet: parts, labor, fit concerns to verify, missing measurements; optionally one product link lookup | Each accepted change updates the build sheet; the fit check is a pre-check that needs sources outside the shop, and what it cannot prove says verify | Fit result CACHED (real check, 2026-10-29: no citable source, so every item says verify); product fields MANUAL, or from a link lookup (owner's machine only; price and approval only when the shop page shows them) |
| 1:35-2:00 | Paperwork summary: approval, inspection, registration | A German paperwork pre-check, not legal advice | CACHED |
| 2:00-2:35 | Estimate: labor and fees in EUR, 19% VAT, export the PDF | Integer EUR cents, VAT, before/after images and the paperwork summary in a client-side PDF | Shop and prices are illustrative; MANUAL entries named |
| 2:35-2:50 | Public URL, demo banner, "Try editing" | The public site shows the cached demo; live edits only Nov 5 to 9, $5 a day shared by all visitors, $0.50 per visitor. If live steps were shown: they were recorded on my own machine before the public window opens | CACHED |
| 2:50-3:00 | Credits card | Built Oct 27 to Nov 4 with Claude Code; SAM 3.1, Muse Spark, Muse Image; owner's photos; name any tool used to edit the video | Disclosure from the README |

Build sheet, paperwork and estimate take about 100 seconds (0:55 to 2:35).

Keep out of the video:

- Voice input and a German PDF: not built. Text search with web search: local development only; do not show it as a site feature.
- Shop product photos: never on screen, not as a reference photo preview and not as a render made from one. That includes the Oct 31 tank renders and the PDF exported with them.
- The studio reference photo of another motorcycle and anything rendered from it (private, not published).
- Unblurred plates, VIN plates, addresses, papers, people, stock images, and music without a clear license.
- Generated or mocked footage of the app: show the real app only.

Keep a full-length successful backup recording, and test the uploaded video link in a private window.
