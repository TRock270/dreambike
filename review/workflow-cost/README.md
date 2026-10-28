# Codex check of the workflow cost changes: how to run it

A short, read-only Codex task on a fixed commit. Codex checks one question:
can the cheaper review workflows report a pass when they should not? It
works in a separate worktree, so the Claude sessions in `dreambike` are not
disturbed, and gitignored private files (.env, fixtures, my_bike, consent,
RULES.md) are not there.

## Steps

1. Create the worktree from the review tag and check the files:

   ```
   cd ~/Projekte/Hackathon/dreambike
   git worktree add --detach ../dreambike-codex-cost workflow-cost-review-base
   cd ../dreambike-codex-cost
   shasum -a 256 -c review/workflow-cost/FILES.sha256
   ln -s ../dreambike/node_modules node_modules
   ```

   Every checksum line should say OK. The link lets Codex run the offline
   mock tests without installing anything.

2. Start Codex in `../dreambike-codex-cost` (CLI: `codex`, or open that
   folder in the Codex app), read-only if you can choose. Paste everything
   below the line in `review/workflow-cost/PROMPT_CODEX.md`.

3. Save Codex's answer as `CODEX_REPORT.md` in
   `~/Projekte/Hackathon/dreambike/review/workflow-cost/` (the main
   checkout, not the worktree).

4. Remove the worktree:

   ```
   cd ~/Projekte/Hackathon/dreambike
   git worktree remove --force ../dreambike-codex-cost
   ```

   `--force` is needed because of the node_modules link.

5. Tell Claude Code: "Codex report liegt in review/workflow-cost." The lead
   session checks every finding against the code, fixes the confirmed ones
   with a reviewed repair, and reports what it took and rejected.

## Package contents

| File | Purpose |
| --- | --- |
| CONTEXT.md | Background, runtime rules, what changed, owner decisions |
| PROMPT_CODEX.md | The Codex prompt with the question and answer format |
| FILES.sha256 | Checksums of the reviewed files at the review base |
