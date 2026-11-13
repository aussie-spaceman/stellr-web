// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MentorContact } from '@/lib/event-emails/audiences'

// Mentor and event-manager check-in (Nov 2026): who the Mentors tab lists, and
// what a tap writes. loadMentorContacts is the Mentors email group's own list,
// so it is stood in for here; its own tests cover where it comes from.

const { contacts } = vi.hoisted(() => ({ contacts: { current: [] as MentorContact[] } }))
vi.mock('@/lib/event-emails/audiences', () => ({ loadMentorContacts: async () => contacts.current }))

const { loadDeskCrew, loadCrewCheckIns, writeCrewCheckIn } = await import('./check-in-crew')
const { fakeSupabase } = await import('@/test/fake-supabase')

const VOL = 'aaaaaaaa-0000-4000-8000-000000000001'
const BOTH = 'aaaaaaaa-0000-4000-8000-000000000002'
const ROSTERED = 'aaaaaaaa-0000-4000-8000-000000000003'

const mentor = (over: Partial<MentorContact>): MentorContact => ({
  email: 'x@example.com', firstName: 'X', lastName: 'Y', role: 'volunteer', key: `v.${VOL}`, memberId: VOL, ...over,
})

function seeded(extra: Record<string, unknown[]> = {}) {
  return fakeSupabase({
    // The roster join, flattened the way the fake reads `registrations.event_slug`.
    participants: [
      { member_id: ROSTERED, 'registrations.event_slug': 'nevada', 'registrations.status': 'confirmed' },
    ],
    event_crew_check_ins: [],
    ...extra,
  }).client as SupabaseClient
}

beforeEach(() => {
  contacts.current = [
    mentor({ email: 'Vol@example.com', firstName: 'Hana', key: `v.${VOL}`, memberId: VOL }),
    mentor({ email: 'both@example.com', firstName: 'Bo', key: `v.${BOTH}`, memberId: BOTH }),
    mentor({ email: 'BOTH@example.com', firstName: 'Bo', role: 'event_manager', key: 'm.user_both', memberId: BOTH }),
    mentor({ email: 'em@example.com', firstName: 'Em', role: 'event_manager', key: 'm.user_em', memberId: null }),
    mentor({ email: 'reg@example.com', firstName: 'Reg', key: `v.${ROSTERED}`, memberId: ROSTERED }),
  ]
})

describe('loadDeskCrew', () => {
  it('lists each person once, as a mentor first, and leaves off anyone the People tab already has', async () => {
    const crew = await loadDeskCrew(seeded(), 'nevada')
    expect(crew.map((s) => [s.id, s.role])).toEqual([
      [`v.${VOL}`, 'volunteer'],
      [`v.${BOTH}`, 'volunteer'],
      ['m.user_em', 'event_manager'],
    ])
  })
})

describe('writeCrewCheckIn', () => {
  it('checks a mentor in with their member id, and a second tap keeps the first time', async () => {
    const db = seeded()
    expect(await writeCrewCheckIn(db, 'nevada', `v.${VOL}`, { checkIn: true, at: '2026-11-07T15:00:00.000Z', by: 'clerk-desk' })).toEqual({ ok: true })
    await writeCrewCheckIn(db, 'nevada', `v.${VOL}`, { checkIn: true, at: '2026-11-07T16:00:00.000Z', by: 'clerk-desk' })
    const { data } = await db.from('event_crew_check_ins').select('*').eq('event_slug', 'nevada')
    expect(data).toHaveLength(1)
    expect(data?.[0]).toMatchObject({
      crew_key: `v.${VOL}`, role: 'volunteer', member_id: VOL, checked_in_at: '2026-11-07T15:00:00.000Z', checked_in_by: 'clerk-desk',
    })
    expect((await loadCrewCheckIns(db, 'nevada')).get(`v.${VOL}`)).toEqual({ checkedInAt: '2026-11-07T15:00:00.000Z', checkInMethod: 'manual' })
  })

  it('undo removes only that person at that event', async () => {
    const db = seeded({
      event_crew_check_ins: [
        { event_slug: 'nevada', crew_key: 'm.user_em', checked_in_at: 't1', check_in_method: 'manual' },
        { event_slug: 'nevada', crew_key: `v.${VOL}`, checked_in_at: 't2', check_in_method: 'manual' },
        { event_slug: 'colorado', crew_key: 'm.user_em', checked_in_at: 't3', check_in_method: 'manual' },
      ],
    })
    expect(await writeCrewCheckIn(db, 'nevada', 'm.user_em', { checkIn: false })).toEqual({ ok: true })
    expect([...(await loadCrewCheckIns(db, 'nevada')).keys()]).toEqual([`v.${VOL}`])
    expect([...(await loadCrewCheckIns(db, 'colorado')).keys()]).toEqual(['m.user_em'])
  })

  it('refuses a key that is malformed or names someone not on this event’s Mentors tab', async () => {
    const db = seeded()
    const at = { checkIn: true as const, at: '2026-11-07T15:00:00.000Z', by: null }
    expect(await writeCrewCheckIn(db, 'nevada', undefined, at)).toMatchObject({ ok: false, status: 400 })
    expect(await writeCrewCheckIn(db, 'nevada', 'x.nope', at)).toMatchObject({ ok: false, status: 400 })
    expect(await writeCrewCheckIn(db, 'nevada', 'm.user_stranger', at)).toMatchObject({ ok: false, status: 404 })
    // On the roster, so the People tab checks them in, not this one.
    expect(await writeCrewCheckIn(db, 'nevada', `v.${ROSTERED}`, at)).toMatchObject({ ok: false, status: 404 })
    const { data } = await db.from('event_crew_check_ins').select('*')
    expect(data).toEqual([])
  })
})
