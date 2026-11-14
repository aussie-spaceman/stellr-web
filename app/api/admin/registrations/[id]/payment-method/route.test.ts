// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// Staff changing how a group pays: admins, and event managers assigned to that event,
// reading and changing alike. (The invoice route beside this one lets event managers
// only read.) This drives the real handler under real lib/authz and loadScoped with
// today's settings unless a test says otherwise; Clerk, the database, Stripe and the
// billing helpers are stand-ins. The database records each query, because "LOADSCOPED_MODE
// off keeps today's read" is a claim about the query, not only the answer.

const ID = '22222222-2222-4222-8222-222222222222'
const OTHER_TENANT = '11111111-1111-4111-8111-111111111111'

type Row = Record<string, unknown>
interface Query {
  table: string
  op: string
  select?: string
  filters: [string, string, unknown][]
}

const h = vi.hoisted(() => ({
  session: {} as Record<string, unknown>,
  assigned: [] as string[],
  registration: null as Record<string, unknown> | null,
  // The events mirror: slug → owning tenant. A slug it lacks reads as Stellr's.
  events: {} as Record<string, string | null>,
  eventsDown: false,
  authzThrows: false,
  queries: [] as unknown[],
  audits: [] as unknown[],
  change: vi.fn(),
  view: vi.fn(),
  log: vi.fn(),
  stripe: vi.fn(() => ({})),
}))

function fakeDb() {
  const from = (table: string) => {
    const q: Query = { table, op: 'select', filters: [] }
    h.queries.push(q)
    const passes = (row: Row) =>
      q.filters.every(([kind, col]) => {
        // The only `or` loadScoped adds here is the Stellr-or-NULL tenant filter.
        if (kind === 'or') return row.tenant_id == null || row.tenant_id === STELLR_TENANT_ID
        return col === 'id' || !(col in row) || row[col] === q.filters.find((f) => f[1] === col)?.[2]
      })
    const answer = (): Row[] => {
      if (table === 'event_manager_assignments') {
        return h.assigned.map((event_slug) => ({ clerk_user_id: h.session.userId, event_slug, tenant_id: null }))
      }
      if (table === 'registrations' && h.registration) return [h.registration].filter(passes)
      if (table === 'events') {
        const slug = q.filters.find((f) => f[1] === 'slug')?.[2] as string
        return slug in h.events ? [{ slug, tenant_id: h.events[slug] }] : []
      }
      return []
    }
    const chain: Record<string, unknown> = {}
    chain.select = (cols?: string) => {
      if (cols) q.select = cols
      return chain
    }
    chain.eq = (col: string, value: unknown) => {
      q.filters.push(['eq', col, value])
      return chain
    }
    chain.or = (expr: string) => {
      q.filters.push(['or', expr, null])
      return chain
    }
    for (const m of ['in', 'order', 'limit', 'is', 'not']) chain[m] = () => chain
    // As Postgres does: an id the uuid column cannot hold is an error (22P02), not a miss.
    const badId = () => q.filters.some(([kind, col, v]) => kind === 'eq' && col === 'id' && !/^[0-9a-f-]{36}$/i.test(String(v)))
    chain.maybeSingle = async () =>
      table === 'events' && h.eventsDown
        ? { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
        : badId() ? { data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } } : { data: answer()[0] ?? null, error: null }
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: answer(), error: null })
    return chain
  }
  return { from, rpc: async () => ({ data: null, error: null }) }
}

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => {
    if (h.authzThrows) throw new Error('clerk unavailable')
    return h.session
  },
  currentUser: async () => null,
  clerkClient: async () => ({ users: { getUserList: async () => ({ data: [] }) } }),
}))
vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  supabaseServer: () => fakeDb(),
}))
vi.mock('@/lib/stripe', () => ({ stripeClient: h.stripe }))
vi.mock('@/lib/activity-log', () => ({ actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: 'm-admin' }), logActivity: h.log }))
vi.mock('@/lib/group-payment-change', () => ({
  changeGroupPaymentMethod: h.change,
  paymentChangeView: h.view,
  PAYMENT_METHOD_LABEL: { invoice: 'Invoice', card: 'Card', individual: 'Individual' },
}))
vi.mock('@/lib/audit/platform', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  audit: async (input: unknown) => {
    h.audits.push(input)
    return { ok: true, id: 1, seq: 1 }
  },
}))
let pending: Promise<unknown>[] = []
vi.mock('@/lib/after-response', () => ({
  runAfterResponse: (_label: string, task: () => Promise<unknown>) => {
    pending.push(task())
  },
}))

import { GET, POST } from './route'

const ctx = (id = ID) => ({ params: Promise.resolve({ id }) })
const url = `https://app.test/api/admin/registrations/${ID}/payment-method`
const get = (id = ID) => GET(new Request(url), ctx(id))
const post = (body: unknown = { method: 'individual' }, id = ID) =>
  POST(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), ctx(id))
const queries = (table: string) => (h.queries as Query[]).filter((q) => q.table === table)
const flush = async () => {
  await Promise.all(pending.splice(0))
}

const asAdmin = () => {
  h.session = { userId: 'user_admin', sessionClaims: { metadata: { role: 'admin' } } }
  h.assigned = []
}
const asEventManager = (...slugs: string[]) => {
  h.session = { userId: 'user_em', sessionClaims: { metadata: { role: 'event_manager' } } }
  h.assigned = slugs
}

const GROUP = { event_slug: 'msu', type: 'group', teacher_member_id: 'm-t', tenant_id: STELLR_TENANT_ID }

beforeEach(() => {
  vi.clearAllMocks()
  asAdmin()
  h.registration = { ...GROUP }
  h.events = {}
  h.eventsDown = false
  h.authzThrows = false
  h.queries = []
  h.audits = []
  pending = []
  h.change.mockResolvedValue({ ok: true, method: 'individual', message: 'Done.', payUrl: null })
  h.view.mockResolvedValue({ current: 'invoice', currentLabel: 'Invoice', blockedReason: null, options: [] })
  vi.stubEnv('LOADSCOPED_MODE', '')
  vi.stubEnv('AUTHZ_SOURCE', '')
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('/api/admin/registrations/[id]/payment-method', () => {
  it('lets an admin change it, and logs it against the organizer', async () => {
    expect((await post()).status).toBe(200)
    expect(h.change).toHaveBeenCalledWith(expect.anything(), expect.anything(), ID, { method: 'individual' }, expect.objectContaining({ by: 'crew' }))
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'm-t', action: 'group_payment_method_changed' }), expect.anything())
  })

  it('lets an admin read the choices', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ current: 'invoice', currentLabel: 'Invoice', blockedReason: null, options: [] })
  })

  it('lets an event manager assigned to the event read and change it', async () => {
    asEventManager('msu')
    expect((await get()).status).toBe(200)
    expect((await post()).status).toBe(200)
    expect(h.change).toHaveBeenCalledTimes(1)
  })

  it('refuses an event manager on another event, reading or writing, as if the group were missing', async () => {
    asEventManager('other')
    const refusedPost = await post()
    const refusedGet = await get()
    expect(refusedPost.status).toBe(404)
    expect(refusedGet.status).toBe(404)
    expect(h.change).not.toHaveBeenCalled()
    expect(h.view).not.toHaveBeenCalled()
    h.registration = null
    expect(await refusedPost.text()).toBe(await (await post()).text())
    expect(await refusedGet.text()).toBe(await (await get()).text())
  })

  it('refuses an event manager with no events', async () => {
    asEventManager()
    expect((await post()).status).toBe(404)
    expect(h.change).not.toHaveBeenCalled()
  })

  it('refuses someone without event access before any read', async () => {
    h.session = { userId: 'user_student', sessionClaims: { metadata: { role: 'student' } } }
    expect((await post()).status).toBe(403)
    expect((await get()).status).toBe(403)
    h.session = { userId: null, sessionClaims: null }
    expect((await post()).status).toBe(401)
    expect(queries('registrations')).toEqual([])
    expect(h.change).not.toHaveBeenCalled()
  })

  it('is for group registrations only', async () => {
    h.registration = { ...GROUP, type: 'individual' }
    expect((await post()).status).toBe(404)
    expect((await get()).status).toBe(404)
    expect(h.change).not.toHaveBeenCalled()
  })

  it('answers a malformed id as a missing group', async () => {
    const res = await post(undefined, 'not-a-uuid')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Group registration not found' })
  })

  it('passes on a refusal without logging', async () => {
    h.change.mockResolvedValue({ ok: false, status: 409, error: 'Paid.' })
    expect((await post()).status).toBe(409)
    expect(h.log).not.toHaveBeenCalled()
  })

  it('asks for a method before going to Stripe', async () => {
    expect((await post({ method: 'cash' })).status).toBe(400)
    expect(h.stripe).not.toHaveBeenCalled()
  })

  it('passes "Invoice for some" through whole, for an admin and for an assigned event manager', async () => {
    const body = { method: 'invoice_some', invoiceParticipantIds: [OTHER_TENANT, ID], lateJoinerPayer: 'self' }
    expect((await post(body)).status).toBe(200)
    asEventManager('msu')
    expect((await post(body)).status).toBe(200)
    expect(h.change).toHaveBeenCalledTimes(2)
    for (const call of h.change.mock.calls) expect(call[3]).toEqual(body)
  })

  it('passes the other methods through as given', async () => {
    for (const body of [{ method: 'invoice' }, { method: 'card' }, { method: 'individual' }, { method: 'teacher_share', shareEstimate: 12 }]) {
      h.change.mockClear()
      expect((await post(body)).status).toBe(200)
      expect(h.change).toHaveBeenCalledWith(expect.anything(), expect.anything(), ID, body, expect.objectContaining({ by: 'crew' }))
    }
  })

  it('answers an incomplete body with what is missing', async () => {
    const some = await post({ method: 'invoice_some', invoiceParticipantIds: [ID] })
    expect(some.status).toBe(400)
    expect(await some.json()).toEqual({ error: 'Tick who goes on the invoice, and say how people who join later pay.' })
    const share = await post({ method: 'teacher_share' })
    expect(share.status).toBe(400)
    expect(await share.json()).toEqual({ error: 'Say how many students you expect to bring.' })
    expect(h.stripe).not.toHaveBeenCalled()
    expect(h.change).not.toHaveBeenCalled()
  })

  it('answers a group the view cannot find as a missing one', async () => {
    h.view.mockResolvedValue(null)
    const res = await get()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Group registration not found' })
  })

  it('says so when Stripe is not configured, and changes nothing', async () => {
    h.stripe.mockReturnValueOnce(null as unknown as object)
    const res = await post()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Stripe is not configured here' })
    expect(h.change).not.toHaveBeenCalled()
    expect(h.log).not.toHaveBeenCalled()
  })
})

describe('with LOADSCOPED_MODE unset', () => {
  it('reads the registration by id alone, as before, for an admin and for an event manager', async () => {
    await get()
    asEventManager('msu')
    await post()
    const reads = queries('registrations')
    expect(reads).toHaveLength(2)
    for (const read of reads) {
      expect(read.filters).toEqual([['eq', 'id', ID]])
      expect(read.select).toBe('event_slug, type, teacher_member_id, tenant_id')
    }
  })

  it('a group stamped with another tenant answers as a missing one and is not changed', async () => {
    h.registration = { ...GROUP, tenant_id: OTHER_TENANT }
    const foreign = await post()
    expect(foreign.status).toBe(404)
    expect(h.change).not.toHaveBeenCalled()
    expect(h.stripe).not.toHaveBeenCalled()
    h.registration = null
    expect(await foreign.text()).toBe(await (await post()).text())
  })

  it('a group stamped with another tenant answers to a read as a missing one too', async () => {
    h.registration = { ...GROUP, tenant_id: OTHER_TENANT }
    const foreign = await get()
    expect(foreign.status).toBe(404)
    expect(h.view).not.toHaveBeenCalled()
    h.registration = null
    expect(await foreign.text()).toBe(await (await get()).text())
  })

  it('a group the backfill has not stamped is Stellr\'s', async () => {
    h.registration = { ...GROUP, tenant_id: null }
    expect((await post()).status).toBe(200)
  })

  it('reads the event\'s tenant from the mirror, for an admin and for an event manager', async () => {
    h.events = { msu: STELLR_TENANT_ID }
    expect((await get()).status).toBe(200)
    asEventManager('msu')
    expect((await post()).status).toBe(200)
    const reads = queries('events')
    expect(reads).toHaveLength(2)
    for (const read of reads) expect(read.filters).toEqual([['eq', 'slug', 'msu']])
  })

  it('a group whose event the mirror places in another tenant answers as a missing one, stamped or not', async () => {
    h.events = { msu: OTHER_TENANT }
    for (const tenant_id of [null, STELLR_TENANT_ID]) {
      h.registration = { ...GROUP, tenant_id }
      const read = await get()
      const change = await post()
      expect(read.status).toBe(404)
      expect(change.status).toBe(404)
      h.registration = null
      expect(await read.text()).toBe(await (await get()).text())
      expect(await change.text()).toBe(await (await post()).text())
    }
    expect(h.view).not.toHaveBeenCalled()
    expect(h.change).not.toHaveBeenCalled()
    expect(h.stripe).not.toHaveBeenCalled()
  })

  it('a failed read of the event refuses rather than passes', async () => {
    h.eventsDown = true
    expect((await get()).status).toBe(404)
    expect((await post()).status).toBe(404)
    expect(h.view).not.toHaveBeenCalled()
    expect(h.change).not.toHaveBeenCalled()
  })
})

describe('under LOADSCOPED_MODE=enforce', () => {
  beforeEach(() => {
    vi.stubEnv('LOADSCOPED_MODE', 'enforce')
  })

  it('the read carries the Stellr-or-NULL tenant filter', async () => {
    h.registration = { ...GROUP, tenant_id: null }
    expect((await get()).status).toBe(200)
    expect(queries('registrations')[0].filters).toContainEqual(['or', `tenant_id.eq.${STELLR_TENANT_ID},tenant_id.is.null`, null])
  })

  it('another tenant\'s group answers exactly as a missing one', async () => {
    h.registration = { ...GROUP, tenant_id: OTHER_TENANT }
    const foreign = await get()
    expect(foreign.status).toBe(404)
    h.registration = null
    expect(await foreign.text()).toBe(await (await get()).text())
  })
})

describe('audit, with PLATFORM_AUDIT_ENABLED=true', () => {
  beforeEach(() => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
  })

  it('a change records who, on Stellr\'s chain, which group and which method', async () => {
    expect((await post()).status).toBe(200)
    await flush()
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0]).toMatchObject({
      action: 'registration.payment_method.change',
      tenantId: STELLR_TENANT_ID,
      target: { table: 'registrations', id: ID },
      metadata: { eventSlug: 'msu', method: 'individual' },
    })
  })

  it('"Invoice for some" records how many are on the invoice, not who', async () => {
    expect((await post({ method: 'invoice_some', invoiceParticipantIds: [OTHER_TENANT, ID], lateJoinerPayer: 'group' })).status).toBe(200)
    await flush()
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0]).toMatchObject({ metadata: { eventSlug: 'msu', method: 'invoice_some', invoiceParticipantCount: 2 } })
    expect(JSON.stringify(h.audits[0])).not.toContain(OTHER_TENANT)
  })

  it('a read records an event too', async () => {
    expect((await get()).status).toBe(200)
    await flush()
    expect(h.audits).toMatchObject([{ action: 'registration.payment_method.read', target: { table: 'registrations', id: ID } }])
  })

  it('a failure before the staff check still names the row, and marks its chain unresolved', async () => {
    h.authzThrows = true
    await expect(post()).rejects.toThrow()
    await flush()
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0]).toMatchObject({
      action: 'registration.payment_method.change',
      tenantId: null,
      target: { table: 'registrations', id: ID },
      metadata: { tenant_unresolved: true },
    })
  })

  it('a refusal records nothing', async () => {
    asEventManager('other')
    expect((await post()).status).toBe(404)
    await flush()
    expect(h.audits).toEqual([])
  })
})
