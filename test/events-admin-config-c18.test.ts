// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { auditHandlers } from '@/lib/security/audit-coverage'
import { ROUTE_MANIFEST } from '@/lib/security/route-manifest'
import { STELLR_ONLY_DISPOSITIONS } from '@/lib/security/stellr-only-dispositions'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// C18 (docs/TENANCY-S5.md): events admin configuration under an event: companies, store
// offerings and the merch batch. Companies is the first area that reads through tenantDb
// ('events-config', lib/events/admin-config.ts, whose own test drives the three paths).
//
// This drives the handlers under real lib/authz, with Clerk and the database as stand-ins:
// Stellr's admins and managers with every flag at its default, where each answer must be
// today's (lib/events/admin-config.test.ts proves no tenant transaction opens then), and a
// tenant's staff on their own event and on Stellr's. The database applies the filters it is given and records each query.

const TENANT = '11111111-1111-4111-8111-111111111111'
const C1 = '22222222-2222-4222-8222-222222222222'
const P1 = '33333333-3333-4333-8333-333333333333'

type Row = Record<string, unknown>
interface Query {
  table: string
  op: string
  select?: string
  filters: [string, string, unknown][]
  payload?: unknown
  options?: unknown
}

const state = vi.hoisted(() => ({
  session: {} as Record<string, unknown>,
  tenant: '',
  rows: {} as Record<string, unknown[]>,
  failEvents: false,
  queries: [] as unknown[],
  audits: [] as unknown[],
  autoAssign: vi.fn(async (..._a: unknown[]) => ({ placed: 0 })),
  overrideOutstanding: vi.fn(async (..._a: unknown[]) => ({ overridden: 0 })),
  getEventBatchSummary: vi.fn(async (..._a: unknown[]) => ({ awaitingCount: 0, batch: null })),
  commitEventBatch: vi.fn(async (..._a: unknown[]) => ({ batchId: 'b', items: 1, podOrderId: null })),
}))

function fakeDb() {
  const from = (table: string) => {
    const q: Query = { table, op: 'select', filters: [] }
    state.queries.push(q)
    const passes = (row: Row) =>
      q.filters.every(([kind, col, value]) => {
        if (kind === 'or') return row.tenant_id == null || col.includes(`tenant_id.eq.${row.tenant_id as string}`)
        // An embedded filter (`registrations.event_slug`) applies to a row that
        // carries the embedded row, as an !inner join would; other rows pass it.
        if (col.includes('.')) {
          const [head, key] = col.split('.')
          const nested = row[head] as Row | undefined
          return nested && typeof nested === 'object' && key in nested ? nested[key] === value : true
        }
        if (!(col in row)) return true
        if (kind === 'in') return (value as unknown[]).includes(row[col])
        if (kind === 'gt') return (row[col] as number) > (value as number)
        if (kind === 'is') return row[col] == null
        return row[col] === value
      })
    const answer = () => ((state.rows[table] ?? []) as Row[]).filter(passes)
    const chain: Record<string, unknown> = {}
    chain.select = (cols?: string) => {
      if (cols && q.op === 'select') q.select = cols
      return chain
    }
    for (const op of ['update', 'delete', 'insert', 'upsert']) {
      chain[op] = (payload?: unknown, options?: unknown) => {
        q.op = op
        q.payload = payload
        q.options = options
        return chain
      }
    }
    for (const kind of ['eq', 'in', 'gt', 'is', 'neq']) {
      chain[kind] = (col: string, value: unknown) => {
        q.filters.push([kind, col, value])
        return chain
      }
    }
    chain.or = (expr: string) => {
      q.filters.push(['or', expr, null])
      return chain
    }
    chain.not = () => chain
    chain.order = () => chain
    chain.limit = () => chain
    chain.maybeSingle = async () =>
      table === 'events' && state.failEvents ? { data: null, error: { message: 'down' } } : { data: answer()[0] ?? null, error: null }
    chain.single = async () => ({ data: answer()[0] ?? null, error: null })
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: q.op === 'select' ? answer() : null, error: null })
    return chain
  }
  return { from, rpc: async () => ({ data: null, error: null }) }
}

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => state.session,
  currentUser: async () => null,
  clerkClient: async () => ({ users: { getUserList: async () => ({ data: [] }) } }),
}))
vi.mock('@/lib/authz/tenant', () => ({ currentTenantId: () => state.tenant }))
vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  supabaseServer: () => fakeDb(),
}))
vi.mock('@/lib/events/repo', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getEventBySlug: async () => null,
}))
vi.mock('@/lib/audit/platform', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  audit: async (input: unknown) => {
    state.audits.push(input)
    return { ok: true, id: 1, seq: 1 }
  },
}))
vi.mock('@/lib/after-response', () => ({
  runAfterResponse: (_label: string, task: () => Promise<unknown>) => {
    pending.push(task())
  },
}))
vi.mock('@/lib/activity-log', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  logActivity: async () => {},
  actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: null, actorLabel: 'Admin' }),
}))
vi.mock('@/lib/survey/events', () => ({ loadSurveyEvent: async () => null }))
vi.mock('@/lib/team-profile/assign', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  autoAssign: state.autoAssign,
}))
vi.mock('@/lib/team-profile/override', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  overrideOutstanding: state.overrideOutstanding,
}))
vi.mock('@/lib/store/event-batch', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getEventBatchSummary: state.getEventBatchSummary,
  commitEventBatch: state.commitEventBatch,
}))

let pending: Promise<unknown>[] = []

const asAdmin = () => {
  state.session = { userId: 'user_admin', sessionClaims: { metadata: { role: 'admin' } } }
  state.rows.event_manager_assignments = []
}
const asEventManager = (...slugs: string[]) => {
  state.session = { userId: 'user_em', sessionClaims: { metadata: { role: 'event_manager' } } }
  state.rows.event_manager_assignments = slugs.map((event_slug) => ({ clerk_user_id: 'user_em', event_slug, tenant_id: null }))
}
/** An admin of another tenant, holding no Clerk staff role: only a membership. */
const asTenantAdmin = () => {
  state.session = { userId: 'user_tenant', sessionClaims: { metadata: { role: 'student' } } }
  state.tenant = TENANT
  vi.stubEnv('AUTHZ_SOURCE', 'postgres')
  state.rows.members = [{ id: 'm', clerk_user_id: 'user_tenant' }]
  state.rows.tenant_memberships = [{ clerk_user_id: 'user_tenant', member_id: 'm', tenant_id: TENANT, role: 'tenant_admin' }]
  state.rows.tenants = [{ id: TENANT, status: 'active' }]
  state.rows.events = [{ slug: 'own', tenant_id: TENANT }, { slug: SLUG, tenant_id: STELLR_TENANT_ID }]
}

const queries = (table: string) => (state.queries as Query[]).filter((q) => q.table === table)
const SLUG = 'nevada'
const ctx = (slug = SLUG) => ({ params: Promise.resolve({ slug }) })
const req = (body?: unknown, method = 'POST', url = 'https://app.test/x') =>
  new Request(url, body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const companies = () => import('@/app/api/admin/events/[slug]/companies/route')
const offerings = () => import('@/app/api/admin/events/[slug]/offerings/route')
const merch = () => import('@/app/api/admin/events/[slug]/merch/commit/route')

const COMPANY = { id: C1, number: 1, name: 'Apollo', participants: [{ count: 2 }], event_slug: SLUG }

beforeEach(() => {
  state.rows = {}
  state.failEvents = false
  state.queries = []
  state.tenant = STELLR_TENANT_ID
  state.audits = []
  pending = []
  for (const f of [state.autoAssign, state.overrideOutstanding, state.getEventBatchSummary, state.commitEventBatch]) f.mockClear()
  vi.stubEnv('LOADSCOPED_MODE', '')
  vi.stubEnv('AUTHZ_SOURCE', '')
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
  vi.stubEnv('TENANT_DB_ENABLED', '')
  vi.stubEnv('TENANT_DB_AREAS', '')
  asAdmin()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

const CONVERTED = ['companies', 'offerings', 'merch/commit'].map((r) => `app/api/admin/events/[slug]/${r}/route.ts`)

describe('the routes C18 converted', () => {
  it("are tenant_crew, on requireEventRoute with the URL's slug, and have left the register", () => {
    for (const f of CONVERTED) {
      expect(ROUTE_MANIFEST[f], f).toBe('tenant_crew')
      expect(STELLR_ONLY_DISPOSITIONS[f], f).toBeUndefined()
      const src = readFileSync(f, 'utf8')
      expect(src, f).toMatch(/requireEventRoute\(slug,/)
      expect(src, f).not.toMatch(/@\/lib\/event-access/)
      // The routes reach the area only through lib/events/admin-config.
      expect(src, f).not.toMatch(/tenancy\/(?:db|area-switch)/)
    }
  })

  it('every handler that writes goes through the audit gate, with a catalogued action', () => {
    for (const f of CONVERTED) {
      for (const h of auditHandlers(f, readFileSync(f, 'utf8'))) {
        if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(h.method)) expect(h.audited, `${f} ${h.method}`).toBe(true)
      }
      const actions = [...readFileSync(f, 'utf8').matchAll(/action: '([a-z_.]+)', \.\.\.auditSubject/g)].map((m) => m[1])
      expect(actions.length, f).toBeGreaterThan(0)
      for (const a of actions) expect(AUDIT_ACTIONS as readonly string[], f).toContain(a)
    }
  })
})

describe('Stellr, with every flag at its default', () => {
  it("companies: today's answer and query, no event read", async () => {
    state.rows.event_companies = [COMPANY]
    const res = await (await companies()).GET(req(undefined, 'GET'), ctx())
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(JSON.stringify({ companies: [COMPANY] }))
    expect(queries('events')).toEqual([])
    expect(queries('event_companies')).toEqual([
      { table: 'event_companies', op: 'select', select: 'id, number, name, participants(count)', filters: [['eq', 'event_slug', SLUG]] },
    ])
  })

  it("an unassigned manager gets today's 403, and a signed-out caller today's 401, with nothing read", async () => {
    asEventManager('texas')
    for (const run of [
      async () => (await companies()).GET(req(undefined, 'GET'), ctx()),
      async () => (await companies()).PUT(req({ count: 2 }, 'PUT'), ctx()),
      async () => (await offerings()).GET(req(undefined, 'GET'), ctx()),
      async () => (await merch()).POST(req({ shipTo: {} }), ctx()),
    ]) {
      state.queries = []
      const res = await run()
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'Forbidden' })
      expect((state.queries as Query[]).filter((q) => q.table !== 'event_manager_assignments')).toEqual([])
    }
    state.session = {}
    const res = await (await companies()).GET(req(undefined, 'GET'), ctx())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
  })

  it('an assigned manager keeps their event', async () => {
    asEventManager(SLUG)
    state.rows.event_companies = [COMPANY]
    expect((await (await companies()).GET(req(undefined, 'GET'), ctx())).status).toBe(200)
    expect((await (await offerings()).GET(req(undefined, 'GET'), ctx())).status).toBe(200)
    expect((await (await merch()).GET(req(undefined, 'GET'), ctx())).status).toBe(200)
  })

  it("PUT companies: today's statements", async () => {
    const res = await (await companies()).PUT(req({ count: 2 }, 'PUT'), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect((state.queries as Query[]).map((q) => `${q.table}.${q.op}`)).toEqual(['event_companies.upsert', 'event_companies.delete', 'event_settings.upsert'])
  })

  it('PUT companies: a bad count is a 400 with nothing written', async () => {
    const res = await (await companies()).PUT(req({ count: 11 }, 'PUT'), ctx())
    expect(res.status).toBe(400)
    expect(state.queries).toEqual([])
  })

  it('rename, move and Auto-Assign still run for Stellr', async () => {
    const { POST } = await companies()
    expect((await POST(req({ action: 'rename', companyId: C1, name: ' Apollo ' }), ctx())).status).toBe(200)
    expect(queries('event_companies').at(-1)).toMatchObject({ op: 'update', payload: { name: 'Apollo' } })
    state.rows.participants = [{ id: P1 }]
    state.rows.event_companies = [{ id: C1, event_slug: SLUG }]
    expect((await POST(req({ action: 'move', participantId: P1, companyId: C1 }), ctx())).status).toBe(200)
    expect(queries('participants').at(-1)).toMatchObject({ op: 'update', payload: { company_id: C1, company_locked: true } })
    expect((await POST(req({ action: 'auto_assign' }), ctx())).status).toBe(200)
    expect(state.autoAssign).toHaveBeenCalledTimes(1)
  })

  it("offerings and merch: today's answers", async () => {
    state.rows.event_store_offerings = [{ id: 'o1', treatment: 'included', variant: { id: 'v', sku: 'S', label: 'M', product: { id: 'p', name: 'Tee' } } }]
    const res = await (await offerings()).GET(req(undefined, 'GET'), ctx())
    expect(await res.json()).toEqual({
      offerings: [{ id: 'o1', treatment: 'included', variantId: 'v', sku: 'S', label: 'M', productName: 'Tee' }],
      products: [],
    })
    expect(queries('event_store_offerings')[0].filters).toEqual([['eq', 'event_slug', SLUG]])
    const added = await (await offerings()).POST(req({ variantId: 'v', treatment: 'addon' }), ctx())
    expect(await added.json()).toEqual({ ok: true })
    expect(queries('event_store_offerings').at(-1)).toMatchObject({ op: 'insert', payload: { event_slug: SLUG, variant_id: 'v', treatment: 'addon' } })
    const removed = await (await offerings()).DELETE(req(undefined, 'DELETE', 'https://app.test/x?id=o1'), ctx())
    expect(await removed.json()).toEqual({ ok: true })
    expect(queries('event_store_offerings').at(-1)).toMatchObject({ op: 'delete', filters: [['eq', 'id', 'o1'], ['eq', 'event_slug', SLUG]] })

    expect(await (await (await merch()).GET(req(undefined, 'GET'), ctx())).json()).toEqual({ awaitingCount: 0, batch: null })
    state.rows.members = [{ id: 'mem-1', clerk_user_id: 'user_admin' }]
    const ship = { name: 'Venue', line1: '1 St', city: 'Reno', state: 'NV', postcode: '89501' }
    const committed = await (await merch()).POST(req({ shipTo: ship }), ctx())
    expect(await committed.json()).toEqual({ batchId: 'b', items: 1, podOrderId: null })
    expect(state.commitEventBatch).toHaveBeenCalledWith(expect.anything(), SLUG, ship, 'mem-1')
  })
})

describe("a tenant's admin", () => {
  beforeEach(() => {
    asTenantAdmin()
  })

  it('on their own event: companies answers from their own event, through today’s service path', async () => {
    state.rows.event_companies = [{ ...COMPANY, event_slug: 'own' }]
    const res = await (await companies()).GET(req(undefined, 'GET'), ctx('own'))
    expect(res.status).toBe(200)
    expect(queries('event_companies')[0].filters).toEqual([['eq', 'event_slug', 'own']])
    expect((await (await companies()).PUT(req({ count: 3 }, 'PUT'), ctx('own'))).status).toBe(200)
    expect((await (await companies()).POST(req({ action: 'rename', companyId: C1, name: 'X' }), ctx('own'))).status).toBe(200)
  })

  it('on their own event: Auto-Assign and the overrides are refused, with nothing read or written', async () => {
    const { POST } = await companies()
    for (const body of [{ action: 'auto_assign' }, { action: 'override_all' }, { action: 'override', participantId: P1, overridden: true }]) {
      state.queries = []
      const res = await POST(req(body), ctx('own'))
      expect(res.status, body.action).toBe(503)
      expect(queries('participants')).toEqual([])
      expect(queries('team_profiles')).toEqual([])
    }
    expect(state.autoAssign).not.toHaveBeenCalled()
    expect(state.overrideOutstanding).not.toHaveBeenCalled()
  })

  // Placing a student stays on the service path for a tenant's staff, so the only thing
  // confining the write is the participant-in-event check (AUTH-3) and the company check.
  it("on their own event: moving another event's participant, or into another event's company, writes nothing", async () => {
    const P2 = '44444444-4444-4444-8444-444444444444'
    const C2 = '55555555-5555-4555-8555-555555555555'
    state.rows.participants = [
      { id: P1, registrations: { event_slug: 'own' } },
      { id: P2, registrations: { event_slug: SLUG } },
    ]
    state.rows.event_companies = [
      { ...COMPANY, event_slug: 'own' },
      { ...COMPANY, id: C2, event_slug: SLUG },
    ]
    const { POST } = await companies()
    const writes = () => queries('participants').filter((q) => q.op !== 'select')

    // Stellr's participant, into the tenant's own company: refused before any write.
    let res = await POST(req({ action: 'move', participantId: P2, companyId: C1 }), ctx('own'))
    expect(res.status).toBe(404)
    // Released to unassigned (companyId null skips the company check): still refused.
    res = await POST(req({ action: 'move', participantId: P2, companyId: null }), ctx('own'))
    expect(res.status).toBe(404)
    // The tenant's own participant, into Stellr's company: refused.
    res = await POST(req({ action: 'move', participantId: P1, companyId: C2 }), ctx('own'))
    expect(res.status).toBe(400)
    expect(writes()).toEqual([])

    // Their own participant into their own company is written, keyed on that id.
    res = await POST(req({ action: 'move', participantId: P1, companyId: C1 }), ctx('own'))
    expect(res.status).toBe(200)
    expect(writes()).toEqual([expect.objectContaining({ op: 'update', payload: { company_id: C1, company_locked: true }, filters: [['eq', 'id', P1]] })])
  })

  it("on their own event: Stellr's store and merch batch are refused, with nothing read or written", async () => {
    const runs: [string, () => Promise<Response>][] = [
      ['offerings GET', async () => (await offerings()).GET(req(undefined, 'GET'), ctx('own'))],
      ['offerings POST', async () => (await offerings()).POST(req({ variantId: 'v', treatment: 'addon' }), ctx('own'))],
      ['offerings DELETE', async () => (await offerings()).DELETE(req(undefined, 'DELETE', 'https://app.test/x?id=o1'), ctx('own'))],
      ['merch GET', async () => (await merch()).GET(req(undefined, 'GET'), ctx('own'))],
      ['merch POST', async () => (await merch()).POST(req({ shipTo: { name: 'a', line1: 'b', city: 'c', state: 'd', postcode: 'e' } }), ctx('own'))],
    ]
    for (const [name, run] of runs) {
      state.queries = []
      const res = await run()
      expect(res.status, name).toBe(503)
      expect(await res.json()).toEqual({ error: "This isn't available for your organisation yet." })
      expect(queries('event_store_offerings'), name).toEqual([])
      expect(queries('store_products'), name).toEqual([])
    }
    expect(state.getEventBatchSummary).not.toHaveBeenCalled()
    expect(state.commitEventBatch).not.toHaveBeenCalled()
  })

  it("on Stellr's event: every route answers 404 before any configuration is read or written", async () => {
    state.rows.event_companies = [COMPANY]
    const runs: [string, () => Promise<Response>][] = [
      ['companies GET', async () => (await companies()).GET(req(undefined, 'GET'), ctx())],
      ['companies PUT', async () => (await companies()).PUT(req({ count: 1 }, 'PUT'), ctx())],
      ['companies rename', async () => (await companies()).POST(req({ action: 'rename', companyId: C1, name: 'X' }), ctx())],
      ['offerings GET', async () => (await offerings()).GET(req(undefined, 'GET'), ctx())],
      ['merch POST', async () => (await merch()).POST(req({ shipTo: {} }), ctx())],
    ]
    for (const [name, run] of runs) {
      state.queries = []
      expect((await run()).status, name).toBe(404)
      for (const t of ['event_companies', 'event_settings', 'participants', 'event_store_offerings']) expect(queries(t), `${name} ${t}`).toEqual([])
    }
  })
})

// Offerings and the merch batch act on Stellr's store and Printful account, so they check
// whose event it is, not only who is asking (refuseUnlessStellrEvent, as remind,
// docusign-reissue and the guardian route do). With LOADSCOPED_MODE off or shadow nothing
// else stops a Stellr admin on another tenant's event.
describe("Stellr's store routes on another tenant's event", () => {
  const STORE_RUNS: [string, () => Promise<Response>][] = [
    ['offerings GET', async () => (await offerings()).GET(req(undefined, 'GET'), ctx('own'))],
    ['offerings POST', async () => (await offerings()).POST(req({ variantId: 'v', treatment: 'addon' }), ctx('own'))],
    ['offerings DELETE', async () => (await offerings()).DELETE(req(undefined, 'DELETE', 'https://app.test/x?id=o1'), ctx('own'))],
    ['merch GET', async () => (await merch()).GET(req(undefined, 'GET'), ctx('own'))],
    ['merch POST', async () => (await merch()).POST(req({ shipTo: { name: 'a', line1: 'b', city: 'c', state: 'd', postcode: 'e' } }), ctx('own'))],
  ]
  const untouched = (name: string) => {
    expect(queries('event_store_offerings'), name).toEqual([])
    expect(queries('store_products'), name).toEqual([])
    expect(queries('members'), name).toEqual([])
    expect(state.getEventBatchSummary, name).not.toHaveBeenCalled()
    expect(state.commitEventBatch, name).not.toHaveBeenCalled()
  }

  describe.each(['', 'shadow', 'enforce'])('LOADSCOPED_MODE=%s', (mode) => {
    it.each(STORE_RUNS)("%s refuses a Stellr admin on a tenant's event, as a missing event, and touches nothing", async (name, run) => {
      vi.stubEnv('LOADSCOPED_MODE', mode)
      state.rows.events = [{ slug: 'own', tenant_id: TENANT }]
      const res = await run()
      expect(res.status, name).toBe(404)
      expect(await res.json()).toEqual({ error: 'Not found' })
      untouched(name)
    })
  })

  it.each(STORE_RUNS)('%s answers a retryable 503 when the owner read fails, and touches nothing', async (name, run) => {
    state.failEvents = true
    const res = await run()
    expect(res.status, name).toBe(503)
    expect(res.headers.get('Retry-After')).toBeTruthy()
    untouched(name)
  })

  it("on Stellr's own event, mirrored or not, both routes still answer, with every flag at its default", async () => {
    for (const events of [[{ slug: SLUG, tenant_id: STELLR_TENANT_ID }], []]) {
      state.rows.events = events
      expect((await (await offerings()).GET(req(undefined, 'GET'), ctx())).status).toBe(200)
      expect((await (await merch()).GET(req(undefined, 'GET'), ctx())).status).toBe(200)
    }
  })
})

describe('audit', () => {
  it('writes nothing with the flag off', async () => {
    expect((await (await companies()).PUT(req({ count: 2 }, 'PUT'), ctx())).status).toBe(200)
    await Promise.all(pending)
    expect(state.audits).toEqual([])
  })

  it('on, a change writes one event naming the actor, the chain, the event and the count', async () => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
    expect((await (await companies()).PUT(req({ count: 2 }, 'PUT'), ctx())).status).toBe(200)
    await Promise.all(pending)
    expect(state.audits).toHaveLength(1)
    expect(state.audits[0]).toMatchObject({
      tenantId: STELLR_TENANT_ID,
      actor: 'user_admin',
      action: 'event_company.count.set',
      metadata: expect.objectContaining({ event_slug: SLUG, count: 2 }),
    })
  })

  it("on, a tenant's change goes on the tenant's chain", async () => {
    asTenantAdmin()
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
    expect((await (await companies()).POST(req({ action: 'rename', companyId: C1, name: 'X' }), ctx('own'))).status).toBe(200)
    await Promise.all(pending)
    expect(state.audits).toHaveLength(1)
    expect(state.audits[0]).toMatchObject({ tenantId: TENANT, action: 'event_company.placement.change', metadata: expect.objectContaining({ op: 'rename' }) })
  })

  it('on, a refusal writes none', async () => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
    asEventManager('texas')
    expect((await (await offerings()).POST(req({ variantId: 'v', treatment: 'addon' }), ctx())).status).toBe(403)
    await Promise.all(pending)
    expect(state.audits).toEqual([])
  })
})
