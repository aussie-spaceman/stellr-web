import { describe, it, expect, vi, beforeEach } from 'vitest'

// sendGroupAccountInvite: the login + "your account is ready" email for people
// a teacher registers in a group. The privacy policy promises a child under 13
// is not contacted before a parent consents, so that case is pinned here.

const h = vi.hoisted(() => ({
  member: null as Record<string, unknown> | null,
  completedAgreements: 0,
  updates: [] as Array<Record<string, unknown>>,
  ensureClerkUser: vi.fn(async () => ({ clerkUserId: 'user_1', created: true })),
  sendEmail: vi.fn(async () => {}),
  logActivity: vi.fn(async () => {}),
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
        if (table === 'participants') return Promise.resolve({ data: [{ id: 'p1' }] }).then(resolve)
        if (table === 'agreements' && op === 'count') return Promise.resolve({ count: h.completedAgreements }).then(resolve)
        return Promise.resolve({ data: null, error: null }).then(resolve)
      },
    })
    return chain
  }
  return { from } as never
}

vi.mock('@/lib/clerk-provisioning', () => ({ ensureClerkUser: h.ensureClerkUser }))
vi.mock('@/lib/email', () => ({
  sendEmail: h.sendEmail,
  accountInviteEmail: () => ({ subject: '', html: '', text: '' }),
  groupAccountCreatedEmail: () => ({ subject: 's', html: 'h', text: 't' }),
}))
vi.mock('@/lib/activity-log', () => ({ logActivity: h.logActivity }))
vi.mock('@/lib/env', () => ({ AUTH_APP_URL: 'https://app.example.org' }))

const { sendGroupAccountInvite } = await import('./member-invite')

const yearsAgo = (n: number) => {
  const d = new Date()
  d.setFullYear(d.getFullYear() - n)
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
})

describe('sendGroupAccountInvite', () => {
  it('creates the login and emails a student aged 13 or over straight away', async () => {
    h.member = { ...base, date_of_birth: yearsAgo(14) }
    expect(await sendGroupAccountInvite(makeDb(), 'm1', opts)).toEqual({ sent: true })
    expect(h.ensureClerkUser).toHaveBeenCalledWith('sam@example.com', 'Sam', 'Lee')
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
    expect(h.updates.some((u) => u.table === 'members' && 'account_invite_sent_at' in u)).toBe(true)
  })

  it('waits for a parent to sign before contacting a child under 13', async () => {
    h.member = { ...base, date_of_birth: yearsAgo(12) }
    expect(await sendGroupAccountInvite(makeDb(), 'm1', opts)).toEqual({ sent: false, reason: 'awaiting_consent' })
    expect(h.ensureClerkUser).not.toHaveBeenCalled()
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('emails a child under 13 once their consent form is signed', async () => {
    h.member = { ...base, date_of_birth: yearsAgo(12) }
    h.completedAgreements = 1
    expect(await sendGroupAccountInvite(makeDb(), 'm1', opts)).toEqual({ sent: true })
  })

  it('never sends twice, and skips anyone who already has a login', async () => {
    h.member = { ...base, date_of_birth: yearsAgo(15), account_invite_sent_at: '2026-10-28T00:00:00Z' }
    expect(await sendGroupAccountInvite(makeDb(), 'm1', opts)).toEqual({ sent: false, reason: 'already_invited' })
    h.member = { ...base, date_of_birth: yearsAgo(15), clerk_user_id: 'user_9' }
    expect(await sendGroupAccountInvite(makeDb(), 'm1', opts)).toEqual({ sent: false, reason: 'has_account' })
    expect(h.sendEmail).not.toHaveBeenCalled()
  })
})
