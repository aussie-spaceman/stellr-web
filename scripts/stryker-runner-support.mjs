/**
 * stryker-runner-support.mjs — does the installed @stryker-mutator/vitest-runner
 * actually switch mutants on under the installed Vitest?
 *
 * WHY: @stryker-mutator/vitest-runner 10.0.0 under Vitest 5 collects no
 * per-test coverage and never activates a mutant: every test shows
 * "(covered 0)" and every mutant "survives" (probed 4 Nov 2026 on
 * lib/esign/backup-crypto.ts: 0 killed, 31 survived, 11 no coverage). 10.1.0
 * fixed it, but it is younger than the repo's 14-day rule for new
 * dependencies until 6 Nov. A nightly run on an unsupported pair would only
 * ever fail red, so mutation.yml asks this script first and, on an unsupported
 * pair, skips the run with a warning and a job-summary line instead.
 *
 *   node scripts/stryker-runner-support.mjs     # prints supported=true|false
 *
 * Writes `supported=…` to $GITHUB_OUTPUT when set. Exit 0 either way; a
 * missing package is an error (exit 1).
 */
import { appendFileSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The first vitest-runner release that works with Vitest 5. */
export const MIN_RUNNER_FOR_VITEST_5 = '10.1.0'

const parse = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v))
  if (!m) throw new Error(`Not a version: ${v}`)
  return m.slice(1, 4).map(Number)
}

/** a < b, comparing major.minor.patch (pre-release tags ignored). */
export function versionLessThan(a, b) {
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]
  return false
}

/** Whether this runner version activates mutants under this Vitest version. */
export function runnerSupportsVitest(runnerVersion, vitestVersion) {
  if (parse(vitestVersion)[0] >= 5) return !versionLessThan(runnerVersion, MIN_RUNNER_FOR_VITEST_5)
  return true
}

const installed = (pkg) => JSON.parse(readFileSync(`node_modules/${pkg}/package.json`, 'utf8')).version

export function main() {
  const runner = installed('@stryker-mutator/vitest-runner')
  const vitest = installed('vitest')
  const supported = runnerSupportsVitest(runner, vitest)
  const out = process.env.GITHUB_OUTPUT
  if (out) appendFileSync(out, `supported=${supported}\nrunner=${runner}\nvitest=${vitest}\n`)
  console.log(`@stryker-mutator/vitest-runner ${runner}, vitest ${vitest}: supported=${supported}`)
  return 0
}

const invokedDirectly = (() => {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  try {
    process.exitCode = main()
  } catch (err) {
    console.error(`stryker-runner-support: ${err.message}`)
    process.exitCode = 1
  }
}
