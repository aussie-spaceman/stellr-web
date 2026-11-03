import { describe, it, expect, vi, beforeEach } from 'vitest'

// sendGroupAccountInvite: the login + "your account is ready" email for people
// a teacher registers in a group. sendAccountInvite: the admin's "activate your
// account" email for a hand-created member. The privacy policy promises a child
// under 13 is not contacted before a parent consents; since S0 (2 Nov 2026)
// both go through the COPPA guard in lib/clerk-provisioning, which runs for
// real here — only Clerk itself is faked.

const h = vi.hoisted(() => ({
  member: null as Record<string, unknown> | null,
  participants: [{ id: 'p1', date_of_birth: null }] as Array<{ id: string; date_of_birth: string | null }>,
  completedAgreements: 0,
  updates: [] as Array<Record<string, unknown>>,
  getUserList: vi.fn(async () => ({ data: [] as Array<{ id: string }> })),
  createUser: vi.fn(async () => ({ id: 'user_1' })),
  sendEmail: vi.fn(async () => {}),
  logActivity: vi.fn(async (_entry: Record<string, unknown>) => {}),
}))

function makeDb() {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {}
    let op = 'select'
    Object.assign(chain, {
      select: (_cols?: string, opts?: { head?: boolean }) => { if (opts?.head) op = 'count'; return chain },
      update: (p: Record<string, unknown>) => { op = 'update'; h.updates.push({ table, ...p }); return chain },
      eq: () => chain, in: () => chain, is: () => chain,
      maybeSingle: async () => ({ data: table === 'members' ? h.member : null }),
      then: (resolve: (v: unknown) => unknown) => {
        if (table === 'participants') return Promise.resolve({ data: h.participants }).then(resolve)
        if (table === 'agreements' && op === 'count') return Promise.resolve({ count: h.completedAgreements }).then(resolve)
        return Promise.resolve({ data: null, error: null }).then(resolve)
      },
    })
    return chain
  }
  return { from } as never
}

vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({ users: { getUserList: h.getUserList, createUser: h.createUser } }),
}))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: () => {} }))
vi.mock('@/lib/email', () => ({
  sendEmail: h.sendEmail,
  accountInviteEmail: () => ({ subject: '', html: '', text: '' }),
  groupAccountCreatedEmail: () => ({ subject: 's', html: 'h', text: 't' }),
}))
vi.mock('@/lib/activity-log', () => ({ logActivity: h.logActivity }))
vi.mock('@/lib/env', () => ({ AUTH_APP_URL: 'https://app.example.org' }))

const { sendGroupAccountInvite, sendAccountInvite, isAdultByRole } = await import('./member-invite')
const { appToday } = await import('./age')

/** A date of birth `n` years before the app's today, less `extraDays`. */
const yearsAgo = (n: number, extraDays = 0) => {
  const d = appToday()
  d.setUTCFullYear(d.getUTCFullYear() - n)
  d.setUTCDate(d.getUTCDate() - extraDays)
  return d.toISOString().slice(0, 10)
}

const base = {
  id: 'm1', first_name: 'Sam', last_name: 'Lee', email: 'sam@example.com', clerk_user_id: null,
  account_invite_sent_at: null, is_active: true, deleted_at: null,
}
const opts = { eventTitle: 'Minnesota EDC', organiserName: 'A Teacher' }

beforeEach(() => {
  vi.clearAllMocks()
  h.updates.length = 0
  h.completedAgreements = 0
  h.participants = [{ id: 'p1', date_of_birth: null }]
  h.getUserList.mockResolvedValue({ data: [] })
  h.createUser.mockResolvedValue({ id: 'user_1' })
})

const linked = () => h.updates.some((u) => u.table === 'members' && u.clerk_user_id === 'user_1')

describe('sendGroupAccountInvite', () => {
  it('creates the login and emails a student aged 13 or over straight away', async () => {
    h.member = { ...base, date_of_birth: yearsAgo(14) }
    expect(await sendGroupAccountInvite(makeDb(), 'm1', opts)).toEqual({ sent: true })
    expect(h.createUser).toHaveBeenCalledWith(expect.objectContaining({ emailAddress: ['sam@example.com'], firstName: 'Sam', lastName: 'Lee' }))
    expect(linked()).toBe(true)
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
    expect(h.updates.some((u) => u.table === 'members' && 'account_invite_sent_at' in u)).toBe(true)
  })

  it('treats 13 today as 13', async () => {
    h.member = { ...base, date_of_birth: yearsAgo(13) }
    expect(await sendGroupAccountInvite(makeDb(), 'm1', opts)).toEqual({ sent: true })
  })

  it('waits for a parent to sign before contacting a child under 13', async () => {
    h.member = { ...base, date_of_birth: yearsAgo(13, -1) } // 13 tomorrow
    expect(await sendGroupAccountInvite(makeDb(), 'm1', opts)).toEqual({ sent: false, reason: 'awaiting_consent' })
    expect(h.getUserList).not.toHaveBeenCalled()
    expect(h.createUser).not.toHaveBeenCalled()
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('emails a child under 13 once their consent form is signed', async () => {
    h.member = { ...base, date_of_birth: yearsAgo(12) }
    h.completedAgreements = 1
    expect(await sendGroupAccountInvite(makeDb(), 'm1', opts)).toEqual({ sent: true })
    expect(h.createUser).toHaveBeenCalledTimes(1)
  })

  it('reads a member with no usable date of birth from their participant row (the youngest one)', async () => {
    // An existing member who joined through a link keeps a null member DOB;
    // their participant row has one. An adult is not held for consent…
    h.member = { ...base, date_of_birth: null }
    h.participants = [{ id: 'p1', date_of_birth: yearsAgo(30) }]
    expect(await sendGroupAccountInvite(makeDb(), 'm1', opts)).toEqual({ sent: true })

    // …a child is, and when rows disagree the youngest reading wins.
    vi.clearAllMocks()
    h.member = { ...base, date_of_birth: 'not a date' }
    h.participants = [{ id: 'p1', date_of_birth: yearsAgo(30) }, { id: 'p2', date_of_birth: yearsAgo(12) }]
    expect(await sendGroupAccountInvite(makeDb(), 'm1', opts)).toEqual({ sent: false, reason: 'awaiting_consent' })
    expect(h.createUser).not.toHaveBeenCalled()
  })

  it('holds anyone with no usable date of birth anywhere, as if under 13', async () => {
    h.member = { ...base, date_of_birth: null }
    h.participants = []
    expect(await sendGroupAccountInvite(makeDb(), 'm1', opts)).toEqual({ sent: false, reason: 'awaiting_consent' })
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('still sends when Clerk fails after the age check passed', async () => {
    h.member = { ...base, date_of_birth: yearsAgo(15) }
    h.getUserList.mockRejectedValue(new Error('clerk 500'))
    expect(await sendGroupAccountInvite(makeDb(), 'm1', opts)).toEqual({ sent: true })
    expect(linked()).toBe(false)
  })

  it('never sends twice, and skips anyone who already has a login', async () => {
    h.member = { ...base, date_of_birth: yearsAgo(15), account_invite_sent_at: '2026-10-28T00:00:00Z' }
    expect(await sendGroupAccountInvite(makeDb(), 'm1', opts)).toEqual({ sent: false, reason: 'already_invited' })
    h.member = { ...base, date_of_birth: yearsAgo(15), clerk_user_id: 'user_9' }
    expect(await sendGroupAccountInvite(makeDb(), 'm1', opts)).toEqual({ sent: false, reason: 'has_account' })
    expect(h.sendEmail).not.toHaveBeenCalled()
  })
})

describe('sendAccountInvite (admin, hand-created member)', () => {
  const admin = { ...base, gender: null, age_bracket: 'adult', event_role: 'teacher' }

  it('creates the login and emails an adult whose date of birth is on file', async () => {
    h.member = { ...admin, date_of_birth: yearsAgo(40) }
    expect(await sendAccountInvite(makeDb(), 'm1', { actorMemberId: 'admin1' })).toEqual({ sent: true })
    expect(h.createUser).toHaveBeenCalledTimes(1)
    expect(linked()).toBe(true)
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('gives a child under 13 no login and no email until a parent has signed', async () => {
    h.member = { ...admin, age_bracket: 'high_school', event_role: 'participant', date_of_birth: yearsAgo(12) }
    expect(await sendAccountInvite(makeDb(), 'm1')).toEqual({ sent: false, reason: 'awaiting_consent' })
    expect(h.createUser).not.toHaveBeenCalled()
    expect(h.sendEmail).not.toHaveBeenCalled()

    h.completedAgreements = 1
    expect(await sendAccountInvite(makeDb(), 'm1')).toEqual({ sent: true })
  })

  it('lets an adult the admin recorded (bracket and role) through with no date of birth, and logs it', async () => {
    h.member = { ...admin, date_of_birth: null }
    expect(await sendAccountInvite(makeDb(), 'm1', { actorMemberId: 'admin1' })).toEqual({ sent: true })
    expect(h.createUser).toHaveBeenCalledTimes(1)
    expect(h.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'account_login_adult_by_role', actorMemberId: 'admin1', memberId: 'm1' }),
      expect.anything(),
    )
  })

  it('asks for a date of birth when nothing says the member is an adult', async () => {
    for (const m of [
      { ...admin, event_role: 'subscriber' },
      { ...admin, age_bracket: 'high_school' },
      { ...admin, age_bracket: null, event_role: null },
    ]) {
      h.member = { ...m, date_of_birth: null }
      expect(await sendAccountInvite(makeDb(), 'm1')).toEqual({ sent: false, reason: 'age_unknown' })
    }
    expect(h.createUser).not.toHaveBeenCalled()
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('never lets an adult record override a date of birth that says under 13', async () => {
    h.member = { ...admin, date_of_birth: yearsAgo(11) }
    expect(await sendAccountInvite(makeDb(), 'm1')).toEqual({ sent: false, reason: 'awaiting_consent' })
    expect(h.createUser).not.toHaveBeenCalled()
  })

  it('emails a member who already has a login without touching Clerk', async () => {
    h.member = { ...admin, date_of_birth: null, event_role: 'subscriber', clerk_user_id: 'user_9' }
    expect(await sendAccountInvite(makeDb(), 'm1')).toEqual({ sent: true })
    expect(h.getUserList).not.toHaveBeenCalled()
  })
})

describe('isAdultByRole', () => {
  it('needs an adult bracket and an adult role', () => {
    expect(isAdultByRole({ age_bracket: 'adult', event_role: 'teacher' })).toBe(true)
    expect(isAdultByRole({ age_bracket: 'college', event_role: 'mentor' })).toBe(true)
    expect(isAdultByRole({ age_bracket: 'adult', event_role: 'subscriber' })).toBe(false)
    expect(isAdultByRole({ age_bracket: 'high_school', event_role: 'teacher' })).toBe(false)
    expect(isAdultByRole({})).toBe(false)
  })
})
