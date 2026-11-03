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
const { appToday } = await import('@/lib/age')

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
    ['missing', undefined, 'dob_missing'],
    ['unreadable', '31/12/2012', 'dob_invalid'],
    ['impossible', '2013-02-30', 'dob_invalid'],
    ['in the future', '2030-05-01', 'dob_invalid'],
  ])('a date of birth that is %s is a 400 before any member, participant or agreement', async (_l, dob, code) => {
    const res = await post({ ...person, date_of_birth: dob })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe(code)
    expect(json.error).toMatch(/date of birth for Ana Ruiz/)
    expect(h.upsertMember).not.toHaveBeenCalled()
    expect(h.partInsert).not.toHaveBeenCalled()
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('a Member-ID-linked person with no date of birth on file is refused with a way forward', async () => {
    h.onFile = { memberId: 'm-linked', first_name: 'Lee', last_name: 'Ng', email: 'lee@x.com', date_of_birth: null, event_role: 'participant' }
    const res = await post({ linked: true, membership_id: 'STL-1', event_role: 'Student' })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('dob_missing')
    expect(json.error).toMatch(/don't have a date of birth on file for this Stellr Member ID/)
    expect(h.partInsert).not.toHaveBeenCalled()
  })

  it('a Member-ID-linked person whose date of birth on file is wrong is asked to correct it', async () => {
    h.onFile = { memberId: 'm-linked', first_name: 'Lee', last_name: 'Ng', email: 'lee@x.com', date_of_birth: '2999-01-01', event_role: 'participant' }
    const res = await post({ linked: true, membership_id: 'STL-1', event_role: 'Student' })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('dob_invalid')
    expect(json.error).toMatch(/date of birth on file for this Stellr Member ID doesn't look right/)
    expect(json.error).toMatch(/contact Stellr to correct it/)
    expect(h.partInsert).not.toHaveBeenCalled()
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('a real past date is saved as YYYY-MM-DD, as before', async () => {
    const res = await post({ ...person, date_of_birth: '2012-03-04' })
    expect(res.status).toBe(201)
    expect(h.upsertMember).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ date_of_birth: '2012-03-04' }), { onExisting: 'skip' })
    expect(h.partInsert).toHaveBeenCalledWith(expect.objectContaining({ date_of_birth: '2012-03-04', member_id: 'm-new' }))
  })

  it("never rewrites an existing member's record: the organiser's details stay on the participant row", async () => {
    // An organiser naming a child's email with an adult date and role used to
    // overwrite the child's member row, which the COPPA guard reads first.
    const res = await post({ ...person, date_of_birth: '1990-01-01', event_role: 'Adult', age_bracket: 'adult' })
    expect(res.status).toBe(201)
    expect(h.upsertMember).toHaveBeenCalledWith(expect.anything(), expect.anything(), { onExisting: 'skip' })
    expect(h.partInsert).toHaveBeenCalledWith(expect.objectContaining({ date_of_birth: '1990-01-01', event_role: 'adult' }))
  })
})

describe('POST /api/members/teams/[id]/participants — a minor takes part as a student', () => {
  /** A date of birth `n` years before the app's today, less `extraDays`. */
  const yearsAgo = (n: number, extraDays = 0) => {
    const d = appToday()
    d.setUTCFullYear(d.getUTCFullYear() - n)
    d.setUTCDate(d.getUTCDate() - extraDays)
    return d.toISOString().slice(0, 10)
  }

  it.each([
    ['12', yearsAgo(13, -1)],
    ['13', yearsAgo(13)],
    ['14', yearsAgo(14)],
    ['17', yearsAgo(17)],
  ])('aged %s, an adult role and bracket are stored as participant / high school', async (_age, dob) => {
    const res = await post({ ...person, date_of_birth: dob, event_role: 'Mentor', age_bracket: 'adult' })
    expect(res.status).toBe(201)
    expect(h.partInsert).toHaveBeenCalledWith(expect.objectContaining({ event_role: 'participant', age_bracket: 'high_school' }))
    expect(h.upsertMember).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event_role: 'participant', age_bracket: 'high_school' }),
      { onExisting: 'skip' },
    )
  })

  it('a school student manager who is a minor stays one', async () => {
    await post({ ...person, date_of_birth: yearsAgo(15), event_role: 'school_student_manager', age_bracket: 'adult' })
    expect(h.partInsert).toHaveBeenCalledWith(expect.objectContaining({ event_role: 'school_student_manager', age_bracket: 'high_school' }))
  })

  it('an adult keeps the role and bracket the organiser picked', async () => {
    await post({ ...person, date_of_birth: yearsAgo(30), event_role: 'Mentor', age_bracket: 'adult' })
    expect(h.partInsert).toHaveBeenCalledWith(expect.objectContaining({ event_role: 'mentor', age_bracket: 'adult' }))
  })
})
