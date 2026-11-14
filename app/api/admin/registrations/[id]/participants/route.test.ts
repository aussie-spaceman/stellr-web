// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  session: { userId: 'user_crew', sessionClaims: { metadata: { role: 'admin' } } } as Record<string, unknown>,
  assigned: [] as string[],
  reg: { id: 'reg-1', type: 'group', event_slug: 'nevada', event_title: 'Nevada', school_name: 'S', school_address_state: 'NV' } as Record<string, unknown> | null,
  add: vi.fn(),
  log: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => h.session }))
// crewActorType is the real one, reading the session above.
vi.mock('@/lib/activity-log', async (importOriginal) => ({
  crewActorType: (await importOriginal<typeof import('@/lib/activity-log')>()).crewActorType,
  actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: 'staff-1', actorLabel: 'Staff' }),
  logActivity: h.log,
}))
vi.mock('@/lib/group-participant-add', () => ({
  GROUP_FOR_ADD_COLUMNS: 'id, event_slug, event_title, school_name, school_address_state',
  addParticipantToGroup: h.add,
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const rows = () => h.assigned.map((event_slug) => ({ clerk_user_id: h.session.userId, event_slug, tenant_id: null }))
      const chain = {
        select: () => chain,
        eq: () => chain,
        or: () => chain,
        maybeSingle: async () => ({ data: h.reg, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: table === 'event_manager_assignments' ? rows() : [], error: null }),
      }
      return chain
    },
  }),
}))

import { POST } from './route'

const asEventManager = (assigned: string[]) => {
  h.session = { userId: 'user_em', sessionClaims: { metadata: { role: 'event_manager' } } }
  h.assigned = assigned
}

const call = (body: unknown = { first_name: 'A', last_name: 'B', email: 'a@example.com', date_of_birth: '2011-05-12' }) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'reg-1' }) })

describe('POST /api/admin/registrations/[id]/participants', () => {
  beforeEach(() => {
    h.session = { userId: 'user_crew', sessionClaims: { metadata: { role: 'admin' } } }
    h.assigned = []
    h.reg = { id: 'reg-1', type: 'group', event_slug: 'nevada', event_title: 'Nevada', school_name: 'S', school_address_state: 'NV' }
    h.add.mockReset().mockResolvedValue({ status: 201, body: { participant: { id: 'p-1' } }, memberId: 'm-1' })
    h.log.mockReset()
  })

  it('refuses anyone who is not staff', async () => {
    h.session = { userId: 'user_student', sessionClaims: { metadata: { role: 'student' } } }
    expect((await call()).status).toBe(403)
    expect(h.add).not.toHaveBeenCalled()
  })

  it('refuses an event manager for an event that is not theirs, as if the group were missing', async () => {
    asEventManager(['colorado'])
    const refused = await call()
    expect(refused.status).toBe(404)
    h.reg = null
    const missing = await call()
    expect(await refused.json()).toEqual(await missing.json())
    expect(h.add).not.toHaveBeenCalled()
  })

  it('only adds to group registrations', async () => {
    h.reg = { ...h.reg!, type: 'individual' }
    expect((await call()).status).toBe(404)
    h.reg = null
    expect((await call()).status).toBe(404)
  })

  it('runs the shared organiser add as staff and records it on the member', async () => {
    const res = await call()
    expect(res.status).toBe(201)
    expect(h.add).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'reg-1' }), expect.anything(),
      { memberId: 'staff-1', label: 'admin' })
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'm-1', action: 'roster_added_by_crew' }))
  })

  it('lets the event manager of that event add', async () => {
    asEventManager(['nevada'])
    expect((await call()).status).toBe(201)
  })

  // staff-role.10: the activity log names who added the person.
  it('records an admin as admin', async () => {
    expect((await call()).status).toBe(201)
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ actorType: 'admin', action: 'roster_added_by_crew' }))
  })

  it('records Staff as staff, not as a member', async () => {
    h.session = { userId: 'user_staff', sessionClaims: { metadata: { role: 'staff' } } }
    expect((await call()).status).toBe(201)
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ actorType: 'staff', action: 'roster_added_by_crew' }))
    // The shared add still takes its crew path for Staff.
    expect(h.add).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), { memberId: 'staff-1', label: 'admin' })
  })

  it('records an event manager on the event as a member, as the activity log has no event manager actor', async () => {
    asEventManager(['nevada'])
    expect((await call()).status).toBe(201)
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ actorType: 'member', action: 'roster_added_by_crew' }))
  })

  it('passes a refusal from the shared add straight through and records nothing', async () => {
    h.add.mockResolvedValue({ status: 409, body: { error: 'This person is already on the team roster.' } })
    const res = await call()
    expect(res.status).toBe(409)
    expect(h.log).not.toHaveBeenCalled()
  })
})
