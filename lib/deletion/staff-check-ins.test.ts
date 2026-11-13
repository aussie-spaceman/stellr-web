import { beforeEach, describe, expect, it } from 'vitest'
import { purgeStaffCheckIns } from './staff-check-ins'

// Owner decision 13 Nov 2026 (tracker attendee-email-cohort.4): event staff
// check-ins leave with the account. An in-memory event_staff_check_ins that
// applies the filters the helper sends, so the test sees which rows are left.

type Row = { id: string; event_slug: string; staff_key: string; member_id: string | null }

let rows: Row[]
let failWith: string | null
const queries: { column: string; values: string[] }[] = []

const db = {
  from(table: string) {
    if (table !== 'event_staff_check_ins') throw new Error(`unexpected table ${table}`)
    return {
      delete: () => ({
        in: (column: keyof Row, values: string[]) => ({
          select: async () => {
            queries.push({ column, values })
            if (failWith) return { data: null, error: { message: failWith } }
            const gone = rows.filter((r) => values.includes(r[column] as string))
            rows = rows.filter((r) => !gone.includes(r))
            return { data: gone.map((r) => ({ id: r.id })), error: null }
          },
        }),
      }),
    }
  },
} as unknown as Parameters<typeof purgeStaffCheckIns>[0]

const LEAVING_LOGIN = 'user_leaving_placeholder'
const OTHER_LOGIN = 'user_other_placeholder'
const LEAVING_MEMBER = '11111111-1111-4111-8111-111111111111'
const OTHER_MEMBER = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  failWith = null
  queries.length = 0
  rows = [
    // The leaving person, as an event manager with no members row, at two events.
    { id: 'r1', event_slug: 'colorado', staff_key: `m.${LEAVING_LOGIN}`, member_id: null },
    { id: 'r2', event_slug: 'tenant-event', staff_key: `m.${LEAVING_LOGIN}`, member_id: null },
    // The leaving person, as a volunteer mentor.
    { id: 'r3', event_slug: 'colorado', staff_key: `v.${LEAVING_MEMBER}`, member_id: LEAVING_MEMBER },
    // Everyone else at the same events.
    { id: 'r4', event_slug: 'colorado', staff_key: `m.${OTHER_LOGIN}`, member_id: null },
    { id: 'r5', event_slug: 'colorado', staff_key: `v.${OTHER_MEMBER}`, member_id: OTHER_MEMBER },
    { id: 'r6', event_slug: 'tenant-event', staff_key: `m.${OTHER_LOGIN}`, member_id: OTHER_MEMBER },
  ]
})

const left = () => rows.map((r) => r.id).sort()

describe('purgeStaffCheckIns', () => {
  it("removes a login's event-manager check-ins at every event, and no one else's", async () => {
    const r = await purgeStaffCheckIns(db, { clerkUserId: LEAVING_LOGIN })
    expect(r).toEqual({ ok: true, removed: 2 })
    expect(left()).toEqual(['r3', 'r4', 'r5', 'r6'])
  })

  it("removes a member's check-ins by member_id and by v.<id> key, and no one else's", async () => {
    rows.push({ id: 'r7', event_slug: 'nevada', staff_key: `v.${LEAVING_MEMBER}`, member_id: null })
    const r = await purgeStaffCheckIns(db, { memberIds: [LEAVING_MEMBER] })
    expect(r).toEqual({ ok: true, removed: 2 })
    expect(left()).toEqual(['r1', 'r2', 'r4', 'r5', 'r6'])
  })

  it('removes both kinds together for a login linked to a member', async () => {
    const r = await purgeStaffCheckIns(db, { clerkUserId: LEAVING_LOGIN, memberIds: [LEAVING_MEMBER] })
    expect(r).toEqual({ ok: true, removed: 3 })
    expect(left()).toEqual(['r4', 'r5', 'r6'])
  })

  it('is idempotent: a second run removes nothing more', async () => {
    await purgeStaffCheckIns(db, { clerkUserId: LEAVING_LOGIN, memberIds: [LEAVING_MEMBER] })
    const again = await purgeStaffCheckIns(db, { clerkUserId: LEAVING_LOGIN, memberIds: [LEAVING_MEMBER] })
    expect(again).toEqual({ ok: true, removed: 0 })
    expect(left()).toEqual(['r4', 'r5', 'r6'])
  })

  it('sends no query when there is nobody to remove', async () => {
    expect(await purgeStaffCheckIns(db, { clerkUserId: null, memberIds: [null, undefined, ''] })).toEqual({ ok: true, removed: 0 })
    expect(queries).toEqual([])
    expect(left()).toHaveLength(6)
  })

  it('matches a login only by its exact key, never by pattern', async () => {
    // A value the key shape refuses cannot name a row, so it is not sent at all.
    expect(await purgeStaffCheckIns(db, { clerkUserId: 'user_%' })).toEqual({ ok: true, removed: 0 })
    expect(queries).toEqual([])
    // A prefix of another login's id removes nothing.
    expect(await purgeStaffCheckIns(db, { clerkUserId: 'user_other' })).toEqual({ ok: true, removed: 0 })
    expect(left()).toHaveLength(6)
  })

  it('reports a failed delete instead of throwing', async () => {
    failWith = 'connection reset'
    expect(await purgeStaffCheckIns(db, { clerkUserId: LEAVING_LOGIN })).toEqual({
      ok: false,
      error: 'event_staff_check_ins: connection reset',
    })
  })
})
