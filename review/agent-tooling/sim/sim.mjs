// Usage from repo root: node review/agent-tooling/sim/sim.mjs .claude/workflows
import fs from 'node:fs'
import assert from 'node:assert/strict'
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
function load(file) {
  const src = fs.readFileSync(file, 'utf8').replace(/^export const meta =/m, 'const meta =')
  return new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow', src)
}
const parallel = async (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)))
const pipeline = async (items, ...stages) => Promise.all(items.map(async (item, i) => {
  let v = item
  for (const s of stages) { try { v = await s(v, item, i) } catch (e) { console.log('stage error', e.message); return null } }
  return v
}))
const calls = []
const logs = []
const run = (file, args, agent) => load(file)(args, async (p, o) => { calls.push(o.label + ' <' + o.agentType + '>'); return agent(p, o) }, parallel, pipeline, () => {}, (m) => logs.push(m), {}, null)
const WF = process.argv[2]

;(async () => {
  // build-ticket: 2 units, u2 depends on u1; models-reviewer finds a major in r1, resolves in r2;
  // security-reviewer returns null in r1 (must be re-asked in r2).
  let secCalls = 0
  const bt = await run(WF + '/build-ticket.js', 'T4 test run', async (p, o) => {
    if (o.label.startsWith('plan')) return { ready: true, blockers: [], doneWhen: ['a', 'b'], notes: 'n', units: [
      { id: 'u1', domain: 'models', task: 't1', files: ['src/lib/server/meta.ts'], dependsOn: [], extraReviewers: ['security-reviewer'] },
      { id: 'u2', domain: 'ui', task: 't2', files: ['src/components/DescribeForm.tsx'], dependsOn: ['u1'], extraReviewers: [] },
    ] }
    if (o.agentType.endsWith('-builder') && o.label.includes('build')) return { summary: 's', filesChanged: [o.label.startsWith('u1 ') ? 'src/lib/server/meta.ts' : 'src/components/DescribeForm.tsx'], checks: [], responses: [], needsLead: [], notes: '' }
    if (o.label.startsWith('verify')) return { checks: ['npm run build', 'npm run lint', 'npm run typecheck', 'npm test'].map((command) => ({ command, result: 'pass', output: '' })), fixes: [], remainingFailures: [], needsLead: [] }
    if (o.label.startsWith('gate')) return { items: [{ item: 'a', status: 'met', evidence: '' }, { item: 'b', status: 'met', evidence: '' }], findings: [], summary: '' }
    if (o.agentType === 'security-reviewer') { secCalls++; return secCalls === 1 ? null : { verdict: 'approve', findings: [], recheck: [], checksRun: [] } }
    if (o.agentType === 'models-reviewer') {
      if (o.label.endsWith('r1')) return { verdict: 'changes_required', findings: [{ id: 'F1', severity: 'major', file: 'meta.ts', line: 1, claim: 'c', failureScenario: 'f', evidence: 'e', requiredFix: 'r' }], recheck: [], checksRun: [] }
      return { verdict: 'approve', findings: [], recheck: [{ findingId: 'models-reviewer:r1:F1', status: 'resolved', reason: 'ok' }], checksRun: [] }
    }
    return { verdict: 'approve', findings: [], recheck: [], checksRun: [] }
  })
  assert.equal(bt.status, 'green')
  assert.ok(bt.units.every((u) => u.status === 'approved'))
  assert.equal(secCalls, 2)
  assert.ok(calls.indexOf('u2 build r1 <ui-builder>') > calls.indexOf('u1 models-reviewer r2 <models-reviewer>'))
  console.log('build-ticket status:', bt.status, '| units:', bt.units.map((u) => `${u.id}=${u.status}`).join(' '))
  console.log('calls:', calls.length); calls.forEach((c) => console.log('  ', c)); console.log('logs:', logs)

  // review-changes: refuter confirms one, refutes none
  calls.length = 0; logs.length = 0
  const rc = await run(WF + '/review-changes.js', 'HEAD', async (p, o) => {
    if (o.label === 'list changes') return { files: ['src/lib/quote.ts', 'README.md', '.claude/agents/x.md'], error: '' }
    if (o.label.startsWith('review')) return { verdict: 'changes_required', findings: [{ id: 'F1', severity: 'blocker', file: 'f', line: 0, claim: 'c', failureScenario: 's', evidence: 'e', requiredFix: 'r' }, { id: 'F2', severity: 'minor', file: 'f', line: 0, claim: 'c', failureScenario: 's', evidence: 'e', requiredFix: 'r' }], recheck: [], checksRun: [] }
    if (o.label.startsWith('refute')) return { outcome: o.label.includes('shop') ? 'refuted' : 'confirmed', reason: 'r' }
  })
  assert.equal(rc.status, 'needs_lead')
  assert.equal(rc.confirmed.length, 3)
  assert.equal(rc.refuted.length, 1)
  assert.equal(rc.minor.length, 4)
  console.log('review-changes reviewers:', rc.reviewers, '| confirmed', rc.confirmed.length, 'refuted', rc.refuted.length, 'minor', rc.minor.length)

  // fix-until-green: fail, fail (less), green
  calls.length = 0; let n = 0
  const fg = await run(WF + '/fix-until-green.js', undefined, async (p, o) => {
    if (o.label.startsWith('check')) { n++; return { checks: ['npm run typecheck', 'npm run lint', 'npm test', 'npm run build'].map((command) => ({ command, result: n < 3 && command === 'npm test' ? 'fail' : 'pass', output: '' })), failures: n < 3 ? Array.from({ length: 3 - n }, (_, i) => ({ check: 'npm test', file: i ? 'src/lib/quote.ts' : 'src/components/A.tsx', message: 'm' })) : [] } }
    if (o.label.startsWith('fix')) return { filesChanged: [o.agentType === 'ui-builder' ? 'src/components/A.tsx' : 'src/lib/quote.ts'], fixed: ['x'], notFixed: [] }
    if (o.label === 'review fixes') return { verdict: 'approve', findings: [] }
  })
  assert.equal(fg.status, 'green')
  assert.equal(fg.fixes.length, 3)
  console.log('fix-until-green status:', fg.status, '| calls:', calls.join(', '))
  console.log('ALL SIM ASSERTIONS PASSED')
})().catch((e) => { console.error('SIM ERROR', e); process.exit(1) })
