// @vitest-environment node
import { Webhook } from 'svix'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appToday } from '@/lib/age'

// deep review TEST-1: the Clerk webhook provisions, updates and soft-deletes
// member records off svix-signed events. Pin fail-closed: no secret → 500,
// missing/invalid svix signature → 400 with nothing written, and a correctly
// signed event gets past the gate. CLERK_WEBHOOK_SECRET is read per request.

const from = vi.fn()
const syncRole = vi.fn()
const claimInvites = vi.fn(async (..._a: unknown[]) => {})
const logActivity = vi.fn(async (..._a: unknown[]) => {})
const startRetentionClock = vi.fn(async (..._a: unknown[]) => {})

vi.mock('next/headers', () => ({ headers: async () => ({ get: (k: string) => hdrs.get(k) ?? null }) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from }) }))
// Downstream helpers are irrelevant to the signature gate; a benign event type
// never reaches them anyway.
vi.mock('@/lib/member-enums', () => ({ normalizeEmail: (e: string) => e }))
vi.mock('@/lib/spaces', () => ({ claimPendingSpaceInvites: (...a: unknown[]) => claimInvites(...a) }))
vi.mock('@/lib/member-roles', () => ({ syncMemberClassificationRole: (...a: unknown[]) => syncRole(...a) }))
vi.mock('@/lib/esign/retention', () => ({ startRetentionClock: (...a: unknown[]) => startRetentionClock(...a) }))
vi.mock('@/lib/activity-log', () => ({ logActivity: (...a: unknown[]) => logActivity(...a) }))

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
  claimInvites.mockClear()
  logActivity.mockClear()
  startRetentionClock.mockClear()
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
// a verified primary email, never takes a row another login already holds, and
// never hands a child under 13 (or a member of unknown age) to a self-serve
// login before a parent or guardian has signed.
describe('POST /api/webhooks/clerk — user.created linking', () => {
  type Op = { table: string; op: string; payload?: unknown; filters: Array<[string, string, unknown]> }
  let ops: Op[]
  let existingMember: Record<string, unknown> | null
  let participants: Array<{ id: string; date_of_birth: string | null }>
  /** Completed agreements on file, by envelope_type. */
  let agreements: string[]

  /** `linkHits: false` is a link landing between the read and the conditional write. */
  function fakeDb(linkHits = true) {
    ops = []
    participants = []
    agreements = []
    from.mockImplementation((table: string) => {
      const o: Op = { table, op: 'select', filters: [] }
      ops.push(o)
      const chain: Record<string, unknown> = {
        select: () => chain,
        insert: (p: unknown) => { o.op = 'insert'; o.payload = p; return chain },
        update: (p: unknown) => { o.op = 'update'; o.payload = p; return chain },
        eq: (c: string, v: unknown) => { o.filters.push(['eq', c, v]); return chain },
        is: (c: string, v: unknown) => { o.filters.push(['is', c, v]); return chain },
        or: (s: string) => { o.filters.push(['or', s, null]); return chain },
        maybeSingle: async () => ({ data: o.op === 'insert' ? { id: 'm-new' } : existingMember, error: null }),
        // `.update(...).select('id')` returns the rows the conditional write hit.
        then: (f: (v: unknown) => unknown) => {
          if (table === 'participants') return Promise.resolve({ data: participants, error: null }).then(f)
          if (table === 'agreements') {
            const type = o.filters.find(([k, c]) => k === 'eq' && c === 'envelope_type')?.[2]
            return Promise.resolve({ count: agreements.filter((t) => !type || t === type).length, error: null }).then(f)
          }
          return Promise.resolve({
            data: o.op === 'update' ? (linkHits ? [{ id: existingMember?.id }] : []) : null,
            error: null,
          }).then(f)
        },
      }
      return chain
    })
  }

  /** A date of birth `n` years before the app's today (Mountain time), less `extraDays`. */
  const yearsAgo = (n: number, extraDays = 0) => {
    const d = appToday()
    d.setUTCFullYear(d.getUTCFullYear() - n)
    d.setUTCDate(d.getUTCDate() - extraDays)
    return d.toISOString().slice(0, 10)
  }
  const ADULT_DOB = '1985-04-02'

  /** `status` undefined leaves the address with no verification record at all. */
  const created = (status?: string | null) => JSON.stringify({
    type: 'user.created',
    data: {
      id: 'user_new', first_name: 'Kim', last_name: 'Lo', image_url: null,
      primary_email_address_id: 'e1',
      email_addresses: [{
        id: 'e1', email_address: 'kim@example.com',
        ...(status === undefined ? {} : { verification: status ? { status } : null }),
      }],
    },
  })

  async function deliver(payload: string) {
    const { POST } = await load(SECRET)
    sign(SECRET, payload)
    const res = await post(POST, payload)
    return { status: res.status, json: await res.json() }
  }

  const writes = () => ops.filter((o) => o.op !== 'select')
  const linkWrite = (memberId: string) => ({
    table: 'members', op: 'update',
    payload: { clerk_user_id: 'user_new', profile_photo_url: null },
    filters: [['eq', 'id', memberId], ['is', 'clerk_user_id', null]],
  })

  it('an unverified primary email links nothing and creates nothing', async () => {
    fakeDb()
    existingMember = { id: 'm-child', event_role: 'participant', clerk_user_id: null }
    for (const status of ['unverified', null, undefined]) {
      const r = await deliver(created(status))
      expect(r).toEqual({ status: 200, json: { received: true, skipped: 'email not verified' } })
    }
    expect(writes()).toEqual([])
    expect(syncRole).not.toHaveBeenCalled()
    expect(claimInvites).not.toHaveBeenCalled()
  })

  it('an unverified email with no member on file creates no member row either', async () => {
    fakeDb()
    existingMember = null
    expect((await deliver(created('unverified'))).json).toEqual({ received: true, skipped: 'email not verified' })
    expect(writes()).toEqual([])
  })

  it('a verified email links an unlinked member, guarded so a link made meanwhile is not overwritten', async () => {
    fakeDb()
    existingMember = { id: 'm-1', event_role: 'teacher', clerk_user_id: null, date_of_birth: ADULT_DOB }
    const r = await deliver(created('verified'))
    expect(r.status).toBe(200)
    expect(writes()).toEqual([linkWrite('m-1')])
    expect(syncRole).toHaveBeenCalledWith(expect.anything(), 'm-1', 'teacher')
    expect(claimInvites).toHaveBeenCalledWith('m-1', 'kim@example.com')
  })

  it('a verified self-serve sign-up is not linked to a child under 13 with no guardian agreement', async () => {
    // The individual form refused this child a login; signing up through Clerk
    // with the same address must not hand them the record anyway.
    fakeDb()
    existingMember = { id: 'm-kid', event_role: 'participant', clerk_user_id: null, date_of_birth: yearsAgo(12) }
    participants = [{ id: 'p-kid', date_of_birth: yearsAgo(12) }]
    const r = await deliver(created('verified'))
    expect(r).toEqual({ status: 200, json: { received: true, skipped: 'guardian consent required' } })
    expect(writes()).toEqual([])
    expect(syncRole).not.toHaveBeenCalled()
    expect(claimInvites).not.toHaveBeenCalled()
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'm-kid', action: 'account_link_held_for_consent' }),
      expect.anything(),
    )
  })

  it('judges age on the date of birth: 12 waits, 13 and 14 are linked', async () => {
    for (const [years, extraDays, linked] of [[13, -1, false], [13, 0, true], [14, 0, true]] as const) {
      fakeDb()
      existingMember = { id: 'm-1', event_role: 'participant', clerk_user_id: null, date_of_birth: yearsAgo(years, extraDays) }
      await deliver(created('verified'))
      expect(writes(), `${years}y ${extraDays}d`).toEqual(linked ? [linkWrite('m-1')] : [])
    }
  })

  it('a member with no usable date of birth anywhere waits, as if under 13', async () => {
    for (const date_of_birth of [null, '', 'not a date', '2999-01-01']) {
      fakeDb()
      existingMember = { id: 'm-1', event_role: 'teacher', clerk_user_id: null, date_of_birth }
      participants = [{ id: 'p1', date_of_birth: null }]
      const r = await deliver(created('verified'))
      expect(r.json, String(date_of_birth)).toEqual({ received: true, skipped: 'guardian consent required' })
      expect(writes()).toEqual([])
    }
    expect(syncRole).not.toHaveBeenCalled()
  })

  it('reads a blank member date of birth from the participant rows (an adult is linked)', async () => {
    fakeDb()
    existingMember = { id: 'm-1', event_role: 'teacher', clerk_user_id: null, date_of_birth: null }
    participants = [{ id: 'p1', date_of_birth: ADULT_DOB }]
    await deliver(created('verified'))
    expect(writes()).toEqual([linkWrite('m-1')])
  })

  it("links a child under 13 once a guardian's consent form is signed — and only that kind of agreement counts", async () => {
    fakeDb()
    existingMember = { id: 'm-kid', event_role: 'participant', clerk_user_id: null, date_of_birth: yearsAgo(12) }
    participants = [{ id: 'p-kid', date_of_birth: yearsAgo(12) }]
    agreements = ['adult', 'mentor']
    expect((await deliver(created('verified'))).json).toEqual({ received: true, skipped: 'guardian consent required' })
    expect(writes()).toEqual([])

    fakeDb()
    participants = [{ id: 'p-kid', date_of_birth: yearsAgo(12) }]
    agreements = ['minor']
    expect((await deliver(created('verified'))).json).toEqual({ received: true })
    expect(writes()).toEqual([linkWrite('m-kid')])
    expect(syncRole).toHaveBeenCalledWith(expect.anything(), 'm-kid', 'participant')
  })

  it('backs off when another login links the row between the read and the write', async () => {
    fakeDb(false)
    existingMember = { id: 'm-1', event_role: 'teacher', clerk_user_id: null, date_of_birth: ADULT_DOB }
    const r = await deliver(created('verified'))
    expect(r).toEqual({ status: 200, json: { received: true, skipped: 'member already linked' } })
    expect(syncRole).not.toHaveBeenCalled()
    expect(claimInvites).not.toHaveBeenCalled()
  })

  it('never moves a member already linked to another login', async () => {
    fakeDb()
    existingMember = { id: 'm-1', event_role: 'teacher', clerk_user_id: 'user_owner' }
    const r = await deliver(created('verified'))
    expect(r).toEqual({ status: 200, json: { received: true, skipped: 'member already linked' } })
    expect(writes()).toEqual([])
    expect(syncRole).not.toHaveBeenCalled()
    expect(claimInvites).not.toHaveBeenCalled()
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
    expect(syncRole).toHaveBeenCalledWith(expect.anything(), 'm-new', 'subscriber')
  })

  // COPPA data minimisation (review, 3 Nov 2026): the person signing up may be
  // a child, and nobody has asked their age yet.
  it('a self sign-up row keeps only the login link: no name, no photo, no age bracket', async () => {
    fakeDb()
    existingMember = null
    const payload = JSON.parse(created('verified'))
    payload.data.image_url = 'https://img.clerk.test/kim.png'
    await deliver(JSON.stringify(payload))
    expect(writes()).toEqual([{
      table: 'members', op: 'insert', filters: [],
      payload: {
        clerk_user_id: 'user_new', email: 'kim@example.com',
        first_name: '', last_name: '', profile_photo_url: null, age_bracket: null,
        event_role: 'subscriber', is_active: true,
      },
    }])
  })

  const updated = (over: Record<string, unknown> = {}) => JSON.stringify({
    type: 'user.updated',
    data: {
      id: 'user_new', first_name: 'Kim', last_name: 'Lo', image_url: 'https://img.clerk.test/kim.png',
      primary_email_address_id: 'e1',
      email_addresses: [{ id: 'e1', email_address: 'kim@example.com' }],
      ...over,
    },
  })

  it('user.updated copies the name and photo only for a member whose date of birth says 13 or over', async () => {
    fakeDb()
    existingMember = { id: 'm-1', date_of_birth: ADULT_DOB }
    await deliver(updated())
    expect(writes()).toEqual([expect.objectContaining({
      table: 'members', op: 'update',
      payload: { email: 'kim@example.com', first_name: 'Kim', last_name: 'Lo', profile_photo_url: 'https://img.clerk.test/kim.png' },
    })])
  })

  it('user.updated keeps a sign-up with no date of birth yet, and a child, to the email alone', async () => {
    for (const date_of_birth of [null, yearsAgo(12), 'not a date']) {
      fakeDb()
      existingMember = { id: 'm-1', date_of_birth }
      await deliver(updated())
      expect(writes(), String(date_of_birth)).toEqual([expect.objectContaining({
        table: 'members', op: 'update', payload: { email: 'kim@example.com' },
      })])
    }
  })
})

// Owner decision 13 Nov 2026 (tracker attendee-email-cohort.4): event staff
// check-ins leave with the account. user.deleted removes the login's
// event-manager check-ins (m.<Clerk id>, member_id null, which nothing else
// would remove) and the check-ins of the member it deactivates (the soft delete
// keeps the members row, so the FK cascade never fires). Nobody else's go.
describe('POST /api/webhooks/clerk — user.deleted removes event crew check-ins', () => {
  type Member = { id: string; clerk_user_id: string | null; is_active: boolean }
  type StaffRow = { id: string; crew_key: string; member_id: string | null }
  const LEAVING = 'user_leaving_placeholder'
  const LEAVING_MEMBER = '11111111-1111-4111-8111-111111111111'
  const OTHER_MEMBER = '22222222-2222-4222-8222-222222222222'

  let members: Member[]
  let staff: StaffRow[]
  let failTable: string | null

  function fakeDb() {
    failTable = null
    members = [
      { id: LEAVING_MEMBER, clerk_user_id: LEAVING, is_active: true },
      { id: OTHER_MEMBER, clerk_user_id: 'user_other_placeholder', is_active: true },
    ]
    staff = [
      { id: 's1', crew_key: `m.${LEAVING}`, member_id: null },
      { id: 's2', crew_key: `v.${LEAVING_MEMBER}`, member_id: LEAVING_MEMBER },
      { id: 's3', crew_key: 'm.user_other_placeholder', member_id: null },
      { id: 's4', crew_key: `v.${OTHER_MEMBER}`, member_id: OTHER_MEMBER },
    ]
    from.mockImplementation((table: string) => {
      let op: 'select' | 'update' | 'delete' = 'select'
      let patch: Partial<Member> = {}
      const filters: Array<[string, unknown]> = []
      const run = () => {
        if (failTable === table) return { data: null, error: { message: `${table} unavailable` } }
        if (table === 'event_crew_check_ins' && op === 'delete') {
          const gone = staff.filter((r) => filters.every(([c, v]) => (v as string[]).includes(r[c as keyof StaffRow] as string)))
          staff = staff.filter((r) => !gone.includes(r))
          return { data: gone.map((r) => ({ id: r.id })), error: null }
        }
        if (table === 'members') {
          const hit = members.filter((m) => filters.every(([c, v]) => m[c as keyof Member] === v))
          const ids = hit.map((m) => ({ id: m.id }))
          if (op === 'update') for (const m of hit) Object.assign(m, patch)
          return { data: ids, error: null }
        }
        throw new Error(`unexpected ${op} on ${table}`)
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        update: (p: Partial<Member>) => { op = 'update'; patch = p; return chain },
        delete: () => { op = 'delete'; return chain },
        eq: (c: string, v: unknown) => { filters.push([c, v]); return chain },
        in: (c: string, v: unknown) => { filters.push([c, v]); return chain },
        then: (f: (v: unknown) => unknown) => Promise.resolve(run()).then(f),
      }
      return chain
    })
  }

  const deleted = (id = LEAVING) => JSON.stringify({ type: 'user.deleted', data: { id, deleted: true } })

  async function deliver(payload: string) {
    const { POST } = await load(SECRET)
    sign(SECRET, payload)
    return (await post(POST, payload)).status
  }

  it("removes the login's event-manager check-ins and its member's volunteer check-ins, and no one else's", async () => {
    fakeDb()
    expect(await deliver(deleted())).toBe(200)
    expect(staff.map((r) => r.id).sort()).toEqual(['s3', 's4'])
    // The soft delete still runs after: the member row is kept, deactivated.
    expect(members[0]).toMatchObject({ id: LEAVING_MEMBER, is_active: false, clerk_user_id: null })
    expect(members[1]).toMatchObject({ id: OTHER_MEMBER, is_active: true, clerk_user_id: 'user_other_placeholder' })
    expect(startRetentionClock).toHaveBeenCalledWith(expect.anything(), LEAVING_MEMBER)
  })

  it('removes the check-ins of an event manager with no members row', async () => {
    fakeDb()
    members = members.filter((m) => m.id !== LEAVING_MEMBER)
    expect(await deliver(deleted())).toBe(200)
    expect(staff.map((r) => r.id).sort()).toEqual(['s2', 's3', 's4'])
  })

  it('a repeated delivery removes nothing more', async () => {
    fakeDb()
    await deliver(deleted())
    expect(await deliver(deleted())).toBe(200)
    expect(staff.map((r) => r.id).sort()).toEqual(['s3', 's4'])
  })

  it('answers 500 with nothing deactivated when the check-ins cannot be removed, so Clerk retries', async () => {
    fakeDb()
    failTable = 'event_crew_check_ins'
    expect(await deliver(deleted())).toBe(500)
    expect(members[0]).toMatchObject({ is_active: true, clerk_user_id: LEAVING })
    expect(startRetentionClock).not.toHaveBeenCalled()
  })

  it('answers 500 and removes nothing when the linked member cannot be read', async () => {
    fakeDb()
    failTable = 'members'
    expect(await deliver(deleted())).toBe(500)
    expect(staff).toHaveLength(4)
  })
})
