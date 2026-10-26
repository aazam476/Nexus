// Prints a Markdown table of test coverage, for the CI job summary:
//   node scripts/coverage-summary.ts
// Reads the json-summary reports the test runs write. Missing reports (a step that didn't run) are skipped.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const reports = [
  ['Server (unit + integration)', 'apps/server/coverage/coverage-summary.json'],
  ['Web app logic, src/lib (unit)', 'apps/web/coverage/coverage-summary.json'],
  ['Web app (browser tests)', 'apps/web/coverage-e2e/coverage-summary.json'],
]

const percent = (metric: { pct: number }) => `${metric.pct.toFixed(1)}%`

console.log('## Test coverage\n')
console.log('| Tests | Lines | Statements | Branches | Functions |')
console.log('|---|---|---|---|---|')
for (const [name, file] of reports) {
  const path = resolve(import.meta.dirname, '..', file)
  if (!existsSync(path)) continue
  const { total } = JSON.parse(readFileSync(path, 'utf8'))
  console.log(`| ${name} | ${percent(total.lines)} | ${percent(total.statements)} | ${percent(total.branches)} | ${percent(total.functions)} |`)
}
