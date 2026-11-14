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
const HOST_SUITE = 'test/idor/tenant-host-routes.test.ts'

/** Every label a tenant-host mutation must be caught under: both people, both directions. */
const hostLabels = (name) =>
  ['anonymous', 'participant'].flatMap((persona) =>
    ['stellr_to_canary', 'canary_to_stellr'].map((direction) => `${name}:${persona}:${direction}`),
  )

/**
 * Each mutation deletes the lines of `file` that match `line`: one line, or `removes` lines
 * when a route answers the case through two guards, either of which alone still refuses it.
 * A guard must be a complete statement on its own line, so the copy still compiles.
 *   fixture: the copy replaces test/idor/fixtures/handlers.ts (IDOR_FIXTURE_DIR)
 *   route:   the copy replaces one real route in the generated suite (IDOR_ROUTE_OVERRIDE)
 * `label` is the case that must record a failing outcome; `labels`, when given, every one.
 * `suite` runs a route mutation in the tenant-host suite instead of the generated one.
 */
export const MUTATIONS = [
  { name: 'crew fixture: tenant filter removed', kind: 'fixture', file: FIXTURES, label: 'crewFiltered', line: /CANARY:crew-tenant-filter/ },
  { name: 'crew fixture: event filter removed', kind: 'fixture', file: FIXTURES, label: 'crewFiltered', line: /CANARY:crew-event-filter/ },
  { name: 'crew fixture: 403 against 404 for a record out of scope', kind: 'fixture', file: FIXTURES, label: 'crewUniform', line: /CANARY:crew-uniform/ },
  { name: 'crew fixture: tenant filter removed from a list with no id', kind: 'fixture', file: FIXTURES, label: 'crewList', line: /CANARY:crew-list-tenant-filter/ },
  { name: 'crew fixture: event filter removed from a list with no id', kind: 'fixture', file: FIXTURES, label: 'crewList', line: /CANARY:crew-list-event-filter/ },
  { name: 'crew fixture: platform guard removed', kind: 'fixture', file: FIXTURES, label: 'platformGuarded', line: /CANARY:platform-guard/ },
  { name: 'tenant host: host filter removed from a token lookup', kind: 'fixture', file: FIXTURES, labels: hostLabels('hostTokenScoped'), line: /CANARY:host-tenant-filter/ },
  { name: 'tenant host: 403 against 404 for another host\'s record', kind: 'fixture', file: FIXTURES, labels: hostLabels('hostUniform'), line: /CANARY:host-uniform/ },
  { name: 'fixture: owner filter removed from the query', kind: 'fixture', file: FIXTURES, label: 'ownerFiltered', line: /CANARY:owner-filter/ },
  { name: 'fixture: owner check removed after the read', kind: 'fixture', file: FIXTURES, label: 'ownerChecked', line: /CANARY:owner-check/ },
  { name: 'fixture: admin guard removed', kind: 'fixture', file: FIXTURES, label: 'adminGuarded', line: /CANARY:admin-guard/ },
  { name: 'fixture: tenant filter removed', kind: 'fixture', file: FIXTURES, label: 'tenantFiltered', line: /CANARY:tenant-filter/ },
  { name: 'fixture: owner filter removed from an update', kind: 'fixture', file: FIXTURES, label: 'scopedWrite', line: /CANARY:write-filter/ },
  // Host B's credential reaches this route's write only past both its host check and its
  // owner check (the participant does not own it), so removing either alone changes no
  // case: the suite sees them only together. A host check alone is proved on the next route.
  {
    name: 'real tenant-host route: host and owner checks removed from POST /api/credentials/[number]/visibility',
    kind: 'route',
    suite: HOST_SUITE,
    file: 'app/api/credentials/[number]/visibility/route.ts',
    label: 'app/api/credentials/[number]/visibility/route.ts',
    line: /^\s*if \(!\(await recordOnHost\(cred\)\)\) return |^\s*if \(cred\.owner_member_id !== member\.id\) return /,
    removes: 2,
  },
  // Share telemetry works signed out, so the host check is the only guard on another
  // host's credential.
  {
    name: 'real tenant-host route: host check removed from POST /api/credentials/[number]/events',
    kind: 'route',
    suite: HOST_SUITE,
    file: 'app/api/credentials/[number]/events/route.ts',
    label: 'app/api/credentials/[number]/events/route.ts',
    line: /^\s*if \(!\(await recordOnHost\(cred\)\)\) return /,
  },
  // S5 A10b. The emailed link's stop is signed out, so the host check is its only guard.
  {
    name: 'real tenant-host route: host check removed from POST /api/survey/[token]/stop-reminders',
    kind: 'route',
    suite: HOST_SUITE,
    file: 'app/api/survey/[token]/stop-reminders/route.ts',
    label: 'app/api/survey/[token]/stop-reminders/route.ts',
    line: /^\s*if \(!\(await recordOnHost\(inv\)\)\) return /,
  },
  {
    name: 'real tenant-host route: host check removed from POST /api/survey/event/[slug]/link',
    kind: 'route',
    suite: HOST_SUITE,
    file: 'app/api/survey/event/[slug]/link/route.ts',
    label: 'app/api/survey/event/[slug]/link/route.ts',
    line: /^\s*if \(!\(await recordOnHost\(d\)\)\) return /,
  },
  // Host B's event is refused by the owner check on Stellr's host and by the host check on
  // Canary's, so the suite sees them only together.
  {
    name: 'real tenant-host route: owner and host checks removed from POST /api/volunteer/interest',
    kind: 'route',
    suite: HOST_SUITE,
    file: 'app/api/volunteer/interest/route.ts',
    label: 'app/api/volunteer/interest/route.ts',
    line: /^\s*if \(owner !== STELLR_TENANT_ID\) return |^\s*if \(!\(await recordOnHost\(\{ tenant_id: owner \}\)\)\) return /,
    removes: 2,
  },
  // The member opt-out on another tenant's host.
  {
    name: 'real tenant-host route: host check removed from the member opt-out in POST /api/email/unsubscribe',
    kind: 'route',
    suite: HOST_SUITE,
    file: 'app/api/email/unsubscribe/route.ts',
    label: 'app/api/email/unsubscribe/route.ts',
    line: /^\s*if \(!\(await recordOnHost\(STELLR_LIST\)\)\) return htmlResponse\('You have been/,
  },
  {
    name: 'real route: member filter removed from DELETE /api/members/event-participations/[id]',
    kind: 'route',
    file: 'app/api/members/event-participations/[id]/route.ts',
    label: 'app/api/members/event-participations/[id]/route.ts',
    line: /^\s*\.eq\('member_id', member\.id\)\s*$/,
  },
]

/**
 * Handlers the audit gate calls audited, and that write no event: the wrapper drops what
 * it is given, which the gate cannot see. The copy replaces a real route in the generated
 * suite, whose audit check must fail on it. This proves the check is wired into the
 * participant loop, whichever real routes have adopted audit.
 */
export const AUDIT_CANARIES = [
  {
    name: 'real route loop: a handler the gate calls audited writes no event',
    file: 'app/api/members/event-participations/[id]/route.ts',
    source: `import { withAudit } from '@/lib/audit/route'
const dropsWhatItIsGiven = (_handler) => async () => new Response('{}')
export const DELETE = dropsWhatItIsGiven(withAudit({ action: 'webhook.event.process', actor: { system: true }, tenant: { stellr: true } }, async () => new Response('{}')))
`,
  },
]

/** Outcomes that prove the suite saw the missing guard. */
export const CAUGHT_OUTCOMES = ['leak', 'honey_write', 'oracle', 'oracle_4xx']

/**
 * Was the mutation caught for the right reason? The run failed AND the
 * mutated case (by label) recorded a failing outcome in the results file.
 * `results` is the file's text: one JSON object per line.
 */
export function caughtFor(exitCode, results, label, outcomes = CAUGHT_OUTCOMES) {
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
    .some((r) => r && r.label === label && outcomes.includes(r.outcome))
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
  for (const suite of [FIXTURE_SUITE, ROUTE_SUITE, HOST_SUITE]) {
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
      const expected = m.removes ?? 1
      if (removed !== expected) {
        console.error(`✗ ${m.name}: expected to remove ${expected} guard line(s) from ${m.file}, removed ${removed}. Update MUTATIONS in scripts/idor-canary.mjs.`)
        process.exit(2)
      }
      const copy = path.join(dir, path.basename(m.file))
      writeFileSync(copy, text)
      const resultsFile = path.join(dir, 'results.jsonl')
      writeFileSync(resultsFile, '')
      const r =
        m.kind === 'fixture'
          ? vitest(FIXTURE_SUITE, { IDOR_FIXTURE_DIR: dir, IDOR_RESULTS_FILE: resultsFile })
          : vitest(m.suite ?? ROUTE_SUITE, { IDOR_ROUTE_OVERRIDE: `${m.file}=${copy}`, IDOR_RESULTS_FILE: resultsFile })
      const recorded = readFileSync(resultsFile, 'utf8')
      const caught = (m.labels ?? [m.label]).every((label) => caughtFor(r.code, recorded, label))
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

  for (const c of AUDIT_CANARIES) {
    const dir = mkdtempSync(path.join(base, 'm-'))
    try {
      const copy = path.join(dir, path.basename(c.file))
      writeFileSync(copy, c.source)
      const resultsFile = path.join(dir, 'results.jsonl')
      writeFileSync(resultsFile, '')
      const r = vitest(ROUTE_SUITE, { IDOR_ROUTE_OVERRIDE: `${c.file}=${copy}`, IDOR_RESULTS_FILE: resultsFile })
      if (caughtFor(r.code, readFileSync(resultsFile, 'utf8'), c.file, ['audit_problem'])) console.log(`  ✓ caught: ${c.name}`)
      else {
        survived.push(c.name)
        console.log(`  ✗ SURVIVED: ${c.name} (exit ${r.code})`)
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
  console.log(`\nAll ${MUTATIONS.length + AUDIT_CANARIES.length} mutations caught: the IDOR suites can fail.`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
