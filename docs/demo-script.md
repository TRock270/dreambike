# Demo script (first draft for T16)

Draft of the PLAN.md section 12 sequence, using only shipped features and the three Meta models (SAM 3.1, Muse Spark, Muse Image). T16 refines the wording and the timing and records the video (at most 3:00). No people on camera; the owner's bike photos only; voice-over by the owner. Steps marked CACHED play precomputed demo results, and steps marked MANUAL are typed by hand, not model output. Say both aloud.

| Time | On screen | Say | Label |
| --- | --- | --- | --- |
| 0:00-0:15 | The owner's bike photo | A customer cannot see a build at the counter, and the shop has to look up parts, fit and paperwork by hand | Photo is the owner's own |
| 0:15-0:30 | Import, bike cutout and part outlines, bike confirmation | SAM 3.1 finds the bike and its parts; Muse Spark names the bike and I confirm it | CACHED if the live window is closed |
| 0:30-0:55 | One edit: pick a part, instruction, render, before/after, accept, undo | One render per click (Muse Image); the result is composited back; I accept it; undo moves the pointer | Real edit if live, else CACHED v1-v3 |
| 0:55-1:35 | Build sheet: parts, labor, fit concerns to verify, missing measurements | Each accepted change updates the build sheet; the fit check searched the web, found no citable source, so every item says verify and lists what to measure | Fit result CACHED (real check, 2026-10-29); product fields MANUAL |
| 1:35-2:00 | Paperwork summary: approval, inspection, registration | A German paperwork pre-check, not legal advice | CACHED |
| 2:00-2:35 | Estimate: labor and fees in EUR, 19% VAT, export the PDF | Integer EUR cents, VAT, before/after images and the paperwork summary in a client-side PDF | Shop and prices are illustrative; MANUAL entries named |
| 2:35-2:50 | Public URL, demo banner, "Try editing" | The public site shows the cached demo; live edits only Nov 5 to 9, $5 a day, $0.50 per visitor | CACHED |
| 2:50-3:00 | Credits card | Built Oct 27 to Nov 4 with Claude Code; SAM 3.1, Muse Spark, Muse Image; owner's photos | Disclosure from the README |

Build sheet, paperwork and estimate take about 100 seconds (0:55 to 2:35). Do not mention voice input, part search or a German PDF: they are not built. Keep a full-length successful backup recording.
