# Codex review of the agent tooling: how to run it

Codex reviews and directly improves the Claude Code subagents, workflows and
permission settings. It works in a separate git worktree, so the Claude
sessions in the main `dreambike` folder are not disturbed, and gitignored
private files (.env, fixtures, my_bike, consent, RULES.md) are not there.

## Steps

1. Create the worktree from the review tag:

   ```
   cd ~/Projekte/Hackathon/dreambike
   git worktree add ../dreambike-codex-review -b codex/agent-tooling-review agent-tooling-review-base
   cd ../dreambike-codex-review
   shasum -a 256 -c review/agent-tooling/FILES.sha256
   ```

   Every line should say OK.

2. Start Codex in `../dreambike-codex-review` (CLI: `codex`, or open that
   folder in the Codex app). Paste everything below the line in
   `review/agent-tooling/PROMPT_CODEX.md`.

3. If Codex writes `ASK_QWEN.md` or `ASK_DEEPSEEK.md` in
   `review/agent-tooling/`:
   - Open chat.qwen.ai or chat.deepseek.com in the browser.
   - Upload the files the ASK file lists (from the worktree), then paste the
     ASK file's prompt.
   - Save the answer as `ANSWER_QWEN.md` or `ANSWER_DEEPSEEK.md` in the same
     folder.
   - Tell Codex: "The answer is in review/agent-tooling. Continue."

4. If Codex runs out of quota before it finishes, start it again in the same
   worktree with: "Continue the task in review/agent-tooling/PROMPT_CODEX.md
   from your commits and CODEX_REPORT.md."

5. When Codex is done, tell Claude Code: "Codex review done." The lead
   session then:
   - reads `review/agent-tooling/CODEX_REPORT.md`,
   - checks every change in
     `git diff agent-tooling-review-base..codex/agent-tooling-review`,
   - reruns the checks,
   - merges only the tooling paths into main,
   - removes the worktree with `git worktree remove ../dreambike-codex-review`.

6. Apply the permission settings yourself, because Claude tools may not edit
   `.claude/settings.json`. From the repo root:

   ```
   cp review/agent-tooling/settings.proposed.json .claude/settings.json
   node review/agent-tooling/sim/permissions.mjs
   ```

   The second command should end with "permission assertions passed". Then
   tell Claude Code "settings applied": the lead commits the file and deletes
   `settings.proposed.json`. Start new sessions afterwards, since agents and
   settings load at session start.

## Package contents

| File | Purpose |
| --- | --- |
| CONTEXT.md | Self-contained background, runtime rules, evidence, decisions |
| PROMPT_CODEX.md | The Codex prompt with scope, rules, checks, answer format |
| FILES.sha256 | Checksums of the reviewed files at the review base |
| sim/check_agents.py | Static check of agent frontmatter |
| sim/sim.mjs, sim/sim-dispute.mjs | Workflow simulations with stubbed agents |
