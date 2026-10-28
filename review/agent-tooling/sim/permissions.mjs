// Static rule checks using CONTEXT section 5 wildcard and deny precedence.
// This does not execute Claude's permission engine or test its Bash sandbox.
import assert from 'node:assert/strict'
import fs from 'node:fs'
const { permissions: { allow, deny } } = JSON.parse(fs.readFileSync('.claude/settings.json', 'utf8'))
const matches = (rule, call) => new RegExp('^' + rule.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(call)
const allowed = (call) => allow.some((rule) => matches(rule, call)) && !deny.some((rule) => matches(rule, call))
let assertions = 0
for (const command of [
  'npm test', 'npm run build', 'npx --no-install vitest run',
  'npx --no-install vitest run tests/quote.test.ts',
  '.venv/bin/python spike/local_images.py --fixture-set all',
  '.venv/bin/python spike/run_all.py --mode smoke --dry-run',
  'git diff HEAD -- src/lib/quote.ts',
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
]) { assert.ok(!allowed('Bash(' + command + ')'), command); assertions++ }
for (const file of ['./.env', './.env.local', './consent/record.md', './secrets/key', './fixtures/bike.jpg', './my_bike/bike.jpg', './RULES.md']) {
  for (const tool of ['Read', 'Edit', 'Write']) {
    assert.ok(deny.some((rule) => matches(rule, tool + '(' + file + ')')), tool + ': ' + file)
    assertions++
  }
}
for (const tool of ['Edit', 'Write']) { assert.ok(deny.includes(tool + '(./.claude/settings.json)')); assertions++ }
assert.ok(!deny.some((rule) => matches(rule, 'Read(./.env.example)'))); assertions++
console.log(assertions + ' permission assertions passed (static model; live sandbox not exercised)')
