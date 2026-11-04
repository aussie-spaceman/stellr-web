import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  access: { ok: true, isAdmin: true, assignedSlugs: null } as Record<string, unknown>,
  reg: { id: 'reg-1', type: 'group', event_slug: 'nevada', event_title: 'Nevada', school_name: 'S', school_address_state: 'NV' } as Record<string, unknown> | null,
  add: vi.fn(),
  log: vi.fn(),
}))

vi.mock('@/lib/event-access', () => ({ requireEventAccess: async () => h.access }))
vi.mock('@/lib/activity-log', () => ({
  actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: 'staff-1', actorLabel: 'Staff' }),
  logActivity: h.log,
}))
vi.mock('@/lib/group-participant-add', () => ({
  GROUP_FOR_ADD_COLUMNS: 'id, event_slug, event_title, school_name, school_address_state',
  addParticipantToGroup: h.add,
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: h.reg, error: null }) }
      return chain
    },
  }),
}))

import { POST } from './route'

const call = (body: unknown = { first_name: 'A', last_name: 'B', email: 'a@example.com', date_of_birth: '2011-05-12' }) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'reg-1' }) })

describe('POST /api/admin/registrations/[id]/participants', () => {
  beforeEach(() => {
    h.access = { ok: true, isAdmin: true, assignedSlugs: null }
    h.reg = { id: 'reg-1', type: 'group', event_slug: 'nevada', event_title: 'Nevada', school_name: 'S', school_address_state: 'NV' }
    h.add.mockReset().mockResolvedValue({ status: 201, body: { participant: { id: 'p-1' } }, memberId: 'm-1' })
    h.log.mockReset()
  })

  it('refuses anyone who is not staff', async () => {
    h.access = { ok: false, status: 403 }
    expect((await call()).status).toBe(403)
    expect(h.add).not.toHaveBeenCalled()
  })

  it('refuses an event manager for an event that is not theirs', async () => {
    h.access = { ok: true, isAdmin: false, assignedSlugs: ['colorado'] }
    expect((await call()).status).toBe(403)
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
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'm-1', action: 'roster_added_by_staff' }))
  })

  it('lets the event manager of that event add', async () => {
    h.access = { ok: true, isAdmin: false, assignedSlugs: ['nevada'] }
    expect((await call()).status).toBe(201)
  })

  it('passes a refusal from the shared add straight through and records nothing', async () => {
    h.add.mockResolvedValue({ status: 409, body: { error: 'This person is already on the team roster.' } })
    const res = await call()
    expect(res.status).toBe(409)
    expect(h.log).not.toHaveBeenCalled()
  })
})
