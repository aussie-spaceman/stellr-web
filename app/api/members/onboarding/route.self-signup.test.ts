// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Decision 24 (3 Nov 2026): minors register themselves, controlled by age.
// MINOR_SELF_SIGNUP_ENABLED off keeps the 2 Oct 2026 refusal; on, the age
// screen comes first, 13–17 finish into the pending guardian-consent state and
// an under-13 gives only a first name, date of birth and a parent's email.

const { state } = vi.hoisted(() => ({
  state: {
    byClerk: null as Record<string, unknown> | null,
    byEmail: null as Record<string, unknown> | null,
    participants: [] as Array<{ id: string; date_of_birth: string | null }>,
    agreements: [] as Array<{ envelope_type: string; status: string; event_slug?: string }>,
    /** Rows opened at the age screen (no guardian yet). */
    screened: [] as Array<Record<string, unknown>>,
    /** openPendingConsent throws. */
    openFails: false,
    invited: false,
    sequence: [] as string[],
    writes: [] as Array<{ table: string; op: string; payload: unknown }>,
    opened: [] as Array<Record<string, unknown>>,
    sent: [] as string[],
    membershipDispatched: 0,
  },
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: 'clerk-1' }),
  currentUser: async () => ({
    emailAddresses: [{ id: 'e1', emailAddress: 'kid@example.test', verification: { status: 'verified' } }],
    primaryEmailAddressId: 'e1',
    firstName: 'Sam',
    lastName: 'Surname',
  }),
}))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from(table: string) {
      const filters: Array<[string, string, unknown]> = []
      const ors: string[] = []
      let op = 'select'
      let head = false
      let payload: unknown = null
      const eqOf = (col: string) => filters.find(([k, c]) => k === 'eq' && c === col)?.[2]
      const result = () => {
        if (op !== 'select') {
          state.writes.push({ table, op, payload })
          state.sequence.push(`${table}:${op}`)
          return { data: [{ id: eqOf('id') ?? 'm-new' }], error: null }
        }
        if (table === 'participants') {
          return head ? { count: state.participants.length, error: null } : { data: state.participants, error: null }
        }
        if (table === 'agreements') {
          const type = eqOf('envelope_type')
          const status = eqOf('status')
          const notMembership = ors.some((o) => o.includes('event_slug.neq.membership'))
          const n = state.agreements.filter((a) =>
            (!type || a.envelope_type === type) && (!status || a.status === status) &&
            (!notMembership || a.event_slug !== 'membership')).length
          return { count: n, data: [], error: null }
        }
        return { data: null, error: null }
      }
      const chain: Record<string, unknown> = {
        select: (_c?: string, opts?: { head?: boolean }) => { if (opts?.head) head = true; return chain },
        insert: (p: unknown) => { op = 'insert'; payload = p; return chain },
        update: (p: unknown) => { op = 'update'; payload = p; return chain },
        upsert: () => chain,
        eq: (c: string, v: unknown) => { filters.push(['eq', c, v]); return chain },
        is: (c: string, v: unknown) => { filters.push(['is', c, v]); return chain },
        in: () => chain,
        or: (f: string) => { ors.push(f); return chain },
        single: async () => {
          if (op === 'insert') {
            state.writes.push({ table, op, payload })
            state.sequence.push(`${table}:${op}`)
            return { data: { id: 'm-new' }, error: null }
          }
          return { data: null, error: null }
        },
        maybeSingle: async () => {
          if (table !== 'members') return { data: null, error: null }
          if (eqOf('clerk_user_id') !== undefined) return { data: state.byClerk, error: null }
          if (eqOf('email') !== undefined) return { data: state.byEmail, error: null }
          if (eqOf('id') !== undefined && filters.length === 1) {
            return { data: { id: eqOf('id'), account_invite_sent_at: state.invited ? '2026-10-01' : null, email: 'kid@example.test', first_name: 'A', last_name: 'B' }, error: null }
          }
          return { data: { id: eqOf('id'), email: 'kid@example.test', first_name: 'A', last_name: 'B' }, error: null }
        },
        then: (f: (v: unknown) => unknown) => Promise.resolve(result()).then(f),
      }
      return chain
    },
  }),
}))
vi.mock('@/lib/pending-consent', async (orig) => ({
  ...(await orig<typeof import('@/lib/pending-consent')>()),
  openPendingConsent: async (_db: unknown, input: Record<string, unknown>) => {
    if (state.openFails) throw new Error('insert failed')
    state.opened.push(input)
    state.sequence.push('pending:open')
  },
  openScreenedRequest: async (_db: unknown, input: Record<string, unknown>) => {
    state.screened.push(input)
    state.sequence.push('pending:screened')
  },
  sendConsentRequest: async (_db: unknown, memberId: string) => { state.sent.push(memberId); return { outcome: 'issued' } },
}))
vi.mock('@/lib/email-campaigns', () => ({ fireCampaignEvent: async () => {} }))
vi.mock('@/lib/membership-grants', () => ({ applyGrantTrigger: async () => {} }))
vi.mock('@/lib/activity-log', () => ({ logActivity: async () => {} }))
vi.mock('@/lib/volunteer', () => ({
  grantVolunteerRole: async () => {},
  dispatchVolunteerAgreement: async () => {},
  VOLUNTEER_MEMBER_COLUMNS: 'id',
}))
vi.mock('@/lib/member-roles', () => ({ syncMemberClassificationRole: async () => {} }))
vi.mock('@/lib/registration-notify', () => ({
  sendAccountConfirmation: async () => { state.sequence.push('email:confirmation') },
  notifyStaffOfRegistration: async () => {},
}))
vi.mock('@/lib/membership-agreement', () => ({
  MEMBERSHIP_SLUG: 'membership',
  dispatchMembershipAgreement: async () => { state.membershipDispatched += 1; return { signNowUrl: null } },
}))

const { POST } = await import('./route')
const { appToday } = await import('@/lib/age')

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/members/onboarding', { method: 'POST', body: JSON.stringify(body) }))

const yearsAgo = (n: number) => {
  const d = appToday()
  d.setUTCFullYear(d.getUTCFullYear() - n)
  return d.toISOString().slice(0, 10)
}
const student = (date_of_birth: string, over: Record<string, unknown> = {}) => ({
  event_role: 'participant', age_bracket: 'high_school', date_of_birth, gender: 'female', phone: '555-1234',
  grade: 'grade_10', tshirt_size: 'YM', school_id: 'school-1',
  ec_first_name: 'Pat', ec_last_name: 'Lee', ec_email: 'pat@example.test', ec_phone: '555-9876', ec_relationship: 'Parent',
  ...over,
})
const ADULT = { event_role: 'parent', age_bracket: 'adult', date_of_birth: yearsAgo(18), gender: 'female', phone: '555-1234' }
const memberWrites = () => state.writes.filter((w) => w.table === 'members')

const flagBefore = process.env.MINOR_SELF_SIGNUP_ENABLED
beforeEach(() => {
  state.byClerk = { id: 'm-1', is_active: true, date_of_birth: null, clerk_user_id: 'clerk-1' }
  state.byEmail = null
  state.participants = []
  state.agreements = []
  state.writes = []
  state.opened = []
  state.sent = []
  state.membershipDispatched = 0
  state.screened = []
  state.openFails = false
  state.invited = false
  state.sequence = []
})
afterEach(() => { process.env.MINOR_SELF_SIGNUP_ENABLED = flagBefore })

describe('flag OFF — minors keep the 2 Oct 2026 behaviour', () => {
  beforeEach(() => { delete process.env.MINOR_SELF_SIGNUP_ENABLED })

  it('has no age screen', async () => {
    expect((await post({ stage: 'age', date_of_birth: yearsAgo(15) })).status).toBe(404)
  })

  it('refuses a self-registering 12-, 13-, 15- or 17-year-old and opens nothing', async () => {
    for (const n of [12, 13, 15, 17]) {
      const res = await post(student(yearsAgo(n)))
      expect(res.status, String(n)).toBe(403)
      expect((await res.json()).code, String(n)).toBe('minor_self_signup_closed')
    }
    expect(state.opened).toEqual([])
    expect(memberWrites()).toEqual([])
  })

  it('lets an 18-year-old finish at once', async () => {
    const res = await post(ADULT)
    expect(res.status).toBe(200)
    expect((await res.json()).pendingConsent).toBeUndefined()
  })
})

describe('flag ON — the age screen', () => {
  beforeEach(() => { process.env.MINOR_SELF_SIGNUP_ENABLED = 'true' })

  it('answers the band for 12, 13, 15, 17 and 18', async () => {
    const expected: Record<number, string> = { 12: 'child', 13: 'teen', 15: 'teen', 17: 'teen', 18: 'adult' }
    for (const [n, band] of Object.entries(expected)) {
      const res = await post({ stage: 'age', date_of_birth: yearsAgo(Number(n)) })
      expect(res.status, n).toBe(200)
      expect((await res.json()).band, n).toBe(band)
    }
  })

  it('refuses an unknown or invalid date of birth', async () => {
    for (const date_of_birth of ['', 'not a date', '2999-01-01', '2010-13-45']) {
      expect((await post({ stage: 'age', date_of_birth })).status, date_of_birth).toBe(400)
    }
  })

  it("records a minor's date where none is on file, so it can't be changed by going back", async () => {
    await post({ stage: 'age', date_of_birth: yearsAgo(15) })
    expect(state.screened).toEqual([{ memberId: 'm-1', band: 'teen' }])
    expect(memberWrites()).toEqual([
      expect.objectContaining({ op: 'update', payload: { date_of_birth: yearsAgo(15), marketing_consent: false } }),
    ])
    state.writes = []
    await post({ stage: 'age', date_of_birth: yearsAgo(30) })
    expect(memberWrites()).toEqual([]) // an adult's answer is not recorded here
  })

  it('a minor on file cannot answer as an adult', async () => {
    state.byClerk = { id: 'm-1', is_active: true, date_of_birth: yearsAgo(15), clerk_user_id: 'clerk-1' }
    expect((await post({ stage: 'age', date_of_birth: yearsAgo(30) })).status).toBe(403)
    expect((await post(ADULT)).status).toBe(403)
  })

  it('an under-13 whose parent has consented gets the full minor form', async () => {
    state.agreements = [{ envelope_type: 'minor', status: 'completed' }]
    const res = await post({ stage: 'age', date_of_birth: yearsAgo(12) })
    expect(await res.json()).toEqual({ band: 'teen', consented: true })
  })
})

describe('flag ON — under 13 (COPPA)', () => {
  beforeEach(() => { process.env.MINOR_SELF_SIGNUP_ENABLED = 'true' })
  const child = (over: Record<string, unknown> = {}) => ({
    date_of_birth: yearsAgo(12), first_name: 'Sam', parent_email: 'Parent@Example.test', ...over,
  })

  it('keeps only first name, date of birth and the parent email, and asks the parent', async () => {
    const res = await post({ ...child(), gender: 'female', phone: '555', last_name: 'Surname' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, pendingConsent: 'parent' })
    const [write] = memberWrites()
    expect(write.payload).toMatchObject({
      first_name: 'Sam', last_name: '', date_of_birth: yearsAgo(12),
      gender: null, phone: null, grade: null, ec_email: null, profile_photo_url: null, marketing_consent: false,
    })
    expect(state.opened).toEqual([expect.objectContaining({ memberId: 'm-1', band: 'child', guardianEmail: 'parent@example.test' })])
    expect(state.sent).toEqual(['m-1'])
    expect(state.membershipDispatched).toBe(0)
  })

  it('creates the row when the sign-up has none yet, with the login email only', async () => {
    state.byClerk = null
    expect((await post(child())).status).toBe(200)
    expect(memberWrites()[0]).toMatchObject({
      op: 'insert', payload: expect.objectContaining({ clerk_user_id: 'clerk-1', email: 'kid@example.test', last_name: '' }),
    })
  })

  it("refuses the child's own email as the parent's, and a missing name or email", async () => {
    expect((await post(child({ parent_email: 'kid@example.test' }))).status).toBe(400)
    expect((await post(child({ first_name: '' }))).status).toBe(400)
    expect((await post(child({ parent_email: 'nope' }))).status).toBe(400)
    expect(state.opened).toEqual([])
  })

  it("leaves a record found only by email (an adult's registration) to its own guardian form", async () => {
    state.byClerk = null
    state.byEmail = { id: 'm-reg', is_active: true, date_of_birth: yearsAgo(12), clerk_user_id: null }
    const res = await post(child())
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('guardian_consent_required')
    expect(memberWrites()).toEqual([])
  })
})

describe('flag ON — 13 to 17', () => {
  beforeEach(() => { process.env.MINOR_SELF_SIGNUP_ENABLED = 'true' })

  it('13, 15 and 17 finish onboarding into the pending state, with marketing off', async () => {
    for (const n of [13, 15, 17]) {
      state.writes = []
      state.opened = []
      const res = await post(student(yearsAgo(n)))
      expect(res.status, String(n)).toBe(200)
      expect((await res.json()).pendingConsent, String(n)).toBe('guardian')
      expect(memberWrites()[0].payload, String(n)).toMatchObject({ marketing_consent: false, event_role: 'participant' })
      expect(state.opened, String(n)).toEqual([expect.objectContaining({ band: 'teen', guardianName: 'Pat Lee', guardianEmail: 'pat@example.test' })])
    }
    // The consent request is the membership agreement: no second form.
    expect(state.membershipDispatched).toBe(0)
  })

  it('needs a parent or legal guardian, not their own address', async () => {
    expect((await post(student(yearsAgo(15), { ec_relationship: 'Teacher' }))).status).toBe(400)
    expect((await post(student(yearsAgo(15), { ec_email: 'kid@example.test' }))).status).toBe(400)
    expect(state.opened).toEqual([])
  })

  it('a guardian agreement already on file means no pending state', async () => {
    state.agreements = [{ envelope_type: 'minor', status: 'completed', event_slug: 'membership' }]
    const res = await post(student(yearsAgo(15)))
    expect(res.status).toBe(200)
    expect((await res.json()).pendingConsent).toBeUndefined()
    expect(state.opened).toEqual([])
  })

  it('18 is unchanged: immediate, no pending state, marketing consent untouched', async () => {
    const res = await post(ADULT)
    expect(res.status).toBe(200)
    expect((await res.json()).pendingConsent).toBeUndefined()
    expect(state.opened).toEqual([])
    expect(memberWrites()[0].payload).not.toHaveProperty('marketing_consent')
  })
})

// Review findings (3 Nov 2026), each with the scenario that used to go wrong.
describe('flag ON — review regressions', () => {
  beforeEach(() => { process.env.MINOR_SELF_SIGNUP_ENABLED = 'true' })

  // An under-13 who stopped at the age screen kept a member row with their
  // date of birth and no pending row, so the 30-day purge never reached it.
  it('the age screen opens the pending row for a self-registering child, BEFORE the date of birth is written', async () => {
    const res = await post({ stage: 'age', date_of_birth: yearsAgo(12) })
    expect(await res.json()).toEqual({ band: 'child', consented: false })
    expect(state.screened).toEqual([{ memberId: 'm-1', band: 'child' }])
    expect(state.sequence).toEqual(['pending:screened', 'members:update'])
  })

  // With the flag on, an event-registered or invited minor was put into the
  // pending state (and onto the purge's list); an under-13 one had every
  // field the teacher entered wiped.
  it('a 15-year-old an event registration brought here keeps the pre-decision path: no pending row, the membership agreement', async () => {
    state.participants = [{ id: 'p-1', date_of_birth: yearsAgo(15) }]
    const res = await post(student(yearsAgo(15), { ec_relationship: 'Aunt' }))
    expect(res.status).toBe(200)
    expect((await res.json()).pendingConsent).toBeUndefined()
    expect(state.opened).toEqual([])
    expect(state.membershipDispatched).toBe(1)
  })

  it('so does an invited 15-year-old, and the age screen opens nothing for them', async () => {
    state.invited = true
    const age = await post({ stage: 'age', date_of_birth: yearsAgo(15) })
    expect(await age.json()).toEqual({ band: 'teen', consented: true })
    expect(state.screened).toEqual([])
    const res = await post(student(yearsAgo(15)))
    expect((await res.json()).pendingConsent).toBeUndefined()
    expect(state.opened).toEqual([])
  })

  it('an under-13 an event registration brought here, parent not yet signed: the old 403, and nothing written', async () => {
    state.participants = [{ id: 'p-1', date_of_birth: yearsAgo(12) }]
    const res = await post({ date_of_birth: yearsAgo(12), first_name: 'Sam', parent_email: 'parent@example.test' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('guardian_consent_required')
    expect(memberWrites()).toEqual([])
    expect(state.opened).toEqual([])
    const age = await post({ stage: 'age', date_of_birth: yearsAgo(12) })
    expect(age.status).toBe(403)
    expect(state.screened).toEqual([])
  })

  it('a membership consent form in flight is not an adult route: a re-run stays pending', async () => {
    state.agreements = [{ envelope_type: 'minor', status: 'sent', event_slug: 'membership' }]
    const res = await post(student(yearsAgo(15)))
    expect((await res.json()).pendingConsent).toBe('guardian')
    expect(state.membershipDispatched).toBe(0)
  })

  // The pending row used to be opened after the profile write, the grant and
  // the emails; a failed insert left a finished minor account with no
  // pending row, so full community access.
  it('opens the pending row before the profile write, and writes nothing if it cannot', async () => {
    await post(student(yearsAgo(15)))
    expect(state.sequence.indexOf('pending:open')).toBeLessThan(state.sequence.indexOf('members:update'))

    state.writes = []
    state.sequence = []
    state.openFails = true
    const res = await post(student(yearsAgo(15)))
    expect(res.status).toBe(500)
    expect(memberWrites()).toEqual([])
    expect(state.sequence).not.toContain('email:confirmation')
  })

  it('a row created by the write itself is rolled back to unfinished when the pending row cannot be opened', async () => {
    state.byClerk = null
    state.openFails = true
    const res = await post(student(yearsAgo(15)))
    expect(res.status).toBe(500)
    expect(memberWrites().map((w) => w.payload)).toEqual([
      expect.objectContaining({ gender: 'female' }),
      { gender: null },
    ])
    expect(state.sequence).not.toContain('email:confirmation')
  })
})
