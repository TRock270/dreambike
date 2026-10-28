export const meta = {
  name: 'review-changes',
  description: 'Review the current DreamBike diff with matching specialist reviewers plus general-reviewer, then refute-check each blocking finding',
  whenToUse: 'Before a commit made outside /build-ticket, or after the owner edited code. Args: base ref string, or {base?, paths?, extraReviewers?}',
  phases: [
    { title: 'Scope', detail: 'list changed and untracked files' },
    { title: 'Review', detail: 'one reviewer per matching domain plus general-reviewer' },
    { title: 'Refute', detail: 'an independent reviewer tries to refute each blocker/major finding' },
  ],
}

// Path rules: which specialist reviews which files. general-reviewer reviews everything.
const RULES = [
  { reviewer: 'models-reviewer', re: /^(src\/lib\/server\/meta\.ts|prompts\/|src\/lib\/mocks\/|src\/app\/api\/(segment|identify|instruction|edit|check|search-parts|transcribe)\/|spike\/(responses_sam|responses_spark|images_edits|asr_transcribe|files|run_all)\.py|tests\/(meta|sam|spark|sse))/ },
  { reviewer: 'imaging-reviewer', re: /^(src\/lib\/server\/images\.ts|src\/lib\/coordinates\.ts|src\/app\/api\/(normalize|composite)\/|spike\/(imaging|local_images)\.py|src\/components\/(ImageCanvas|PartOverlay|PartSelector|BeforeAfter|UploadDropzone|ReferenceDropzone)\.tsx|src\/lib\/browser\/|src\/lib\/imageFormat\.ts|tests\/(images|coordinates|masks|composite))/ },
  { reviewer: 'shop-reviewer', re: /^(src\/lib\/(db|project|cache|quote|pdf)\.ts|src\/lib\/server\/fit[^/]*\.ts|prompts\/fit-check|src\/components\/(BuildSheet|ProductFields|FitBadge|EvidenceLinks|PaperworkSummary|EstimatePreview|MissingCosts|InspectionFees|ExportButton|ShopSettingsForm|VersionStrip|ProjectList|EditReview)\.tsx|tests\/(project|cache|quote|fit-policy))/ },
  { reviewer: 'security-reviewer', re: /^(budget\/|src\/lib\/server\/(budget|config|fetch-product|meta|http)\.ts|tests\/(budget|config|fetch-product)|src\/app\/api\/|spike\/(ledger|common|deployment)\.py|next\.config\.ts|\.env\.example$|\.gitignore$|\.claude\/settings\.json$|src\/(middleware|proxy)\.ts)/ },
  { reviewer: 'release-reviewer', re: /^(README\.md|CREDITS\.md|LICENSE|docs\/(submission|demo-script)\.md|public\/|src\/components\/(UploadNotice|DemoBanner)\.tsx)/ },
  { reviewer: 'models-reviewer', re: /^(src\/lib\/(contracts|types)\.ts$|src\/components\/(BikeConfirm|DescribeForm|PaintForm|ProgressStatus)\.tsx$|tests\/(contracts|instruction|identify|edit|check|search|transcribe|mocks)[^/]*\.test\.ts$)/ },
  { reviewer: 'imaging-reviewer', re: /^(src\/lib\/(contracts|types|slots)\.ts$|src\/components\/(EditReview|ProgressStatus)\.tsx$|tests\/(slots|preflight|imageFormat|browser)[^/]*\.test\.ts$)/ },
  { reviewer: 'shop-reviewer', re: /^(src\/lib\/(contracts|types|slots)\.ts$|src\/app\/api\/check\/|src\/components\/BikeConfirm\.tsx$|tests\/(db|pdf|fit)[^/]*\.test\.ts$)/ },
  { reviewer: 'security-reviewer', re: /^(src\/lib\/(contracts|errors)\.ts$|\.claude\/(agents\/|workflows\/)|package(-lock)?\.json$|vercel\.json$|vitest\.config\.ts$|eslint\.config\.mjs$|tests\/(http|deployment)[^/]*\.test\.ts$)/ },
  { reviewer: 'release-reviewer', re: /^(docs\/api-evidence\.md$|\.gitignore$|src\/components\/ModeBanner\.tsx$)|\.(png|jpe?g|webp|heic|svg|pdf|ttf|woff2?|mp4|mov)$/i },
  { reviewer: 'security-reviewer', re: /^src\/components\/(BudgetBanner|ErrorNotice|DemoBanner|ModeBanner)\.tsx$/ },
]
const MAX_REFUTES = 12

// Args arrive as an object, a JSON string, or a plain base ref like "HEAD~1".
function parseArgs(raw) {
  if (typeof raw !== 'string') return raw || {}
  const text = raw.trim()
  if (text.startsWith('{')) return JSON.parse(text)
  return { base: text || 'HEAD' }
}
const input = parseArgs(args)
const base = input.base || 'HEAD'
const readablePath = (f) => typeof f === 'string' && f && !f.startsWith('/') && !f.includes('\\')
  && !/[\s*?]/.test(f) && f.split('/').every((p) => p && p !== '.' && p !== '..')
  && !/^(\.env(?!\.example$)|consent\/|secrets\/|fixtures\/|my_bike\/|RULES\.md$)/.test(f)
if (typeof base !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/~^{}@-]*$/.test(base)
  || (input.paths !== undefined && (!Array.isArray(input.paths) || input.paths.some((f) => !readablePath(f))))) {
  return { status: 'blocked', base, blockers: ['base must be a safe git ref; paths must be explicit canonical nonprivate repo paths'] }
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
const VERDICT = {
  type: 'object',
  required: ['outcome', 'reason'],
  properties: { outcome: { type: 'string', enum: ['confirmed', 'refuted', 'uncertain'] }, reason: str },
}

// ---------- scope ----------
phase('Scope')
let files = input.paths
if (!files) {
  const scope = await agent([
    `List the files changed relative to ${base}: run \`git diff --name-only ${base}\` and \`git ls-files --others --exclude-standard\` from the repo root.`,
    'Return repo-relative paths only. Do not read file contents and do not edit anything.',
    'Report mode: files plus error. error is empty only if both git commands succeeded. On failure, return error with a safe explanation; never represent a failed command as an empty successful diff.',
  ].join('\n'), { label: 'list changes', phase: 'Scope', agentType: 'general-builder', effort: 'low', schema: SCOPE })
  if (!scope) return { status: 'needs_lead', base, files: [], scopeError: 'scope agent returned nothing', confirmed: [], unverified: [], refuted: [], minor: [] }
  if (scope.error) return { status: 'needs_lead', base, files: scope.files, scopeError: scope.error, confirmed: [], unverified: [], refuted: [], minor: [] }
  files = scope.files
}
if (files.some((f) => !readablePath(f))) return { status: 'blocked', base, blockers: ['scope returned a private or noncanonical path; lead must select a safe scope'] }
files = files.filter((f, i) => files.indexOf(f) === i)
if (!files.length) {
  log('No changed files found')
  return { status: 'green', base, files: [], reviewers: [], missingReviewers: [], reviewProblems: [], confirmed: [], unverified: [], refuted: [], minor: [] }
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
log(`${files.length} file(s); reviewers: ${Object.keys(assignments).join(', ')}`)

// ---------- barrier between reviews and refutes keeps concurrency below 16 ----------
phase('Review')
let refuteBudget = MAX_REFUTES
const skippedRefutes = []
const reviewed = await parallel(Object.keys(assignments).map((reviewer) => () => agent([
    `Unit review of the current diff against ${base}. Round 1.`,
    `Your files:\n${assignments[reviewer].join('\n')}`,
    `All changed files, for context:\n${files.join('\n')}`,
    `Read the diff (\`git diff ${base} -- <file>\`) and whole content of new files. Report findings; recheck is empty.`,
  ].join('\n\n'), { label: `review ${reviewer}`, phase: 'Review', agentType: reviewer, schema: REVIEW })
    .then((review) => (review ? { reviewer, review } : null))))
phase('Refute')
const perReviewer = await parallel(reviewed.map((result) => () => {
    if (!result) return null
    const blocking = result.review.findings.filter((f) => f.severity !== 'minor')
    const minor = result.review.findings.filter((f) => f.severity === 'minor').map((f) => ({ ...f, reviewer: result.reviewer }))
    return parallel(blocking.map((f) => () => {
      if (refuteBudget <= 0) {
        skippedRefutes.push({ ...f, reviewer: result.reviewer })
        return Promise.resolve(null)
      }
      refuteBudget -= 1
      return agent([
        'Try to refute this review finding. Read the code and the cited SPEC/TASKS text yourself.',
        `Diff base: ${base}. Files in scope:\n${files.join('\n')}. Read git diff against this base and whole new files.`,
        `Finding from ${result.reviewer}:\n${JSON.stringify(f, null, 1)}`,
        'outcome confirmed: the failure scenario really happens. refuted: it cannot happen or the evidence is wrong. uncertain: you cannot tell from the repo. Do not edit files.',
      ].join('\n\n'), { label: `refute ${result.reviewer}:${f.id}`, phase: 'Refute', agentType: 'general-reviewer', schema: VERDICT })
        .then((v) => ({ ...f, reviewer: result.reviewer, verdict: v }))
    })).then((judged) => ({ reviewer: result.reviewer,
      judged: blocking.map((f, i) => judged[i] || { ...f, reviewer: result.reviewer, verdict: null }), minor }))
  }))

const done = perReviewer.filter(Boolean)
const judged = done.flatMap((r) => r.judged)
if (skippedRefutes.length) log(`Refute cap ${MAX_REFUTES} reached; ${skippedRefutes.length} blocking finding(s) returned unverified`)
const missingReviewers = Object.keys(assignments).filter((r) => !done.some((d) => d.reviewer === r))
const reviewProblems = reviewed.filter((r) => r && r.review.verdict !== 'approve'
  && !r.review.findings.some((f) => f.severity !== 'minor')).map((r) => `${r.reviewer}: changes_required without blocking findings`)
const confirmed = judged.filter((f) => f.verdict && f.verdict.outcome === 'confirmed')
const unverified = judged.filter((f) => !f.verdict || f.verdict.outcome === 'uncertain')
if (missingReviewers.length) log(`No result from: ${missingReviewers.join(', ')}`)
return {
  status: missingReviewers.length || reviewProblems.length || confirmed.length || unverified.length ? 'needs_lead' : 'green',
  base,
  files,
  reviewers: Object.keys(assignments),
  missingReviewers,
  reviewProblems,
  confirmed,
  unverified,
  refuted: judged.filter((f) => f.verdict && f.verdict.outcome === 'refuted'),
  minor: done.flatMap((r) => r.minor),
}
