#!/usr/bin/env node
/**
 * IDOR canary fault injection (multi-tenant plan S4 gate: "the canary job
 * proves the suites can fail").
 *
 *   node scripts/idor-canary.mjs
 *
 * 1. Runs the IDOR suites intact; both must pass.
 * 2. For each mutation below: copies the guarded file into a temp directory
 *    (node_modules/.cache/idor-canary/, so imports still resolve), deletes the
 *    one line that carries the isolation guard, points the suite at the copy
 *    through an env var, and runs it. The suite must FAIL, and fail for the
 *    right reason: the mutated case itself must record a `leak`, `honey_write`
 *    or `oracle` outcome in the machine-readable results file
 *    (IDOR_RESULTS_FILE, written by test/idor/harness.ts). Text in Vitest's
 *    output does not count: a failure's code frame quotes the test source,
 *    which names those outcomes, so a mutation that only crashes the handler
 *    would otherwise look caught.
 *
 * Exits 0 when every mutation was caught, 1 when one survived (the suite could
 * not see a missing guard), 2 when the canary itself is broken (a guard line
 * was not found, or the intact run failed). The working tree is never
 * modified. No network, no secrets.
 *
 * CI: .github/workflows/idor-canary.yml (non-blocking until the CANARY_ENFORCE
 * repository variable is 'true').
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const FIXTURES = 'test/idor/fixtures/handlers.ts'
const FIXTURE_SUITE = 'test/idor/fixtures.test.ts'
const ROUTE_SUITE = 'test/idor/idor-routes.test.ts'

/**
 * Each mutation deletes the lines of `file` that match `line`.
 *   fixture: the copy replaces test/idor/fixtures/handlers.ts (IDOR_FIXTURE_DIR)
 *   route:   the copy replaces one real route in the generated suite (IDOR_ROUTE_OVERRIDE)
 */
export const MUTATIONS = [
  { name: 'fixture: owner filter removed from the query', kind: 'fixture', file: FIXTURES, label: 'ownerFiltered', line: /CANARY:owner-filter/ },
  { name: 'fixture: owner check removed after the read', kind: 'fixture', file: FIXTURES, label: 'ownerChecked', line: /CANARY:owner-check/ },
  { name: 'fixture: admin guard removed', kind: 'fixture', file: FIXTURES, label: 'adminGuarded', line: /CANARY:admin-guard/ },
  { name: 'fixture: tenant filter removed', kind: 'fixture', file: FIXTURES, label: 'tenantFiltered', line: /CANARY:tenant-filter/ },
  { name: 'fixture: owner filter removed from an update', kind: 'fixture', file: FIXTURES, label: 'scopedWrite', line: /CANARY:write-filter/ },
  {
    name: 'real route: member filter removed from DELETE /api/members/event-participations/[id]',
    kind: 'route',
    file: 'app/api/members/event-participations/[id]/route.ts',
    label: 'app/api/members/event-participations/[id]/route.ts',
    line: /^\s*\.eq\('member_id', member\.id\)\s*$/,
  },
]

/** Outcomes that prove the suite saw the missing guard. */
export const CAUGHT_OUTCOMES = ['leak', 'honey_write', 'oracle']

/**
 * Was the mutation caught for the right reason? The run failed AND the
 * mutated case (by label) recorded a failing outcome in the results file.
 * `results` is the file's text: one JSON object per line.
 */
export function caughtFor(exitCode, results, label) {
  if (exitCode === 0) return false
  return results
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .some((r) => r && r.label === label && CAUGHT_OUTCOMES.includes(r.outcome))
}

function vitest(file, env) {
  const r = spawnSync('npx', ['vitest', 'run', file], {
    cwd: ROOT,
    env: { ...process.env, ...env, CI: 'true' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` }
}

/** Removes the matching lines; returns the mutated text and how many went. */
export function mutate(src, line) {
  const lines = src.split('\n')
  const kept = lines.filter((l) => !line.test(l))
  return { text: kept.join('\n'), removed: lines.length - kept.length }
}

function main() {
  console.log('IDOR canary: intact run')
  for (const suite of [FIXTURE_SUITE, ROUTE_SUITE]) {
    const r = vitest(suite, {})
    if (r.code !== 0) {
      console.error(r.out.slice(-4000))
      console.error(`✗ ${suite} fails before any mutation: fix the suite first`)
      process.exit(2)
    }
    console.log(`  ✓ ${suite} passes intact`)
  }

  const base = path.join(ROOT, 'node_modules', '.cache', 'idor-canary')
  mkdirSync(base, { recursive: true })
  const survived = []
  for (const m of MUTATIONS) {
    const dir = mkdtempSync(path.join(base, 'm-'))
    try {
      const { text, removed } = mutate(readFileSync(path.join(ROOT, m.file), 'utf8'), m.line)
      if (removed !== 1) {
        console.error(`✗ ${m.name}: expected to remove 1 guard line from ${m.file}, removed ${removed}. Update MUTATIONS in scripts/idor-canary.mjs.`)
        process.exit(2)
      }
      const copy = path.join(dir, path.basename(m.file))
      writeFileSync(copy, text)
      const resultsFile = path.join(dir, 'results.jsonl')
      writeFileSync(resultsFile, '')
      const r =
        m.kind === 'fixture'
          ? vitest(FIXTURE_SUITE, { IDOR_FIXTURE_DIR: dir, IDOR_RESULTS_FILE: resultsFile })
          : vitest(ROUTE_SUITE, { IDOR_ROUTE_OVERRIDE: `${m.file}=${copy}`, IDOR_RESULTS_FILE: resultsFile })
      const caught = caughtFor(r.code, readFileSync(resultsFile, 'utf8'), m.label)
      if (caught) console.log(`  ✓ caught: ${m.name}`)
      else {
        survived.push(m.name)
        console.log(`  ✗ SURVIVED: ${m.name} (exit ${r.code})`)
        console.log(r.out.slice(-3000))
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  if (survived.length) {
    console.error(`\n${survived.length} mutation(s) survived: the IDOR suite cannot see these missing guards.`)
    process.exit(1)
  }
  console.log(`\nAll ${MUTATIONS.length} mutations caught: the IDOR suites can fail.`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
