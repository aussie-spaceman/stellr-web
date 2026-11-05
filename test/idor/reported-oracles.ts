// The refusals test/idor/idor-routes.test.ts reports and does not fail on
// (CaseResult.reportedOracle, test/idor/harness.ts).
//
// The snapshot pins the set as a count and a sha256 of its sorted lines, and names no
// route, so it still fails when the set changes. The lines themselves go only to the
// output of a local run: logs and artifacts on this repo are public.
import { createHash } from 'node:crypto'

export interface ReportedOracleSeal {
  count: number
  hash: string
}

/** `<METHOD> <route file>` to which comparison differed. */
export type ReportedOracles = Record<string, string>

const linesOf = (list: ReportedOracles) => Object.entries(list).map(([key, kind]) => `${key} ${kind}`).sort()

export function sealReportedOracles(list: ReportedOracles): ReportedOracleSeal {
  const lines = linesOf(list)
  return { count: lines.length, hash: createHash('sha256').update(lines.join('\n')).digest('hex') }
}

export const isCi = (env: Record<string, string | undefined> = process.env) => Boolean(env.CI || env.GITHUB_ACTIONS)

/** Prints the set for the developer who changed it. Prints nothing on CI. Returns whether it printed. */
export function printReportedOracles(
  list: ReportedOracles,
  env: Record<string, string | undefined> = process.env,
  log: (text: string) => void = console.log,
  heading = 'The reported refusals now',
): boolean {
  if (isCi(env)) return false
  log(`${heading} (not committed, and not printed on CI):\n${linesOf(list).join('\n')}`)
  return true
}
