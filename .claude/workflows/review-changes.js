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
  { reviewer: 'models-reviewer', re: /^(src\/lib\/server\/meta\.ts|prompts\/|src\/lib\/mocks\/|src\/app\/api\/(segment|identify|instruction|edit|check|search-parts|transcribe)\/|spike\/(responses_sam|responses_spark|images_edits|asr_transcribe|files|run_all)\.py)/ },
  { reviewer: 'imaging-reviewer', re: /^(src\/lib\/server\/images\.ts|src\/lib\/coordinates\.ts|src\/app\/api\/(normalize|composite)\/|spike\/(imaging|local_images)\.py|src\/components\/(ImageCanvas|PartOverlay|PartSelector|BeforeAfter|UploadDropzone|ReferenceDropzone)\.tsx)/ },
  { reviewer: 'shop-reviewer', re: /^(src\/lib\/(db|project|cache|quote|pdf)\.ts|src\/lib\/server\/fit[^/]*\.ts|prompts\/fit-check|src\/components\/(BuildSheet|ProductFields|FitBadge|EvidenceLinks|PaperworkSummary|EstimatePreview|MissingCosts|InspectionFees|ExportButton|ShopSettingsForm|VersionStrip|ProjectList|EditReview)\.tsx)/ },
  { reviewer: 'security-reviewer', re: /^(budget\/|src\/lib\/server\/(budget|config|fetch-product|meta)\.ts|src\/app\/api\/|spike\/(ledger|common|deployment)\.py|next\.config\.ts|\.env\.example$|\.gitignore$|\.claude\/settings\.json$|src\/(middleware|proxy)\.ts)/ },
  { reviewer: 'release-reviewer', re: /^(README\.md|CREDITS\.md|LICENSE|docs\/(submission|demo-script)\.md|public\/)/ },
]
const MAX_REFUTES = 12

const input = typeof args === 'string' ? { base: args.trim() || 'HEAD' } : (args || {})
const base = input.base || 'HEAD'

const str = { type: 'string' }
const SCOPE = { type: 'object', required: ['files'], properties: { files: { type: 'array', items: str } } }
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
    recheck: { type: 'array', items: { type: 'object', properties: {} } },
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
  ].join('\n'), { label: 'list changes', phase: 'Scope', agentType: 'general-builder', effort: 'low', schema: SCOPE })
  files = scope ? scope.files : []
}
files = files.filter((f, i) => files.indexOf(f) === i)
if (!files.length) {
  log('No changed files found')
  return { base, files: [], confirmed: [], unverified: [], refuted: [], minor: [] }
}
const assignments = {}
for (const rule of RULES) {
  const matched = files.filter((f) => rule.re.test(f))
  if (matched.length) assignments[rule.reviewer] = matched
}
for (const r of input.extraReviewers || []) assignments[r] = assignments[r] || files
assignments['general-reviewer'] = files
log(`${files.length} file(s); reviewers: ${Object.keys(assignments).join(', ')}`)

// ---------- review, then refute each blocking finding as soon as its review lands ----------
phase('Review')
let refuteBudget = MAX_REFUTES
const skippedRefutes = []
const perReviewer = await pipeline(
  Object.keys(assignments),
  (reviewer) => agent([
    `Unit review of the current diff against ${base}. Round 1.`,
    `Your files:\n${assignments[reviewer].join('\n')}`,
    `All changed files, for context:\n${files.join('\n')}`,
    `Read the diff (\`git diff ${base} -- <file>\`) and whole content of new files. Report findings; recheck is empty.`,
  ].join('\n\n'), { label: `review ${reviewer}`, phase: 'Review', agentType: reviewer, schema: REVIEW })
    .then((review) => (review ? { reviewer, review } : null)),
  (result) => {
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
        `Finding from ${result.reviewer}:\n${JSON.stringify(f, null, 1)}`,
        'outcome confirmed: the failure scenario really happens. refuted: it cannot happen or the evidence is wrong. uncertain: you cannot tell from the repo. Do not edit files.',
      ].join('\n\n'), { label: `refute ${result.reviewer}:${f.id}`, phase: 'Refute', agentType: 'general-reviewer', schema: VERDICT })
        .then((v) => ({ ...f, reviewer: result.reviewer, verdict: v }))
    })).then((judged) => ({ reviewer: result.reviewer, judged: judged.filter(Boolean), minor }))
  },
)

const done = perReviewer.filter(Boolean)
const judged = done.flatMap((r) => r.judged)
if (skippedRefutes.length) log(`Refute cap ${MAX_REFUTES} reached; ${skippedRefutes.length} blocking finding(s) returned unverified`)
const missingReviewers = Object.keys(assignments).filter((r) => !done.some((d) => d.reviewer === r))
if (missingReviewers.length) log(`No result from: ${missingReviewers.join(', ')}`)
return {
  base,
  files,
  reviewers: Object.keys(assignments),
  missingReviewers,
  confirmed: judged.filter((f) => f.verdict && f.verdict.outcome === 'confirmed'),
  unverified: judged.filter((f) => !f.verdict || f.verdict.outcome === 'uncertain').concat(skippedRefutes),
  refuted: judged.filter((f) => f.verdict && f.verdict.outcome === 'refuted'),
  minor: done.flatMap((r) => r.minor),
}
