// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// tenant-host-routing is a required check through the e2e gate (owner decision
// W7-8(c), 12 Nov 2026, S5 B10r). Branch protection still names only verify and e2e,
// so the gate is what makes it required. A continue-on-error on the job would let a
// failure read as success; a condition that differs from e2e-tests' could skip it on a
// code change; and a gate that read only "not failure" would pass it when cancelled.
// The gate's own script runs below under each case, so a change to its logic shows.

const ci = readFileSync('.github/workflows/ci.yml', 'utf8')

/** The job's block: from its key to the next job's key. */
function jobBlock(name: string): string {
  const start = ci.indexOf(`\n  ${name}:\n`)
  expect(start, `${name} job`).toBeGreaterThan(0)
  const rest = ci.slice(start + 1)
  const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/)
  return next < 0 ? rest : rest.slice(0, next + 1)
}

const thr = jobBlock('tenant-host-routing')
const e2e = jobBlock('e2e')
const ifOf = (job: string) => job.match(/^ {4}if: (.+)$/m)?.[1]

/** The gate step's `run: |` script, dedented. */
function gateScript(): string {
  const at = e2e.indexOf('- id: gate')
  expect(at, 'the gate step').toBeGreaterThan(0)
  const step = e2e.slice(at)
  const run = step.match(/\n( +)run: \|\n/)
  expect(run, 'the gate run block').toBeTruthy()
  const indent = (run as RegExpMatchArray)[1].length + 2
  const lines: string[] = []
  for (const line of step.slice((run as RegExpMatchArray).index! + (run as RegExpMatchArray)[0].length).split('\n')) {
    if (line.trim() !== '' && line.length - line.trimStart().length < indent) break
    lines.push(line.slice(indent))
  }
  return lines.join('\n')
}

const dir = mkdtempSync(join(tmpdir(), 'ci-thr-gate-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const script = join(dir, 'gate.sh')
writeFileSync(script, gateScript())

type Needs = { CODE: string; NEEDED: string; VERIFY: string; TESTS: string; STORYBOOK: string; THR: string; RAN: string }
const green: Needs = { CODE: 'true', NEEDED: 'true', VERIFY: 'success', TESTS: 'success', STORYBOOK: 'success', THR: 'success', RAN: 'true' }

let n = 0
function gate(needs: Needs): { passed: boolean; record: boolean; out: string } {
  const output = join(dir, `output-${n++}`)
  writeFileSync(output, '')
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', GITHUB_OUTPUT: output, ...needs } as unknown as NodeJS.ProcessEnv
  const r = spawnSync('bash', [script], { env, encoding: 'utf8' })
  return { passed: r.status === 0, record: /^record=true$/m.test(readFileSync(output, 'utf8')), out: `${r.stdout}${r.stderr}` }
}

describe('ci.yml tenant-host-routing (required through e2e)', () => {
  it('has no continue-on-error, on the job or on any step', () => {
    expect(thr).toMatch(/runs-on: ubuntu-latest/)
    expect(thr).not.toMatch(/continue-on-error/)
  })

  it('still runs the flag-off-and-on comparison, with no step condition to skip it', () => {
    expect(thr).toMatch(/name: Flag off and on, compared\n\s+run: npx playwright test -c playwright\.tenant-hosts\.config\.ts\n/)
    // Only the job's own condition, so no step skips on a path filter.
    expect(thr.match(/^\s+(?:- )?if:/gm)).toHaveLength(1)
  })

  // The gate reads THR only after its early exits for a docs-only change and an
  // already-passed tree. Any other skip would read as red, so the job must run
  // wherever e2e-tests does: the same needs and the same condition.
  it("runs under exactly e2e-tests' condition", () => {
    const tests = jobBlock('e2e-tests')
    expect(ifOf(thr)).toBeTruthy()
    expect(ifOf(thr)).toBe(ifOf(tests))
    expect(thr).toMatch(/^ {4}needs: \[verify, changes\]$/m)
    expect(tests).toMatch(/^ {4}needs: \[verify, changes\]$/m)
  })

  it('is one of the gate\'s needs, passed to it as THR', () => {
    expect(e2e).toMatch(/^ {4}needs: \[changes, verify, e2e-tests, storybook, tenant-host-routing\]$/m)
    expect(e2e).toMatch(/^ {4}if: always\(\)$/m)
    expect(e2e).toMatch(/THR: \$\{\{ needs\.tenant-host-routing\.result \}\}/)
  })

  it('passes when everything succeeded, and records the tree', () => {
    expect(gate(green)).toMatchObject({ passed: true, record: true })
  })

  for (const result of ['failure', 'cancelled', 'skipped', '']) {
    it(`fails, and records nothing, when tenant-host-routing reads '${result}'`, () => {
      const r = gate({ ...green, THR: result })
      expect(r.passed, r.out).toBe(false)
      expect(r.record).toBe(false)
      expect(r.out).toMatch(/e2e needs tenant-host-routing to pass/)
    })
  }

  it('passes a docs-only change exactly as before, with THR skipped', () => {
    for (const NEEDED of ['false', 'true']) {
      const r = gate({ ...green, CODE: 'false', NEEDED, TESTS: 'skipped', STORYBOOK: 'skipped', THR: 'skipped', RAN: '' })
      expect(r).toMatchObject({ passed: true, record: false })
      expect(r.out).toMatch(/Docs-only change: nothing to test\./)
    }
  })

  it('passes a tree that already passed exactly as before, with THR skipped', () => {
    const r = gate({ ...green, NEEDED: 'false', TESTS: 'skipped', STORYBOOK: 'skipped', THR: 'skipped', RAN: '' })
    expect(r).toMatchObject({ passed: true, record: false })
    expect(r.out).toMatch(/This tree already passed: see the changes job\./)
  })

  it('stays red when verify failed and every job after it skipped', () => {
    const r = gate({ ...green, VERIFY: 'failure', TESTS: 'skipped', STORYBOOK: 'skipped', THR: 'skipped', RAN: '' })
    expect(r).toMatchObject({ passed: false, record: false })
  })

  it('does not record a tree whose suite did not run', () => {
    expect(gate({ ...green, RAN: 'false' })).toMatchObject({ passed: true, record: false })
  })

  // The record steps check THR themselves too, so the marker never depends on the
  // gate script alone.
  it('writes the e2e-passed-tree record only when THR succeeded', () => {
    const recordSteps = e2e.match(/^ {6}- if: .*$/gm) ?? []
    expect(recordSteps).toHaveLength(2)
    for (const step of recordSteps) {
      expect(step).toMatch(/steps\.gate\.outputs\.record == 'true'/)
      expect(step).toMatch(/needs\.tenant-host-routing\.result == 'success'/)
    }
  })

  // A push skips e2e on a marker from a run that passed. That proof now counts
  // tenant-host-routing too, so a tree is never skipped without it.
  it("the changes job's already-passed proof needs tenant-host-routing", () => {
    const changes = jobBlock('changes')
    expect(changes).toMatch(/\.name == "e2e-tests" or \.name == "storybook" or \.name == "tenant-host-routing"\) and \.conclusion == "success"/)
    expect(changes).toMatch(/if \[ "\$passed" = 3 \]; then/)
  })
})
