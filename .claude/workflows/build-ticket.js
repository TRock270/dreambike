export const meta = {
  name: 'build-ticket',
  description: 'Build one DreamBike ticket: plan check, builder/reviewer challenge loop per unit, full checks, done-when gate',
  whenToUse: 'Any TASKS.md ticket or ticket slice with offline-buildable code. Args: "T2" or {ticket, goal?, units?, maxRounds?, checks?}',
  phases: [
    { title: 'Plan check', detail: 'general-reviewer drafts or checks the unit split' },
    { title: 'Build and review', detail: 'builder and reviewers challenge each other per unit' },
    { title: 'Verify', detail: 'run full checks without changing reviewed code' },
    { title: 'Done-when gate', detail: 'general-reviewer audits the acceptance checks' },
  ],
}

// Domain -> builder and specialist reviewer. general-reviewer joins every unit.
const DOMAINS = {
  models: { builder: 'models-builder', reviewer: 'models-reviewer' },
  imaging: { builder: 'imaging-builder', reviewer: 'imaging-reviewer' },
  shop: { builder: 'shop-builder', reviewer: 'shop-reviewer' },
  platform: { builder: 'platform-builder', reviewer: 'security-reviewer' },
  ui: { builder: 'ui-builder', reviewer: null },
  release: { builder: 'general-builder', reviewer: 'release-reviewer' },
  general: { builder: 'general-builder', reviewer: null },
}
const EXTRA_REVIEWERS = ['security-reviewer', 'release-reviewer', 'models-reviewer', 'imaging-reviewer', 'shop-reviewer']
const MAX_UNITS = 4
// Agents sometimes report absolute paths; compare everything repo-relative.
// The optional part strips a session worktree under .claude/worktrees/<name>/.
const repoPath = (f) => f.replace(/^\/.*?\/dreambike\/(\.claude\/worktrees\/[^/]+\/)?/, '').replace(/^\.\//, '')
const MAX_REVIEWERS_PER_UNIT = 3

// Args arrive as an object, a JSON string, or plain text like "T2 focus on preflight".
function parseArgs(raw) {
  if (typeof raw !== 'string') return raw || {}
  const text = raw.trim()
  if (text.startsWith('{')) return JSON.parse(text)
  const words = text.split(/\s+/)
  return { ticket: words[0], goal: words.slice(1).join(' ') }
}
const input = parseArgs(args)
if (!input.ticket) throw new Error('build-ticket needs a ticket id, e.g. "T2" or {ticket: "T2"}')
const ticket = input.ticket
const goal = input.goal ? `Lead's goal for this run: ${input.goal}` : ''
const maxRounds = Math.min(Math.max(input.maxRounds || 3, 1), 3)
const requestedChecks = input.checks
if ((input.maxRounds !== undefined && (!Number.isInteger(input.maxRounds) || input.maxRounds < 1))
  || (requestedChecks !== undefined && (!Array.isArray(requestedChecks) || !requestedChecks.length
    || requestedChecks.some((c) => typeof c !== 'string' || !c.trim()) || new Set(requestedChecks).size !== requestedChecks.length))) {
  return { ticket, status: 'blocked', blockers: ['checks must be a nonempty array of unique command strings; maxRounds must be a positive integer'] }
}

// ---------- schemas ----------
const str = { type: 'string' }
const strList = { type: 'array', items: str }
const UNIT = {
  type: 'object',
  required: ['id', 'domain', 'task', 'files', 'dependsOn', 'extraReviewers'],
  properties: {
    id: str,
    domain: { type: 'string', enum: Object.keys(DOMAINS) },
    task: str,
    files: strList,
    dependsOn: strList,
    extraReviewers: { type: 'array', items: { type: 'string', enum: EXTRA_REVIEWERS } },
  },
}
const PLAN = {
  type: 'object',
  required: ['ready', 'blockers', 'doneWhen', 'units', 'notes'],
  properties: { ready: { type: 'boolean' }, blockers: strList, doneWhen: strList, units: { type: 'array', items: UNIT }, notes: str },
}
const CHECK = {
  type: 'object',
  required: ['command', 'result', 'output'],
  properties: { command: str, result: { type: 'string', enum: ['pass', 'fail', 'not_run'] }, output: str },
}
const NEEDS_LEAD = {
  type: 'object',
  required: ['kind', 'detail'],
  properties: { kind: { type: 'string', enum: ['dependency', 'paid_call', 'owner_input', 'spec_conflict', 'outside_files'] }, detail: str },
}
const BUILD = {
  type: 'object',
  required: ['summary', 'filesChanged', 'checks', 'responses', 'needsLead', 'notes'],
  properties: {
    summary: str,
    filesChanged: strList,
    checks: { type: 'array', items: CHECK },
    responses: {
      type: 'array',
      items: {
        type: 'object',
        required: ['findingId', 'action', 'evidence'],
        properties: { findingId: str, action: { type: 'string', enum: ['fixed', 'disputed'] }, evidence: str },
      },
    },
    needsLead: { type: 'array', items: NEEDS_LEAD },
    notes: str,
  },
}
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
    checksRun: { type: 'array', items: CHECK },
  },
}
const VERIFY = {
  type: 'object',
  required: ['checks', 'fixes', 'remainingFailures', 'needsLead'],
  properties: {
    checks: { type: 'array', items: CHECK },
    fixes: { type: 'array', items: { type: 'object', required: ['file', 'what'], properties: { file: str, what: str } } },
    remainingFailures: strList,
    needsLead: { type: 'array', items: NEEDS_LEAD },
  },
}
const GATE = {
  type: 'object',
  required: ['items', 'findings', 'summary'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['item', 'status', 'evidence'],
        properties: { item: str, status: { type: 'string', enum: ['met', 'not_met', 'blocked', 'not_verifiable_offline'] }, evidence: str },
      },
    },
    findings: { type: 'array', items: FINDING },
    summary: str,
  },
}

const json = (value) => JSON.stringify(value, null, 1)
const isBlocking = (f) => f.severity === 'blocker' || f.severity === 'major'
const unique = (list) => list.filter((x, i) => list.indexOf(x) === i)
const completeChecks = (reported, expected) => reported.length === expected.length
  && expected.every((command) => reported.filter((c) => c.command === command && c.result === 'pass').length === 1)
const writablePath = (file) => file && !file.startsWith('/') && !file.includes('\\')
  && !/[\s*?]/.test(file) && file.split('/').every((p) => p && p !== '.' && p !== '..')
  && !/^(\.env(?!\.example$)|consent\/|secrets\/|fixtures\/|my_bike\/|RULES\.md$|PLAN\.md$|SPEC\.md$|TASKS\.md$|CLAUDE\.md$|HACKATHON_GUIDELINES\.md$|docs\/api-evidence\.md$|\.claude\/settings\.json$)/.test(file)

// ---------- phase 1: plan check ----------
phase('Plan check')
const planPrompt = [
  `Mode: plan check. Ticket ${ticket}.`,
  goal,
  input.units
    ? `The lead proposed these units. Check them and return corrected units:\n${json(input.units)}`
    : 'Draft the units yourself from TASKS.md and SPEC.md.',
  `Domains: ${Object.keys(DOMAINS).join(', ')}. models = Meta client, model routes, prompts, mocks, spike profiles; imaging = normalize, coordinates, masks, composite; shop = history, sheet, fit policy, quote, PDF; platform = budget, config, fetch, demo, deploy; ui = components and tokens; release = README, credits, submission docs, public assets; general = scaffold, config, glue.`,
  `At most ${MAX_UNITS} units. files lists every file the builder may create or edit, including tests. Two units share a file only if one dependsOn the other.`,
  'Use explicit canonical repo-relative file paths, not directories/globs. Exclude private and lead-only files from Subagent rules; put their proposed updates in notes for the lead.',
  'extraReviewers: include every relevant specialist: security-reviewer for paid calls/config/secrets, release-reviewer for public assets/disclosures, imaging-reviewer for canvas/overlays/clicks, shop-reviewer for money/history/fit, models-reviewer for model dispatch/parsing. Split units if necessary; never drop a required reviewer to save calls.',
  `doneWhen: copy each done-when item of ${ticket} from TASKS.md as one string.`,
  'ready=false only for real blockers (owner approval, paid call, missing owner input, gate without documented fallback, SPEC conflict). Plan the offline parts that can proceed and name the gated part in notes.',
  'Do not edit files.',
].filter(Boolean).join('\n\n')
const plan = await agent(planPrompt, { label: `plan ${ticket}`, phase: 'Plan check', agentType: 'general-reviewer', schema: PLAN })
if (!plan) return { ticket, status: 'blocked', blockers: ['plan check agent returned nothing'] }
if (!plan.ready || !plan.units.length || !plan.doneWhen.length) {
  const blockers = plan.blockers
    .concat(plan.units.length ? [] : ['plan check returned no units'])
    .concat(plan.doneWhen.length ? [] : ['plan check found no done-when items'])
  log(`${ticket} not ready: ${blockers.join('; ')}`)
  return { ticket, status: 'blocked', blockers, notes: plan.notes, proposedUnits: plan.units }
}

// Validate the unit graph in plain code.
const byId = Object.create(null)
const planErrors = []
for (const u of plan.units) {
  if (!u.id || byId[u.id]) planErrors.push(`empty or duplicate unit id ${u.id}`)
  if (!u.files.length || u.files.some((f) => !writablePath(f))) planErrors.push(`Unit ${u.id}: files must be explicit, canonical, writable repo paths`)
  byId[u.id] = u
}
for (const u of plan.units) {
  for (const d of u.dependsOn) if (!byId[d] || d === u.id) planErrors.push(`Unit ${u.id}: invalid dependency ${d}`)
}
if (planErrors.length) return { ticket, status: 'blocked', blockers: planErrors, proposedUnits: plan.units }
const ordered = []
const visiting = Object.create(null)
function visit(u) {
  if (ordered.includes(u)) return
  if (visiting[u.id]) throw new Error(`Dependency cycle at unit ${u.id}`)
  visiting[u.id] = true
  u.dependsOn.forEach((d) => visit(byId[d]))
  ordered.push(u)
}
try { plan.units.forEach(visit) }
catch (error) { return { ticket, status: 'blocked', blockers: [error.message], proposedUnits: plan.units } }
function dependsOn(unit, id) {
  return unit.dependsOn.some((d) => d === id || dependsOn(byId[d], id))
}
for (let i = 0; i < ordered.length; i++) {
  for (const other of ordered.slice(i + 1)) {
    if (ordered[i].files.some((f) => other.files.includes(f)) && !dependsOn(other, ordered[i].id)) {
      planErrors.push(`Units ${ordered[i].id} and ${other.id} share files without a dependency`)
    }
  }
}
if (planErrors.length) return { ticket, status: 'blocked', blockers: planErrors, proposedUnits: plan.units }
const units = ordered.slice(0, MAX_UNITS)
const deferredUnits = ordered.slice(MAX_UNITS)
if (deferredUnits.length) log(`Deferred ${deferredUnits.length} unit(s) beyond ${MAX_UNITS}: ${deferredUnits.map((u) => u.id).join(', ')}. Run them in a second /build-ticket.`)
log(`${ticket}: ${units.length} unit(s): ${units.map((u) => `${u.id}[${u.domain}]`).join(', ')}`)

// ---------- phase 2: build and review ----------
function reviewersFor(unit) {
  return unique([DOMAINS[unit.domain].reviewer, ...unit.extraReviewers, 'general-reviewer'].filter(Boolean))
}

function builderPrompt(unit, round, open) {
  return [
    `Ticket ${ticket}, unit ${unit.id}, round ${round} of ${maxRounds}.`,
    goal,
    `Task: ${unit.task}`,
    `Files you own (create or edit only these):\n${unit.files.join('\n')}`,
    'Other units may be editing other files right now. Run only targeted offline checks, and never npm run build (the Verify phase builds once).',
    'needsLead ends this unit before review, so use it only for something that blocks the unit; follow-ups go in notes.',
    round === 1 ? '' : `Reviewer findings still open. Fix each one or dispute it with evidence:\n${json(open)}`,
  ].filter(Boolean).join('\n\n')
}

// firstLook: the reviewer has not returned a review for this unit yet, so it gets the round-1 task.
function reviewPrompt(unit, reviewer, round, build, mine, firstLook) {
  const recheckPart = round === 1 || firstLook
    ? 'Report your findings.'
    : (mine.length
      ? `Recheck these findings you raised earlier, using the builder's responses in its report. Use these exact findingIds in recheck:\n${json(mine)}`
      : 'You had no open findings. Check that the latest changes did not break anything in your area.')
  return [
    `Unit review. Ticket ${ticket}, unit ${unit.id}, round ${round} of ${maxRounds}.`,
    `Task given to the builder: ${unit.task}`,
    `Files in scope:\n${unit.files.join('\n')}`,
    `Builder report:\n${json(build)}`,
    'Read the files themselves (git diff for tracked files, whole content for new ones). Do not trust the report over the code.',
    'Other reviewers and units run in parallel: do not run npm run build.',
    recheckPart,
    round === 1 || firstLook ? '' : 'Raise new findings only if blocker or major, and only if the fix caused them or you missed something real.',
  ].filter(Boolean).join('\n\n')
}

async function runUnit(unit) {
  const domain = DOMAINS[unit.domain]
  const allReviewers = reviewersFor(unit)
  const rounds = []
  const minor = []
  const notYetReviewed = allReviewers.slice() // a unit is approved only after every reviewer has returned once
  const reviewProblems = Object.create(null)
  const changedFiles = []
  const disputeEvidence = Object.create(null)
  let open = []
  let build = null
  const currentDisputes = () => open.filter((f) => disputeEvidence[f.id]).map((f) => ({ ...f, builderEvidence: disputeEvidence[f.id] }))
  for (let round = 1; round <= maxRounds; round++) {
    const attempted = await agent(builderPrompt(unit, round, open), {
      label: `${unit.id} build r${round}`, phase: 'Build and review', agentType: domain.builder, schema: BUILD,
    })
    if (!attempted) return { unit, status: 'failed', reason: 'builder returned nothing; inspect owned files for partial edits', lastBuild: build, rounds, openFindings: open, disputes: currentDisputes(), minor }
    build = attempted
    const editedNow = build.filesChanged.length > 0
    changedFiles.push(...build.filesChanged.map(repoPath))
    build = { ...build, filesChanged: unique(changedFiles) }
    build.responses.filter((r) => r.action === 'disputed').forEach((r) => { disputeEvidence[r.findingId] = r.evidence })
    if (build.filesChanged.some((f) => !unit.files.includes(f))) {
      return { unit, status: 'needs_lead', reason: 'builder changed files outside ownership', lastBuild: build, rounds, openFindings: open, disputes: currentDisputes(), minor }
    }
    if (build.needsLead.length) {
      rounds.push({ round, build: build.summary, needsLead: build.needsLead })
      return { unit, status: 'needs_lead', needsLead: build.needsLead, lastBuild: build, rounds, openFindings: open, disputes: currentDisputes(), minor }
    }
    // Every specialist rechecks edited code. For a dispute with no edits, ask
    // only reviewers with open/incomplete results plus general-reviewer.
    const active = round === 1 || editedNow
      ? allReviewers
      : unique([...open.map((f) => f.reviewer), ...notYetReviewed, ...Object.keys(reviewProblems), 'general-reviewer'])
    const reviews = []
    // Four units times three reviewers is at most 12 simultaneous agents.
    // Additional specialists run in the next batch rather than being discarded.
    // A first review runs on the card model (Opus); rechecks from round 2 on run on Sonnet.
    // security-reviewer rechecks on its card at medium effort: ../CLAUDE.md wants Opus for security work.
    for (let offset = 0; offset < active.length; offset += MAX_REVIEWERS_PER_UNIT) {
      reviews.push(...await parallel(active.slice(offset, offset + MAX_REVIEWERS_PER_UNIT).map((reviewer) => () => {
        const firstLook = notYetReviewed.includes(reviewer)
        const recheckModel = reviewer === 'security-reviewer' ? { effort: 'medium' } : { model: 'sonnet' }
        return agent(reviewPrompt(unit, reviewer, round, build, open.filter((f) => f.reviewer === reviewer), firstLook), {
          label: `${unit.id} ${reviewer} r${round}`, phase: 'Build and review', agentType: reviewer, ...(firstLook ? {} : recheckModel), schema: REVIEW,
        }).then((r) => (r ? { reviewer, ...r } : null))
      })))
    }

    const next = []
    const missing = []
    active.forEach((reviewer, i) => {
      const review = reviews[i]
      const mine = open.filter((f) => f.reviewer === reviewer)
      if (!review) {
        missing.push(reviewer)
        reviewProblems[reviewer] = 'returned nothing'
        next.push(...mine) // cannot confirm a fix without the reviewer
        return
      }
      delete reviewProblems[reviewer]
      if (notYetReviewed.includes(reviewer)) notYetReviewed.splice(notYetReviewed.indexOf(reviewer), 1)
      const recheck = {}
      review.recheck.forEach((r) => { recheck[r.findingId] = r })
      const skipped = mine.filter((f) => !recheck[f.id])
      if (skipped.length) log(`Unit ${unit.id}: ${reviewer} did not recheck ${skipped.map((f) => f.id).join(', ')}; kept open`)
      for (const f of mine) {
        const r = recheck[f.id]
        if (!r || r.status === 'upheld') next.push({ ...f, recheckStatus: r ? r.status : 'missing', upheldReason: r ? r.reason : 'not rechecked' })
      }
      for (const f of review.findings) {
        const tagged = { ...f, id: `${reviewer}:r${round}:${f.id}`, reviewer }
        if (isBlocking(f)) next.push(tagged)
        else minor.push(tagged)
      }
      if (review.verdict !== 'approve' && !next.some((f) => f.reviewer === reviewer)) {
        reviewProblems[reviewer] = 'changes_required without an open blocking finding'
      }
    })
    // Keep open findings of reviewers who were not active this round.
    next.push(...open.filter((f) => !active.includes(f.reviewer)))
    if (missing.length) log(`Unit ${unit.id} round ${round}: no result from ${missing.join(', ')}`)
    rounds.push({ round, build: build.summary, verdicts: reviews.filter(Boolean).map((r) => `${r.reviewer}: ${r.verdict}`), open: next.length })
    open = next
    log(`Unit ${unit.id} round ${round}: ${open.length} open blocking finding(s)`)
    if (!open.length && !missing.length && !notYetReviewed.length && !Object.keys(reviewProblems).length) return { unit, status: 'approved', lastBuild: build, rounds, openFindings: [], minor }
    // Another round cannot settle findings the builder disputed and the reviewer upheld.
    // Stop early and let the lead decide.
    const disputedNow = build.responses.filter((r) => r.action === 'disputed').map((r) => r.findingId)
    if (round > 1 && open.length && !notYetReviewed.length && !Object.keys(reviewProblems).length
      && open.every((f) => disputedNow.includes(f.id) && f.recheckStatus === 'upheld')) {
      log(`Unit ${unit.id}: only upheld disputes left after round ${round}; handing to the lead`)
      break
    }
  }
  const disputes = currentDisputes()
  const incomplete = unique([...notYetReviewed, ...Object.keys(reviewProblems)])
  return { unit, status: 'unresolved', reason: incomplete.length ? `incomplete review: ${incomplete.join(', ')}` : 'open blocking findings', lastBuild: build, rounds, openFindings: open, disputes, minor }
}

phase('Build and review')
const results = Object.create(null)
const remaining = units.slice()
while (remaining.length) {
  // A wave is every unit whose dependencies are finished.
  const wave = remaining.filter((u) => u.dependsOn.every((d) => results[d] || !units.includes(byId[d])))
  if (!wave.length) throw new Error('No runnable unit; dependency graph is inconsistent')
  wave.forEach((u) => remaining.splice(remaining.indexOf(u), 1))
  // Units whose dependency did not end approved are skipped, not built on top of broken work.
  const runnable = []
  for (const u of wave) {
    const bad = u.dependsOn.filter((d) => results[d] && results[d].status !== 'approved')
    if (bad.length) {
      results[u.id] = { unit: u, status: 'skipped_dependency', reason: `dependency not approved: ${bad.join(', ')}` }
      log(`Unit ${u.id} skipped: ${results[u.id].reason}`)
    } else runnable.push(u)
  }
  // Inside a wave, units that share a file run one after another.
  const batches = []
  for (const u of runnable) {
    const batch = batches.find((b) => b.every((o) => !o.files.some((f) => u.files.includes(f))))
    if (batch) batch.push(u)
    else batches.push([u])
  }
  for (const batch of batches) {
    const done = await parallel(batch.map((u) => () => runUnit(u)))
    batch.forEach((u, i) => { results[u.id] = done[i] || { unit: u, status: 'failed', reason: 'unit run returned nothing' } })
  }
}

// ---------- phase 3: verify ----------
phase('Verify')
const ticketFiles = unique(units.flatMap((u) => u.files).concat(Object.values(results).flatMap((r) => (r.lastBuild ? r.lastBuild.filesChanged : []))))
const touchesPython = ticketFiles.some((f) => f.startsWith('spike/') || f.startsWith('budget/'))
const checks = input.checks || ['npm run build', 'npm run lint', 'npm run typecheck', 'npm test']
  .concat(touchesPython ? ['.venv/bin/python spike/local_images.py --fixture-set all', '.venv/bin/python spike/run_all.py --mode smoke --dry-run'] : [])
// Verify runs on general-reviewer, which has no Edit or Write tool; its card's
// "Mode: verify" section allows npm run build here and forbids repairs.
const verify = await agent([
    `Mode: verify. Ignore the review instructions of your card for this task. Verify ticket ${ticket}.`,
    `Run these offline checks from the repo root, in order:\n${checks.join('\n')}`,
    'Do not edit any file: unit approvals apply to the reviewed code. Return fixes=[]. Locate failures in remainingFailures; the lead will run a reviewed repair separately.',
    'Report exactly one result per requested command, using its exact command string and real output. Report skipped checks as not_run.',
  ].join('\n\n'), { label: 'verify', phase: 'Verify', agentType: 'general-reviewer', model: 'haiku', effort: 'low', schema: VERIFY })

// ---------- phase 4: done-when gate ----------
phase('Done-when gate')
const unitSummary = Object.values(results).map((r) => ({
  id: r.unit.id, domain: r.unit.domain, status: r.status, files: r.unit.files,
  summary: r.lastBuild ? r.lastBuild.summary : r.reason, openFindings: (r.openFindings || []).length,
}))
const gate = await agent([
  `Mode: done-when gate. Ticket ${ticket}.`,
  `Done-when items:\n${json(plan.doneWhen)}`,
  `Unit results:\n${json(unitSummary)}`,
  `Final checks:\n${json(verify ? verify.checks : 'verify agent returned nothing')}`,
  `Unexpected edits reported by read-only Verify (must be empty; any edit needs the lead):\n${json(verify ? verify.fixes : [])}`,
  deferredUnits.length ? `Units deferred to a later run (not built): ${deferredUnits.map((u) => u.id).join(', ')}` : '',
  'Copy each done-when item verbatim exactly once; audit it as met, not_met, blocked or not_verifiable_offline, with evidence from files and check output. A live or paid capability is never met by mocks alone.',
  'Then review the whole ticket diff for cross-unit problems the unit reviews could not see. Flag any Verify edit as a scope violation needing a separately reviewed repair. Report problems as findings.',
].join('\n\n'), { label: `gate ${ticket}`, phase: 'Done-when gate', agentType: 'general-reviewer', schema: GATE })

const all = Object.values(results)
const openFindings = all.flatMap((r) => r.openFindings || []).concat(gate ? gate.findings.filter(isBlocking) : [])
const green = gate
  && !deferredUnits.length
  && all.length === units.length
  && all.every((r) => r.status === 'approved')
  && verify && completeChecks(verify.checks, checks)
  && !verify.remainingFailures.length && !verify.needsLead.length && !verify.fixes.length
  && gate.items.length === plan.doneWhen.length
  && plan.doneWhen.every((item) => gate.items.filter((i) => i.item === item).length === plan.doneWhen.filter((s) => s === item).length)
  && gate.items.every((i) => i.status === 'met')
  && !openFindings.length
return {
  ticket,
  status: green ? 'green' : 'needs_lead',
  notApproved: all.filter((r) => r.status !== 'approved').map((r) => `${r.unit.id}: ${r.status}${r.reason ? ` (${r.reason})` : ''}`),
  units: all.map((r) => ({ id: r.unit.id, domain: r.unit.domain, files: r.unit.files, status: r.status, reason: r.reason, rounds: r.rounds, filesChanged: r.lastBuild ? r.lastBuild.filesChanged : [], notes: r.lastBuild ? r.lastBuild.notes : '' })),
  deferredUnits,
  checks: verify,
  gate,
  openFindings,
  disputes: all.flatMap((r) => r.disputes || []),
  needsLead: all.flatMap((r) => r.needsLead || []).concat(verify ? verify.needsLead : []),
  minorFindings: all.flatMap((r) => r.minor || []).concat(gate ? gate.findings.filter((f) => !isBlocking(f)) : []),
  planNotes: plan.notes,
}
