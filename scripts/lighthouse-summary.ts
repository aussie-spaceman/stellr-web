/**
 * Print the scores from lhci's report to the job log and the run summary.
 *
 * WHY: the Lighthouse step is report-only, so the job stays green whether or not
 * lhci finished, and lhci prints no scores itself. An abort on a 404 once went
 * unnoticed for that reason. This step says plainly when there is no report. It
 * never fails the job.
 *
 * Usage: tsx scripts/lighthouse-summary.ts [report dir, default lhci-report]
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export type ManifestEntry = {
  url: string
  isRepresentativeRun?: boolean
  jsonPath?: string
  summary: Record<string, number | null | undefined>
}

type Audits = Record<string, { numericValue?: number } | undefined>

const pct = (score: number | null | undefined) => (typeof score === 'number' ? String(Math.round(score * 100)) : '–')
const ms = (value: number | undefined) => (value === undefined ? '–' : `${Math.round(value)} ms`)

export function formatRow(entry: ManifestEntry, audits: Audits = {}): string {
  const cls = audits['cumulative-layout-shift']?.numericValue
  return [
    new URL(entry.url).pathname,
    pct(entry.summary.performance),
    pct(entry.summary.accessibility),
    pct(entry.summary['best-practices']),
    ms(audits['largest-contentful-paint']?.numericValue),
    ms(audits['total-blocking-time']?.numericValue),
    cls === undefined ? '–' : cls.toFixed(3),
  ].join(' | ')
}

export function formatReport(rows: string[]): string {
  return ['Page | Perf | A11y | Best practices | LCP | TBT | CLS', '--- | --- | --- | --- | --- | --- | ---', ...rows]
    .map((row) => `| ${row} |`)
    .join('\n')
}

function main(): void {
  const manifestPath = join(process.argv[2] ?? 'lhci-report', 'manifest.json')
  if (!existsSync(manifestPath)) {
    console.log('::warning::Lighthouse produced no report, so this run measured nothing. Read the Lighthouse step log.')
    return
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestEntry[]
  const rows = manifest
    .filter((entry) => entry.isRepresentativeRun !== false)
    .map((entry) => {
      const audits = entry.jsonPath && existsSync(entry.jsonPath) ? JSON.parse(readFileSync(entry.jsonPath, 'utf8')).audits : {}
      return formatRow(entry, audits)
    })
  const report = formatReport(rows)
  console.log(report)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Lighthouse (mobile, report-only)\n\n${report}\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (err) {
    console.log(`::warning::Could not read the Lighthouse report: ${(err as Error).message}`)
  }
}
