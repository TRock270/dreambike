# T8 start plan: build sheet and manual product input

Prepared 2026-10-28 by the lead for the next session. Nothing here is built yet.
Read with TASKS.md (T8 ticket, newest Handoff entry), SPEC.md sections 4, 9, 10 and 11, and CLAUDE.md.

## Owner decisions (2026-10-28)

- Place: clicking "Build sheet" at the bottom turns the right panel into a wide sheet panel
  (about half the window). The photo stays visible on the left, contain-fitted. Clicking
  "Build sheet" again, or "Back to editor" in the panel, returns to the edit folds.
- Lead scope note: the ticket's Files line also names "seed mock product/check data". It is
  deferred. Check data needs T9's FitResult flow, and seeded products belong to the T13 cached demo.
  Mock products in T8 would risk mock data in real projects. The T8 log entry records this deferral.
- The owner wants the session to start T8 without further questions. Workflows are opted in
  (CLAUDE.md). Stop after T8: T9 needs grounded paid calls and owner gates.

## What already exists (checked 2026-10-28)

- BuildItem, Product, Fee and Version (kind "root" | "visual" | "sheet") schemas in
  src/lib/contracts.ts. No schema change is planned for T8.
- project.ts: newBuildItem (all prices and labor null/unknown), visualChild (same-slot item is
  replaced, the parent keeps the old one), activeItems, exportPlan.
- db.ts: acceptVisual only. Its comment says sheet versions get their own writer in T8.
- AppShell.tsx: "Build sheet" and "Estimate" are placeholder buttons with no action.
- No BuildSheet.tsx or ProductFields.tsx. Both are already in the review and fix routing.
- Allow lines exist for tests/project, db and projectsession. The owner still has to add
  `Bash(npx --no-install vitest run tests/folderexport.test.ts)` to .claude/settings.json.

## Run

`/build-ticket` with these args:

```json
{
  "ticket": "T8",
  "goal": "Build sheet and manual product input (TASKS.md T8). Owner decision 2026-10-28: the sheet opens as a wide right panel, the photo stays visible. Plan: docs/t8-start.md",
  "checks": ["npm run typecheck", "npm run lint", "npm test", "npm run build", ".venv/bin/python spike/local_images.py --fixture-set all"],
  "units": [
    {
      "id": "S1",
      "builder": "shop-builder",
      "files": ["src/lib/project.ts", "tests/project.test.ts"],
      "task": "Pure sheet logic in project.ts, no schema change. (1) sheetChild(parent, {versionId, createdAt, items, fees}) returns a kind 'sheet' child of parent that shares parent.image, cutoutImageId, bikeMaskId and parts unchanged, change null, and copies composed/aligned/drift/fallbackReason; parent is never modified; result passes VersionSchema. (2) sheetChangeLabel(parent, child): short history text from the item diff, e.g. 'Tank: price', 'Tank: product', 'Rear wheel removed'; several changes are joined, at most about 80 characters. (3) editItem(items, itemId, patch) for title, spec, product, costKind, partPriceCents, taxBasis, laborMinutes, zeroLaborConfirmed, mechanicNotes. A physical change (title, spec, product identity name/brand/partNumber/url, approval or approvalText, costKind) clears fit, fitInputHash, fitCheckedAt and fitReviewedHash on EVERY item (SPEC 9: combinations matter). Price, tax basis, labor and notes keep fit (they only make the estimate stale). costKind labor_only sets partPriceCents to 0 and product to null; switching back to part sets partPriceCents to null (never an invented price). laborMinutes 0 is refused unless zeroLaborConfirmed is true and mechanicNotes is not blank (SPEC 11). Return {ok:true, items} or {ok:false, message} in plain words; never throw for user input. (4) removeItem(items, fees, itemId): explicit removal, drops the id from every fee's itemIds, clears all fits like a physical change. (5) manualProduct(input, now): Product from mechanic input with a new id, https url only, imageUrl null, fulfillmentRegion 'unknown', linkState 'unchecked', source {url, title: name, accessedAt: now ISO, supports: 'Entered by the mechanic'}, priceText = the listed text as typed; the item fields partPriceCents/taxBasis stay the price that counts, product.priceEurCents null and product.taxBasis 'unknown'. (6) parseEuroInput(text): integer cents or a plain-words error. ',' is the decimal mark when present and '.' then groups thousands ('1.234,56'); without ',', '.' followed by 1 or 2 digits is decimal ('1234.5'), '.' followed by exactly 3 digits is ambiguous and refused with the hint 'Write 1234 or 1.234,00'. Optional leading/trailing '€' or 'EUR' and spaces; refuse negatives, more than 2 decimals, empty text and values above Cents max. (7) exportPlan: a sheet version reuses its parent's image file (no second .webp; dedupe by image id), and history.md says 'Sheet change: <label>' for it; sheet lines in history.md also show price as listed with basis, or 'price unknown', and labor minutes or 'labor unknown'. Tests in tests/project.test.ts must check behavior, not copy code: sheetChild shares the image and leaves parent items unchanged; a product change clears fits on all items while a price change keeps them; labor_only gives 0 part cost and switching back gives null; zero labor without confirmation and notes is refused; removeItem also cleans fees; parseEuroInput table incl. the ambiguous case and rounding refusal; exportPlan writes no duplicate image for a sheet version."
    },
    {
      "id": "S2",
      "builder": "shop-builder",
      "dependsOn": ["S1"],
      "files": ["src/lib/db.ts", "src/lib/browser/projectSession.ts", "tests/db.test.ts", "tests/projectsession.test.ts"],
      "task": "Persist sheet revisions (SPEC 9). db.ts: acceptSheet(h, projectId, expectedHeadId, version) next to acceptVisual, same style. Validate with VersionSchema; refuse with InvalidWriteError unless kind is 'sheet', projectId matches and parentId equals expectedHeadId. Inside one writeTx: re-read the project, 'project_missing' or 'stale_head' exactly like acceptVisual, idempotent success on a retry with the same version id, and require that the version's image ref, cutoutImageId, bikeMaskId and parts equal the stored parent's (no new blobs, nothing to dedupe); write the version and move the head; run enforceTarget. Reuse AcceptResult. projectSession.ts: saveSheet(session, {ref, items, fees}) that generates the version id before the transaction, builds the child with sheetChild, calls acceptSheet, and returns the same result shape the visual accept path returns; keep the in-memory path the visual accept uses when storage is unavailable. Tests: accept then undo restores the parent's sheet; a stale head is refused and writes nothing; a retry with the same ids writes one version; a sheet version with a different image ref is refused; the in-memory path moves the head too."
    },
    {
      "id": "U1",
      "builder": "ui-builder",
      "dependsOn": ["S1", "S2"],
      "files": ["src/components/BuildSheet.tsx", "src/components/ProductFields.tsx", "src/components/AppShell.tsx", "src/components/Workspace.tsx", "src/components/VersionStrip.tsx"],
      "task": "Build sheet UI, owner decision: wide right panel. AppShell: 'Build sheet' becomes a toggle (aria-pressed) that Workspace controls; 'Estimate' stays a disabled button with the text 'Estimate (comes later)'. Workspace: while the sheet is open the aside widens to about half the window and shows BuildSheet instead of the edit folds; the photo column stays and keeps its contain fit; 'Back to editor' and the toggle close it; fold states survive. BuildSheet shows the head version's activeItems: slot label and title; product name as a link (target _blank, rel noopener noreferrer) or 'No product yet'; price as listed formatted with Intl.NumberFormat('en-IE', {style: 'currency', currency: 'EUR'}) plus its basis (gross/net), or 'Price unknown' with an icon and words, never 0; a labor-only item shows 'Labor only, no part cost'; labor minutes or 'Labor unknown'. Empty state: 'No parts on the sheet yet. Accept a change to add one.' Each row has Edit and Remove (Remove asks to confirm in the row). Edit opens ProductFields inline: product name, https link, brand, part number, price as listed (text through parseEuroInput, the error shown next to the field), basis gross/net/unknown, approval (abe, e_mark, teilegutachten, none, unknown) with approval text, labor minutes, labor-only switch, zero-labor confirmation plus notes when minutes are 0, mechanic notes. Save calls editItem/removeItem, then saveSheet once; on ok:false show the message; disable Save while saving. While a render or prepare is running or a preview waits for Accept, sheet Save and Remove are disabled with the text 'Accept or reject the preview first.' A physical edit that cleared fit results shows 'Fit checks were reset by this change.' only if any item had a fit before. After a saved sheet change, run the same folder auto-save the visual Accept uses. VersionStrip: a kind 'sheet' step is labeled 'Sheet: <sheetChangeLabel(parent, version)>' instead of 'Start photo'. Nordlicht tokens only, no hex; every input labeled; keyboard reachable; desktop only."
    }
  ]
}
```

Unit routing: S1 and S2 get shop-reviewer and general-reviewer (S2 also imaging-reviewer, because
src/lib/browser/ matches its rule); U1 gets shop-reviewer for BuildSheet, ProductFields and VersionStrip,
plus general-reviewer. No paid calls, no new dependency, no new test file.

## Done-when map (TASKS.md T8)

| Done when | Where it is proven |
| --- | --- |
| Accepted render creates one line | existing visualChild test; recheck in the browser |
| Repeated same-slot edits replace the active line | existing visualChild test; browser |
| Changing a product preserves prior history and invalidates checks | S1 test (parent unchanged, all fits cleared), S2 undo test |
| Unknown part price is shown as unknown | U1 BuildSheet; browser |
| Explicit labor-only allows zero part cost | S1 test; browser |
| Undo restores the prior sheet | S2 test; browser |
| Invalidation and money-field validation tested | S1 tests |
| Build and lint pass | Verify checks |

## After the run (lead)

1. Handle the workflow status (CLAUDE.md). Lead fixes go through `/review-changes` quick.
2. Free browser check with MOCK=1 in headless Chrome:
   - accept a mock tank change, open the sheet, check "Price unknown";
   - enter a product with "1.234,56", basis gross, 90 minutes, save; check the History step "Sheet: Tank: …";
   - try "1.234" and see the hint;
   - switch on labor only and see the zero part cost;
   - try 0 minutes without confirmation and see it refused;
   - Undo and check that the earlier sheet is back; Redo;
   - remove the item, confirm, Undo;
   - check that the sheet controls are disabled while a preview waits.
3. Consultant: PAL chat with nim-nemotron35 on src/lib/project.ts and src/lib/db.ts (explicit paths,
   no secrets, no photos). At most 2 calls. Check every point against the code.
4. TASKS.md: set the T8 status line, add the log entry (files, checks, real duration, review and
   consultant results, open items), commit. Do not push without asking.
5. Owner check in their own Chrome: the same steps on a real project, then the folder copy shows
   the sheet change in history.md with no duplicate image.
