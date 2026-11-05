// @vitest-environment node
//
// The routes a tenant host serves (lib/tenancy/tenant-surface.ts allowedTenantFiles) are
// participant or public class. This suite runs an anonymous caller and a participant over
// every one of them, on host A naming a valid record of host B, in both directions, Stellr
// included, with the refusal differential enforced.
//
// test/baselines/tenant-host-idor.json pins the cases as totals and a sha256 of their sorted
// lines, and names no route: logs and artifacts on this repo are public. Its totals are a
// generated cap that only falls, through A7 and A10 to A12:
//   - any case that changes fails here, on the hash, until the baseline is regenerated, so
//     an improvement stays down;
//   - the writer refuses totals that rose, and CI's `scripts/tenant-host-cap.mjs --since`
//     guards the baseline itself.
// A local run prints the cases when they differ; CI prints only counts and hashes.
// Regenerate with `npm run idor:snapshot`.
//
// A valid credential, not a guess: test/idor/tenant-host-targets.ts. An event slug answers
// through the Sanity mock below. A case that ends `refused_untouched`, `ok_untouched`,
// `unexercised` or `error` proved nothing: it needs a named reason (TENANT_HOST_UNPROVEN),
// and that count only falls too.
import './mocks'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { HONEYTOKENS, HONEYTOKEN_MARKER } from '@/lib/testing/honeytokens'
import { applyEnv, HELD_BACK_FIXTURES } from './case-fixtures'
import { harness, installNetworkGuard, recordOutboundEmail, runIdorCase, targetInput, type CaseResult, type Direction } from './harness'
import { isCi, printReportedOracles } from './reported-oracles'
import { TENANT_HOST_ACCEPTED, TENANT_HOST_UNPROVEN } from './tenant-host-accepted'
import { capRegressions, entryOf, hostTotals, isFailingEntry, isUnprovenEntry, printHostCases, sealHostCases, tenantHostFixture, tenantHostTargets, tenantHostVariants, unprovenReasonKey, type HostBaseline, type HostCases } from './tenant-host-targets'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.idor.invalid'
process.env.SUPABASE_SECRET_KEY = 'sb_secret_idorharness'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_idorharness'
process.env.HUBSPOT_PORTAL_ID = 'idor-harness-portal'
delete process.env.NEXT_PUBLIC_SANITY_PROJECT_ID

const eventLookups = vi.hoisted(() => ({ byRoute: new Map<string, number>(), route: '' }))

// The generated suite models no Sanity event, so a route that looks one up stops there.
// Here host B's slug names a real, open event of host B, gone in the differential's run.
vi.mock('@/lib/sanity', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getEventBySlug: async (slug: string) => {
    if (String(slug).toUpperCase().includes(HONEYTOKEN_MARKER)) eventLookups.byRoute.set(eventLookups.route, (eventLookups.byRoute.get(eventLookups.route) ?? 0) + 1)
    if (harness.db.honeyAbsent || !String(slug).toUpperCase().includes(HONEYTOKEN_MARKER)) return null
    return {
      _id: HONEYTOKENS.sanityId,
      title: HONEYTOKENS.personName,
      slug: { current: slug },
      type: 'competition',
      date: '2099-06-01',
      endDate: '2099-06-02',
      setting: 'in_person',
      registrationOpen: true,
      gradeMin: 7,
      gradeMax: 12,
      capacity: 100,
    }
  },
}))

// No key here, so lib/email would log and return: without this, a route that mails another
// tenant's data behind a uniform response would stay `ok`.
vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendEmail: async (email: unknown) => {
    recordOutboundEmail(email)
    return { id: 'email_idorharness' }
  },
}))

const BASELINE_FILE = 'test/baselines/tenant-host-idor.json'
const UPDATE = process.env.IDOR_UPDATE_SNAPSHOT === '1'
const ALLOW_GROW = process.env.IDOR_ALLOW_GROW === '1'
const PERSONAS = ['anonymous', 'participant'] as const
const DIRECTIONS: readonly Direction[] = ['stellr_to_canary', 'canary_to_stellr']

const OVERRIDE = (() => {
  const raw = process.env.IDOR_ROUTE_OVERRIDE
  if (!raw) return null
  const at = raw.indexOf('=')
  return { file: raw.slice(0, at), path: raw.slice(at + 1) }
})()

const targets = tenantHostTargets()
const baseline: HostBaseline | null = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : null
const observed: HostCases = {}

installNetworkGuard()

function describeResult(r: CaseResult): string {
  const parts = [`${r.method} → ${r.status} ${r.outcome}`]
  for (const l of r.leaks) parts.push(`  leaked ${l.value} in …${l.context}…`)
  for (const w of r.writes) parts.push(`  wrote ${w.table} (${w.op}): ${w.detail}`)
  if (r.oracle) parts.push(`  oracle: ${r.oracle}`)
  if (r.error) parts.push(`  error: ${r.error}`)
  return parts.join('\n')
}

describe('tenant-host routes: anonymous and participant, on host A naming a valid record of host B', () => {
  it('covers every allowed route handler, signing sessions included', () => {
    expect(targets.length).toBeGreaterThan(20)
    expect(targets.map((t) => t.file)).toEqual(expect.arrayContaining(['app/api/sign/context/route.ts', 'app/api/survey/[token]/route.ts', 'app/api/credentials/[number]/pdf/route.ts']))
  })

  for (const t of targets) {
    it(`${t.urlPattern} [${t.methods.join(',')}]`, async () => {
      eventLookups.route = t.file
      const restoreEnv = applyEnv(tenantHostFixture(t.file).env)
      const mod = (await (OVERRIDE?.file === t.file ? import(OVERRIDE.path) : import(`../../${t.file}`)).finally(restoreEnv)) as Record<string, unknown>
      const cases: Record<string, string> = {}
      const details: string[] = []
      for (const { variant, fixture } of tenantHostVariants(t.file)) {
        const input = { ...targetInput(t), fixture }
        for (const method of t.methods) {
          for (const persona of PERSONAS) {
            for (const direction of DIRECTIONS) {
              const r = await runIdorCase(mod, input, method, persona, t.file, { direction, strict: true })
              const key = [method, persona, direction, variant].filter(Boolean).join(' ')
              cases[key] = entryOf(r)
              details.push(`${key}\n${describeResult(r)}`)
            }
          }
        }
      }
      observed[t.file] = cases
      if (process.env.IDOR_DEBUG && !isCi() && t.file.includes(process.env.IDOR_DEBUG)) console.log(`${t.file}\n${details.join('\n')}`)
    })
  }

  it('every route ran, and the baseline’s totals and hash are what the cases add up to', () => {
    expect(Object.keys(observed).length, 'a route above did not finish').toBe(targets.length)
    const totals = hostTotals(observed, TENANT_HOST_ACCEPTED)
    const caseHash = sealHostCases(observed).hash
    if (caseHash !== baseline?.caseHash) printHostCases(observed)
    if (UPDATE) {
      if (OVERRIDE) throw new Error('refusing to write the baseline from a canary run')
      const grew = capRegressions(baseline?.totals ?? null, totals)
      if (grew.length && !ALLOW_GROW) throw new Error(`the tenant-host cap only falls. Rose:\n${grew.join('\n')}`)
      const out: HostBaseline = {
        _comment:
          'Generated by `npm run idor:snapshot` (test/idor/tenant-host-routes.test.ts). Never hand-edited. totals.failing and totals.unproven are caps that only fall, failing to 0 by the S5 gate. caseHash is a sha256 of the sorted case lines; a local run of the suite prints them.',
        totals,
        caseHash,
      }
      writeFileSync(BASELINE_FILE, JSON.stringify(out, null, 2) + '\n')
      return
    }
    expect(baseline, `${BASELINE_FILE} is missing: run \`npm run idor:snapshot\``).not.toBeNull()
    expect(
      { totals, caseHash },
      `a case changed from ${BASELINE_FILE}: run this suite locally to see the cases, review. Better: \`npm run idor:snapshot\` lowers the cap. Worse: fix the route; the cap does not rise.`,
    ).toEqual({ totals: baseline?.totals, caseHash: baseline?.caseHash })
  })

  it('an accepted outcome names a case that still fails as approved, its reason and the owner’s approval', () => {
    for (const [key, a] of Object.entries(TENANT_HOST_ACCEPTED)) {
      expect(a.reason.length, key).toBeGreaterThan(20)
      expect(a.approvedBy.trim(), key).not.toBe('')
      expect(a.approvedOn, key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      const at = key.indexOf(' ')
      const entry = observed[key.slice(0, at)]?.[key.slice(at + 1)]
      expect(entry && isFailingEntry(entry), `${key} no longer fails: remove it`).toBe(true)
      expect(entry === a.outcome, `${key} is not what was approved: the approval does not cover it`).toBe(true)
    }
  })

  it('a case that proved nothing has a named reason, and a reason names a case that still needs one', () => {
    if (UPDATE) return
    const used = new Set<string>()
    const unnamed: Record<string, string> = {}
    for (const [file, byCase] of Object.entries(observed)) {
      for (const [key, entry] of Object.entries(byCase)) {
        if (!isUnprovenEntry(entry)) continue
        const reason = unprovenReasonKey(file, key, TENANT_HOST_UNPROVEN)
        if (reason) used.add(reason)
        else unnamed[`${file} ${key}`] = entry
      }
    }
    const stale = Object.fromEntries(Object.keys(TENANT_HOST_UNPROVEN).filter((k) => !used.has(k)).map((k) => [k, 'proves something now']))
    if (Object.keys(unnamed).length) printReportedOracles(unnamed, process.env, console.log, 'Proved nothing, with no named reason')
    if (Object.keys(stale).length) printReportedOracles(stale, process.env, console.log, 'A reason no case needs')
    expect(Object.keys(unnamed).length, 'give each case a fixture that reaches the code that decides; a local run names them').toBe(0)
    expect(Object.keys(stale).length, 'these now prove something: remove them; a local run names them').toBe(0)
    for (const [k, why] of Object.entries(TENANT_HOST_UNPROVEN)) expect(why.length, k).toBeGreaterThan(20)
  })

  it('the event-gated writes reach host B’s event, in both directions', () => {
    if (UPDATE) return
    for (const file of ['app/api/register/individual/route.ts', 'app/api/register/group/route.ts', 'app/api/volunteer/interest/route.ts']) {
      expect(eventLookups.byRoute.get(file), `${file} never looked host B's slug up`).toBeGreaterThan(0)
      const cases = Object.entries(observed[file] ?? {})
      expect(cases.length, file).toBeGreaterThan(0)
      for (const direction of DIRECTIONS) expect(cases.some(([k, entry]) => k.includes(direction) && !isUnprovenEntry(entry)), `${file} ${direction}`).toBe(true)
    }
    for (const file of ['app/api/register/individual/route.ts', 'app/api/register/group/route.ts']) {
      expect(Object.values(observed[file]).filter(isUnprovenEntry).length, `${file}: cases that proved nothing`).toBe(0)
    }
  })

  it('a held-back fixture on this surface is the one in use, so both suites see the same request', () => {
    for (const t of targets) {
      const held = HELD_BACK_FIXTURES[t.file]
      if (held) expect(tenantHostFixture(t.file).body).toEqual(held.fixture.body)
    }
  })
})
