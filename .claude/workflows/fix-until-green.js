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

// Path rules: which builder fixes which files. First match wins, so the
// single-file shop rule comes before imaging's src/lib/browser/ rule.
const BUILDERS = [
  { builder: 'shop-builder', re: /^(src\/lib\/browser\/projectSession\.ts|src\/lib\/bikeForm\.ts|tests\/(projectsession|bikeform))/ },
  { builder: 'models-builder', re: /^(src\/lib\/server\/(meta|sse)\.ts|src\/lib\/editPolicy\.ts|prompts\/|src\/lib\/mocks\/|src\/app\/api\/(segment|identify|instruction|edit|check|search-parts|transcribe)\/|spike\/(responses_sam|responses_spark|images_edits|asr_transcribe|files|run_all)\.py|tests\/(meta|sam|spark|sse|instruction|identify|edit|check|search|transcribe))/ },
  { builder: 'imaging-builder', re: /^(src\/lib\/server\/images\.ts|src\/lib\/(coordinates|slots|parts)\.ts|src\/app\/api\/(normalize|composite)\/|spike\/(imaging|local_images)\.py|src\/lib\/browser\/|src\/lib\/imageFormat\.ts|tests\/(images|coordinates|masks|composite|slots|preflight|imageFormat|browser|partmap|renderflow))/ },
  { builder: 'shop-builder', re: /^(src\/lib\/(db|project|cache|quote|pdf)\.ts|src\/lib\/server\/fit[^/]*\.ts|tests\/(db|project|cache|quote|pdf|fit))/ },
  { builder: 'platform-builder', re: /^(budget\/|src\/lib\/server\/(budget|config|fetch-product|http|paid)\.ts|src\/app\/api\/(budget|health|product-image)\/|spike\/(ledger|common|deployment)\.py|next\.config\.ts|vercel\.json$|\.env\.example$|tests\/(budget|config|fetch-product|http|deployment|paid))/ },
  { builder: 'ui-builder', re: /^(src\/components\/|src\/styles\/|src\/app\/(layout|page)\.tsx|src\/app\/globals\.css)/ },
]
const builderFor = (file) => (BUILDERS.find((b) => b.re.test(file)) || { builder: 'general-builder' }).builder
// ../CLAUDE.md wants an Opus review for security work. These are the spend-cap,
// secret and route paths of the security-reviewer RULES in review-changes.js;
// keep both lists in step. Where a rule has no end anchor, this one has none
// either, so it stays a superset. Fix reviews of other files run on Sonnet.
const OPUS_REVIEW_RE = /^(budget\/|src\/lib\/server\/(budget|config|fetch-product|meta|http|paid)\.ts|src\/app\/api\/|spike\/(ledger|common|deployment|run_all|responses_sam|responses_spark|images_edits|asr_transcribe|files)\.py|spike\/requirements\.txt$|next\.config\.ts|vercel\.json$|\.env\.example$|\.gitignore$|\.claude\/|package(-lock)?\.json$|src\/(middleware|proxy)\.ts|src\/lib\/(contracts|errors)\.ts$|vitest\.config\.ts$|eslint\.config\.mjs$|src\/components\/(BudgetBanner|ErrorNotice|DemoBanner|ModeBanner)\.tsx$|tests\/(budget|config|fetch-product)|tests\/(http|deployment|paid|workflows)[^/]*\.test\.ts$|tests\/support\/workflowHarness\.ts$)/

// Args arrive as an object, a JSON string, or one plain check command like "npm test".
function parseArgs(raw) {
  if (typeof raw !== 'string') return raw || {}
  const text = raw.trim()
  if (text.startsWith('{')) {
    try { return JSON.parse(text) }
    catch (error) { return { parseError: error.message } }
  }
  return text ? { checks: [text] } : {}
}
const input = parseArgs(args)
if (input.parseError) return { status: 'blocked', blockers: [`args are not valid JSON: ${input.parseError}`] }
const checks = input.checks || ['npm run typecheck', 'npm run lint', 'npm test', 'npm run build']
const maxRounds = Math.min(Math.max(input.maxRounds || 3, 1), 4)
if (!Array.isArray(checks) || !checks.length || checks.some((c) => typeof c !== 'string' || !c.trim())
  || new Set(checks).size !== checks.length
  || (input.maxRounds !== undefined && (!Number.isInteger(input.maxRounds) || input.maxRounds < 1))) {
  return { status: 'blocked', blockers: ['checks must be a nonempty array of unique command strings; maxRounds must be a positive integer'] }
}
const completeChecks = (reported) => reported.length === checks.length
  && checks.every((command) => reported.filter((c) => c.command === command && c.result === 'pass').length === 1)
const writablePath = (file) => file && !file.startsWith('/') && !file.includes('\\')
  && !/[\s*?]/.test(file) && file.split('/').every((p) => p && p !== '.' && p !== '..')
  && !/^(\.env(?!\.example$)|consent\/|secrets\/|fixtures\/|my_bike\/|RULES\.md$|PLAN\.md$|SPEC\.md$|TASKS\.md$|CLAUDE\.md$|HACKATHON_GUIDELINES\.md$|docs\/api-evidence\.md$|\.claude\/settings\.json$)/.test(file)
// A failing assertion usually points at the test file while the fix belongs in
// the module under test, so a fixer may also edit TypeScript under src/ and
// tests/ that an explicit rule routes to it (never via the general-builder
// fallback). Data, schema, price, prompt, spike, budget and config files count
// only when they are the located failure.
// Agents sometimes report absolute paths; compare everything repo-relative.
// The optional part strips a session worktree under .claude/worktrees/<name>/.
const repoPath = (f) => f.replace(/^\/.*?\/dreambike\/(\.claude\/worktrees\/[^/]+\/)?/, '').replace(/^\.\//, '')
const domainFile = (file, builder) => writablePath(file) && /^(src|tests)\/.*\.tsx?$/.test(file)
  && BUILDERS.some((b) => b.re.test(file)) && builderFor(file) === builder

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
    findings: { type: 'array', items: { type: 'object', required: ['severity', 'file', 'claim', 'requiredFix'], properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, file: str, claim: str, requiredFix: str } } },
  },
}

const fixes = []
let last = null
let previous = Infinity
let stalled = 0
let status = 'still_failing'
rounds: for (let round = 1; round <= maxRounds; round++) {
  phase('Check')
  // The check runs on general-reviewer (no Edit or Write tool) under its "Mode: verify".
  const checked = await agent([
    'Mode: verify. Ignore the review instructions of your card for this task.',
    `Run these offline checks from the repo root and report each result:\n${checks.join('\n')}`,
    'For every failure give the check, the repo-relative file it points at (the test file if no source file is named), and the key error message. Do not edit anything.',
    'Return exactly one checks entry per requested command with that exact command string. Skipped commands are not_run, never omitted.',
  ].join('\n\n'), { label: `check r${round}`, phase: 'Check', agentType: 'general-reviewer', model: 'haiku', effort: 'low', schema: CHECK_RESULT })
  if (!checked) { status = 'needs_lead'; break }
  last = checked
  if (!last.failures.length && completeChecks(last.checks)) { status = 'green'; break }
  // A failing or skipped check without a located failure gives the fixers nothing to work on.
  if (!last.failures.length) { status = 'unlocated_failure'; break }
  if (last.failures.some((f) => !writablePath(f.file))) { status = 'unlocated_failure'; break }
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
    const owned = [...new Set(groups[builder].map((f) => f.file))]
    const scope = builder === 'general-builder'
      ? 'Edit only the failing files.'
      : `Beyond them, create or edit only TypeScript files under src/ or tests/ that belong to ${builder} and that the fix strictly requires.`
    const result = await agent([
      `Fix these check failures (round ${round}):\n${JSON.stringify(groups[builder], null, 1)}`,
      'Fix the cause in source, not the symptom. Never weaken, skip, or delete a test, and never add ts-ignore, eslint-disable, or an any cast to silence an error.',
      `Failing files you own:\n${owned.join('\n')}`,
      `${scope} If the fix needs any other file, stop that part and describe the needed file and reason in notFixed. Run the affected check again before reporting.`,
      'Report mode for this workflow: return filesChanged (every edited path), fixed (strings), notFixed (strings, including blockers needing the lead). This schema replaces your usual report for this call.',
    ].join('\n\n'), { label: `fix ${builder} r${round}`, phase: 'Fix', agentType: builder, schema: FIX })
    if (!result) {
      // A failed agent can have edited files before losing its report.
      fixes.push({ round, builder, filesChanged: owned, fixed: [], notFixed: ['fixer returned nothing; inspect its failing files and its domain code for partial edits'], failed: true })
      status = 'needs_lead'
      break rounds
    }
    result.filesChanged = result.filesChanged.map(repoPath)
    fixes.push({ round, builder, ownedFiles: owned, ...result })
    if (result.notFixed.length || result.filesChanged.some((f) => !owned.includes(f) && !domainFile(f, builder))) {
      status = 'needs_lead'
      break rounds
    }
  }
}

phase('Review fixes')
const changed = fixes.flatMap((f) => f.filesChanged.concat(f.ownedFiles || [])).filter((f, i, all) => all.indexOf(f) === i)
const reviewModel = changed.some((f) => OPUS_REVIEW_RE.test(f)) ? {} : { model: 'sonnet' }
const review = changed.length
  ? await agent([
    `Review only these fixes made to get the checks green:\n${JSON.stringify(fixes, null, 1)}`,
    `Changed files:\n${changed.join('\n')}`,
    'Look for weakened or skipped tests, loosened assertions, silenced type or lint errors, and behavior that now differs from SPEC.md. Read the diff yourself. Do not edit files.',
    'Report mode: return verdict and findings (severity blocker/major/minor, file, claim, requiredFix) using the supplied schema.',
  ].join('\n\n'), { label: 'review fixes', phase: 'Review fixes', agentType: 'general-reviewer', ...reviewModel, effort: 'medium', schema: REVIEW })
  : null

// Green checks with a rejected fix review still need the lead's eyes.
if (status === 'green' && changed.length && (!review || review.verdict !== 'approve'
  || review.findings.some((f) => f.severity === 'blocker' || f.severity === 'major'))) status = 'green_fix_review_failed'

return { status, checks: last ? last.checks : [], failures: last ? last.failures : [], fixes, review }
