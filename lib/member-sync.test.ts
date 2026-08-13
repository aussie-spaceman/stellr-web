import { describe, it, expect, vi } from 'vitest'
import { upsertMember, fillBlanksFromStored } from '@/lib/member-sync'

vi.mock('@/lib/member-roles', () => ({ syncMemberClassificationRole: vi.fn() }))

// Minimal Supabase stub: records the update payload so we can assert exactly
// which columns a merge touches.
function makeDb(existingMember: { id: string; event_role?: string } | null) {
  const calls: { updates: Record<string, unknown>[]; inserts: Record<string, unknown>[] } = {
    updates: [], inserts: [],
  }
  const db = {
    from() {
      const q: Record<string, unknown> = {}
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data: q.mode === 'insert' ? { id: 'new-id' } : existingMember, error: null,
        }),
        update: (payload: Record<string, unknown>) => {
          calls.updates.push(payload)
          return { eq: async () => ({ error: null }) }
        },
        insert: (payload: Record<string, unknown>) => {
          calls.inserts.push(payload)
          q.mode = 'insert'
          return chain
        },
      }
      return chain
    },
  }
  return { db: db as never, calls }
}

describe('upsertMember — email cross-reference against existing members', () => {
  it('updates the matched member and never blanks fields left empty', async () => {
    const { db, calls } = makeDb({ id: 'existing-1', event_role: 'teacher' })

    const id = await upsertMember(db, {
      email: '  Jane@Example.COM ',
      first_name: 'Jane',
      last_name: 'Doe',
      phone: '',                       // left blank — must not wipe stored phone
      date_of_birth: '',               // left blank — must not wipe stored DOB
      gender: '',                      // unrecognised — must not wipe
      t_shirt_size: 'L',               // submitted — must win
      grade: '11',
      age_bracket: 'high_school',
      event_role: 'Student',
      ec_first_name: 'Sam',
      ec_email: 'SAM@example.com',
      ec_phone: '',                    // blank — must not wipe
    })

    expect(id).toBe('existing-1')
    expect(calls.inserts).toHaveLength(0)
    const patch = calls.updates[0]

    // Submitted values are applied...
    expect(patch.first_name).toBe('Jane')
    expect(patch.tshirt_size).toBe('L')
    expect(patch.grade).toBe('grade_11')
    expect(patch.event_role).toBe('participant')
    expect(patch.ec_first_name).toBe('Sam')
    expect(patch.ec_email).toBe('sam@example.com')   // normalised

    // ...blanks are absent from the patch entirely, so stored values survive.
    expect(patch).not.toHaveProperty('phone')
    expect(patch).not.toHaveProperty('date_of_birth')
    expect(patch).not.toHaveProperty('gender')
    expect(patch).not.toHaveProperty('ec_phone')
  })

  it('keeps an existing role when none was submitted (no demotion to subscriber)', async () => {
    const { db, calls } = makeDb({ id: 'existing-2', event_role: 'teacher' })
    await upsertMember(db, { email: 'a@b.com', first_name: 'A', last_name: 'B' })
    expect(calls.updates[0]).not.toHaveProperty('event_role')
  })

  it('creates a member when the email is not on file', async () => {
    const { db, calls } = makeDb(null)
    const id = await upsertMember(db, {
      email: 'New@Person.com', first_name: 'New', last_name: 'Person',
      date_of_birth: '2010-04-10', gender: 'Female', age_bracket: 'high_school', event_role: 'Student',
    })
    expect(id).toBe('new-id')
    expect(calls.updates).toHaveLength(0)
    expect(calls.inserts[0].email).toBe('new@person.com')
    expect(calls.inserts[0].event_role).toBe('participant')
  })

  it('returns null without writing when there is no email', async () => {
    const { db, calls } = makeDb(null)
    expect(await upsertMember(db, { email: '  ', first_name: 'X', last_name: 'Y' })).toBeNull()
    expect(calls.inserts).toHaveLength(0)
    expect(calls.updates).toHaveLength(0)
  })
})

// The organiser group form must batch its roster into one upsert, and
// ON CONFLICT DO UPDATE overwrites every column in the payload — so blanks are
// pre-filled from the stored row before the batch runs.
describe('fillBlanksFromStored — batched upsert keeps its merge guarantee', () => {
  it('fills blanks from the stored row without touching submitted values', () => {
    const payload: Record<string, unknown> = {
      email: 'jane@example.com',
      first_name: 'Jane',
      phone: null,              // organiser left it blank
      date_of_birth: '',        // blank
      ec_phone: '   ',          // whitespace only
      tshirt_size: 'L',         // submitted — must win
      grade: null,
    }
    fillBlanksFromStored(payload, {
      email: 'SHOULD-NOT-BE-COPIED@example.com',
      first_name: 'Janet',
      phone: '555-0100',
      date_of_birth: '2010-04-10',
      ec_phone: '555-0199',
      tshirt_size: 'S',
      grade: null,              // nothing on file either — stays null
    })

    expect(payload.phone).toBe('555-0100')
    expect(payload.date_of_birth).toBe('2010-04-10')
    expect(payload.ec_phone).toBe('555-0199')
    expect(payload.first_name).toBe('Jane')          // submitted wins
    expect(payload.tshirt_size).toBe('L')            // submitted wins
    expect(payload.grade).toBeNull()                 // nothing to fill from
    expect(payload.email).toBe('jane@example.com')   // match key never overwritten
  })

  it('leaves a payload untouched when nothing is on file', () => {
    const payload: Record<string, unknown> = { email: 'new@example.com', phone: null }
    fillBlanksFromStored(payload, { email: 'new@example.com', phone: null })
    expect(payload.phone).toBeNull()
  })
})
