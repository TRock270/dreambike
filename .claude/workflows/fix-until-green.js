export const meta = {
  name: 'fix-until-green',
  description: 'Run DreamBike offline checks, fix failures with the matching builder, repeat until green or no progress, then review the fixes',
  whenToUse: 'Broken build, lint, types or tests, and regressions in T17. Args: optional {checks?, maxRounds?}',
  phases: [
    { title: 'Check', detail: 'run the checks and locate failures' },
    { title: 'Fix', detail: 'domain builder fixes each failing file group' },
    { title: 'Review fixes', detail: 'general-reviewer looks for weakened tests and behavior changes' },
  ],
}

// Path rules: which builder fixes which files. First match wins.
const BUILDERS = [
  { builder: 'models-builder', re: /^(src\/lib\/server\/meta\.ts|prompts\/|src\/lib\/mocks\/|src\/app\/api\/(segment|identify|instruction|edit|check|search-parts|transcribe)\/|spike\/(responses_sam|responses_spark|images_edits|asr_transcribe|files|run_all)\.py)/ },
  { builder: 'imaging-builder', re: /^(src\/lib\/server\/images\.ts|src\/lib\/coordinates\.ts|src\/app\/api\/(normalize|composite)\/|spike\/(imaging|local_images)\.py|tests\/(images|coordinates|masks|composite))/ },
  { builder: 'shop-builder', re: /^(src\/lib\/(db|project|cache|quote|pdf)\.ts|src\/lib\/server\/fit[^/]*\.ts|tests\/(project|cache|quote|fit-policy))/ },
  { builder: 'platform-builder', re: /^(budget\/|src\/lib\/server\/(budget|config|fetch-product)\.ts|src\/app\/api\/(budget|health|product-image)\/|spike\/(ledger|common|deployment)\.py|next\.config\.ts|tests\/(budget|fetch-product))/ },
  { builder: 'ui-builder', re: /^(src\/components\/|src\/styles\/|src\/app\/(layout|page)\.tsx|src\/app\/globals\.css)/ },
]
const builderFor = (file) => (BUILDERS.find((b) => b.re.test(file)) || { builder: 'general-builder' }).builder

const input = typeof args === 'object' && args ? args : {}
const checks = input.checks || ['npm run typecheck', 'npm run lint', 'npm test', 'npm run build']
const maxRounds = Math.min(Math.max(input.maxRounds || 3, 1), 4)

const str = { type: 'string' }
const CHECK_RESULT = {
  type: 'object',
  required: ['checks', 'failures'],
  properties: {
    checks: { type: 'array', items: { type: 'object', required: ['command', 'result', 'output'], properties: { command: str, result: { type: 'string', enum: ['pass', 'fail', 'not_run'] }, output: str } } },
    failures: { type: 'array', items: { type: 'object', required: ['check', 'file', 'message'], properties: { check: str, file: str, message: str } } },
  },
}
const FIX = {
  type: 'object',
  required: ['filesChanged', 'fixed', 'notFixed'],
  properties: { filesChanged: { type: 'array', items: str }, fixed: { type: 'array', items: str }, notFixed: { type: 'array', items: str } },
}
const REVIEW = {
  type: 'object',
  required: ['verdict', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['approve', 'changes_required'] },
    findings: { type: 'array', items: { type: 'object', required: ['severity', 'file', 'claim', 'requiredFix'], properties: { severity: str, file: str, claim: str, requiredFix: str } } },
  },
}

const fixes = []
let last = null
let previous = Infinity
let stalled = 0
let status = 'still_failing'
for (let round = 1; round <= maxRounds; round++) {
  phase('Check')
  last = await agent([
    `Run these offline checks from the repo root and report each result:\n${checks.join('\n')}`,
    'For every failure give the check, the repo-relative file it points at (the test file if no source file is named), and the key error message. Do not edit anything.',
  ].join('\n\n'), { label: `check r${round}`, phase: 'Check', agentType: 'general-builder', effort: 'low', schema: CHECK_RESULT })
  if (!last) break
  if (!last.failures.length && last.checks.every((c) => c.result === 'pass')) { status = 'green'; break }
  if (last.failures.length >= previous) stalled += 1
  else stalled = 0
  if (stalled >= 2) { status = 'no_progress'; break }
  previous = last.failures.length
  if (round === maxRounds) break

  phase('Fix')
  const groups = {}
  for (const f of last.failures) {
    const b = builderFor(f.file)
    groups[b] = groups[b] || []
    groups[b].push(f)
  }
  log(`Round ${round}: ${last.failures.length} failure(s) -> ${Object.keys(groups).join(', ')}`)
  // Sequential on purpose: fixes in different groups can touch the same shared file.
  for (const builder of Object.keys(groups)) {
    const result = await agent([
      `Fix these check failures (round ${round}):\n${JSON.stringify(groups[builder], null, 1)}`,
      'Fix the cause in source, not the symptom. Never weaken, skip, or delete a test, and never add ts-ignore, eslint-disable, or an any cast to silence an error.',
      'You own the failing files plus any file the fix strictly requires; list every file you change. Run the affected check again before reporting.',
    ].join('\n\n'), { label: `fix ${builder} r${round}`, phase: 'Fix', agentType: builder, schema: FIX })
    if (result) fixes.push({ round, builder, ...result })
  }
}

phase('Review fixes')
const changed = fixes.flatMap((f) => f.filesChanged).filter((f, i, all) => all.indexOf(f) === i)
const review = changed.length
  ? await agent([
    `Review only these fixes made to get the checks green:\n${JSON.stringify(fixes, null, 1)}`,
    `Changed files:\n${changed.join('\n')}`,
    'Look for weakened or skipped tests, loosened assertions, silenced type or lint errors, and behavior that now differs from SPEC.md. Read the diff yourself. Do not edit files.',
  ].join('\n\n'), { label: 'review fixes', phase: 'Review fixes', agentType: 'general-reviewer', schema: REVIEW })
  : null

return { status, checks: last ? last.checks : [], failures: last ? last.failures : [], fixes, review }
