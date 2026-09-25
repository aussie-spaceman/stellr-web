import { describe, it, expect, vi, beforeEach } from 'vitest'

// The awards route enforces the judging rules before the database's unique
// indexes do. These tests pin the rules and the access gate, with the data
// layer mocked: every write is recorded, none is performed.

const { requireEventAccess, writes, state } = vi.hoisted(() => ({
  requireEventAccess: vi.fn(async (_slug: string): Promise<{ ok: boolean; status: number; userId?: string }> => ({ ok: true, status: 200, userId: 'user_admin' })),
  writes: [] as { op: string; table: string; payload?: unknown; filters: [string, unknown][] }[],
  state: {
    students: [] as { id: string; first_name: string; last_name: string; company_id: string | null }[],
    assignments: [] as { id: string; award_type: string; participant_id: string; company_id: string | null; assigned_at: string }[],
  },
}))

vi.mock('@/lib/event-access', () => ({ requireEventAccess }))
vi.mock('@/lib/event-award-issue', () => ({ pendingAwardChanges: async () => 0 }))
vi.mock('@/lib/event-certificates', () => ({
  fullName: (p: { first_name: string; last_name: string }) => `${p.first_name} ${p.last_name}`,
  listEventStudents: async () => state.students,
  listEventCompanies: async () => [{ id: 'co-1', number: 1, name: null }, { id: 'co-2', number: 2, name: null }],
  listAssignments: async () => state.assignments,
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const rec = { op: '', table, payload: undefined as unknown, filters: [] as [string, unknown][] }
      const chain: Record<string, unknown> = {
        select: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        delete: () => { rec.op = 'delete'; writes.push(rec); return chain },
        insert: async (payload: unknown) => { writes.push({ ...rec, op: 'insert', payload }); return { error: null } },
        upsert: async (payload: unknown) => { writes.push({ ...rec, op: 'upsert', payload }); return { error: null } },
        eq: (k: string, v: unknown) => { rec.filters.push([k, v]); return chain },
        is: (k: string, v: unknown) => { rec.filters.push([k, v]); return chain },
        then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
      }
      return chain
    },
  }),
}))

const { PUT } = await import('./route')

function put(body: unknown) {
  return PUT(
    new Request('https://app.stellreducation.org/api/admin/events/colorado/awards', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug: 'colorado' }) },
  )
}

beforeEach(() => {
  writes.length = 0
  requireEventAccess.mockClear()
  state.students = [
    { id: 'p1', first_name: 'Daniel', last_name: 'Ahaiwe', company_id: 'co-1' },
    { id: 'p2', first_name: 'Leon', last_name: 'Buk', company_id: 'co-1' },
    { id: 'p3', first_name: 'Ava', last_name: 'Zed', company_id: 'co-2' },
  ]
  state.assignments = []
})

describe('PUT /api/admin/events/[slug]/awards', () => {
  it('refuses an event manager not assigned to the event', async () => {
    requireEventAccess.mockResolvedValueOnce({ ok: false, status: 403 })
    const res = await put({ action: 'set_champion', companyId: 'co-1' })
    expect(res.status).toBe(403)
    expect(writes).toHaveLength(0)
  })

  it('makes every student in the winning company a champion', async () => {
    const res = await put({ action: 'set_champion', companyId: 'co-1' })
    expect(res.status).toBe(200)
    const insert = writes.find((w) => w.op === 'insert')
    expect((insert?.payload as { participant_id: string }[]).map((r) => r.participant_id)).toEqual(['p1', 'p2'])
    // The previous champions are cleared first.
    expect(writes[0]).toMatchObject({ op: 'delete', filters: [['event_slug', 'colorado'], ['award_type', 'overall_champion']] })
  })

  it('refuses a second specialist award for the same student', async () => {
    state.assignments = [{ id: 'a1', award_type: 'anita_gale', participant_id: 'p1', company_id: 'co-1', assigned_at: '' }]
    const res = await put({ action: 'set_specialist', awardType: 'dick_edwards', companyId: 'co-1', participantId: 'p1' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/one specialist award per event/)
    expect(writes).toHaveLength(0)
  })

  it('replaces the company’s current winner of a specialist award', async () => {
    state.assignments = [{ id: 'a1', award_type: 'anita_gale', participant_id: 'p1', company_id: 'co-1', assigned_at: '' }]
    const res = await put({ action: 'set_specialist', awardType: 'anita_gale', companyId: 'co-1', participantId: 'p2' })
    expect(res.status).toBe(200)
    expect(writes[0]).toMatchObject({ op: 'delete', filters: [['event_slug', 'colorado'], ['award_type', 'anita_gale'], ['company_id', 'co-1']] })
    expect(writes[1]).toMatchObject({ op: 'insert', payload: { participant_id: 'p2', award_type: 'anita_gale', company_id: 'co-1' } })
  })

  it('refuses a winner from another company', async () => {
    const res = await put({ action: 'set_specialist', awardType: 'anita_gale', companyId: 'co-1', participantId: 'p3' })
    expect(res.status).toBe(400)
    expect(writes).toHaveLength(0)
  })
})
