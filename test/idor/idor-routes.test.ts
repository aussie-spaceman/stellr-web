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
//   - the outcome differs from test/idor/idor-snapshot.json.
// And the suite fails when the case count differs from the manifest's count of
// id-bearing routes, when a new id-bearing route is not in the snapshot, and
// when more cases are `unexercised` (request validation refused before the id
// was used) than MAX_UNEXERCISED.
//
// Regenerate after adding or changing an id-bearing route, then REVIEW the diff:
//   npm run idor:snapshot
// New leak/honey_write outcomes are written with `accepted: "TODO: review"`,
// which fails until a person replaces it with the reason it is safe.
import './mocks'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { idorTargets, type IdorTarget } from '@/lib/security/idor-targets'
import { ROUTE_MANIFEST } from '@/lib/security/route-manifest'
import { FAILING_OUTCOMES, installNetworkGuard, runIdorCase, targetInput, type CaseResult, type Outcome } from './harness'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.idor.invalid'
process.env.SUPABASE_SECRET_KEY = 'sb_secret_idorharness'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_idorharness'

const SNAPSHOT_FILE = 'test/idor/idor-snapshot.json'
const UPDATE = process.env.IDOR_UPDATE_SNAPSHOT === '1'
const TODO = 'TODO: review'

// Floor, so an emptied manifest or a broken analyser cannot pass with a small
// count. 4 Nov 2026: 226 id-bearing route files (130 stellr_only, 64
// participant, 30 public, 2 webhook).
const MIN_TARGETS = 215

// Cases whose request the handler refused as invalid before any Canary value
// reached the database: they prove nothing about isolation. The harness fills
// non-id body fields with plausible values to get past validation; what is
// left is pinned in the snapshot as `unexercised` and capped here, so the
// number can only go down. Lower it when a route starts being exercised.
const MAX_UNEXERCISED = 16

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
  targets: Record<string, SnapshotTarget>
}

// scripts/idor-canary.mjs: `<route file>=<absolute path of a mutated copy>`.
// The case for that route loads the copy instead, so the canary can prove the
// generated suite fails when a real route loses its guard.
const OVERRIDE = (() => {
  const raw = process.env.IDOR_ROUTE_OVERRIDE
  if (!raw) return null
  const at = raw.indexOf('=')
  return { file: raw.slice(0, at), path: raw.slice(at + 1) }
})()

const outcomeOf = (e: MethodEntry) => (typeof e === 'string' ? e : e.outcome)
const acceptedOf = (e: MethodEntry | undefined) => (e && typeof e === 'object' ? e.accepted : undefined)

const targets = idorTargets()
const snapshot: Snapshot = existsSync(SNAPSHOT_FILE)
  ? JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8'))
  : { _comment: '', count: 0, targets: {} }
const observed = new Map<string, Record<string, CaseResult>>()
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
    // Nothing is tenant-scoped yet (S5 moves routes to tenant_staff /
    // platform_admin). When the first one moves, add a tenant-staff persona
    // case for it here: a tenant-A admin naming a tenant-B id must be refused.
    expect(targets.filter((t) => t.cls === 'tenant_staff' || t.cls === 'platform_admin')).toEqual([])
  })

  for (const t of targets) {
    it(`${t.cls} ${t.urlPattern} [${t.methods.join(',')}]`, async () => {
      ran++
      const mod = (await (OVERRIDE?.file === t.file ? import(OVERRIDE.path) : import(`../../${t.file}`))) as Record<string, unknown>
      const results: Record<string, CaseResult> = {}
      for (const m of t.methods) results[m] = await runIdorCase(mod, targetInput(t), m, 'participant', t.file)
      observed.set(t.file, results)
      // IDOR_DEBUG=<substring of a route file>: print what each method did.
      if (process.env.IDOR_DEBUG && t.file.includes(process.env.IDOR_DEBUG)) {
        console.log(`${t.file}\n${Object.values(results).map(describeResult).join('\n')}`)
      }
      if (UPDATE) return
      checkTarget(t, results)
    })
  }

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

  it(`no more than ${MAX_UNEXERCISED} cases are unexercised (refused as invalid before the id was used)`, () => {
    if (UPDATE) return
    const unexercised = [...observed.entries()].flatMap(([file, rs]) =>
      Object.values(rs)
        .filter((r) => r.outcome === 'unexercised')
        .map((r) => `${r.method} ${file}`),
    )
    expect(unexercised.length, unexercised.join('\n')).toBeLessThanOrEqual(MAX_UNEXERCISED)
  })
})

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
    if (accepted !== undefined) {
      expect(accepted, `${detail}\nthe snapshot's accepted reason is still a TODO`).not.toBe(TODO)
      expect(accepted.length, `${detail}\nan accepted outcome needs a reason`).toBeGreaterThan(20)
    }
    if (FAILING_OUTCOMES.includes(r.outcome)) {
      expect(accepted, `${detail}\ntenant-B data reached a tenant-A caller, and the snapshot does not accept it`).toBeDefined()
    }
    if (t.cls === 'stellr_only' && accepted === undefined) {
      // By construction: an admin guard refuses a participant before any read.
      expect([401, 403, 404], `${detail}\na stellr_only route must refuse a participant`).toContain(r.status)
    }
    expect(r.outcome, `${detail}\noutcome changed from the snapshot: review, then \`npm run idor:snapshot\``).toBe(outcomeOf(entry))
  }
}

function writeSnapshot() {
  const out: Snapshot = {
    _comment:
      'Generated by `npm run idor:snapshot` (test/idor/idor-routes.test.ts). One entry per id-bearing route handler. ' +
      'A leak or honey_write outcome needs a reviewed `accepted` reason; the generator writes "TODO: review", which fails.',
    count: targets.length,
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
      const needsReason = FAILING_OUTCOMES.includes(r.outcome) ||(t.cls === 'stellr_only' && ![401, 403, 404].includes(r.status))
      if (keep !== undefined && prevEntry && outcomeOf(prevEntry) === r.outcome) methods[m] = { outcome: r.outcome, accepted: keep }
      else if (needsReason) methods[m] = { outcome: r.outcome, accepted: TODO }
      else methods[m] = r.outcome
    }
    out.targets[t.file] = { class: t.cls, segments: t.segments, query: t.query, body: t.body, methods }
  }
  writeFileSync(SNAPSHOT_FILE, JSON.stringify(out, null, 2) + '\n')
}
