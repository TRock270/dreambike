export const meta = {
  name: 'review-changes',
  description: 'Review the current DreamBike diff with matching specialist reviewers plus general-reviewer; depth full also refute-checks the blocking findings',
  whenToUse: 'Before a commit made outside /build-ticket (quick), and with base main before a merge (full). Args: base ref string, or {base?, paths?, extraReviewers?, depth?}',
  phases: [
    { title: 'Scope', detail: 'list changed and untracked files' },
    { title: 'Review', detail: 'one reviewer per matching domain plus general-reviewer' },
    { title: 'Refute', detail: 'full only: one general-reviewer run tries to refute all blocker/major findings' },
  ],
}

// Path rules: which specialist reviews which files. general-reviewer reviews everything.
const RULES = [
  { reviewer: 'models-reviewer', re: /^(src\/lib\/server\/meta\.ts|prompts\/|src\/lib\/mocks\/|src\/app\/api\/(segment|identify|instruction|edit|check|search-parts|transcribe)\/|spike\/(responses_sam|responses_spark|images_edits|asr_transcribe|files|run_all)\.py|tests\/(meta|sam|spark|sse))/ },
  { reviewer: 'imaging-reviewer', re: /^(src\/lib\/server\/images\.ts|src\/lib\/coordinates\.ts|src\/app\/api\/(normalize|composite)\/|spike\/(imaging|local_images)\.py|src\/components\/(ImageCanvas|PartOverlay|PartSelector|BeforeAfter|UploadDropzone|ReferenceDropzone)\.tsx|src\/lib\/browser\/|src\/lib\/imageFormat\.ts|tests\/(images|coordinates|masks|composite))/ },
  { reviewer: 'shop-reviewer', re: /^(src\/lib\/(db|project|cache|quote|pdf|estimate|demo)\.ts|src\/lib\/server\/(fit[^/]*|demoPack)\.ts|prompts\/fit-check|src\/components\/(BuildSheet|ProductFields|FitBadge|EvidenceLinks|PaperworkSummary|EstimatePreview|MissingCosts|InspectionFees|ExportButton|ShopSettingsForm|VersionStrip|ProjectList|EditReview)\.tsx|tests\/(project|cache|quote|fit-policy|demo))/ },
  { reviewer: 'security-reviewer', re: /^(budget\/|src\/lib\/server\/(budget|config|fetch-product|meta|http)\.ts|tests\/(budget|config|fetch-product)|src\/app\/api\/|spike\/(ledger|common|deployment)\.py|next\.config\.ts|\.env\.example$|\.gitignore$|\.claude\/settings\.json$|src\/(middleware|proxy)\.ts)/ },
  { reviewer: 'release-reviewer', re: /^(README\.md|CREDITS\.md|LICENSE|docs\/(submission|demo-script)\.md|public\/|src\/components\/(UploadNotice|DemoBanner|DemoView)\.tsx|src\/lib\/server\/demoPack\.ts)/ },
  { reviewer: 'models-reviewer', re: /^(src\/lib\/(contracts|types)\.ts$|src\/components\/(BikeConfirm|DescribeForm|PaintForm|ProgressStatus)\.tsx$|tests\/(contracts|instruction|identify|edit|check|search|transcribe|mocks)[^/]*\.test\.ts$)/ },
  { reviewer: 'imaging-reviewer', re: /^(src\/lib\/(contracts|types|slots)\.ts$|src\/components\/(EditReview|ProgressStatus)\.tsx$|tests\/(slots|preflight|imageFormat|browser)[^/]*\.test\.ts$)/ },
  { reviewer: 'shop-reviewer', re: /^(src\/lib\/(contracts|types|slots)\.ts$|src\/app\/api\/check\/|src\/components\/BikeConfirm\.tsx$|tests\/(db|pdf|fit)[^/]*\.test\.ts$)/ },
  { reviewer: 'security-reviewer', re: /^(src\/lib\/(contracts|errors)\.ts$|\.claude\/(agents\/|workflows\/)|package(-lock)?\.json$|vercel\.json$|vitest\.config\.ts$|eslint\.config\.mjs$|tests\/(http|deployment|workflows)[^/]*\.test\.ts$|tests\/support\/(workflowHarness|session)\.ts$)/ },
  { reviewer: 'release-reviewer', re: /^(docs\/api-evidence\.md$|\.gitignore$|src\/components\/ModeBanner\.tsx$)|\.(png|jpe?g|webp|heic|svg|pdf|ttf|woff2?|mp4|mov)$/i },
  { reviewer: 'security-reviewer', re: /^src\/components\/(BudgetBanner|ErrorNotice|DemoBanner|ModeBanner)\.tsx$/ },
  // Files added after the Codex review base: the paid-call wrapper, SSE parser,
  // edit policy, part rules, project session and bike form.
  // Paid-call spike scripts: their --dry-run short-circuit keeps the allowlisted smoke dry run free.
  { reviewer: 'security-reviewer', re: /^(src\/lib\/server\/paid\.ts$|tests\/paid[^/]*\.test\.ts$|spike\/(run_all|responses_sam|responses_spark|images_edits|asr_transcribe|files)\.py$|spike\/requirements\.txt$)/ },
  { reviewer: 'models-reviewer', re: /^(src\/lib\/server\/(paid|sse)\.ts$|src\/lib\/(editPolicy|queue)\.ts$|src\/lib\/browser\/(renderFlow|renderClient|sparkClient|segmentClient)\.ts$|src\/components\/InstructionPreview\.tsx$|tests\/(paid|renderflow|masks)[^/]*\.test\.ts$)/ },
  { reviewer: 'imaging-reviewer', re: /^(src\/lib\/parts\.ts$|tests\/(partmap|renderflow)[^/]*\.test\.ts$)/ },
  { reviewer: 'shop-reviewer', re: /^(src\/lib\/browser\/(projectSession|pdfExport)\.ts$|src\/lib\/bikeForm\.ts$|tests\/(projectsession|bikeform)[^/]*\.test\.ts$)/ },
]
const MAX_REFUTES = 12
const DEPTHS = ['quick', 'full']
// In depth full these rule-based reviewers run on Sonnet; contracts (models),
// security and the general review stay on their Opus card at medium effort.
// security-reviewer keeps its card in quick too: ../CLAUDE.md wants Opus for security work.
const SONNET_REVIEWERS = ['imaging-reviewer', 'shop-reviewer', 'release-reviewer']
const OPUS_ALWAYS = ['security-reviewer']

// Args arrive as an object, a JSON string, or a plain base ref like "HEAD~1".
function parseArgs(raw) {
  if (typeof raw !== 'string') return raw || {}
  const text = raw.trim()
  if (text.startsWith('{')) {
    try { return JSON.parse(text) }
    catch (error) { return { parseError: error.message } }
  }
  return { base: text || 'HEAD' }
}
const input = parseArgs(args)
if (input.parseError) return { status: 'blocked', blockers: [`args are not valid JSON: ${input.parseError}`] }
const base = input.base || 'HEAD'
// quick: reviewers on Sonnet (except OPUS_ALWAYS), no refute, every blocking finding goes to the lead.
// full: see SONNET_REVIEWERS, then one batched refute on Sonnet.
const depth = input.depth || (/^(origin\/)?main$/.test(base) ? 'full' : 'quick')
const readablePath = (f) => typeof f === 'string' && f && !f.startsWith('/') && !f.includes('\\')
  && !/[\s*?]/.test(f) && f.split('/').every((p) => p && p !== '.' && p !== '..')
  && !/^(\.env(?!\.example$)|consent\/|secrets\/|fixtures\/|my_bike\/|RULES\.md$)/.test(f)
if (typeof base !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/~^{}@-]*$/.test(base)
  || (input.paths !== undefined && (!Array.isArray(input.paths) || input.paths.some((f) => !readablePath(f))))
  || (input.extraReviewers !== undefined && !Array.isArray(input.extraReviewers))
  || !DEPTHS.includes(depth)) {
  return { status: 'blocked', depth, base, blockers: ['base must be a safe git ref; paths must be explicit canonical nonprivate repo paths; extraReviewers must be a list; depth must be "quick" or "full"'] }
}

const str = { type: 'string' }
const SCOPE = { type: 'object', required: ['files', 'error'], properties: { files: { type: 'array', items: str }, error: str } }
const FINDING = {
  type: 'object',
  required: ['id', 'severity', 'file', 'line', 'claim', 'failureScenario', 'evidence', 'requiredFix'],
  properties: {
    id: str,
    severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
    file: str,
    line: { type: 'integer' },
    claim: str,
    failureScenario: str,
    evidence: str,
    requiredFix: str,
  },
}
const REVIEW = {
  type: 'object',
  required: ['verdict', 'findings', 'recheck', 'checksRun'],
  properties: {
    verdict: { type: 'string', enum: ['approve', 'changes_required'] },
    findings: { type: 'array', items: FINDING },
    recheck: {
      type: 'array',
      items: {
        type: 'object',
        required: ['findingId', 'status', 'reason'],
        properties: { findingId: str, status: { type: 'string', enum: ['resolved', 'upheld', 'withdrawn'] }, reason: str },
      },
    },
    checksRun: { type: 'array', items: { type: 'object', required: ['command', 'result', 'output'], properties: { command: str, result: str, output: str } } },
  },
}
const VERDICTS = {
  type: 'object',
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'outcome', 'reason'],
        properties: { key: str, outcome: { type: 'string', enum: ['confirmed', 'refuted', 'uncertain'] }, reason: str },
      },
    },
  },
}
const json = (value) => JSON.stringify(value, null, 1)
const empty = { depth, confirmed: [], unverified: [], refuted: [], minor: [] }

// ---------- scope ----------
phase('Scope')
let files = input.paths
if (!files) {
  const scope = await agent([
    'Ignore the review instructions of your card for this task. Do not read file contents and do not edit anything.',
    `List the files changed relative to ${base}: run \`git diff --name-only --no-renames ${base}\` and \`git ls-files --others --exclude-standard\` from the repo root.`,
    'Return repo-relative paths only, the union of both outputs.',
    'Report mode: files plus error. error is empty only if both git commands succeeded. On failure, return error with a safe explanation; never represent a failed command as an empty successful diff.',
  ].join('\n'), { label: 'list changes', phase: 'Scope', agentType: 'general-reviewer', model: 'haiku', effort: 'low', schema: SCOPE })
  if (!scope) return { status: 'needs_lead', base, files: [], scopeError: 'scope agent returned nothing', ...empty }
  if (scope.error) return { status: 'needs_lead', base, files: scope.files, scopeError: scope.error, ...empty }
  files = scope.files
}
if (files.some((f) => !readablePath(f))) return { status: 'blocked', depth, base, blockers: ['scope returned a private or noncanonical path; lead must select a safe scope'] }
files = files.filter((f, i) => files.indexOf(f) === i)
// An empty scope is never a silent pass: the lead confirms that nothing changed.
if (!files.length) {
  log('No changed files found')
  return { status: 'needs_lead', base, files: [], reviewers: [], missingReviewers: [], reviewProblems: ['no changed files found; confirm the empty diff'], ...empty }
}
const assignments = {}
for (const rule of RULES) {
  const matched = files.filter((f) => rule.re.test(f))
  if (matched.length) assignments[rule.reviewer] = [...new Set([...(assignments[rule.reviewer] || []), ...matched])]
}
const KNOWN_REVIEWERS = RULES.map((rule) => rule.reviewer)
const extras = (input.extraReviewers || []).filter((r) => KNOWN_REVIEWERS.includes(r))
if (extras.length < (input.extraReviewers || []).length) log('Ignored unknown extraReviewers names')
for (const r of extras) assignments[r] = files
assignments['general-reviewer'] = files
log(`${files.length} file(s), ${depth} review; reviewers: ${Object.keys(assignments).join(', ')}`)

const diffNote = [
  `Diff base: ${base}. First read the diff of all your files in one call, \`git diff ${base} -- <file> <file> …\`; read untracked new files whole, other whole files only where the diff is not enough.`,
  'Leave .env.example out of git commands (they are denied) and read it with Read.',
].join(' ')

// ---------- review, then one batched refute (full only) ----------
phase('Review')
const reviewOpts = (reviewer) => (!OPUS_ALWAYS.includes(reviewer) && (depth === 'quick' || SONNET_REVIEWERS.includes(reviewer))
  ? { model: 'sonnet' } : { effort: 'medium' })
const reviewed = await parallel(Object.keys(assignments).map((reviewer) => () => agent([
    `Unit review of the current diff against ${base} (${depth} review). Round 1.`,
    `Your files:\n${assignments[reviewer].join('\n')}`,
    `All changed files, for context:\n${files.join('\n')}`,
    diffNote,
    'Report findings; recheck is empty.',
  ].join('\n\n'), { label: `review ${reviewer}`, phase: 'Review', agentType: reviewer, ...reviewOpts(reviewer), schema: REVIEW })
    .then((review) => (review ? { reviewer, review } : null))))

const done = reviewed.filter(Boolean)
const blocking = []
const minor = []
const keys = new Set()
for (const { reviewer, review } of done) {
  for (const f of review.findings) {
    if (f.severity === 'minor') { minor.push({ ...f, reviewer }); continue }
    // A unique key per finding lets one refuter answer for all of them.
    let key = `${reviewer}:${f.id}`
    for (let n = 2; keys.has(key); n++) key = `${reviewer}:${f.id}#${n}`
    keys.add(key)
    blocking.push({ ...f, reviewer, key })
  }
}
// Blockers first, so the cap drops majors before blockers.
const refutable = depth === 'full'
  ? blocking.filter((f) => readablePath(f.file)).sort((a, b) => (b.severity === 'blocker') - (a.severity === 'blocker')).slice(0, MAX_REFUTES)
  : []
const verdicts = Object.create(null)
if (refutable.length) {
  phase('Refute')
  const answer = await agent([
    'Mode: refute. Try to refute each review finding below. Read the code and the cited SPEC/TASKS text yourself; do not rely on the reviewer\'s reasoning.',
    diffNote,
    `Files in scope:\n${files.join('\n')}`,
    `Findings:\n${json(refutable)}`,
    'Return exactly one verdict per finding, with its key copied verbatim. outcome confirmed: the failure scenario really happens. refuted: it cannot happen or the evidence is wrong. uncertain: you cannot tell from the repo. Do not edit files.',
  ].join('\n\n'), { label: 'refute', phase: 'Refute', agentType: 'general-reviewer', model: 'sonnet', effort: 'medium', schema: VERDICTS })
  if (!answer) log('Refuter returned nothing; blocking findings stay unverified')
  const returned = answer ? answer.verdicts : []
  for (const f of refutable) {
    const matches = returned.filter((v) => v.key === f.key)
    if (matches.length === 1) verdicts[f.key] = { outcome: matches[0].outcome, reason: matches[0].reason }
    else if (answer) log(`Refuter returned ${matches.length} verdicts for ${f.key}; kept unverified`)
  }
  const unknown = returned.filter((v) => !refutable.some((f) => f.key === v.key)).map((v) => v.key)
  if (unknown.length) log(`Ignored verdicts with unknown keys: ${unknown.join(', ')}`)
}
if (depth === 'full' && blocking.length > refutable.length) log(`Refute cap ${MAX_REFUTES} or noncanonical path: ${blocking.length - refutable.length} blocking finding(s) returned unverified`)
const judged = blocking.map((f) => ({ ...f, verdict: verdicts[f.key] || null }))
const missingReviewers = Object.keys(assignments).filter((r) => !done.some((d) => d.reviewer === r))
const reviewProblems = done.filter((r) => r.review.verdict !== 'approve'
  && !r.review.findings.some((f) => f.severity !== 'minor')).map((r) => `${r.reviewer}: changes_required without blocking findings`)
const confirmed = judged.filter((f) => f.verdict && f.verdict.outcome === 'confirmed')
const unverified = judged.filter((f) => !f.verdict || f.verdict.outcome === 'uncertain')
const refuted = judged.filter((f) => f.verdict && f.verdict.outcome === 'refuted')
// A refuted blocker still goes to the lead: one Sonnet refute must not wave a blocker through.
const refutedBlockers = refuted.filter((f) => f.severity === 'blocker')
if (missingReviewers.length) log(`No result from: ${missingReviewers.join(', ')}`)
return {
  status: missingReviewers.length || reviewProblems.length || confirmed.length || unverified.length || refutedBlockers.length ? 'needs_lead' : 'green',
  depth,
  base,
  files,
  reviewers: Object.keys(assignments),
  missingReviewers,
  reviewProblems,
  confirmed,
  unverified,
  refuted,
  minor,
}
