// @vitest-environment node
import { Webhook } from 'svix'
import { afterEach, describe, expect, it, vi } from 'vitest'

// deep review TEST-1: the Clerk webhook provisions, updates and soft-deletes
// member records off svix-signed events. Pin fail-closed: no secret → 500,
// missing/invalid svix signature → 400 with nothing written, and a correctly
// signed event gets past the gate. CLERK_WEBHOOK_SECRET is read per request.

const from = vi.fn()
const syncRole = vi.fn()

vi.mock('next/headers', () => ({ headers: async () => ({ get: (k: string) => hdrs.get(k) ?? null }) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from }) }))
// Downstream helpers are irrelevant to the signature gate; a benign event type
// never reaches them anyway.
vi.mock('@/lib/member-enums', () => ({ normalizeEmail: (e: string) => e }))
vi.mock('@/lib/spaces', () => ({ claimPendingSpaceInvites: vi.fn(async () => {}) }))
vi.mock('@/lib/member-roles', () => ({ syncMemberClassificationRole: (...a: unknown[]) => syncRole(...a) }))
vi.mock('@/lib/esign/retention', () => ({ startRetentionClock: vi.fn() }))

const hdrs = new Map<string, string>()
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
// An event type the handler does not act on: a verified request returns
// { received: true } without touching the DB, which isolates the signature gate.
const body = JSON.stringify({ type: 'session.created', data: { id: 'u_1' } })

async function load(secret: string) {
  vi.resetModules()
  vi.stubEnv('CLERK_WEBHOOK_SECRET', secret)
  return import('./route')
}

function sign(secret: string, payload = body) {
  const id = 'msg_1'
  const timestamp = new Date()
  const signature = new Webhook(secret).sign(id, timestamp, payload)
  hdrs.set('svix-id', id)
  hdrs.set('svix-timestamp', Math.floor(timestamp.getTime() / 1000).toString())
  hdrs.set('svix-signature', signature)
}

const post = (POST: (r: Request) => Promise<Response>, payload = body) =>
  POST(new Request('https://app.test/api/webhooks/clerk', { method: 'POST', body: payload }))

afterEach(() => {
  hdrs.clear()
  from.mockReset()
  syncRole.mockReset()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('POST /api/webhooks/clerk', () => {
  it('fails closed (500) when CLERK_WEBHOOK_SECRET is unset, writing nothing', async () => {
    const { POST } = await load('')
    sign(SECRET)
    expect((await post(POST)).status).toBe(500)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects a request with no svix headers', async () => {
    const { POST } = await load(SECRET)
    expect((await post(POST)).status).toBe(400)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects a signature made with another secret and writes nothing', async () => {
    const { POST } = await load(SECRET)
    sign('whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') // valid svix secret, wrong value
    expect((await post(POST)).status).toBe(400)
    expect(from).not.toHaveBeenCalled()
  })

  it('accepts a correctly signed event (past the gate)', async () => {
    const { POST } = await load(SECRET)
    sign(SECRET)
    expect((await post(POST)).status).toBe(200)
  })
})

// S0 (2 Nov 2026): user.created links a Clerk user to a member row only through
// a verified primary email, and never takes a row another login already holds.
describe('POST /api/webhooks/clerk — user.created linking', () => {
  type Op = { table: string; op: string; payload?: unknown; filters: Array<[string, string, unknown]> }
  let ops: Op[]
  let existingMember: Record<string, unknown> | null

  function fakeDb() {
    ops = []
    from.mockImplementation((table: string) => {
      const o: Op = { table, op: 'select', filters: [] }
      ops.push(o)
      const chain: Record<string, unknown> = {
        select: () => chain,
        insert: (p: unknown) => { o.op = 'insert'; o.payload = p; return chain },
        update: (p: unknown) => { o.op = 'update'; o.payload = p; return chain },
        eq: (c: string, v: unknown) => { o.filters.push(['eq', c, v]); return chain },
        is: (c: string, v: unknown) => { o.filters.push(['is', c, v]); return chain },
        maybeSingle: async () => ({ data: o.op === 'insert' ? { id: 'm-new' } : existingMember, error: null }),
        then: (f: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(f),
      }
      return chain
    })
  }

  const created = (status: string | null) => JSON.stringify({
    type: 'user.created',
    data: {
      id: 'user_new', first_name: 'Kim', last_name: 'Lo', image_url: null,
      primary_email_address_id: 'e1',
      email_addresses: [{ id: 'e1', email_address: 'kim@example.com', verification: status ? { status } : null }],
    },
  })

  async function deliver(payload: string) {
    const { POST } = await load(SECRET)
    sign(SECRET, payload)
    const res = await post(POST, payload)
    return { status: res.status, json: await res.json() }
  }

  const writes = () => ops.filter((o) => o.op !== 'select')

  it('an unverified primary email links nothing and creates nothing', async () => {
    fakeDb()
    existingMember = { id: 'm-child', event_role: 'participant', clerk_user_id: null }
    for (const status of ['unverified', null]) {
      const r = await deliver(created(status))
      expect(r).toEqual({ status: 200, json: { received: true, skipped: 'email not verified' } })
    }
    expect(writes()).toEqual([])
    expect(syncRole).not.toHaveBeenCalled()
  })

  it('a verified email links an unlinked member, guarded so a link made meanwhile is not overwritten', async () => {
    fakeDb()
    existingMember = { id: 'm-1', event_role: 'teacher', clerk_user_id: null }
    const r = await deliver(created('verified'))
    expect(r.status).toBe(200)
    expect(writes()).toEqual([{
      table: 'members', op: 'update',
      payload: { clerk_user_id: 'user_new', profile_photo_url: null },
      filters: [['eq', 'id', 'm-1'], ['is', 'clerk_user_id', null]],
    }])
    expect(syncRole).toHaveBeenCalledWith(expect.anything(), 'm-1', 'teacher')
  })

  it('never moves a member already linked to another login', async () => {
    fakeDb()
    existingMember = { id: 'm-1', event_role: 'teacher', clerk_user_id: 'user_owner' }
    const r = await deliver(created('verified'))
    expect(r).toEqual({ status: 200, json: { received: true, skipped: 'member already linked' } })
    expect(writes()).toEqual([])
    expect(syncRole).not.toHaveBeenCalled()
  })

  it('leaves a member already linked to this same login as it is (registration linked it first)', async () => {
    fakeDb()
    existingMember = { id: 'm-1', event_role: 'participant', clerk_user_id: 'user_new' }
    const r = await deliver(created('verified'))
    expect(r.json).toEqual({ received: true })
    expect(writes()).toEqual([])
    expect(syncRole).toHaveBeenCalledWith(expect.anything(), 'm-1', 'participant')
  })

  it('a verified email with no member on file still gets a new member row', async () => {
    fakeDb()
    existingMember = null
    const r = await deliver(created('verified'))
    expect(r.json).toEqual({ received: true })
    expect(writes()).toEqual([expect.objectContaining({
      table: 'members', op: 'insert',
      payload: expect.objectContaining({ clerk_user_id: 'user_new', email: 'kim@example.com' }),
    })])
  })
})
