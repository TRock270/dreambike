export const meta = {
  name: 'build-ticket',
  description: 'Build one DreamBike ticket: plan check, builder/reviewer challenge loop per unit, full checks, done-when gate',
  whenToUse: 'Any TASKS.md ticket or ticket slice with offline-buildable code. Args: "T2" or {ticket, goal?, units?, maxRounds?, checks?}',
  phases: [
    { title: 'Plan check', detail: 'general-reviewer drafts or checks the unit split' },
    { title: 'Build and review', detail: 'builder and reviewers challenge each other per unit' },
    { title: 'Verify', detail: 'build, lint, typecheck, tests; fix failures' },
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
const MAX_REVIEWERS_PER_UNIT = 3

const input = typeof args === 'string'
  ? { ticket: args.trim().split(/\s+/)[0], goal: args.trim().split(/\s+/).slice(1).join(' ') }
  : (args || {})
if (!input.ticket) throw new Error('build-ticket needs a ticket id, e.g. "T2" or {ticket: "T2"}')
const ticket = input.ticket
const goal = input.goal ? `Lead's goal for this run: ${input.goal}` : ''
const maxRounds = Math.min(Math.max(input.maxRounds || 3, 1), 3)

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
  'extraReviewers: security-reviewer when the unit dispatches or guards a paid call or touches config or secrets; release-reviewer when it changes anything public. At most one extra reviewer per unit.',
  `doneWhen: copy each done-when item of ${ticket} from TASKS.md as one string.`,
  'ready=false only for real blockers (owner approval, paid call, missing owner input, gate without documented fallback, SPEC conflict). Plan the offline parts that can proceed and name the gated part in notes.',
  'Do not edit files.',
].filter(Boolean).join('\n\n')
const plan = await agent(planPrompt, { label: `plan ${ticket}`, phase: 'Plan check', agentType: 'general-reviewer', schema: PLAN })
if (!plan) throw new Error('Plan check agent returned nothing')
if (!plan.ready) {
  log(`${ticket} not ready: ${plan.blockers.join('; ')}`)
  return { ticket, status: 'blocked', blockers: plan.blockers, notes: plan.notes, proposedUnits: plan.units }
}

// Validate the unit graph in plain code.
const byId = {}
for (const u of plan.units) {
  if (byId[u.id]) throw new Error(`Duplicate unit id ${u.id}`)
  byId[u.id] = u
}
for (const u of plan.units) {
  u.dependsOn = u.dependsOn.filter((d) => {
    if (!byId[d]) log(`Unit ${u.id}: dropped unknown dependency ${d}`)
    return byId[d] && d !== u.id
  })
}
const ordered = []
const visiting = {}
function visit(u) {
  if (ordered.includes(u)) return
  if (visiting[u.id]) throw new Error(`Dependency cycle at unit ${u.id}`)
  visiting[u.id] = true
  u.dependsOn.forEach((d) => visit(byId[d]))
  ordered.push(u)
}
plan.units.forEach(visit)
const units = ordered.slice(0, MAX_UNITS)
const deferredUnits = ordered.slice(MAX_UNITS)
if (deferredUnits.length) log(`Deferred ${deferredUnits.length} unit(s) beyond ${MAX_UNITS}: ${deferredUnits.map((u) => u.id).join(', ')}. Run them in a second /build-ticket.`)
log(`${ticket}: ${units.length} unit(s): ${units.map((u) => `${u.id}[${u.domain}]`).join(', ')}`)

// ---------- phase 2: build and review ----------
function reviewersFor(unit) {
  const list = unique([DOMAINS[unit.domain].reviewer, ...unit.extraReviewers, 'general-reviewer'].filter(Boolean))
  if (list.length > MAX_REVIEWERS_PER_UNIT) {
    const kept = [...list.slice(0, MAX_REVIEWERS_PER_UNIT - 1), 'general-reviewer']
    log(`Unit ${unit.id}: capped reviewers at ${MAX_REVIEWERS_PER_UNIT}, dropped ${list.filter((r) => !kept.includes(r)).join(', ')}`)
    return kept
  }
  return list
}

function builderPrompt(unit, round, open) {
  return [
    `Ticket ${ticket}, unit ${unit.id}, round ${round} of ${maxRounds}.`,
    goal,
    `Task: ${unit.task}`,
    `Files you own (create or edit only these):\n${unit.files.join('\n')}`,
    'Other units may be editing other files right now. Run only targeted offline checks.',
    round === 1 ? '' : `Reviewer findings still open. Fix each one or dispute it with evidence:\n${json(open)}`,
  ].filter(Boolean).join('\n\n')
}

function reviewPrompt(unit, reviewer, round, build, mine) {
  const recheckPart = round === 1
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
    recheckPart,
    round === 1 ? '' : 'Raise new findings only if blocker or major, and only if the fix caused them or you missed something real.',
  ].filter(Boolean).join('\n\n')
}

async function runUnit(unit) {
  const domain = DOMAINS[unit.domain]
  const allReviewers = reviewersFor(unit)
  const rounds = []
  const minor = []
  const notYetReviewed = allReviewers.slice() // a unit is approved only after every reviewer has returned once
  let open = []
  let build = null
  for (let round = 1; round <= maxRounds; round++) {
    build = await agent(builderPrompt(unit, round, open), {
      label: `${unit.id} build r${round}`, phase: 'Build and review', agentType: domain.builder, schema: BUILD,
    })
    if (!build) return { unit, status: 'failed', reason: 'builder returned nothing', rounds, openFindings: open, minor }
    if (build.needsLead.length) {
      rounds.push({ round, build: build.summary, needsLead: build.needsLead })
      return { unit, status: 'needs_lead', needsLead: build.needsLead, lastBuild: build, rounds, openFindings: open, minor }
    }
    // Round 1: every reviewer. Later rounds: reviewers with open findings, reviewers
    // that have not returned yet, and general-reviewer.
    const active = round === 1
      ? allReviewers
      : unique([...open.map((f) => f.reviewer), ...notYetReviewed, 'general-reviewer'])
    const reviews = await parallel(active.map((reviewer) => () =>
      agent(reviewPrompt(unit, reviewer, round, build, open.filter((f) => f.reviewer === reviewer)), {
        label: `${unit.id} ${reviewer} r${round}`, phase: 'Build and review', agentType: reviewer, schema: REVIEW,
      }).then((r) => (r ? { reviewer, ...r } : null))))

    const next = []
    const missing = []
    active.forEach((reviewer, i) => {
      const review = reviews[i]
      const mine = open.filter((f) => f.reviewer === reviewer)
      if (!review) {
        missing.push(reviewer)
        next.push(...mine) // cannot confirm a fix without the reviewer
        return
      }
      if (notYetReviewed.includes(reviewer)) notYetReviewed.splice(notYetReviewed.indexOf(reviewer), 1)
      const recheck = {}
      review.recheck.forEach((r) => { recheck[r.findingId] = r })
      for (const f of mine) {
        const r = recheck[f.id]
        if (!r || r.status === 'upheld') next.push({ ...f, upheldReason: r ? r.reason : 'not rechecked' })
      }
      for (const f of review.findings) {
        const tagged = { ...f, id: `${reviewer}:r${round}:${f.id}`, reviewer }
        if (isBlocking(f)) next.push(tagged)
        else minor.push(tagged)
      }
    })
    // Keep open findings of reviewers who were not active this round.
    next.push(...open.filter((f) => !active.includes(f.reviewer)))
    if (missing.length) log(`Unit ${unit.id} round ${round}: no result from ${missing.join(', ')}`)
    rounds.push({ round, build: build.summary, verdicts: reviews.filter(Boolean).map((r) => `${r.reviewer}: ${r.verdict}`), open: next.length })
    open = next
    log(`Unit ${unit.id} round ${round}: ${open.length} open blocking finding(s)`)
    if (!open.length && !missing.length && !notYetReviewed.length) return { unit, status: 'approved', lastBuild: build, rounds, openFindings: [], minor }
  }
  const disputed = {}
  build.responses.filter((r) => r.action === 'disputed').forEach((r) => { disputed[r.findingId] = r.evidence })
  const disputes = open.filter((f) => disputed[f.id]).map((f) => ({ ...f, builderEvidence: disputed[f.id] }))
  return { unit, status: 'unresolved', lastBuild: build, rounds, openFindings: open, disputes, minor }
}

phase('Build and review')
const results = {}
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
let verify = null
let previousFailures = Infinity
for (let round = 1; round <= 2; round++) {
  verify = await agent([
    `Verify ticket ${ticket}, round ${round} of 2.`,
    `Run these offline checks from the repo root, in order:\n${checks.join('\n')}`,
    `If a check fails because of a file in this ticket's file set, fix it there and rerun that check:\n${ticketFiles.join('\n')}`,
    'Do not touch files outside that set; list such failures in remainingFailures. Never weaken, skip, or delete a test to make it pass.',
    'Report the final result of every check, with the last relevant output lines.',
  ].join('\n\n'), { label: `verify r${round}`, phase: 'Verify', agentType: 'general-builder', schema: VERIFY })
  if (!verify) break
  const failures = verify.checks.filter((c) => c.result === 'fail').length
  log(`Verify round ${round}: ${failures} failing check(s)`)
  if (failures === 0 || failures >= previousFailures) break
  previousFailures = failures
}

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
  'Audit every item as met, not_met, blocked or not_verifiable_offline, with evidence from files and check output. A live or paid capability is never met by mocks alone.',
  'Then review the whole ticket diff for cross-unit problems the unit reviews could not see, and report them as findings.',
].join('\n\n'), { label: `gate ${ticket}`, phase: 'Done-when gate', agentType: 'general-reviewer', schema: GATE })

const all = Object.values(results)
const openFindings = all.flatMap((r) => r.openFindings || []).concat(gate ? gate.findings.filter(isBlocking) : [])
const green = gate
  && all.length === units.length
  && all.every((r) => r.status === 'approved')
  && verify && verify.checks.every((c) => c.result === 'pass')
  && gate.items.every((i) => i.status === 'met')
  && !openFindings.length
return {
  ticket,
  status: green ? 'green' : 'needs_lead',
  units: all.map((r) => ({ id: r.unit.id, domain: r.unit.domain, status: r.status, reason: r.reason, rounds: r.rounds, filesChanged: r.lastBuild ? r.lastBuild.filesChanged : [], notes: r.lastBuild ? r.lastBuild.notes : '' })),
  deferredUnits,
  checks: verify,
  gate,
  openFindings,
  disputes: all.flatMap((r) => r.disputes || []),
  needsLead: all.flatMap((r) => r.needsLead || []).concat(verify ? verify.needsLead : []),
  minorFindings: all.flatMap((r) => r.minor || []).concat(gate ? gate.findings.filter((f) => !isBlocking(f)) : []),
  planNotes: plan.notes,
}
