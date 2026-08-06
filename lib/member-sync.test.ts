import { describe, it, expect, vi } from 'vitest'
import { upsertMember } from '@/lib/member-sync'

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
