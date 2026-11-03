import { describe, it, expect, vi, beforeEach } from 'vitest'

// S0 (2 Nov 2026): an organiser adding someone from the Teams tab gets the
// registration routes' date-of-birth check. A typo (a future date, an
// unreadable one) used to reach the member row and the agreement, and the
// person was then swept for a login.

const h = vi.hoisted(() => ({
  partInsert: vi.fn(),
  upsertMember: vi.fn(async (_db: unknown, _m: Record<string, unknown>) => 'm-new'),
  dispatch: vi.fn(async () => {}),
  onFile: null as Record<string, unknown> | null,
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'user_org' }) }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/team-access', () => ({ ownsTeam: () => true }))
vi.mock('@/lib/member-sync', () => ({ upsertMember: h.upsertMember }))
vi.mock('@/lib/member-onfile', () => ({ getMemberOnFileByMembershipId: async () => h.onFile }))
vi.mock('@/lib/school-link', () => ({ linkMembersToRegistrationSchool: async () => {} }))
vi.mock('@/lib/event-participation-sync', () => ({ recordEventParticipationForRegistration: async () => {} }))
vi.mock('@/lib/docusign-agreements', () => ({ dispatchAgreement: h.dispatch }))
vi.mock('@/lib/individual-payment', () => ({ ensureIndividualPayments: async () => {} }))
vi.mock('@/lib/group-billing', () => ({ applyRosterChange: async () => ({ message: null, action: 'none' }) }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => null }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      let op = 'select'
      let payload: Record<string, unknown> = {}
      const result = () => {
        if (table === 'members') return { data: { id: 'm-org', email: 'org@example.com' }, error: null }
        if (table === 'registrations') return { data: { id: 'reg-1', event_slug: 'colorado', event_title: 'Colorado' }, error: null }
        if (table === 'participants' && op === 'insert') return { data: { id: 'p-1', ...payload }, error: null }
        return { data: null, error: null }
      }
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, or: () => chain,
        insert: (p: Record<string, unknown>) => { op = 'insert'; payload = p; h.partInsert(p); return chain },
        maybeSingle: async () => result(), single: async () => result(),
      }
      return chain
    },
  }),
}))

const { POST } = await import('./route')

function post(b: Record<string, unknown>) {
  return POST(
    new Request('https://app.stellreducation.org/api/members/teams/reg-1/participants', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
    }) as never,
    { params: Promise.resolve({ id: 'reg-1' }) },
  )
}

const person = { first_name: 'Ana', last_name: 'Ruiz', email: 'ana@example.com', event_role: 'Student' }

beforeEach(() => {
  vi.clearAllMocks()
  h.onFile = null
})

describe('POST /api/members/teams/[id]/participants — S0 date-of-birth check', () => {
  it.each([
    ['missing', undefined],
    ['unreadable', '31/12/2012'],
    ['in the future', '2030-05-01'],
  ])('a date of birth that is %s is a 400 before any member, participant or agreement', async (_l, dob) => {
    const res = await post({ ...person, date_of_birth: dob })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/date of birth for Ana Ruiz/)
    expect(h.upsertMember).not.toHaveBeenCalled()
    expect(h.partInsert).not.toHaveBeenCalled()
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('a Member-ID-linked person with no date of birth on file is refused with a way forward', async () => {
    h.onFile = { memberId: 'm-linked', first_name: 'Lee', last_name: 'Ng', email: 'lee@x.com', date_of_birth: null, event_role: 'participant' }
    const res = await post({ linked: true, membership_id: 'STL-1', event_role: 'Student' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Stellr Member ID/)
    expect(h.partInsert).not.toHaveBeenCalled()
  })

  it('a real past date is saved as YYYY-MM-DD, as before', async () => {
    const res = await post({ ...person, date_of_birth: '2012-03-04' })
    expect(res.status).toBe(201)
    expect(h.upsertMember).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ date_of_birth: '2012-03-04' }))
    expect(h.partInsert).toHaveBeenCalledWith(expect.objectContaining({ date_of_birth: '2012-03-04', member_id: 'm-new' }))
  })
})
