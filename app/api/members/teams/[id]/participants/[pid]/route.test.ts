// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// deep review MEM-15 (data retention): removing a participant hard-deletes the
// row, and four FKs that point at it are ON DELETE CASCADE — so the delete also
// erased judging awards, submitted survey responses and the team profile, all of
// which policy retains for 7 years. The DELETE route must refuse to destroy them.
const { state } = vi.hoisted(() => ({ state: { db: null as FakeDb | null } }))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'clerk-teacher' }) }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/email', () => ({ sendEmail: async () => ({}), studentLeftTeamEmail: () => ({ subject: '', html: '', text: '' }) }))
vi.mock('@/lib/event-participation-sync', () => ({ removeEventParticipation: async () => {} }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => state.db!.client }))

const { DELETE } = await import('./route')

function seed(extra: Record<string, object[]> = {}) {
  state.db = fakeSupabase({
    members: [{ id: 'teacher', email: 't@s.test', clerk_user_id: 'clerk-teacher', is_active: true, event_role: 'teacher', first_name: 'T', last_name: 'X' }],
    registrations: [{
      id: 'reg', teacher_member_id: 'teacher', teacher_email: 't@s.test', teacher_poc_email: null,
      teacher_first_name: 'T', event_title: 'Event', event_slug: 'e1',
    }],
    participants: [{ id: 'p1', registration_id: 'reg', member_id: 'stu', event_role: 'participant', first_name: 'S', last_name: 'Y', email: 's@s.test' }],
    ...extra,
  })
}

const del = () =>
  DELETE(new NextRequest('https://app.test/api/members/teams/reg/participants/p1', { method: 'DELETE' }), {
    params: Promise.resolve({ id: 'reg', pid: 'p1' }),
  })

beforeEach(() => vi.clearAllMocks())

describe('DELETE team participant — retained-record guard (MEM-15)', () => {
  it('removes a participant that holds no retained records', async () => {
    seed()
    const res = await del()
    expect(res.status).toBe(200)
    expect(state.db!.table('participants')).toHaveLength(0) // actually removed
  })

  it('refuses to delete a participant with an event award (would cascade it away)', async () => {
    seed({ event_award_assignments: [{ id: 'a1', participant_id: 'p1', event_slug: 'e1', award_type: 'anita_gale' }] })
    const res = await del()
    expect(res.status).toBe(409)
    expect(state.db!.table('participants')).toHaveLength(1) // preserved
  })

  it('refuses to delete a participant with a SUBMITTED survey response', async () => {
    seed({ survey_responses: [{ id: 'r1', participant_id: 'p1', submitted_at: '2026-01-01T00:00:00Z' }] })
    expect((await del()).status).toBe(409)
    expect(state.db!.table('participants')).toHaveLength(1)
  })

  it('refuses to delete a participant with a SUBMITTED team profile', async () => {
    seed({ team_profiles: [{ id: 'tp1', participant_id: 'p1', submitted_at: '2026-01-01T00:00:00Z' }] })
    expect((await del()).status).toBe(409)
    expect(state.db!.table('participants')).toHaveLength(1)
  })

  it('still removes a participant whose survey response is only a draft (nothing to retain)', async () => {
    seed({ survey_responses: [{ id: 'r1', participant_id: 'p1', submitted_at: null }] })
    const res = await del()
    expect(res.status).toBe(200)
    expect(state.db!.table('participants')).toHaveLength(0)
  })
})
