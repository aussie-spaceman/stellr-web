import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review AUTH-3: the companies `move` action writes participants.company_id
// by participant id. requireEventAccess(slug) only proves the caller may manage
// `slug`, so the route must also confirm the participant belongs to `slug` before
// writing — otherwise an event manager assigned to event A could retarget event
// B's placement. These tests pin that gate with the data layer mocked: every
// participants update is recorded, none is performed.

const { requireEventAccess, writes, state } = vi.hoisted(() => ({
  requireEventAccess: vi.fn(
    async (_slug: string): Promise<{ ok: boolean; status: number; userId?: string }> => ({ ok: true, status: 200, userId: 'user_admin' }),
  ),
  writes: [] as { op: string; table: string; payload?: unknown; filters: [string, unknown][] }[],
  state: {
    // participantId -> the event_slug of its registration
    participantEvent: {} as Record<string, string>,
    // companyId -> the event_slug it belongs to
    companyEvent: {} as Record<string, string>,
    // participantIds with a submitted team profile
    submitted: [] as string[],
  },
}))

vi.mock('@/lib/event-access', () => ({ requireEventAccess }))
vi.mock('@/lib/activity-log', () => ({ actorFromAuth: async () => ({ actorType: 'admin', actorLabel: 'Staff Admin' }) }))
vi.mock('@/lib/survey/events', () => ({ loadSurveyEvent: async () => null }))
vi.mock('@/lib/team-profile/assign', () => ({
  autoAssign: async () => ({}),
  AssignError: class AssignError extends Error {},
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const rec = { op: 'select', table, payload: undefined as unknown, filters: [] as [string, unknown][] }
      const chain: Record<string, unknown> = {
        select: () => chain,
        update: (payload: unknown) => { rec.op = 'update'; rec.payload = payload; return chain },
        delete: () => { rec.op = 'delete'; return chain },
        upsert: async () => ({ error: null }),
        eq: (k: string, v: unknown) => { rec.filters.push([k, v]); return chain },
        gt: (k: string, v: unknown) => { rec.filters.push([k, v]); return chain },
        order: () => chain,
        maybeSingle: async () => {
          const idFilter = rec.filters.find(([k]) => k === 'id')?.[1] as string | undefined
          if (table === 'participants') {
            const slugFilter = rec.filters.find(([k]) => k === 'registrations.event_slug')?.[1]
            const belongs = !!idFilter && state.participantEvent[idFilter] === slugFilter
            return { data: belongs ? { id: idFilter } : null, error: null }
          }
          if (table === 'event_companies') {
            const slugFilter = rec.filters.find(([k]) => k === 'event_slug')?.[1]
            const belongs = !!idFilter && state.companyEvent[idFilter] === slugFilter
            return { data: belongs ? { id: idFilter } : null, error: null }
          }
          if (table === 'team_profiles') {
            const pid = rec.filters.find(([k]) => k === 'participant_id')?.[1] as string
            return { data: state.submitted.includes(pid) ? { submitted_at: '2026-10-20T12:00:00Z' } : null, error: null }
          }
          return { data: null, error: null }
        },
        then: (resolve: (v: { error: null }) => void) => {
          if (rec.op === 'update') writes.push(rec)
          resolve({ error: null })
        },
      }
      return chain
    },
  }),
}))

const { POST } = await import('./route')

function move(slug: string, body: unknown) {
  return POST(
    new Request(`https://app.stellreducation.org/api/admin/events/${slug}/companies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) },
  )
}

beforeEach(() => {
  writes.length = 0
  requireEventAccess.mockClear()
  requireEventAccess.mockResolvedValue({ ok: true, status: 200, userId: 'user_admin' })
  state.participantEvent = { pA: 'event-a', pB: 'event-b' }
  state.companyEvent = { cA: 'event-a', cB: 'event-b' }
  state.submitted = []
})

describe('POST /api/admin/events/[slug]/companies — move', () => {
  it('refuses to move a participant that belongs to ANOTHER event (AUTH-3)', async () => {
    // EM manages event-a, passes event-b's participant id.
    const res = await move('event-a', { action: 'move', participantId: 'pB', companyId: null })
    expect(res.status).toBe(404)
    expect(writes).toHaveLength(0)
  })

  it('refuses even when the target company is this event’s (AUTH-3)', async () => {
    const res = await move('event-a', { action: 'move', participantId: 'pB', companyId: 'cA' })
    expect(res.status).toBe(404)
    expect(writes).toHaveLength(0)
  })

  it('moves a participant of THIS event into a company', async () => {
    const res = await move('event-a', { action: 'move', participantId: 'pA', companyId: 'cA' })
    expect(res.status).toBe(200)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      op: 'update',
      table: 'participants',
      payload: { company_id: 'cA', company_locked: true },
      filters: [['id', 'pA']],
    })
  })

  it('unassigns (unlocks) a participant of THIS event', async () => {
    const res = await move('event-a', { action: 'move', participantId: 'pA', companyId: null })
    expect(res.status).toBe(200)
    expect(writes[0]).toMatchObject({ payload: { company_id: null, company_locked: false }, filters: [['id', 'pA']] })
  })

  it('refuses an event manager not assigned to the event (no write)', async () => {
    requireEventAccess.mockResolvedValueOnce({ ok: false, status: 403 })
    const res = await move('event-a', { action: 'move', participantId: 'pA', companyId: 'cA' })
    expect(res.status).toBe(403)
    expect(writes).toHaveLength(0)
  })
})

describe('POST /api/admin/events/[slug]/companies — override', () => {
  it('refuses to override a participant that belongs to ANOTHER event (AUTH-3)', async () => {
    const res = await move('event-a', { action: 'override', participantId: 'pB', overridden: true })
    expect(res.status).toBe(404)
    expect(writes).toHaveLength(0)
  })

  it('overrides a participant of THIS event, recording who did it', async () => {
    const res = await move('event-a', { action: 'override', participantId: 'pA', overridden: true })
    expect(res.status).toBe(200)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      op: 'update',
      table: 'participants',
      payload: { team_profile_overridden_by: 'user_admin', team_profile_overridden_by_name: 'Staff Admin' },
      filters: [['id', 'pA']],
    })
    expect(typeof (writes[0].payload as Record<string, unknown>).team_profile_overridden_at).toBe('string')
  })

  it('refuses to override a student who has already submitted (no write)', async () => {
    state.submitted = ['pA']
    const res = await move('event-a', { action: 'override', participantId: 'pA', overridden: true })
    expect(res.status).toBe(409)
    expect(writes).toHaveLength(0)
  })

  it('undoes an override', async () => {
    const res = await move('event-a', { action: 'override', participantId: 'pA', overridden: false })
    expect(res.status).toBe(200)
    expect(writes[0]).toMatchObject({
      payload: { team_profile_overridden_at: null, team_profile_overridden_by: null, team_profile_overridden_by_name: null },
      filters: [['id', 'pA']],
    })
  })

  it('needs a participant and a true/false override', async () => {
    const res = await move('event-a', { action: 'override', participantId: 'pA' })
    expect(res.status).toBe(400)
    expect(writes).toHaveLength(0)
  })

  it('refuses an event manager not assigned to the event (no write)', async () => {
    requireEventAccess.mockResolvedValueOnce({ ok: false, status: 403 })
    const res = await move('event-a', { action: 'override_all' })
    expect(res.status).toBe(403)
    expect(writes).toHaveLength(0)
  })
})
