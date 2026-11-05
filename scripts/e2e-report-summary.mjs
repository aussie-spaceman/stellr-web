// Prints what a Playwright run actually did, from its JSON report: the counts, and
// the title of every skipped test. A skipped spec passes a run while proving
// nothing, so comparing e2e-local with e2e means comparing these lists too
// (docs/RUNBOOK-ci-database.md, "The e2e-local job").
//
//   node scripts/e2e-report-summary.mjs test-results/e2e-results.json
import { readFileSync } from 'node:fs'

const report = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const { expected, unexpected, flaky, skipped } = report.stats

const skippedTitles = []
function walk(suite, trail) {
  const path = suite.title ? [...trail, suite.title] : trail
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      if (t.status === 'skipped') skippedTitles.push(`${t.projectName}: ${[...path, spec.title].join(' › ')}`)
    }
  }
  for (const child of suite.suites ?? []) walk(child, path)
}
for (const suite of report.suites ?? []) walk(suite, [])

console.log('### e2e-local result\n')
console.log(`Passed ${expected}, failed ${unexpected}, flaky ${flaky}, skipped ${skipped}.\n`)
if (skippedTitles.length) {
  console.log('Skipped:\n')
  for (const title of skippedTitles.sort()) console.log(`- ${title}`)
}
