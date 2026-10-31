import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// Team profile override: who "Override all not submitted" touches, and who
// Auto-Assign then places. The data layer is faked; nothing is written.

vi.mock('./store', () => ({ formsComplete: async () => new Set() }))

const { CLEARED_OVERRIDE, overrideFields, overrideOutstanding } = await import('./override')
const { autoAssignGroups } = await import('./assign')
type PlanningStudent = import('./assign').PlanningStudent

function fakeDb(participants: Record<string, unknown>[], submittedIds: string[]) {
  const writes: { payload: unknown; ids: string[] }[] = []
  const db = {
    from: (table: string) => {
      let payload: unknown
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        not: () => chain,
        update: (p: unknown) => {
          payload = p
          return chain
        },
        in: async (_k: string, ids: string[]) => {
          writes.push({ payload, ids })
          return { error: null }
        },
        then: (resolve: (v: unknown) => void) =>
          resolve({
            data: table === 'participants' ? participants : submittedIds.map((participant_id) => ({ participant_id })),
            error: null,
          }),
      }
      return chain
    },
  }
  return { db: db as unknown as SupabaseClient, writes }
}

const part = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  event_role: 'participant',
  team_profile_overridden_at: null,
  registrations: { event_slug: 'nevada', status: 'confirmed' },
  ...over,
})

const actor = { userId: 'user_staff', name: 'Event Manager' }

describe('overrideFields', () => {
  it('records when and by whom; clearing empties all three', () => {
    expect(overrideFields(actor, new Date('2026-10-30T18:00:00Z'))).toEqual({
      team_profile_overridden_at: '2026-10-30T18:00:00.000Z',
      team_profile_overridden_by: 'user_staff',
      team_profile_overridden_by_name: 'Event Manager',
    })
    expect(Object.keys(CLEARED_OVERRIDE).sort()).toEqual(Object.keys(overrideFields(actor)).sort())
    expect(Object.values(CLEARED_OVERRIDE).every((v) => v === null)).toBe(true)
  })
})

describe('overrideOutstanding', () => {
  it('overrides every student who has not submitted, and no one else', async () => {
    const { db, writes } = fakeDb(
      [
        part('sent'),
        part('waiting', { event_role: 'school_student_manager' }),
        part('submitted'),
        part('already', { team_profile_overridden_at: '2026-10-29T10:00:00Z' }),
        part('withdrawn', { registrations: { event_slug: 'nevada', status: 'withdrawn' } }),
        part('mentor', { event_role: 'mentor' }),
      ],
      ['submitted'],
    )
    const result = await overrideOutstanding(db, 'nevada', actor)
    expect(result).toEqual({ overridden: 2 })
    expect(writes).toHaveLength(1)
    expect(writes[0].ids).toEqual(['sent', 'waiting'])
    expect(writes[0].payload).toMatchObject({ team_profile_overridden_by: 'user_staff', team_profile_overridden_by_name: 'Event Manager' })
  })

  it('writes nothing when everyone has submitted or is overridden', async () => {
    const { db, writes } = fakeDb([part('a'), part('b', { team_profile_overridden_at: '2026-10-29T10:00:00Z' })], ['a'])
    expect(await overrideOutstanding(db, 'nevada', actor)).toEqual({ overridden: 0 })
    expect(writes).toHaveLength(0)
  })
})

const student = (participantId: string, over: Partial<PlanningStudent> = {}): PlanningStudent => ({
  participantId,
  firstName: participantId,
  lastName: '',
  school: null,
  grade: null,
  gender: null,
  age: null,
  ethnicity: [],
  experience: 0,
  registrationId: `r-${participantId}`,
  isGroup: false,
  companyId: null,
  companyNumber: null,
  locked: false,
  status: 'sent',
  lastSentAt: null,
  sendCount: 0,
  lastSendError: null,
  submittedAt: null,
  overridden: null,
  answers: null,
  teammates: [],
  suggestedCompany: null,
  ...over,
})

describe('autoAssignGroups', () => {
  const by = { at: '2026-10-30T18:00:00Z', by: 'Event Manager' }
  const ids = (list: PlanningStudent[]) => list.map((s) => s.participantId)

  it('places submitted and overridden students, and pools the rest', () => {
    const groups = autoAssignGroups([
      student('submitted', { status: 'submitted' }),
      student('overridden-sent', { overridden: by }),
      student('overridden-waiting', { status: 'waiting', overridden: by }),
      student('sent'),
      student('not-sent', { status: 'not_sent' }),
    ])
    expect(ids(groups.placed)).toEqual(['submitted', 'overridden-sent', 'overridden-waiting'])
    expect(ids(groups.pool)).toEqual(['sent', 'not-sent'])
    expect(groups.locked).toEqual([])
  })

  it('leaves hand-placed students alone, overridden or not', () => {
    const groups = autoAssignGroups([
      student('locked-overridden', { locked: true, companyId: 'c1', companyNumber: 1, overridden: by }),
      student('locked-plain', { locked: true, companyId: 'c2', companyNumber: 2 }),
      // A stale lock with no company is not a hand placement.
      student('stale-lock', { locked: true, overridden: by }),
    ])
    expect(ids(groups.locked)).toEqual(['locked-overridden', 'locked-plain'])
    expect(ids(groups.placed)).toEqual(['stale-lock'])
    expect(groups.pool).toEqual([])
  })
})
