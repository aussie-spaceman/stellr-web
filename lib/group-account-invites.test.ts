import { describe, it, expect, vi, beforeEach } from 'vitest'
import { appToday } from '@/lib/age'

// The daily login catch-up (lib/group-account-invites). S0 (2 Nov 2026): a
// child under 13 who registered themselves — an individual registrant, or a
// group's student organiser — is refused a login at registration, and before
// this nothing ever made one once their parent signed. The sweep now picks
// them up, and only them: anyone else who registered themselves either has a
// login already or was deliberately given none.

const h = vi.hoisted(() => ({
  send: vi.fn(async (_db: unknown, _id: string, _o: { eventTitle: string; organiserName?: string | null }) => ({ sent: true }) as { sent: true }),
}))
vi.mock('@/lib/member-invite', () => ({ sendGroupAccountInvite: h.send }))

const { sweepGroupAccountInvites } = await import('./group-account-invites')

/** A date of birth `n` years before the app's today, less `extraDays`. */
const yearsAgo = (n: number, extraDays = 0) => {
  const d = appToday()
  d.setUTCFullYear(d.getUTCFullYear() - n)
  d.setUTCDate(d.getUTCDate() - extraDays)
  return d.toISOString().slice(0, 10)
}

type Reg = { type: string; status: string; event_title: string; teacher_member_id: string | null; teacher_first_name: string | null; teacher_last_name: string | null }
type Row = { member_id: string; date_of_birth: string | null; registrations: Reg }
let rows: Row[]
let members: Array<{ id: string; date_of_birth: string | null; clerk_user_id?: string | null }>

const group = (teacher = 'm-teacher'): Reg => ({ type: 'group', status: 'pending', event_title: 'Nevada', teacher_member_id: teacher, teacher_first_name: 'Ada', teacher_last_name: 'Teach' })
const individual = (): Reg => ({ type: 'individual', status: 'pending', event_title: 'Nevada', teacher_member_id: null, teacher_first_name: null, teacher_last_name: null })

/** Honours the registration-type filter, so a sweep that asks only for groups sees only groups. */
function fakeDb() {
  return {
    from(table: string) {
      let types: string[] | null = null
      let ids: string[] = []
      const chain: Record<string, unknown> = {
        select: () => chain, not: () => chain, gte: () => chain, neq: () => chain, limit: () => chain, is: () => chain,
        eq: (c: string, v: string) => { if (c === 'registrations.type') types = [v]; return chain },
        in: (c: string, v: string[]) => { if (c === 'registrations.type') types = v; if (c === 'id') ids = v; return chain },
        then: (f: (v: unknown) => unknown) => {
          if (table === 'participants') {
            return Promise.resolve({ data: rows.filter((r) => !types || types.includes(r.registrations.type)), error: null }).then(f)
          }
          return Promise.resolve({ data: members.filter((m) => ids.includes(m.id) && !m.clerk_user_id), error: null }).then(f)
        },
      }
      return chain
    },
  } as never
}

const sentTo = () => h.send.mock.calls.map(([, id, o]) => [id, o.organiserName ?? null])

beforeEach(() => {
  vi.clearAllMocks()
  rows = []
  members = []
})

describe('sweepGroupAccountInvites', () => {
  it('invites a group student, naming their teacher, as before', async () => {
    rows = [{ member_id: 'm-stu', date_of_birth: yearsAgo(15), registrations: group() }]
    members = [{ id: 'm-stu', date_of_birth: yearsAgo(15) }]
    await sweepGroupAccountInvites(fakeDb())
    expect(sentTo()).toEqual([['m-stu', 'Ada Teach']])
  })

  it('picks up an individual registrant under 13, whose login waited for their parent', async () => {
    rows = [{ member_id: 'm-kid', date_of_birth: yearsAgo(12), registrations: individual() }]
    members = [{ id: 'm-kid', date_of_birth: yearsAgo(12) }]
    const r = await sweepGroupAccountInvites(fakeDb())
    expect(r.candidates).toBe(1)
    expect(sentTo()).toEqual([['m-kid', null]])
  })

  it("picks up a group's student organiser under 13 too, and leaves an adult organiser alone", async () => {
    rows = [
      { member_id: 'm-sm', date_of_birth: yearsAgo(12), registrations: group('m-sm') },
      { member_id: 'm-teacher', date_of_birth: yearsAgo(40), registrations: group('m-teacher') },
    ]
    members = [{ id: 'm-sm', date_of_birth: yearsAgo(12) }, { id: 'm-teacher', date_of_birth: yearsAgo(40) }]
    await sweepGroupAccountInvites(fakeDb())
    expect(sentTo()).toEqual([['m-sm', null]])
  })

  it('leaves alone anyone 13 or over who registered themselves', async () => {
    // They got a login at registration, or were deliberately given none (an
    // existing member named on an anonymous form): the sweep must not add one.
    rows = [
      { member_id: 'm-13', date_of_birth: yearsAgo(13), registrations: individual() },
      { member_id: 'm-14', date_of_birth: yearsAgo(14), registrations: individual() },
      { member_id: 'm-adult', date_of_birth: yearsAgo(30), registrations: individual() },
    ]
    members = rows.map((r) => ({ id: r.member_id, date_of_birth: r.date_of_birth }))
    const r = await sweepGroupAccountInvites(fakeDb())
    expect(r.candidates).toBe(0)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('leaves alone an existing adult member whose email was entered on a child registration', async () => {
    rows = [{ member_id: 'm-parent', date_of_birth: yearsAgo(12), registrations: individual() }]
    members = [{ id: 'm-parent', date_of_birth: yearsAgo(41) }]
    await sweepGroupAccountInvites(fakeDb())
    expect(h.send).not.toHaveBeenCalled()
  })

  it('a member registered both by a teacher and by themselves gets the email naming the teacher', async () => {
    rows = [
      { member_id: 'm-kid', date_of_birth: yearsAgo(12), registrations: individual() },
      { member_id: 'm-kid', date_of_birth: yearsAgo(12), registrations: group() },
    ]
    members = [{ id: 'm-kid', date_of_birth: yearsAgo(12) }]
    await sweepGroupAccountInvites(fakeDb())
    expect(sentTo()).toEqual([['m-kid', 'Ada Teach']])
  })

  it('skips anyone who already has a login', async () => {
    rows = [{ member_id: 'm-kid', date_of_birth: yearsAgo(12), registrations: individual() }]
    members = [{ id: 'm-kid', date_of_birth: yearsAgo(12), clerk_user_id: 'user_1' }]
    await sweepGroupAccountInvites(fakeDb())
    expect(h.send).not.toHaveBeenCalled()
  })
})
