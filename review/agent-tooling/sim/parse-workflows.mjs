import fs from 'node:fs'
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const directory = process.argv[2] || '.claude/workflows'
for (const name of fs.readdirSync(directory).filter((name) => name.endsWith('.js')).sort()) {
  const source = fs.readFileSync(directory + '/' + name, 'utf8').replace(/^export const meta =/m, 'const meta =')
  new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow', source)
  console.log('PARSE OK', name)
}
