import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The desk's group check-in, scanning and details (Oct 2026). The open / close
// banner rules are in route.test.ts.

type Filter = [op: string, column: string, value: unknown]
interface Call {
  table: string
  op: 'select' | 'update'
  values?: Record<string, unknown>
  filters: Filter[]
}

const { calls, respond, getEventRoster } = vi.hoisted(() => ({
  calls: [] as Call[],
  respond: { fn: (_call: Call, _single: boolean): { data: unknown; error: null } => ({ data: null, error: null }) },
  getEventRoster: vi.fn(),
}))

vi.mock('@/lib/event-access', () => ({ requireEventAccess: async () => ({ ok: true, status: 200 }) }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: async () => ({ setting: 'in_person', date: '2026-11-06' }) }))
vi.mock('@/lib/check-in-banner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/check-in-banner')>()),
  loadOpenCheckIns: async () => [],
}))
vi.mock('@/lib/event-admin', () => ({ getEventRoster }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const call: Call = { table, op: 'select', filters: [] }
      const add = (op: string) => (column: string, value?: unknown) => {
        call.filters.push([op, column, value])
        return chain
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        update: (values: Record<string, unknown>) => {
          call.op = 'update'
          call.values = values
          return chain
        },
        eq: add('eq'),
        neq: add('neq'),
        in: add('in'),
        is: add('is'),
        not: add('not'),
        limit: () => chain,
        maybeSingle: async () => {
          calls.push(call)
          return respond.fn(call, true)
        },
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          calls.push(call)
          return Promise.resolve(respond.fn(call, false)).then(resolve, reject)
        },
      }
      return chain
    },
  }),
}))

const { GET, POST } = await import('./route')
const { signCheckInCode } = await import('@/lib/check-in-codes')

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const REG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function post(body: unknown) {
  return POST(
    new Request('https://www.stellreducation.org/api/admin/events/nevada/check-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug: 'nevada' }) }
  )
}

const updates = () => calls.filter((c) => c.op === 'update')
const has = (c: Call, op: string, column: string) => c.filters.find((f) => f[0] === op && f[1] === column)

beforeEach(() => {
  calls.length = 0
  vi.stubEnv('SURVEY_TOKEN_SECRET', 's'.repeat(40))
  // By default every id asked about belongs to the event.
  respond.fn = (call, single) => {
    if (call.table === 'participants' && call.op === 'select') {
      const ids = (has(call, 'in', 'id')?.[2] as string[] | undefined) ?? [has(call, 'eq', 'id')?.[2] as string]
      const rows = ids.map((id) => ({ id, checked_in_at: null }))
      return { data: single ? rows[0] : rows, error: null }
    }
    return { data: null, error: null }
  }
})
afterEach(() => vi.unstubAllEnvs())

describe('group check-in', () => {
  it('checks in the ticked people who aren’t in yet, at the time the desk tapped', async () => {
    const at = new Date(Date.now() - 60_000).toISOString()
    const res = await post({ action: 'group_check_in', participantIds: [A, B], at })
    expect(res.status).toBe(200)
    const [u] = updates()
    expect(u.values).toEqual({ checked_in_at: at, check_in_method: 'manual' })
    expect(has(u, 'in', 'id')?.[2]).toEqual([A, B])
    // Someone who checked in on their own phone keeps their time.
    expect(has(u, 'is', 'checked_in_at')?.[2]).toBeNull()
  })

  it('undoes exactly that group', async () => {
    await post({ action: 'group_undo', participantIds: [A, B] })
    const [u] = updates()
    expect(u.values).toEqual({ checked_in_at: null, check_in_method: null })
    expect(has(u, 'in', 'id')?.[2]).toEqual([A, B])
  })

  it('touches nobody when anyone on the list isn’t at this event', async () => {
    respond.fn = (call) => (call.op === 'select' ? { data: [{ id: A }], error: null } : { data: null, error: null })
    const res = await post({ action: 'group_check_in', participantIds: [A, B] })
    expect(res.status).toBe(404)
    expect(updates()).toHaveLength(0)
  })

  it('refuses an empty, malformed or oversized list', async () => {
    for (const participantIds of [[], 'abc', [1, 2], Array.from({ length: 301 }, (_, i) => `id-${i}`)]) {
      expect((await post({ action: 'group_check_in', participantIds })).status).toBe(400)
    }
    expect(updates()).toHaveLength(0)
  })
})

describe('scan', () => {
  it('checks in the participant a valid code names', async () => {
    const res = await post({ action: 'scan', code: signCheckInCode('nevada', 'p', A) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ kind: 'participant', participantId: A, alreadyCheckedIn: false })
    const [u] = updates()
    expect(u.values).toMatchObject({ check_in_method: 'manual' })
    expect(has(u, 'eq', 'id')?.[2]).toBe(A)
  })

  it('says when they were already in, and changes nothing', async () => {
    respond.fn = (call) => ({ data: call.op === 'select' ? { id: A, checked_in_at: '2026-11-06T15:00:00Z' } : null, error: null })
    const body = await (await post({ action: 'scan', code: signCheckInCode('nevada', 'p', A) })).json()
    expect(body).toMatchObject({ alreadyCheckedIn: true, checkedInAt: '2026-11-06T15:00:00Z' })
    expect(updates()).toHaveLength(0)
  })

  it('returns the group for a group code, for the desk to confirm', async () => {
    respond.fn = (call) => ({ data: call.table === 'registrations' ? { id: REG } : null, error: null })
    const body = await (await post({ action: 'scan', code: signCheckInCode('nevada', 'g', REG) })).json()
    expect(body).toEqual({ ok: true, kind: 'group', registrationId: REG })
    expect(updates()).toHaveLength(0)
  })

  it('refuses another event’s code and a forged one', async () => {
    for (const code of [signCheckInCode('colorado', 'p', A), `p.${A}.abcdefghijklmnopqrstuv`, 'nonsense']) {
      expect((await post({ action: 'scan', code })).status).toBe(404)
    }
    expect(updates()).toHaveLength(0)
  })
})

describe('GET ?details=1', () => {
  it('flags only people with something to flag, and finds the teacher’s phone', async () => {
    getEventRoster.mockResolvedValue({
      groups: [
        {
          participants: [
            { id: A, docusign: 'outstanding', docusign_label: 'Not Issued', docusign_detail: null, paid: false, payment_pill: 'invoice_issued', health_conditions: 'Asthma', dietary_requirements: ['None', 'Vegan'] },
            { id: B, docusign: 'completed', docusign_label: 'Complete', docusign_detail: null, paid: true, payment_pill: 'invoice_paid', health_conditions: 'none', dietary_requirements: [] },
          ],
        },
      ],
    })
    respond.fn = (call) => {
      if (call.table === 'registrations') {
        return {
          data: [
            {
              id: REG,
              teacher_first_name: 'Dana',
              teacher_last_name: 'Okafor',
              teacher_email: 'teacher@example.com',
              teacher_member_id: 'm1',
              participants: [{ member_id: 'm2', event_role: 'participant', phone: '555-0100' }],
            },
          ],
          error: null,
        }
      }
      if (call.table === 'members') return { data: [{ id: 'm1', phone: '555-0199' }], error: null }
      return { data: null, error: null }
    }
    const res = await GET(new Request('https://www.stellreducation.org/api/admin/events/nevada/check-in?details=1'), {
      params: Promise.resolve({ slug: 'nevada' }),
    })
    const body = await res.json()
    expect(body.flags).toEqual({
      [A]: { agreement: 'Not Issued', agreementDetail: null, unpaid: 'Invoice unpaid', medical: 'Asthma', dietary: ['Vegan'] },
    })
    expect(body.contacts[REG]).toEqual({ name: 'Dana Okafor', phone: '555-0199', email: 'teacher@example.com' })
    expect(getEventRoster).toHaveBeenCalledWith('nevada', '2026-11-06')
  })
})
