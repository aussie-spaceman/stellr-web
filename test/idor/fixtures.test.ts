// @vitest-environment node
//
// The IDOR harness run against fixture handlers whose guards are known
// (test/idor/fixtures/handlers.ts). Intact, every fixture refuses a tenant-A
// participant naming a tenant-B honeytoken. scripts/idor-canary.mjs copies the
// fixtures, deletes one guard line, points IDOR_FIXTURE_DIR at the copy and
// expects this file to FAIL: proof the suites can fail.
import './mocks'
import path from 'node:path'
import { headers } from 'next/headers'
import { describe, expect, it } from 'vitest'
import { currentTenantId, requireEventAccess } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { TENANT_ID_HEADER } from '@/lib/tenancy/host'
import { CANARY_TENANT, HONEYTOKENS, scanForHoneytokens } from '@/lib/testing/honeytokens'
import { harness, installNetworkGuard, runIdorCase, runStaffPersonaCases, STAFF_PERSONAS_FOR, STELLR_HOST, staffCaseProblem, type CaseResult, type Direction, type Persona, type StaffPersona } from './harness'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.idor.invalid'
process.env.SUPABASE_SECRET_KEY = 'sb_secret_idorharness'
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_idorharness'

installNetworkGuard()

const dir = process.env.IDOR_FIXTURE_DIR ? path.resolve(process.env.IDOR_FIXTURE_DIR) : path.resolve(__dirname, 'fixtures')
const input = { segments: ['id'], query: [], body: [], urlPattern: '/api/fixture/[id]' }
type Ctx = { params: Promise<Record<string, string | string[]>> }

const CASES: [name: string, method: string][] = [
  ['ownerFiltered', 'GET'],
  ['ownerChecked', 'GET'],
  ['adminGuarded', 'GET'],
  ['tenantFiltered', 'GET'],
  ['scopedWrite', 'PATCH'],
]

function explain(r: CaseResult) {
  return [
    `${r.method} → ${r.status} ${r.outcome}`,
    ...r.leaks.map((l) => `leaked ${l.value}`),
    ...r.writes.map((w) => `honey write ${w.table}: ${w.detail}`),
    r.error ?? '',
  ].join('\n')
}

const load = async () => ((await import(path.join(dir, 'handlers.ts'))) as { FIXTURES: Record<string, Record<string, unknown>> }).FIXTURES

// Staff personas. A staff case must get as far as the database: a refusal with nothing
// touched would mean the persona was never let in, and proves nothing about the scope.
const STAFF_CASES: [name: string, cls: 'tenant_staff' | 'platform_admin', reachesDb: boolean][] = [
  ['loadScopedRead', 'tenant_staff', true],
  ['staffFiltered', 'tenant_staff', true],
  ['staffUniform', 'tenant_staff', true],
  ['platformGuarded', 'platform_admin', false],
]

// Written out, not read from STAFF_PERSONAS_FOR: this is what the class must run.
const PERSONAS_FOR_CLASS = {
  tenant_staff: ['stellr_staff', 'canary_admin', 'stellr_event_manager'],
  platform_admin: ['canary_admin'],
} as const

describe(`IDOR fixtures: staff personas (${process.env.IDOR_FIXTURE_DIR ? 'canary copy' : 'intact'})`, () => {
  for (const [name, cls, reachesDb] of STAFF_CASES) {
    it(`${name} (${cls}) refuses every persona the class runs, uniformly`, async () => {
      const results = await runStaffPersonaCases((await load())[name], input, 'GET', cls, name)
      expect(results.map((r) => r.persona)).toEqual(PERSONAS_FOR_CLASS[cls])
      for (const { persona, result } of results) {
        expect(result.outcome, `${persona}\n${explain(result)}`).toBe('refused')
        if (reachesDb) expect(result.touched, `${persona} never reached the database`).toBe(true)
      }
    })
  }

  it('staffList (no id) returns none of the other tenant’s or event’s rows to any persona', async () => {
    const noId = { segments: [], query: [], body: [], urlPattern: '/api/fixture/list' }
    for (const { persona, result } of await runStaffPersonaCases((await load()).staffList, noId, 'GET', 'tenant_staff', 'staffList')) {
      expect(result.outcome, `${persona}\n${explain(result)}`).toBe('ok')
      expect(staffCaseProblem({ cls: 'tenant_staff', persona, result, idBearing: false })).toBeNull()
    }
  })
})

describe('a staff case has to prove something', () => {
  const result = (over: Partial<CaseResult>): CaseResult => ({ method: 'GET', status: 200, outcome: 'ok', leaks: [], writes: [], touched: true, audits: [], ...over })
  const on = (over: Partial<CaseResult>, persona: StaffPersona = 'stellr_staff', cls: 'tenant_staff' | 'platform_admin' = 'tenant_staff') =>
    staffCaseProblem({ cls, persona, result: result(over), idBearing: true })

  it('a tenant_staff route that errors, stops on the request, or never uses the id does not pass', () => {
    expect(on({ status: 500, outcome: 'error' })).toContain('error')
    expect(on({ status: 400, outcome: 'unexercised', touched: false })).toContain('unexercised')
    expect(on({ status: 403, outcome: 'refused', touched: false })).toContain('never reached')
    expect(on({ status: 403, outcome: 'refused', touched: false }, 'canary_admin')).toContain('never reached')
    expect(on({ status: 200, outcome: 'ok', touched: false })).toContain('never reached')
  })

  it('a failing outcome never passes, even with an exception', () => {
    for (const outcome of ['leak', 'honey_write', 'oracle', 'oracle_4xx'] as const) {
      expect(staffCaseProblem({ cls: 'tenant_staff', persona: 'stellr_staff', result: result({ outcome }), idBearing: true, exception: 'a named reason' })).toContain(outcome)
    }
  })

  it('what may pass: a refusal after the id, an event manager refused at the guard, a named exception, and no id to use', () => {
    expect(on({ status: 404, outcome: 'refused' })).toBeNull()
    expect(on({ status: 403, outcome: 'refused', touched: false }, 'stellr_event_manager')).toBeNull()
    expect(staffCaseProblem({ cls: 'tenant_staff', persona: 'stellr_staff', result: result({ status: 400, outcome: 'unexercised' }), idBearing: true, exception: 'a named reason' })).toBeNull()
    expect(staffCaseProblem({ cls: 'tenant_staff', persona: 'stellr_staff', result: result({ touched: false }), idBearing: false })).toBeNull()
  })

  it('a platform route must refuse the tenant admin, by status', () => {
    expect(on({ status: 200, outcome: 'ok' }, 'canary_admin', 'platform_admin')).toContain('200')
    expect(on({ status: 400, outcome: 'unexercised', touched: false }, 'canary_admin', 'platform_admin')).toContain('400')
    expect(on({ status: 403, outcome: 'refused', touched: false }, 'canary_admin', 'platform_admin')).toBeNull()
  })

  it('a platform_destined route is held to the same refusal as a platform route', () => {
    const destined = (over: Partial<CaseResult>, guardExempt?: boolean) =>
      staffCaseProblem({ cls: 'platform_destined', persona: 'canary_admin', result: result(over), idBearing: true, guardExempt })
    expect(destined({ status: 200, outcome: 'ok' })).toContain('200')
    expect(destined({ status: 400, outcome: 'unexercised', touched: false })).toContain('400')
    expect(destined({ status: 403, outcome: 'refused', touched: false })).toBeNull()
    expect(STAFF_PERSONAS_FOR.platform_destined).toEqual(['canary_admin'])
  })

  it('a guard exception excuses the status and nothing else', () => {
    const exempt = (over: Partial<CaseResult>) =>
      staffCaseProblem({ cls: 'platform_destined', persona: 'canary_admin', result: result(over), idBearing: true, guardExempt: true })
    expect(exempt({ status: 200, outcome: 'ok' })).toBeNull()
    for (const outcome of ['leak', 'honey_write', 'oracle', 'oracle_4xx'] as const) expect(exempt({ outcome })).toContain(outcome)
    // It has no bearing on a tenant_staff route, which has to prove its scope.
    expect(staffCaseProblem({ cls: 'tenant_staff', persona: 'stellr_staff', result: result({ status: 403, outcome: 'refused', touched: false }), idBearing: true, guardExempt: true })).toContain('never reached')
  })
})

// A route with no host filter gives the same entries in both directions, so nothing else
// would notice one quietly becoming the other.
describe('a case runs in the direction it asks for', () => {
  const seen = async (direction?: Direction, persona: Persona = 'participant') => {
    let got: Record<string, unknown> = {}
    const probe = {
      async GET(req: Request) {
        const h = await headers()
        got = {
          url: new URL(req.url).host,
          host: req.headers.get('host'),
          forwarded: req.headers.get('x-forwarded-host'),
          reqTenant: req.headers.get(TENANT_ID_HEADER),
          nextHost: h.get('host'),
          nextTenant: h.get(TENANT_ID_HEADER),
          currentTenant: currentTenantId(),
          honeyTenant: harness.db.honeyTenantId,
          contextTenant: harness.context.callerTenantId,
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      },
    }
    await runIdorCase(probe, input, 'GET', persona, 'probe', { direction, strict: true })
    return got
  }

  const onStellr = {
    url: STELLR_HOST,
    host: STELLR_HOST,
    forwarded: STELLR_HOST,
    reqTenant: null,
    nextHost: STELLR_HOST,
    nextTenant: null,
    currentTenant: STELLR_TENANT_ID,
    honeyTenant: CANARY_TENANT.id,
    contextTenant: STELLR_TENANT_ID,
  }
  const onCanary = {
    url: CANARY_TENANT.host,
    host: CANARY_TENANT.host,
    forwarded: CANARY_TENANT.host,
    reqTenant: CANARY_TENANT.id,
    nextHost: CANARY_TENANT.host,
    nextTenant: CANARY_TENANT.id,
    currentTenant: CANARY_TENANT.id,
    honeyTenant: STELLR_TENANT_ID,
    contextTenant: CANARY_TENANT.id,
  }

  it('host, headers, the tenant in context and whose record it names all follow the direction', async () => {
    expect(await seen('stellr_to_canary')).toEqual(onStellr)
    expect(await seen('canary_to_stellr')).toEqual(onCanary)
    expect(await seen(undefined)).toEqual(onStellr)
  })

  it('canary_admin is on Canary’s host, and its scope is Canary’s', async () => {
    expect(await seen(undefined, 'canary_admin')).toEqual(onCanary)
    expect(await seen(undefined, 'stellr_staff')).toEqual(onStellr)
    let tenantId: string | undefined
    const scoped = {
      async GET() {
        const access = await requireEventAccess()
        tenantId = access.ok ? access.tenantId : undefined
        return new Response('{}', { status: 200 })
      },
    }
    await runIdorCase(scoped, input, 'GET', 'canary_admin', 'scoped', { strict: true })
    expect(tenantId).toBe(CANARY_TENANT.id)
  })

  it('Stellr’s id written into a filter is refused in one direction and fails the other', async () => {
    const hard = (await load()).hostHardcodedStellr
    const hostInput = { segments: ['token'], query: [], body: [], urlPattern: '/api/fixture/[token]' }
    const stellr = await runIdorCase(hard, hostInput, 'GET', 'anonymous', 'hard', { direction: 'stellr_to_canary', strict: true })
    expect(stellr.outcome, explain(stellr)).toBe('refused')
    const canary = await runIdorCase(hard, hostInput, 'GET', 'anonymous', 'hard', { direction: 'canary_to_stellr', strict: true })
    expect(canary.outcome, explain(canary)).toBe('leak')
  })
})

describe('the refusal differential', () => {
  const byId = (run: (id: string) => Response | Promise<Response>) => ({
    async GET(_req: Request, { params }: Ctx) {
      return run((await params).id as string)
    },
  })
  const notFound = (body: unknown) => new Response(JSON.stringify(body), { status: 404 })
  const readRow = async (id: string) => (await supabaseServer().from('registrations').select('id').eq('id', id).maybeSingle()).data

  it('a value the caller sent, echoed back, is not a difference', async () => {
    const echoes = byId(async (id) => {
      await readRow(id)
      return notFound({ error: `no record ${id}` })
    })
    const r = await runIdorCase(echoes, input, 'GET', 'anonymous', 'echo', { strict: true })
    expect(r.outcome, explain(r)).toBe('refused')
  })

  it('a different refusal with the row there is oracle_4xx, and with a malformed id too', async () => {
    const presence = byId(async (id) => ((await readRow(id)) ? new Response('{}', { status: 403 }) : notFound({ error: 'missing' })))
    const r = await runIdorCase(presence, input, 'GET', 'anonymous', 'presence', { strict: true })
    expect([r.outcome, r.oracleKind]).toEqual(['oracle_4xx', 'presence'])
    const malformed = byId(async (id) => {
      const { error } = await supabaseServer().from('registrations').select('id').eq('id', id).maybeSingle()
      return error ? new Response('{}', { status: 400 }) : notFound({ error: 'missing' })
    })
    const m = await runIdorCase(malformed, input, 'GET', 'anonymous', 'malformed', { strict: true })
    expect([m.outcome, m.oracleKind]).toEqual(['oracle_4xx', 'malformed'])
  })

  it('a rate limit proves nothing: not refused, and no comparison with it passes a strict case', async () => {
    const limited = byId(async (id) => {
      await readRow(id)
      return new Response('{}', { status: 429 })
    })
    expect((await runIdorCase(limited, input, 'GET', 'anonymous', 'limited', { strict: true })).outcome).toBe('unexercised')
    expect((await runIdorCase(limited, input, 'GET', 'anonymous', 'limited')).outcome).toBe('unexercised')
    let calls = 0
    const limitedLater = byId(async (id) => {
      await readRow(id)
      return ++calls === 1 ? notFound({ error: 'missing' }) : new Response('{}', { status: 429 })
    })
    expect((await runIdorCase(limitedLater, input, 'GET', 'anonymous', 'later', { strict: true })).outcome).toBe('unexercised')
  })

  it('in a strict case an unanswered send still counts, behind a uniform response', async () => {
    const sends = byId(async (id) => {
      const row = await readRow(id)
      if (row) await fetch('https://mail.invalid/send', { method: 'POST', body: JSON.stringify(row) })
      return new Response('{}', { status: 200 })
    })
    const strict = await runIdorCase(sends, input, 'GET', 'anonymous', 'sends', { strict: true })
    expect(strict.outcome, explain(strict)).toBe('honey_write')
    expect(strict.writes.map((w) => w.table)).toEqual(['fetch:mail.invalid'])
  })

  it('in a strict case a send only the row causes counts, though it carries nothing the scanner knows', async () => {
    const sends = byId(async (id) => {
      if (await readRow(id)) await fetch('https://mail.invalid/send', { method: 'POST', body: '{"note":"a link"}' })
      return new Response('{}', { status: 200 })
    })
    const strict = await runIdorCase(sends, input, 'GET', 'anonymous', 'sends', { strict: true })
    expect(strict.outcome, explain(strict)).toBe('honey_write')
    expect((await runIdorCase(sends, input, 'GET', 'anonymous', 'sends')).outcome).toBe('ok')
    const always = byId(async () => {
      await fetch('https://mail.invalid/send', { method: 'POST', body: '{"note":"a link"}' })
      return new Response('{}', { status: 200 })
    })
    expect((await runIdorCase(always, input, 'GET', 'anonymous', 'always', { strict: true })).outcome).toBe('ok')
  })
})

// Tenant hosts: both people, both directions, strict. Labelled per case, so the canary
// can demand that a missing guard is seen by each of the four.
const HOST_CASES: [name: string, segment: string][] = [
  ['hostTokenScoped', 'token'],
  ['hostUniform', 'number'],
]

describe(`IDOR fixtures: tenant hosts (${process.env.IDOR_FIXTURE_DIR ? 'canary copy' : 'intact'})`, () => {
  for (const [name, segment] of HOST_CASES) {
    const hostInput = { segments: [segment], query: [], body: [], urlPattern: `/api/fixture/[${segment}]` }
    for (const persona of ['anonymous', 'participant'] as const) {
      for (const direction of ['stellr_to_canary', 'canary_to_stellr'] as const) {
        it(`${name} refuses ${persona} ${direction}`, async () => {
          const r = await runIdorCase((await load())[name], hostInput, 'GET', persona, `${name}:${persona}:${direction}`, { direction, strict: true })
          expect(r.outcome, explain(r)).toBe('refused')
          expect(r.touched).toBe(true)
        })
      }
    }
  }
})

describe(`IDOR fixtures (${process.env.IDOR_FIXTURE_DIR ? 'canary copy' : 'intact'})`, () => {
  for (const [name, method] of CASES) {
    it(`${name} refuses a tenant-B honeytoken id`, async () => {
      const mod = (await import(path.join(dir, 'handlers.ts'))) as { FIXTURES: Record<string, Record<string, unknown>> }
      const r = await runIdorCase(mod.FIXTURES[name], input, method, 'participant', name)
      expect(r.outcome, explain(r)).not.toBe('leak')
      expect(r.outcome, explain(r)).not.toBe('honey_write')
      expect(r.outcome, explain(r)).not.toBe('error')
    })
  }

  it('the scanner itself sees a planted honeytoken (it is not blind)', () => {
    expect(scanForHoneytokens({ email: HONEYTOKENS.email })).toHaveLength(1)
    expect(scanForHoneytokens({ id: HONEYTOKENS.id }, { sent: [HONEYTOKENS.id] })).toHaveLength(0)
  })
})
