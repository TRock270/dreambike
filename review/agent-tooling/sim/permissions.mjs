// Static rule checks using CONTEXT section 5 wildcard and deny precedence.
// This does not execute Claude's permission engine or test its Bash sandbox.
import assert from 'node:assert/strict'
import fs from 'node:fs'
// Optional argument: a proposed settings file to check before the owner applies it.
const { permissions: { allow, deny } } = JSON.parse(fs.readFileSync(process.argv[2] || '.claude/settings.json', 'utf8'))
const matches = (rule, call) => new RegExp('^' + rule.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(call)
const allowed = (call) => allow.some((rule) => matches(rule, call)) && !deny.some((rule) => matches(rule, call))
let assertions = 0
for (const command of [
  'npm test', 'npm run build', 'npx --no-install vitest run',
  'npx --no-install vitest run tests/quote.test.ts',
  'npx --no-install vitest run tests/paid.test.ts',
  'npx --no-install vitest run tests/projectsession.test.ts',
  '.venv/bin/python spike/local_images.py --fixture-set all',
  '.venv/bin/python spike/run_all.py --mode smoke --dry-run',
  'git diff HEAD -- src/lib/quote.ts',
  'git diff --name-only HEAD', 'git diff HEAD~1 -- src/lib/quote.ts',
  'git diff agent-tooling-review-base..main -- .claude/workflows/build-ticket.js',
  'git log --oneline -5', 'git status --short',
]) { assert.ok(allowed('Bash(' + command + ')'), command); assertions++ }
for (const command of [
  'npm test -- --config /tmp/arbitrary.mjs',
  'npx vitest run --config /tmp/arbitrary.mjs',
  'npx --no-install vitest run --config /tmp/arbitrary.mjs',
  'npx --no-install vitest run tests/quote.test.ts --reporter /tmp/arbitrary.mjs',
  'npx --no-install vitest run tests/quote.test.ts --outputFile /tmp/write.json',
  '.venv/bin/python spike/local_images.py --fixture-set all --anything',
  '.venv/bin/python spike/run_all.py --mode smoke --dry-run # --force',
  '.venv/bin/python spike/run_all.py --mode smoke',
  'git diff --output /tmp/write', 'git diff --no-index /tmp/a /tmp/b',
  'git show --ext-diff HEAD', 'curl https://example.com', 'npm install',
  // git switches to no-index mode by itself when a path lies outside the repo
  // (review finding SEC-1). These denies only narrow it; the sandbox is the boundary.
  'git diff /dev/null .env.local', 'git diff -- /dev/null .env.local',
  'git diff ../x ./secrets/key', 'git diff --stat /dev/null ./consent/record.md',
  'git diff ~/x y', 'git diff "$HOME/x" y', 'git diff HEAD -- .env',
]) { assert.ok(!allowed('Bash(' + command + ')'), command); assertions++ }
// Edit(path) rules cover Write too; Claude Code warns that Write(path) rules never match.
assert.ok(!deny.some((rule) => rule.startsWith('Write('))); assertions++
for (const file of ['./.env', './.env.local', './consent/record.md', './secrets/key']) {
  for (const tool of ['Read', 'Edit']) {
    assert.ok(deny.some((rule) => matches(rule, tool + '(' + file + ')')), tool + ': ' + file)
    assertions++
  }
}
// ./path is relative to the current directory; /path anchors at the project root.
for (const path of ['.env', '.env.local', 'consent/**', 'secrets/**']) {
  for (const tool of ['Read', 'Edit']) { assert.ok(deny.includes(tool + '(/' + path + ')'), tool + ': /' + path); assertions++ }
}
for (const file of ['./my_bike/bike.jpg', './RULES.md', './.claude/settings.json', './fixtures/plain-wall-right.jpg', './fixtures/heic.heic']) {
  assert.ok(deny.some((rule) => matches(rule, 'Edit(' + file + ')')), 'Edit: ' + file); assertions++
}
// Raw owner photos may still show plates; only blurred outputs are read.
assert.ok(deny.some((rule) => matches(rule, 'Read(./my_bike/bike.jpg)'))); assertions++
// The lead reads RULES.md (CLAUDE.md "Start each ticket") and writes
// fixtures/expected.json (TASKS T0); subagents are kept out by Subagent rules.
for (const call of ['Read(./RULES.md)', 'Read(./fixtures/expected.json)', 'Edit(./fixtures/expected.json)', 'Read(./.env.example)']) {
  assert.ok(!deny.some((rule) => matches(rule, call)), call); assertions++
}
console.log(assertions + ' permission assertions passed (static model; live sandbox not exercised)')
