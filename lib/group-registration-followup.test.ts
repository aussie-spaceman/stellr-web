import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  calls: [] as string[],
  dispatchAgreement: vi.fn(async (_db: unknown, ctx: { participantId: string }) => {
    h.calls.push(`agreement:${ctx.participantId}`)
    return 'issued'
  }),
  sendGroupAccountInvite: vi.fn(async (_db: unknown, memberId: string) => {
    h.calls.push(`invite:${memberId}`)
    return { sent: true }
  }),
  notifyClearanceRequired: vi.fn(async (_db: unknown, input: { memberId: string }) => {
    h.calls.push(`clearance:${input.memberId}`)
    return { sent: true }
  }),
}))

vi.mock('@/lib/docusign-agreements', () => ({ dispatchAgreement: h.dispatchAgreement }))
vi.mock('@/lib/esign/outbox', () => ({ batchInvites: async (_db: unknown, fn: () => Promise<unknown>) => fn() }))
vi.mock('@/lib/member-invite', () => ({ sendGroupAccountInvite: h.sendGroupAccountInvite }))
vi.mock('@/lib/compliance-notify', () => ({ notifyClearanceRequired: h.notifyClearanceRequired }))

const { runGroupRegistrationFollowUp } = await import('./group-registration-followup')

const person = (id: string, role: string, dob: string, isRegistrant = false) => ({
  isRegistrant,
  agreement: {
    participantId: `p-${id}`, memberId: `m-${id}`, eventSlug: 'mn', eventTitle: 'MN',
    firstName: id, lastName: 'X', email: `${id}@example.com`, eventRole: role, dateOfBirth: dob,
  },
})

const people = [
  person('teacher', 'teacher', '1970-01-01', true),
  person('s1', 'participant', '2011-05-01'),
  person('s2', 'participant', '2011-06-01'),
]

const input = (deadline: number) => ({
  eventSlug: 'mn', eventTitle: 'MN', organiserName: 'T X', people, deadline,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.calls.length = 0
})

describe('runGroupRegistrationFollowUp', () => {
  it('sends the clearance notice first, then every agreement, then logins for everyone but the organiser', async () => {
    const r = await runGroupRegistrationFollowUp({} as never, input(Date.now() + 60_000))
    expect(h.calls).toEqual([
      'clearance:m-teacher',
      'agreement:p-teacher', 'agreement:p-s1', 'agreement:p-s2',
      'invite:m-s1', 'invite:m-s2',
    ])
    expect(r.agreements).toEqual({ issued: 3 })
    expect(r.invites).toEqual({ sent: 2 })
    expect(r.deferred).toEqual({ agreements: 0, invites: 0 })
  })

  it('stops starting slow work at the deadline and reports what it left for the sweep', async () => {
    const r = await runGroupRegistrationFollowUp({} as never, input(Date.now() - 1))
    // The clearance notice is cheap and never starved; nothing else starts.
    expect(h.calls).toEqual(['clearance:m-teacher'])
    expect(r.deferred).toEqual({ agreements: 3, invites: 2 })
  })

  it('a failing invite does not stop the rest', async () => {
    h.sendGroupAccountInvite.mockRejectedValueOnce(new Error('clerk down'))
    const r = await runGroupRegistrationFollowUp({} as never, input(Date.now() + 60_000))
    expect(r.invites).toEqual({ error: 1, sent: 1 })
  })
})
