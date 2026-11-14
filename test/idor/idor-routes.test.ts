// @vitest-environment node
//
// The generated cross-tenant / IDOR suite (multi-tenant plan S2 "Cross-tenant
// and IDOR generator", S4 gate "the canary job proves the suites can fail").
//
// For every id-bearing route handler in lib/security/route-manifest.ts
// (lib/security/idor-targets.ts), one case runs each exported method as a
// signed-in tenant-A (Stellr) participant who names a tenant-B ("Canary
// Academy") honeytoken in every id input: path segments, id-like query
// parameters and body fields. Auth and the database are mocked at the module
// boundary (test/idor/harness.ts, test/idor/honey-db.ts): no network, no real
// database.
//
// A case FAILS when:
//   - the response carries a Canary honeytoken the caller did not send (leak),
//     a write touched or referenced a Canary row (honey_write), or a 2xx
//     changed when the Canary row was removed (oracle), unless the snapshot
//     records a reviewed `accepted` reason;
//   - a stellr_only route does anything but refuse (401/403/404);
//   - the outcome differs from test/idor/idor-snapshot.json;
//   - the audit events are wrong: auditCaseProblem in test/idor/harness.ts, on the
//     participant cases here and the staff cases below. An ok mutating outcome on a
//     handler the audit gate calls audited wrote exactly one event, with a catalogued
//     action. That is vacuous for a handler still on
//     test/baselines/unaudited-mutations.json, which test/audit-coverage.test.ts holds.
//     test/idor/audit-cases.test.ts and the canary's audit entry prove it can fail.
// And the suite fails when the case count differs from the manifest's count of
// id-bearing routes, when a new id-bearing route is not in the snapshot, and
// when more cases are `unexercised` (request validation refused before the id
// was used) than MAX_UNEXERCISED.
//
// Every tenant_crew, platform_admin and platform_destined route handler, with or without
// an id, also runs the staff personas, strict, with no accepted reason possible:
// test/idor/harness.ts CREW_PERSONAS_FOR and crewCaseProblem.
// A refusal that changes with the row, or with a malformed id, fails there and is
// only reported here for every other class: test/idor/reported-oracles.ts, pinned in the
// snapshot's `reported4xxOracleCount` and `reported4xxOracleHash`.
// test/idor/tenant-host-routes.test.ts enforces it on the routes tenant hosts serve.
//
// Regenerate after adding or changing an id-bearing route, then REVIEW the diff:
//   npm run idor:snapshot
// New leak/honey_write outcomes are written with `accepted: "TODO: review"`,
// which fails until a person replaces it with the reason it is safe.
import './mocks'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { idorTargets, crewTargets, type IdorTarget } from '@/lib/security/idor-targets'
import { ROUTE_MANIFEST } from '@/lib/security/route-manifest'
import { applyEnv, CASE_FIXTURES, fixtureFor, HELD_BACK_FIXTURES } from './case-fixtures'
import { FAILING_OUTCOMES, installNetworkGuard, routeAuditProblems, runIdorCase, runCrewTarget, targetInput, type CaseResult, type Outcome } from './harness'
import { printReportedOracles, sealReportedOracles, type ReportedOracles } from './reported-oracles'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.idor.invalid'
process.env.SUPABASE_SECRET_KEY = 'sb_secret_idorharness'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_idorharness'
// lib/hubspot.ts reads this when it first loads, which several routes share, so
// it cannot be a per-route fixture. Inert without a HUBSPOT_FORM_* id.
process.env.HUBSPOT_PORTAL_ID = 'idor-harness-portal'
// lib/sanity.ts builds no client without a project id, so outcomes cannot depend
// on the machine's environment. What that leaves unmodelled: a route that looks
// an event up finds none, whatever the slug.
delete process.env.NEXT_PUBLIC_SANITY_PROJECT_ID

const SNAPSHOT_FILE = 'test/idor/idor-snapshot.json'
const UPDATE = process.env.IDOR_UPDATE_SNAPSHOT === '1'
const TODO = 'TODO: review'

// Floor, so an emptied manifest or a broken analyser cannot pass with a small
// count. 4 Nov 2026: 228 id-bearing route files (132 stellr_only, 64
// participant, 30 public, 2 webhook).
const MIN_TARGETS = 215

// Cases whose request the handler refused as invalid before any Canary value
// reached the database: they prove nothing about isolation. The harness fills
// non-id body fields with plausible values to get past validation; what is
// left is pinned in the snapshot as `unexercised` and capped here, so the
// number can only go down. Lower it when a route starts being exercised.
// test/idor/case-fixtures.ts gets the rest through. Of the 5 left, 4 are held back
// there, because getting through shows a write carrying a Canary value, and
// register/individual is Lane A's (it needs an event this suite does not model;
// test/idor/tenant-host-routes.test.ts, which does, gets it to one).
const MAX_UNEXERCISED = 5

// Cases that ended in a 5xx: the harness could not model the path, so they
// prove nothing either. Same rule. Of the 3 left, 2 are held back in the same
// place and register/group is Lane A's, for the same reason.
const MAX_ERROR = 3

type MethodEntry = Outcome | { outcome: Outcome; accepted: string }
interface SnapshotTarget {
  class: string
  segments: string[]
  query: string[]
  body: string[]
  methods: Record<string, MethodEntry>
}
interface Snapshot {
  _comment: string
  count: number
  /** How many refusals differ, and a hash of the set: test/idor/reported-oracles.ts. Reported, not failed. */
  reported4xxOracleCount?: number
  reported4xxOracleHash?: string
  targets: Record<string, SnapshotTarget>
}

const CREW_CLASSES = ['tenant_crew', 'platform_admin'] as const
const isCrewClass = (c: string): c is (typeof CREW_CLASSES)[number] => (CREW_CLASSES as readonly string[]).includes(c)
// Same guard as stellr_only, so the same rules as stellr_only in the participant cases.
const hasStellrOnlyGuard = (c: string) => c === 'stellr_only' || c === 'platform_destined'

// scripts/idor-canary.mjs: `<route file>=<absolute path of a mutated copy>`.
// The case for that route loads the copy instead, so the canary can prove the
// generated suite fails when a real route loses its guard.
const OVERRIDE = (() => {
  const raw = process.env.IDOR_ROUTE_OVERRIDE
  if (!raw) return null
  const at = raw.indexOf('=')
  return { file: raw.slice(0, at), path: raw.slice(at + 1) }
})()

/** The source of the handler this case runs, so the gate reads what the case imports. */
const sourceOf = (file: string) => readFileSync(OVERRIDE?.file === file ? OVERRIDE.path : file, 'utf8')

const outcomeOf = (e: MethodEntry) => (typeof e === 'string' ? e : e.outcome)
const acceptedOf = (e: MethodEntry | undefined) => (e && typeof e === 'object' ? e.accepted : undefined)

const targets = idorTargets()
const snapshot: Snapshot = existsSync(SNAPSHOT_FILE)
  ? JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8'))
  : { _comment: '', count: 0, targets: {} }
const observed = new Map<string, Record<string, CaseResult>>()
// Staff cases that proved nothing under a named exception still count against the caps.
const crewUnexercised: string[] = []
const crewErrors: string[] = []
let ran = 0

installNetworkGuard()

function describeResult(r: CaseResult): string {
  const parts = [`${r.method} → ${r.status} ${r.outcome}`]
  for (const l of r.leaks) parts.push(`  leaked ${l.value} in …${l.context}…`)
  for (const w of r.writes) parts.push(`  wrote ${w.table} (${w.op}): ${w.detail}`)
  if (r.oracle) parts.push(`  oracle: ${r.oracle}`)
  if (r.error) parts.push(`  error: ${r.error}`)
  return parts.join('\n')
}

describe('cross-tenant / IDOR: tenant-A participant naming tenant-B honeytokens', () => {
  it('finds the id-bearing routes and every one is classified in the manifest', () => {
    expect(targets.length).toBeGreaterThanOrEqual(MIN_TARGETS)
    for (const t of targets) expect(ROUTE_MANIFEST[t.file]).toBe(t.cls)
  })

  // Every tenant_crew, platform_admin and platform_destined route handler, with or without
  // an id. test/idor/fixtures.test.ts runs the same functions over handlers with known
  // guards, and the canary proves they can fail.
  it('runs the crew personas on routes: the nine platform_destined at least', () => {
    expect(crewTargets().filter((t) => t.cls === 'platform_destined')).toHaveLength(9)
  })

  for (const t of crewTargets()) {
    const cls = t.cls
    if (!isCrewClass(cls) && cls !== 'platform_destined') continue
    it(`${cls} ${t.urlPattern}: the staff personas are refused`, async () => {
      const fixture = CASE_FIXTURES[t.file]
      const restoreEnv = applyEnv(fixture?.env)
      const mod = (await (OVERRIDE?.file === t.file ? import(OVERRIDE.path) : import(`../../${t.file}`)).finally(restoreEnv)) as Record<string, unknown>
      const cases = await runCrewTarget({ file: t.file, cls, methods: t.methods, source: sourceOf(t.file) }, mod, targetInput(t), fixture?.crewUnproven)
      for (const { method, persona, result, problem } of cases) {
        if (result.outcome === 'unexercised') crewUnexercised.push(`${method} ${t.file} ${persona}`)
        if (result.outcome === 'error') crewErrors.push(`${method} ${t.file} ${persona}`)
        expect(problem, `${persona} ${t.file}\n${describeResult(result)}`).toBeNull()
      }
    })
  }

  for (const t of targets) {
    it(`${t.cls} ${t.urlPattern} [${t.methods.join(',')}]`, async () => {
      ran++
      // A route that reads its secret when it loads gets the fixture's env then too.
      const restoreEnv = applyEnv(CASE_FIXTURES[t.file]?.env)
      const mod = (await (OVERRIDE?.file === t.file ? import(OVERRIDE.path) : import(`../../${t.file}`)).finally(restoreEnv)) as Record<string, unknown>
      const results: Record<string, CaseResult> = {}
      for (const m of t.methods) results[m] = await runIdorCase(mod, targetInput(t), m, 'participant', t.file)
      observed.set(t.file, results)
      // IDOR_DEBUG=<substring of a route file>: print what each method did.
      if (process.env.IDOR_DEBUG && t.file.includes(process.env.IDOR_DEBUG)) {
        console.log(`${t.file}\n${Object.values(results).map(describeResult).join('\n')}`)
      }
      checkFixtureReachedTheId(t, results)
      checkAudits(t, results)
      if (UPDATE) return
      checkTarget(t, results)
    })
  }

  it('models no Sanity event: getEventBySlug answers null for any slug', async () => {
    const { client, getEventBySlug } = await import('@/lib/sanity')
    expect(client).toBeNull()
    expect(await getEventBySlug('any-slug')).toBeNull()
  })

  it('ran one case per id-bearing route (count gate) and the snapshot lists exactly those routes', () => {
    expect(ran).toBe(targets.length)
    if (UPDATE) {
      if (OVERRIDE) throw new Error('refusing to write the snapshot from a canary run')
      writeSnapshot()
      return
    }
    const files = targets.map((t) => t.file)
    const unclassified = files.filter((f) => !snapshot.targets[f])
    const stale = Object.keys(snapshot.targets).filter((f) => !files.includes(f))
    expect(unclassified, `new id-bearing routes not in ${SNAPSHOT_FILE}: run \`npm run idor:snapshot\` and review`).toEqual([])
    expect(stale, `routes in ${SNAPSHOT_FILE} that are gone or no longer id-bearing: run \`npm run idor:snapshot\``).toEqual([])
    expect(snapshot.count).toBe(targets.length)
  })

  it('the refusals that differ are the ones the snapshot reports', () => {
    if (UPDATE) return
    const reported = reportedOracles()
    const seal = sealReportedOracles(reported)
    if (seal.hash !== snapshot.reported4xxOracleHash) printReportedOracles(reported)
    expect(seal, `a refusal now differs, or stopped differing: run this suite locally to see the set, review, then \`npm run idor:snapshot\``).toEqual({
      count: snapshot.reported4xxOracleCount,
      hash: snapshot.reported4xxOracleHash,
    })
  })

  it(`no more than ${MAX_UNEXERCISED} cases are unexercised (refused as invalid before the id was used)`, () => {
    if (UPDATE) return
    const unexercised = [...observed.entries()].flatMap(([file, rs]) =>
      Object.values(rs)
        .filter((r) => r.outcome === 'unexercised')
        .map((r) => `${r.method} ${file}`),
    ).concat(crewUnexercised)
    expect(unexercised.length, unexercised.join('\n')).toBeLessThanOrEqual(MAX_UNEXERCISED)
  })

  it(`no more than ${MAX_ERROR} cases end in a 5xx (the harness could not model the path)`, () => {
    if (UPDATE) return
    const errors = [...observed.entries()].flatMap(([file, rs]) =>
      Object.values(rs)
        .filter((r) => r.outcome === 'error')
        .map((r) => `${r.method} ${file}`),
    ).concat(crewErrors)
    expect(errors.length, errors.join('\n')).toBeLessThanOrEqual(MAX_ERROR)
  })
})

// Not accepted outcomes: the snapshot keeps these routes as `unexercised` or
// `error`. This proves each finding is still open, so the fix cannot land without
// its case moving to CASE_FIXTURES.
describe('open IDOR findings: fixtures held back until the route is fixed', () => {
  for (const [file, held] of Object.entries(HELD_BACK_FIXTURES)) {
    it(`${held.method} ${file}`, async () => {
      const target = targets.find((t) => t.file === file)
      expect(target, `${file} is no longer an id-bearing route`).toBeDefined()
      expect(CASE_FIXTURES[file], `${file} cannot be both exercised and held back`).toBeUndefined()
      const restoreEnv = applyEnv(held.fixture.env)
      const mod = (await import(`../../${file}`).finally(restoreEnv)) as Record<string, unknown>
      const input = { ...targetInput(target as IdorTarget), fixture: held.fixture }
      const r = await runIdorCase(mod, input, held.method, 'participant', `held back: ${file}`)
      const fixedHint =
        `${file}\n${describeResult(r)}\nthe finding is fixed, or the fixture no longer gets through: check the result above. ` +
        'If it is fixed, move this fixture to CASE_FIXTURES, then `npm run idor:snapshot`. If not, update the fixture here.'
      expect(r.outcome, fixedHint).toBe('honey_write')
      expect(r.writes.map((w) => w.table), fixedHint).toEqual(expect.arrayContaining(held.writes))
    })

    if (!held.refusedWhen) continue
    it(`${held.method} ${file}: the route's own rule refuses when the row does not pass it`, async () => {
      const target = targets.find((t) => t.file === file) as IdorTarget
      const restoreEnv = applyEnv(held.fixture.env)
      const mod = (await import(`../../${file}`).finally(restoreEnv)) as Record<string, unknown>
      const fixture = { ...held.fixture, honey: { ...held.fixture.honey, ...held.refusedWhen } }
      const r = await runIdorCase(mod, { ...targetInput(target), fixture }, held.method, 'participant', `refused: ${file}`)
      expect(r.outcome, describeResult(r)).toBe('refused')
      expect(r.touched, describeResult(r)).toBe(true)
      expect(r.writes, describeResult(r)).toEqual([])
    })
  }
})

/**
 * A fixture exists to get the id to the code that decides. A refusal with no
 * Canary value used stopped on something else (an event the suite does not model,
 * say), and pinning it as `refused` would claim a check nobody saw. The few routes
 * that do decide without a query name that decision in `refusesWithoutQuery`.
 */
function checkFixtureReachedTheId(t: IdorTarget, results: Record<string, CaseResult>) {
  for (const [method, r] of Object.entries(results)) {
    const fixture = fixtureFor(CASE_FIXTURES[t.file], method)
    if (!fixture || r.outcome !== 'refused' || r.touched) continue
    expect(fixture.refusesWithoutQuery, `${t.file}\n${describeResult(r)}\nthe fixture got a refusal without using the id: this case proves nothing`).toBeDefined()
  }
}

function checkAudits(t: IdorTarget, results: Record<string, CaseResult>) {
  expect(routeAuditProblems(t.file, sourceOf(t.file), Object.values(results)), `${t.file}\n${Object.values(results).map(describeResult).join('\n')}`).toEqual([])
}

function checkTarget(t: IdorTarget, results: Record<string, CaseResult>) {
  const snap = snapshot.targets[t.file]
  expect(snap, `${t.file} is a new id-bearing route: run \`npm run idor:snapshot\` and review its outcomes`).toBeDefined()
  expect({ class: t.cls, segments: t.segments, query: t.query, body: t.body }).toEqual({
    class: snap.class,
    segments: snap.segments,
    query: snap.query,
    body: snap.body,
  })
  expect(Object.keys(snap.methods).sort()).toEqual([...t.methods].sort())
  for (const m of t.methods) {
    const r = results[m]
    const entry = snap.methods[m]
    const accepted = acceptedOf(entry)
    const detail = `${t.file}\n${describeResult(r)}`
    if (isCrewClass(t.cls)) {
      expect(accepted, `${detail}\n${t.cls} may not accept any outcome`).toBeUndefined()
      expect([401, 403, 404], `${detail}\na ${t.cls} route must refuse a participant`).toContain(r.status)
    }
    if (accepted !== undefined) {
      expect(accepted, `${detail}\nthe snapshot's accepted reason is still a TODO`).not.toBe(TODO)
      expect(accepted.length, `${detail}\nan accepted outcome needs a reason`).toBeGreaterThan(20)
    }
    if (FAILING_OUTCOMES.includes(r.outcome)) {
      expect(accepted, `${detail}\ntenant-B data reached a tenant-A caller, and the snapshot does not accept it`).toBeDefined()
    }
    if (hasStellrOnlyGuard(t.cls) && accepted === undefined) {
      // By construction: an admin guard refuses a participant before any read.
      expect([401, 403, 404], `${detail}\na ${t.cls} route must refuse a participant`).toContain(r.status)
    }
    expect(r.outcome, `${detail}\noutcome changed from the snapshot: review, then \`npm run idor:snapshot\``).toBe(outcomeOf(entry))
  }
}

function reportedOracles(): ReportedOracles {
  const out: ReportedOracles = {}
  for (const [file, rs] of [...observed.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const r of Object.values(rs)) if (r.reportedOracle) out[`${r.method} ${file}`] = r.reportedOracle.kind
  }
  return out
}

function writeSnapshot() {
  const reported = reportedOracles()
  const seal = sealReportedOracles(reported)
  if (seal.hash !== snapshot.reported4xxOracleHash) printReportedOracles(reported)
  const out: Snapshot = {
    _comment:
      'Generated by `npm run idor:snapshot` (test/idor/idor-routes.test.ts). One entry per id-bearing route handler. ' +
      'A leak or honey_write outcome needs a reviewed `accepted` reason; the generator writes "TODO: review", which fails.',
    count: targets.length,
    reported4xxOracleCount: seal.count,
    reported4xxOracleHash: seal.hash,
    targets: {},
  }
  for (const t of targets) {
    const prev = snapshot.targets[t.file]
    const methods: Record<string, MethodEntry> = {}
    for (const m of t.methods) {
      const r = observed.get(t.file)?.[m]
      if (!r) throw new Error(`no result for ${t.file} ${m}`)
      const prevEntry = prev?.methods[m]
      const keep = acceptedOf(prevEntry)
      const needsReason = FAILING_OUTCOMES.includes(r.outcome) || (hasStellrOnlyGuard(t.cls) && ![401, 403, 404].includes(r.status))
      if (keep !== undefined && prevEntry && outcomeOf(prevEntry) === r.outcome) methods[m] = { outcome: r.outcome, accepted: keep }
      else if (needsReason) methods[m] = { outcome: r.outcome, accepted: TODO }
      else methods[m] = r.outcome
    }
    out.targets[t.file] = { class: t.cls, segments: t.segments, query: t.query, body: t.body, methods }
  }
  writeFileSync(SNAPSHOT_FILE, JSON.stringify(out, null, 2) + '\n')
}
