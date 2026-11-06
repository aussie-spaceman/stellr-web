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

const { DELETE, PATCH } = await import('./route')
const { appToday } = await import('@/lib/age')

function seed(extra: Record<string, object[]> = {}) {
  state.db = fakeSupabase({
    members: [{ id: 'teacher', email: 't@s.test', clerk_user_id: 'clerk-teacher', is_active: true, event_role: 'teacher', first_name: 'T', last_name: 'X' }],
    registrations: [{
      id: 'reg', type: 'group', teacher_member_id: 'teacher', teacher_email: 't@s.test', teacher_poc_email: null,
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

// S0 (2 Nov 2026): an organiser's edit gets the same date-of-birth check as an add.
describe('PATCH team participant — date of birth', () => {
  const patch = (b: Record<string, unknown>) =>
    PATCH(new NextRequest('https://app.test/api/members/teams/reg/participants/p1', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
    }), { params: Promise.resolve({ id: 'reg', pid: 'p1' }) })
  const stored = () => (state.db!.table('participants')[0] as Record<string, unknown>).date_of_birth

  it('refuses any edit of a row filled from the member record, and returns none of it', async () => {
    seed()
    const row = state.db!.table('participants')[0] as Record<string, unknown>
    row.details_from_member = true
    row.health_conditions = 'kept'
    const res = await patch({ health_conditions: '' })
    expect(res.status).toBe(409)
    expect(JSON.stringify(await res.json())).not.toContain('kept')
    expect(row.health_conditions).toBe('kept')
  })

  it.each([
    ['cleared', '', 'dob_missing'],
    ['unreadable', '31/12/2012', 'dob_invalid'],
    ['in the future', '2999-01-01', 'dob_invalid'],
  ])('refuses a date of birth that is %s, leaving the row as it was', async (_l, dob, code) => {
    seed()
    state.db!.table('participants')[0].date_of_birth = '2012-03-04'
    const res = await patch({ first_name: 'S', last_name: 'Y', date_of_birth: dob })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe(code)
    expect(json.error).toMatch(/date of birth for S Y/)
    expect(stored()).toBe('2012-03-04')
  })

  it('saves a real past date, and an edit that leaves the date out is untouched by the check', async () => {
    seed()
    expect((await patch({ first_name: 'S', last_name: 'Y', date_of_birth: '2011-05-06' })).status).toBe(200)
    expect(stored()).toBe('2011-05-06')
    expect((await patch({ phone: '555-0100' })).status).toBe(200)
    expect(stored()).toBe('2011-05-06')
  })
})

// S0 (2 Nov 2026): a minor takes part as a student. An edit can neither give a
// minor an adult role or bracket nor leave one in place after a corrected date.
describe('PATCH team participant — a minor takes part as a student', () => {
  const patch = (b: Record<string, unknown>) =>
    PATCH(new NextRequest('https://app.test/api/members/teams/reg/participants/p1', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
    }), { params: Promise.resolve({ id: 'reg', pid: 'p1' }) })
  const row = () => state.db!.table('participants')[0] as Record<string, unknown>
  /** A date of birth `n` years before the app's today, less `extraDays`. */
  const yearsAgo = (n: number, extraDays = 0) => {
    const d = appToday()
    d.setUTCFullYear(d.getUTCFullYear() - n)
    d.setUTCDate(d.getUTCDate() - extraDays)
    return d.toISOString().slice(0, 10)
  }

  it.each([
    ['12', yearsAgo(13, -1)],
    ['13', yearsAgo(13)],
    ['14', yearsAgo(14)],
  ])('aged %s, the full edit form cannot set an adult role or bracket', async (_age, dob) => {
    seed()
    const res = await patch({ first_name: 'S', last_name: 'Y', date_of_birth: dob, event_role: 'Mentor', age_bracket: 'adult' })
    expect(res.status).toBe(200)
    expect(row()).toMatchObject({ date_of_birth: dob, event_role: 'participant', age_bracket: 'high_school' })
  })

  it('an edit of the role alone is judged on the date of birth already on the row', async () => {
    seed()
    Object.assign(row(), { date_of_birth: yearsAgo(12), event_role: 'participant', age_bracket: 'high_school' })
    expect((await patch({ event_role: 'Adult' })).status).toBe(200)
    expect(row()).toMatchObject({ event_role: 'participant', age_bracket: 'high_school' })
  })

  it('correcting a date to a minor one moves an adult role back to a student', async () => {
    seed()
    Object.assign(row(), { date_of_birth: '1990-01-01', event_role: 'mentor', age_bracket: 'adult' })
    expect((await patch({ date_of_birth: yearsAgo(15) })).status).toBe(200)
    expect(row()).toMatchObject({ event_role: 'participant', age_bracket: 'high_school' })
  })

  it('an adult keeps the role and bracket the organiser picked', async () => {
    seed()
    expect((await patch({ first_name: 'S', last_name: 'Y', date_of_birth: '1990-01-01', event_role: 'Mentor', age_bracket: 'adult' })).status).toBe(200)
    expect(row()).toMatchObject({ event_role: 'mentor', age_bracket: 'adult' })
  })
})
