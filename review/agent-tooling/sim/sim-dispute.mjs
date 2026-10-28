// Usage from repo root: node review/agent-tooling/sim/sim-dispute.mjs .claude/workflows/build-ticket.js
// Upheld-dispute early stop: builder disputes F1 in r2, reviewer upholds -> stop after r2, status unresolved, disputes listed.
import fs from 'node:fs'
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/^export const meta =/m, 'const meta =')
const fn = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow', src)
const parallel = async (t) => Promise.all(t.map((x) => x().catch(() => null)))
let builds = 0
fn('{"ticket":"T8"}', async (p, o) => {
  if (o.label.startsWith('plan')) return { ready: true, blockers: [], doneWhen: ['a'], notes: '', units: [{ id: 'u1', domain: 'shop', task: 't', files: ['src/lib/quote.ts'], dependsOn: [], extraReviewers: [] }] }
  if (o.label.includes('build')) { builds++; return { summary: 's', filesChanged: ['src/lib/quote.ts'], checks: [], responses: builds > 1 ? [{ findingId: 'shop-reviewer:r1:F1', action: 'disputed', evidence: 'SPEC 11' }] : [], needsLead: [], notes: '' } }
  if (o.label.startsWith('verify')) return { checks: [{ command: 'npm test', result: 'pass', output: '' }], fixes: [], remainingFailures: [], needsLead: [] }
  if (o.label.startsWith('gate')) return { items: [{ item: 'a', status: 'met', evidence: '' }], findings: [], summary: '' }
  if (o.agentType === 'shop-reviewer') return o.label.endsWith('r1')
    ? { verdict: 'changes_required', findings: [{ id: 'F1', severity: 'blocker', file: 'q', line: 1, claim: 'c', failureScenario: 'f', evidence: 'e', requiredFix: 'r' }], recheck: [], checksRun: [] }
    : { verdict: 'changes_required', findings: [], recheck: [{ findingId: 'shop-reviewer:r1:F1', status: 'upheld', reason: 'counter' }], checksRun: [] }
  return { verdict: 'approve', findings: [], recheck: [], checksRun: [] }
}, parallel, null, () => {}, (m) => console.log('log:', m), {}, null).then((r) => console.log('status', r.status, '| unit', r.units[0].status, '| rounds', r.units[0].rounds.length, '| disputes', r.disputes.length, '| builds', builds))
