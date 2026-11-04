import { expect } from 'vitest'

/**
 * True inside a Stryker mutation run (stryker.config.mjs, nightly). Stryker
 * sets STRYKER_MUTATOR_WORKER in every test-runner process it starts.
 */
export const UNDER_MUTATION = Boolean(process.env.STRYKER_MUTATOR_WORKER)

/**
 * Asserts that the work since `started` (a performance.now() reading) took
 * less than `budgetMs`. Under Stryker the instrumented code runs 20-130x
 * slower, so a wall-clock budget measures the instrumentation, not the code,
 * and cannot tell mutants apart: there, and only there, it is not asserted.
 * Every normal test run asserts it.
 */
export function expectWithin(started: number, budgetMs: number): void {
  if (!UNDER_MUTATION) expect(performance.now() - started).toBeLessThan(budgetMs)
}
