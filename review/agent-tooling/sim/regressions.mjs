// Offline adversarial workflow cases; no Claude, app code, network, or dependencies.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const directory = process.argv[2] || '.claude/workflows'
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const tests = []
const test = (name, fn) => tests.push({ name, fn })
const clone = (value) => JSON.parse(JSON.stringify(value))
const check = (command = 'npm test', result = 'pass') => ({ command, result, output: 'stubbed offline output' })
const finding = (severity = 'major') => ({ id: 'F1', severity, file: 'src/lib/quote.ts', line: 1, claim: 'wrong total', failureScenario: '119 gross', evidence: 'SPEC 11', requiredFix: 'fix math' })
const approve = () => ({ verdict: 'approve', findings: [], recheck: [], checksRun: [] })
const unit = (id = 'u1', files = ['src/lib/quote.ts'], dependsOn = []) => ({ id, domain: 'shop', task: 'implement quote', files, dependsOn, extraReviewers: [] })
const plan = () => ({ ready: true, blockers: [], doneWhen: ['first', 'second'], units: [unit()], notes: '' })
const build = () => ({ summary: 'built', filesChanged: ['src/lib/quote.ts'], checks: [check()], responses: [], needsLead: [], notes: '' })
const verify = () => ({ checks: [check()], fixes: [], remainingFailures: [], needsLead: [] })
const gate = () => ({ items: ['first', 'second'].map((item) => ({ item, status: 'met', evidence: 'stub' })), findings: [], summary: 'audit' })

// Validate the JSON Schema subset used by the workflows, including schema construction.
function validate(schema, value, label = 'root') {
  assert.equal(schema.type === 'object' && !Array.isArray(value) && value !== null || schema.type !== 'object', true, label)
  if (schema.type === 'object') {
    for (const key of schema.required || []) {
      assert.ok(Object.hasOwn(schema.properties, key), 'required field missing from schema: ' + key)
      assert.ok(Object.hasOwn(value, key), label + ' lacks ' + key)
    }
    for (const [key, child] of Object.entries(schema.properties)) if (Object.hasOwn(value, key)) validate(child, value[key], label + '.' + key)
  } else if (schema.type === 'array') {
    assert.ok(Array.isArray(value), label)
    if (schema.minItems !== undefined) assert.ok(value.length >= schema.minItems, label + ' minItems')
    for (const item of value) validate(schema.items, item, label)
  } else if (schema.type === 'integer') assert.ok(Number.isInteger(value), label)
  else assert.equal(typeof value, schema.type, label)
  if (schema.enum) assert.ok(schema.enum.includes(value), label + ' enum')
}

async function run(name, input, override = async () => undefined) {
  const source = fs.readFileSync(path.join(directory, name + '.js'), 'utf8').replace(/^export const meta =/m, 'const meta =')
  const fn = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow', source)
  const calls = []
  let active = 0
  let maxActive = 0
  const parallel = async (thunks) => Promise.all(thunks.map(async (thunk) => { try { return await thunk() } catch { return null } }))
  const pipeline = async (items, ...stages) => parallel(items.map((item) => async () => {
    let result = item
    for (const stage of stages) result = await stage(result)
    return result
  }))
  let fixes = 0
  const agent = async (prompt, options) => {
    active++
    maxActive = Math.max(maxActive, active)
    try {
    calls.push({ prompt, ...options })
    let result = await override(prompt, options, calls)
    if (result === undefined) {
      if (options.label.startsWith('plan')) result = plan()
      else if (options.label.includes(' build ')) result = build()
      else if (options.label.startsWith('verify')) result = verify()
      else if (options.label.startsWith('gate')) result = gate()
      else if (options.label === 'list changes') result = { files: ['src/lib/quote.ts'], error: '' }
      else if (options.label.startsWith('refute')) result = { outcome: 'confirmed', reason: 'reproduced' }
      else if (options.label.startsWith('check')) result = fixes ? { checks: [check()], failures: [] } : { checks: [check('npm test', 'fail')], failures: [{ check: 'npm test', file: 'src/lib/quote.ts', message: 'wrong total' }] }
      else if (options.label.startsWith('fix ')) { fixes++; result = { filesChanged: ['src/lib/quote.ts'], fixed: ['math'], notFixed: [] } }
      else result = approve()
    }
    if (result !== null) validate(options.schema, result, options.label)
    return clone(result)
    } finally { active-- }
  }
  return { result: await fn(input, agent, parallel, pipeline, () => {}, () => {}, {}, null), calls, maxActive }
}
const bt = (override, input = { ticket: 'T10', checks: ['npm test'] }) => run('build-ticket', input, override)
const fg = (override, input = { checks: ['npm test'] }) => run('fix-until-green', input, override)
const rc = (override, input = { paths: ['src/lib/quote.ts'] }) => run('review-changes', input, override)
const notGreen = ({ result }) => assert.notEqual(result.status, 'green')

test('happy build stays green', async () => assert.equal((await bt()).result.status, 'green'))
for (const [name, change] of [
  ['empty Verify results', (v) => { v.checks = [] }],
  ['omitted requested check', () => {}],
  ['Verify needsLead', (v) => { v.needsLead = [{ kind: 'owner_input', detail: 'missing input' }] }],
  ['Verify remaining failure', (v) => { v.remainingFailures = ['failed outside ticket'] }],
]) test('build rejects ' + name, async () => notGreen(await bt(async (p, o) => {
  if (o.label.startsWith('verify')) { const v = verify(); change(v); return v }
}, { ticket: 'T10', checks: name === 'omitted requested check' ? ['npm test', 'npm run lint'] : ['npm test'] })))
test('gate must cover item identities, not duplicate count', async () => notGreen(await bt(async (p, o) => {
  if (o.label.startsWith('gate')) { const g = gate(); g.items[1].item = 'first'; return g }
})))
test('unit rejection without findings is not approval', async () => notGreen(await bt(async (p, o) => {
  if (o.agentType === 'shop-reviewer') return { ...approve(), verdict: 'changes_required' }
})))
test('null reviewer on later round cannot disappear from diagnostics', async () => {
  const { result } = await bt(async (p, o) => {
    if (o.agentType === 'shop-reviewer') return o.label.endsWith('r1') ? { ...approve(), findings: [finding()], verdict: 'changes_required' } : null
  })
  notGreen({ result })
  assert.ok(result.notApproved.some((s) => s.includes('shop-reviewer')), 'missing reviewer must be named')
})
for (const dependency of ['missing', 'u1']) test('invalid dependency ' + dependency + ' blocks before writes', async () => {
  const { result, calls } = await bt(async (p, o) => {
    if (o.label.startsWith('plan')) { const v = plan(); v.units[0].dependsOn = [dependency]; return v }
  })
  assert.equal(result.status, 'blocked')
  assert.equal(calls.filter((c) => c.label.includes(' build ')).length, 0)
})
test('cycle returns actionable blocked status', async () => {
  const { result } = await bt(async (p, o) => {
    if (o.label.startsWith('plan')) return { ...plan(), units: [unit('a', ['a.ts'], ['b']), unit('b', ['b.ts'], ['a'])] }
  })
  assert.equal(result.status, 'blocked')
})
test('overlapping independent units require an ordering dependency', async () => {
  const { result, calls } = await bt(async (p, o) => {
    if (o.label.startsWith('plan')) return { ...plan(), units: [unit('a'), unit('b')] }
  })
  assert.equal(result.status, 'blocked')
  assert.equal(calls.length, 1)
})
test('prototype-looking IDs work as ordinary IDs', async () => {
  const { result } = await bt(async (p, o) => {
    if (o.label.startsWith('plan')) return { ...plan(), units: [unit('constructor')] }
  })
  assert.equal(result.status, 'green')
})
test('noncanonical plan paths are blocked', async () => {
  const { result } = await bt(async (p, o) => {
    if (o.label.startsWith('plan')) return { ...plan(), units: [unit('u1', ['./src/lib/quote.ts'])] }
  })
  assert.equal(result.status, 'blocked')
})
test('builder edits outside ownership cannot be approved', async () => notGreen(await bt(async (p, o) => {
  if (o.label.includes(' build ')) return { ...build(), filesChanged: ['src/lib/server/meta.ts'] }
})))
test('unreviewed specialist changes from Verify need lead', async () => notGreen(await bt(async (p, o) => {
  if (o.label.startsWith('verify')) return { ...verify(), fixes: [{ file: 'src/lib/quote.ts', what: 'changed VAT' }] }
})))
test('blocking status remains when reviewer verdict contradicts findings', async () => {
  const { result } = await fg(async (p, o) => {
    if (o.label === 'review fixes') return { ...approve(), findings: [finding()] }
  })
  assert.equal(result.status, 'green_fix_review_failed')
})
test('fix review returning null is not green', async () => {
  const { result } = await fg(async (p, o) => o.label === 'review fixes' ? null : undefined)
  assert.equal(result.status, 'green_fix_review_failed')
})
for (const missing of ['empty', 'partial']) test('fix rejects ' + missing + ' check evidence', async () => notGreen(await fg(async (p, o) => {
  if (o.label.startsWith('check')) return { checks: missing === 'empty' ? [] : [check()], failures: [] }
}, { checks: ['npm test', 'npm run lint'] })))
for (const name of ['build-ticket', 'fix-until-green']) {
  test(name + ' rejects zero checks before agent calls', async () => {
    const { result, calls } = await run(name, { ticket: 'T10', checks: [] })
    assert.equal(result.status, 'blocked')
    assert.equal(calls.length, 0)
  })
  test(name + ' validates maxRounds before agent calls', async () => {
    const { result, calls } = await run(name, { ticket: 'T10', maxRounds: 'invalid' })
    assert.equal(result.status, 'blocked')
    assert.equal(calls.length, 0)
  })
}
test('null fixer may have written files and must stop with diagnostics', async () => {
  const { result } = await fg(async (p, o) => o.label.startsWith('fix ') ? null : undefined)
  assert.equal(result.status, 'needs_lead')
  assert.ok(result.fixes.some((f) => f.failed))
})
test('fixers receive explicit ownership and report mode', async () => {
  const { calls } = await fg()
  const prompt = calls.find((c) => c.label.startsWith('fix ')).prompt
  assert.ok(prompt.includes('Failing files you own'))
  assert.ok(prompt.includes('notFixed'))
})
// A test-file failure whose cause may be in the module under test.
const testFailure = (failing, fixed) => {
  let attempts = 0
  return async (p, o) => {
    if (o.label.startsWith('check')) return ++attempts === 1 ? { checks: [check('npm test', 'fail')], failures: [{ check: 'npm test', file: failing, message: 'expected 41650' }] } : { checks: [check()], failures: [] }
    if (o.label.startsWith('fix ')) return { filesChanged: fixed, fixed: ['math'], notFixed: [] }
  }
}
test('a fixer may fix the module under test in its own domain', async () => {
  const { result, calls } = await fg(testFailure('tests/quote.test.ts', ['src/lib/quote.ts']))
  assert.equal(result.status, 'green')
  assert.ok(calls.some((c) => c.label === 'review fixes' && c.prompt.includes('src/lib/quote.ts')))
})
test('general-builder may edit its located failing file', async () => {
  assert.equal((await fg(testFailure('tests/contracts.test.ts', ['tests/contracts.test.ts']))).result.status, 'green')
})
for (const [failing, edited] of [
  ['tests/quote.test.ts', 'src/lib/server/budget.ts'], // another domain
  ['tests/quote.test.ts', 'package.json'],
  ['tests/quote.test.ts', 'vitest.config.ts'],
  ['tests/quote.test.ts', '.claude/workflows/build-ticket.js'],
  ['tests/paid.test.ts', 'budget/prices.json'], // own-domain data, owner-reviewed prices
  ['tests/paid.test.ts', 'budget/reserve.lua'],
  ['tests/edit.test.ts', 'prompts/schemas/edit_instruction_v1.json'],
  ['tests/edit.test.ts', 'spike/run_all.py'], // paid-call script
  ['tests/contracts.test.ts', 'src/middleware.ts'], // general-builder fallback owns nothing extra
  ['tests/contracts.test.ts', 'spike/requirements.txt'],
]) {
  test('fixing ' + failing + ' by editing ' + edited + ' needs the lead', async () => {
    assert.equal((await fg(testFailure(failing, [failing, edited]))).result.status, 'needs_lead')
  })
}
test('scope failure is distinguishable from an empty diff', async () => {
  const { result } = await rc(async (p, o) => o.label === 'list changes' ? null : undefined, {})
  assert.equal(result.status, 'needs_lead')
})
test('empty successful scope is green', async () => {
  const { result } = await rc(async (p, o) => o.label === 'list changes' ? { files: [], error: '' } : undefined, {})
  assert.equal(result.status, 'green')
})
test('missing reviewer prevents green', async () => {
  const { result } = await rc(async (p, o) => o.agentType === 'shop-reviewer' ? null : undefined)
  assert.equal(result.status, 'needs_lead')
  assert.deepEqual(result.missingReviewers, ['shop-reviewer'])
})
test('git scope error cannot look like an empty successful diff', async () => {
  const { result } = await rc(async (p, o) => o.label === 'list changes' ? { files: [], error: 'unknown revision' } : undefined, {})
  assert.equal(result.status, 'needs_lead')
})
test('scope output cannot send a reviewer into private files', async () => {
  const { result, calls } = await rc(async (p, o) => o.label === 'list changes' ? { files: ['.env.local'], error: '' } : undefined, {})
  assert.equal(result.status, 'blocked')
  assert.equal(calls.length, 1)
})
test('refuter sees the actual base and file scope', async () => {
  const { calls } = await rc(async (p, o) => o.label.startsWith('review ') ? { ...approve(), findings: [finding()], verdict: 'changes_required' } : undefined, { base: 'HEAD~2', paths: ['src/lib/quote.ts'] })
  assert.ok(calls.filter((c) => c.label.startsWith('refute')).every((c) => c.prompt.includes('HEAD~2') && c.prompt.includes('src/lib/quote.ts')))
})
test('rejected refute thunk retains its finding', async () => {
  const { result } = await rc(async (p, o) => {
    if (o.label.startsWith('review ')) return { ...approve(), findings: [finding()], verdict: 'changes_required' }
    if (o.label.startsWith('refute')) throw new Error('runtime failure')
  })
  assert.equal(result.unverified.length, 2)
})
test('refute cap keeps every excess finding', async () => {
  const { result, calls } = await rc(async (p, o) => o.label.startsWith('review ') ? { ...approve(), findings: Array.from({ length: 9 }, (_, i) => ({ ...finding(), id: 'F' + i })) } : undefined)
  assert.equal(calls.filter((c) => c.label.startsWith('refute')).length, 12)
  assert.equal(result.confirmed.length + result.unverified.length, 18)
})
const routes = [
  ['src/lib/contracts.ts', ['models-reviewer', 'shop-reviewer', 'security-reviewer'], 'general-builder'],
  ['src/lib/types.ts', ['models-reviewer', 'shop-reviewer'], 'general-builder'],
  ['src/lib/slots.ts', ['imaging-reviewer', 'shop-reviewer'], 'imaging-builder'],
  ['src/lib/errors.ts', ['security-reviewer'], 'general-builder'],
  ['src/components/ProgressStatus.tsx', ['models-reviewer', 'imaging-reviewer'], 'ui-builder'],
  ['src/components/EditReview.tsx', ['imaging-reviewer', 'shop-reviewer'], 'ui-builder'],
  ['src/components/BikeConfirm.tsx', ['models-reviewer', 'shop-reviewer'], 'ui-builder'],
  ['src/components/ModeBanner.tsx', ['release-reviewer'], 'ui-builder'],
  ['tests/pdf.test.ts', ['shop-reviewer'], 'shop-builder'],
  ['src/app/api/check/route.ts', ['models-reviewer', 'shop-reviewer', 'security-reviewer'], 'models-builder'],
  ['.claude/agents/general-builder.md', ['security-reviewer'], 'general-builder'],
  ['src/components/BudgetBanner.tsx', ['security-reviewer'], 'ui-builder'],
  ['src/components/ErrorNotice.tsx', ['security-reviewer'], 'ui-builder'],
  ['.env.example', ['security-reviewer'], 'platform-builder'],
  ['tests/instruction.test.ts', ['models-reviewer'], 'models-builder'],
  ['tests/http.test.ts', ['security-reviewer'], 'platform-builder'],
  ['src/lib/server/paid.ts', ['security-reviewer', 'models-reviewer'], 'platform-builder'],
  ['tests/paid.test.ts', ['security-reviewer', 'models-reviewer'], 'platform-builder'],
  ['src/lib/server/sse.ts', ['models-reviewer'], 'models-builder'],
  ['src/lib/editPolicy.ts', ['models-reviewer'], 'models-builder'],
  ['src/lib/parts.ts', ['imaging-reviewer'], 'imaging-builder'],
  ['tests/partmap.test.ts', ['imaging-reviewer'], 'imaging-builder'],
  ['tests/renderflow.test.ts', ['imaging-reviewer', 'models-reviewer'], 'imaging-builder'],
  ['src/lib/browser/projectSession.ts', ['shop-reviewer', 'imaging-reviewer'], 'shop-builder'],
  ['tests/projectsession.test.ts', ['shop-reviewer'], 'shop-builder'],
  ['src/lib/bikeForm.ts', ['shop-reviewer'], 'shop-builder'],
  ['spike/run_all.py', ['security-reviewer', 'models-reviewer'], 'models-builder'],
  ['spike/images_edits.py', ['security-reviewer', 'models-reviewer'], 'models-builder'],
  ['src/lib/browser/sparkClient.ts', ['models-reviewer', 'imaging-reviewer'], 'imaging-builder'],
  ['src/lib/browser/segmentClient.ts', ['models-reviewer', 'imaging-reviewer'], 'imaging-builder'],
  ['src/lib/queue.ts', ['models-reviewer'], 'general-builder'],
  ['tests/masks.test.ts', ['models-reviewer', 'imaging-reviewer'], 'imaging-builder'],
  ['spike/requirements.txt', ['security-reviewer'], 'general-builder'],
]
for (const [file, reviewers, builder] of routes) test('routes ' + file, async () => {
  const { result } = await rc(undefined, { paths: [file] })
  for (const reviewer of reviewers) assert.ok(result.reviewers.includes(reviewer), 'missing ' + reviewer)
  const { calls } = await fg(async (p, o) => o.label.startsWith('check') && o.label.endsWith('r1') ? { checks: [check('npm test', 'fail')], failures: [{ check: 'npm test', file, message: 'stub' }] } : undefined)
  assert.equal(calls.find((c) => c.label.startsWith('fix ')).agentType, builder)
})

test('specialists re-review edits caused by another reviewer', async () => {
  const { result, calls } = await bt(async (p, o) => {
    if (o.agentType === 'general-reviewer' && o.label.includes(' r1')) return { ...approve(), findings: [finding()], verdict: 'changes_required' }
    if (o.agentType === 'general-reviewer' && o.label.includes(' r2')) return { ...approve(), recheck: [{ findingId: 'general-reviewer:r1:F1', status: 'resolved', reason: 'fixed' }] }
  })
  assert.equal(result.status, 'green')
  assert.ok(calls.some((c) => c.label === 'u1 shop-reviewer r2'))
})
test('all requested specialists run rather than being silently capped', async () => {
  const { result, maxActive, calls } = await bt(async (p, o) => {
    if (o.label.startsWith('plan')) { const v = plan(); v.units[0].extraReviewers = ['security-reviewer', 'release-reviewer', 'imaging-reviewer', 'models-reviewer']; return v }
  })
  assert.equal(result.status, 'green')
  assert.equal(calls.filter((c) => c.label.startsWith('u1 ') && c.agentType.endsWith('-reviewer')).length, 6)
  assert.ok(maxActive <= 3)
})
test('all workflows construct as AsyncFunction with documented globals', async () => {
  for (const name of ['build-ticket', 'fix-until-green', 'review-changes']) {
    const source = fs.readFileSync(path.join(directory, name + '.js'), 'utf8').replace(/^export const meta =/m, 'const meta =')
    assert.ok(new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow', source))
  }
})
test('review plus refutes never exceed the 16-agent limit', async () => {
  const { result, maxActive } = await rc(async (p, o) => {
    if (o.label.startsWith('review ')) {
      if (o.agentType !== 'models-reviewer') await new Promise((resolve) => setImmediate(resolve))
      return { ...approve(), findings: Array.from({ length: 12 }, (_, i) => ({ ...finding(), id: 'F' + i })) }
    }
    if (o.label.startsWith('refute')) { await new Promise((resolve) => setImmediate(resolve)); return { outcome: 'confirmed', reason: 'stub' } }
  }, { paths: ['src/lib/contracts.ts', 'public/demo/quote.pdf'] })
  assert.equal(result.confirmed.length + result.unverified.length, 72)
  assert.ok(maxActive <= 16, 'peak ' + maxActive)
})
test('failed dependency prevents downstream builder calls', async () => {
  const { result, calls } = await bt(async (p, o) => {
    if (o.label.startsWith('plan')) return { ...plan(), units: [unit(), unit('u2', ['src/lib/pdf.ts'], ['u1'])] }
    if (o.label === 'u1 build r1') return { ...build(), needsLead: [{ kind: 'owner_input', detail: 'missing price policy' }] }
  })
  assert.equal(result.units.find((u) => u.id === 'u2').status, 'skipped_dependency')
  assert.ok(!calls.some((c) => c.label.startsWith('u2 build')))
})
test('missing recheck does not count as an upheld dispute', async () => {
  let builds = 0
  const { result } = await bt(async (p, o) => {
    if (o.label.includes(' build ')) return { ...build(), filesChanged: builds++ ? [] : build().filesChanged, responses: builds > 1 ? [{ findingId: 'shop-reviewer:r1:F1', action: 'disputed', evidence: 'SPEC 11' }] : [] }
    if (o.agentType === 'shop-reviewer') return o.label.endsWith('r1') ? { ...approve(), findings: [finding()], verdict: 'changes_required' } : approve()
  })
  assert.equal(result.status, 'needs_lead')
  assert.equal(builds, 3)
  assert.equal(result.disputes.length, 1)
})
test('files changed in earlier rounds remain in final report', async () => {
  const { result } = await bt(async (p, o) => {
    if (o.label.startsWith('plan')) return { ...plan(), units: [unit('u1', ['src/lib/quote.ts', 'tests/quote.test.ts'])] }
    if (o.label.includes('build r2')) return { ...build(), filesChanged: ['tests/quote.test.ts'] }
    if (o.agentType === 'shop-reviewer') return o.label.endsWith('r1') ? { ...approve(), findings: [finding()], verdict: 'changes_required' } : { ...approve(), recheck: [{ findingId: 'shop-reviewer:r1:F1', status: 'resolved', reason: 'fixed' }] }
  })
  assert.deepEqual(result.units[0].filesChanged, ['src/lib/quote.ts', 'tests/quote.test.ts'])
})
test('extra reviewers expand an already routed specialist to all requested paths', async () => {
  const { calls } = await rc(undefined, { paths: ['src/lib/quote.ts', 'src/app/page.tsx'], extraReviewers: ['shop-reviewer'] })
  assert.ok(calls.find((c) => c.label === 'review shop-reviewer').prompt.includes('Your files:\nsrc/lib/quote.ts\nsrc/app/page.tsx'))
})
test('review rejection without blocking findings needs the lead', async () => {
  const { result } = await rc(async (p, o) => o.label.startsWith('review ') ? { ...approve(), verdict: 'changes_required' } : undefined)
  assert.equal(result.status, 'needs_lead')
  assert.equal(result.reviewProblems.length, 2)
})
test('fix cannot take ownership of a private or parent path from a failure', async () => {
  for (const file of ['../other/file.ts', '.env.local', 'TASKS.md']) {
    const { result, calls } = await fg(async (p, o) => o.label.startsWith('check') ? { checks: [check('npm test', 'fail')], failures: [{ check: 'npm test', file, message: 'bad scope' }] } : undefined)
    assert.equal(result.status, 'unlocated_failure')
    assert.ok(!calls.some((c) => c.label.startsWith('fix ')))
  }
})
test('a fixer cannot skip review by omitting filesChanged', async () => {
  let attempts = 0
  const { result, calls } = await fg(async (p, o) => {
    if (o.label.startsWith('check')) return ++attempts === 1 ? { checks: [check('npm test', 'fail')], failures: [{ check: 'npm test', file: 'src/lib/quote.ts', message: 'wrong' }] } : { checks: [check()], failures: [] }
    if (o.label.startsWith('fix ')) return { filesChanged: [], fixed: ['changed math'], notFixed: [] }
  })
  assert.equal(result.status, 'green')
  assert.ok(calls.some((c) => c.label === 'review fixes' && c.prompt.includes('src/lib/quote.ts')))
})
test('a later null builder retains earlier reported edits and findings', async () => {
  const { result } = await bt(async (p, o) => {
    if (o.label.includes('build r2')) return null
    if (o.agentType === 'shop-reviewer') return { ...approve(), findings: [finding()], verdict: 'changes_required' }
  })
  assert.equal(result.status, 'needs_lead')
  assert.deepEqual(result.units[0].filesChanged, ['src/lib/quote.ts'])
  assert.equal(result.openFindings.length, 1)
})
test('a first-round null builder still exposes its owned paths to the lead', async () => {
  const { result } = await bt(async (p, o) => o.label.includes(' build ') ? null : undefined)
  assert.equal(result.status, 'needs_lead')
  assert.deepEqual(result.units[0].files, ['src/lib/quote.ts'])
})
test('worst-case ticket is bounded at 87 calls and 12 active agents', async () => {
  const { result, calls, maxActive } = await bt(async (p, o) => {
    if (o.label.startsWith('plan')) return { ...plan(), units: Array.from({ length: 4 }, (_, i) => ({ ...unit('u' + i, ['src/lib/quote' + i + '.ts']), extraReviewers: ['security-reviewer', 'release-reviewer', 'models-reviewer', 'imaging-reviewer'] })) }
    if (o.label.includes(' build ')) return { ...build(), filesChanged: ['src/lib/quote' + o.label[1] + '.ts'] }
    if (o.label.startsWith('u') && o.agentType.endsWith('-reviewer')) return { ...approve(), findings: [finding()], verdict: 'changes_required' }
  })
  assert.equal(result.status, 'needs_lead')
  assert.equal(calls.length, 87)
  assert.ok(maxActive <= 12, 'peak ' + maxActive)
})

let failures = 0
for (const { name, fn } of tests) {
  try { await fn(); console.log('PASS', name) }
  catch (error) { failures++; console.log('FAIL', name + ':', error.message.split('\n')[0]) }
}
console.log(tests.length + ' cases; ' + (tests.length - failures) + ' passed; ' + failures + ' failed')
process.exitCode = failures ? 1 : 0
