// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review MEM-3: onboarding is a POST anyone signed in can re-run. It must
// refuse to revive an admin-deactivated (banned) account, and must refuse a
// minor who re-submits an adult date of birth to escape the high-school bracket.
const { state, activity } = vi.hoisted(() => ({
  activity: [] as Array<{ action: string }>,
  state: {
    userId: 'clerk-1' as string | null,
    clerkUser: null as Record<string, unknown> | null,
    byClerk: null as Record<string, unknown> | null,
    byEmail: null as Record<string, unknown> | null,
    /** The member's participant rows (S0 tests). */
    participants: [] as Array<{ id: string; date_of_birth: string | null }>,
    /** Agreements on file for the member (S0 tests). */
    agreements: [] as Array<{ envelope_type: string; status: string }>,
    /** Whether a conditional (`.is('clerk_user_id', null)`) update finds its row. */
    linkHits: true,
    /** What the read of a picked school answers. */
    school: { data: null, error: null } as { data: { id: string; name?: string; is_active?: boolean | null } | null; error: { message: string } | null },
    schoolReads: [] as Array<Array<[string, string, unknown]>>,
    upserts: [] as Array<{ table: string; payload: unknown }>,
    updates: 0,
    writes: [] as Array<{ table: string; payload: unknown; filters: Array<[string, string, unknown]> }>,
  },
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: state.userId }),
  currentUser: async () => state.clerkUser,
}))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
// A small chainable stand-in for the Supabase client: members are found by
// Clerk id or by email, participants and agreements come from `state`, and
// every update is recorded.
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from(table: string) {
      const filters: Array<[string, string, unknown]> = []
      let op = 'select'
      let head = false
      const eqOf = (col: string) => filters.find(([k, c]) => k === 'eq' && c === col)?.[2]
      const result = () => {
        if (op === 'update') {
          const conditional = filters.some(([k, c]) => k === 'is' && c === 'clerk_user_id')
          return { data: conditional && !state.linkHits ? [] : [{ id: eqOf('id') }], error: null }
        }
        if (table === 'participants') {
          return head ? { count: state.participants.length, error: null } : { data: state.participants, error: null }
        }
        if (table === 'agreements') {
          const type = eqOf('envelope_type')
          const status = eqOf('status')
          const n = state.agreements.filter((a) => (!type || a.envelope_type === type) && (!status || a.status === status)).length
          return { count: n, error: null }
        }
        return { data: null, error: null }
      }
      const chain: Record<string, unknown> = {
        select: (_cols?: string, opts?: { head?: boolean }) => { if (opts?.head) head = true; return chain },
        update: (payload: unknown) => {
          op = 'update'
          state.updates += 1
          state.writes.push({ table, payload, filters })
          return chain
        },
        upsert: (payload: unknown) => { state.upserts.push({ table, payload }); return chain },
        eq: (c: string, v: unknown) => { filters.push(['eq', c, v]); return chain },
        is: (c: string, v: unknown) => { filters.push(['is', c, v]); return chain },
        or: (s: string) => { filters.push(['or', s, null]); return chain },
        maybeSingle: async () => {
          if (table === 'schools') {
            state.schoolReads.push(filters)
            return state.school
          }
          if (table !== 'members') return { data: null, error: null }
          if (eqOf('clerk_user_id') !== undefined) return { data: state.byClerk, error: null }
          if (eqOf('email') !== undefined) return { data: state.byEmail, error: null }
          return { data: { id: eqOf('id'), email: 'person@test', first_name: 'A', last_name: 'B' }, error: null }
        },
        then: (f: (v: unknown) => unknown) => Promise.resolve(result()).then(f),
      }
      return chain
    },
  }),
}))
// Side-effect collaborators — not reached on the 403 paths, but the imports must
// resolve. No-op them so the module loads hermetically.
vi.mock('@/lib/email-campaigns', () => ({ fireCampaignEvent: async () => {} }))
vi.mock('@/lib/membership-grants', () => ({ applyGrantTrigger: async () => {} }))
vi.mock('@/lib/activity-log', () => ({ logActivity: async (e: { action: string }) => { activity.push(e) } }))
vi.mock('@/lib/volunteer', () => ({
  grantVolunteerRole: async () => {},
  dispatchVolunteerAgreement: async () => {},
  VOLUNTEER_MEMBER_COLUMNS: 'id',
}))
vi.mock('@/lib/member-roles', () => ({ syncMemberClassificationRole: async () => {} }))
vi.mock('@/lib/registration-notify', () => ({
  sendAccountConfirmation: async () => {},
  notifyStaffOfRegistration: async () => {},
}))
vi.mock('@/lib/membership-agreement', () => ({ dispatchMembershipAgreement: async () => ({ signNowUrl: null }) }))

const { POST } = await import('./route')
const { appToday } = await import('@/lib/age')

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/members/onboarding', { method: 'POST', body: JSON.stringify(body) }))

const ADULT_BODY = {
  event_role: 'parent',
  age_bracket: 'adult',
  date_of_birth: '1990-01-01',
  gender: 'female',
  phone: '555-1234',
}

beforeEach(() => {
  state.userId = 'clerk-1'
  state.clerkUser = {
    emailAddresses: [{ id: 'e1', emailAddress: 'person@test' }],
    primaryEmailAddressId: 'e1',
    firstName: 'A',
    lastName: 'B',
  }
  state.byClerk = null
  state.byEmail = null
  state.participants = []
  state.agreements = []
  state.linkHits = true
  state.school = { data: null, error: null }
  state.schoolReads = []
  state.upserts = []
  state.updates = 0
  state.writes = []
  activity.length = 0
})

// C4-F6: a picked school is linked only if it is one the picker could have offered.
describe('POST /api/members/onboarding — a picked school', () => {
  const SCHOOL = '11111111-1111-4111-8111-111111111111'
  const links = () => state.upserts.filter((u) => u.table === 'member_schools')
  const linkedLogs = () => activity.filter((a) => a.action === 'school_linked')
  const signedUp = () => {
    state.byClerk = { id: 'm-1', is_active: true, date_of_birth: '1990-01-01' }
  }

  it('links a school that exists and is active', async () => {
    signedUp()
    state.school = { data: { id: SCHOOL, name: 'Denver High' }, error: null }
    const res = await post({ ...ADULT_BODY, school_id: SCHOOL })
    expect(res.status).toBe(200)
    expect(links()).toHaveLength(1)
    expect(links()[0].payload).toMatchObject({ member_id: 'm-1', school_id: SCHOOL, is_current: true })
    expect(linkedLogs()).toHaveLength(1)
    // The same filter as /api/schools/search: a deactivated school is not offered.
    expect(state.schoolReads[0]).toContainEqual(['or', 'is_active.is.null,is_active.eq.true', null])
  })

  it('a school that does not resolve links nothing, logs no link, and onboarding still succeeds', async () => {
    signedUp()
    const res = await post({ ...ADULT_BODY, school_id: SCHOOL })
    expect(res.status).toBe(200)
    expect(links()).toEqual([])
    expect(linkedLogs()).toEqual([])
  })

  it('an id that is not a uuid is never sent to the database', async () => {
    signedUp()
    const res = await post({ ...ADULT_BODY, school_id: 'not-a-uuid' })
    expect(res.status).toBe(200)
    expect(state.schoolReads).toEqual([])
    expect(links()).toEqual([])
  })

  it('a failed read decides nothing: a retryable 500 before the profile is written', async () => {
    signedUp()
    state.school = { data: null, error: { message: 'boom' } }
    const res = await post({ ...ADULT_BODY, school_id: SCHOOL })
    expect(res.status).toBe(500)
    expect(state.writes.filter((w) => w.table === 'members')).toEqual([])
    expect(links()).toEqual([])
  })

  describe('added as new, by name', () => {
    const NEW = { ...ADULT_BODY, school_id: 'new', new_school_name: 'Denver High' }

    it('a name that matches an active school links it', async () => {
      signedUp()
      state.school = { data: { id: SCHOOL, is_active: true }, error: null }
      expect((await post(NEW)).status).toBe(200)
      expect(links()[0].payload).toMatchObject({ member_id: 'm-1', school_id: SCHOOL })
    })

    it('a name that matches a deactivated school links nothing, logs no link, and succeeds', async () => {
      signedUp()
      state.school = { data: { id: SCHOOL, is_active: false }, error: null }
      expect((await post(NEW)).status).toBe(200)
      expect(links()).toEqual([])
      expect(linkedLogs()).toEqual([])
    })

    it('a failed read decides nothing: a retryable 500 before the profile is written', async () => {
      signedUp()
      state.school = { data: null, error: { message: 'boom' } }
      expect((await post(NEW)).status).toBe(500)
      expect(state.writes.filter((w) => w.table === 'members')).toEqual([])
      expect(links()).toEqual([])
    })
  })
})

describe('POST /api/members/onboarding — re-entry guards (MEM-3)', () => {
  it('refuses to revive an admin-deactivated (banned) account matched by email', async () => {
    state.byEmail = { id: 'm-ban', is_active: false, date_of_birth: '1990-01-01' }
    const res = await post(ADULT_BODY)
    expect(res.status).toBe(403)
    expect(state.updates).toBe(0) // nothing revived/written
  })

  it('refuses a minor on file who re-submits an adult date of birth', async () => {
    state.byClerk = { id: 'm-kid', is_active: true, date_of_birth: '2011-01-01' }
    const res = await post(ADULT_BODY) // adult DOB in the payload
    expect(res.status).toBe(403)
    expect(state.updates).toBe(0)
  })
})

// S0 (2 Nov 2026): onboarding is where a self-serve Clerk sign-up is linked to
// an existing member row by email (the webhook holds a child's link back), so
// it applies the COPPA rule and the webhook's two linking rules itself.
describe('POST /api/members/onboarding — COPPA and linking by email (S0)', () => {
  /** A date of birth `n` years before the app's today, less `extraDays`. */
  const yearsAgo = (n: number, extraDays = 0) => {
    const d = appToday()
    d.setUTCFullYear(d.getUTCFullYear() - n)
    d.setUTCDate(d.getUTCDate() - extraDays)
    return d.toISOString().slice(0, 10)
  }
  const student = (date_of_birth: string) => ({
    event_role: 'participant', age_bracket: 'high_school', date_of_birth, gender: 'female', phone: '555-1234',
    grade: '7', tshirt_size: 'YM', school_id: 'school-1',
    ec_first_name: 'Pat', ec_last_name: 'Lee', ec_email: 'pat@test', ec_phone: '555-9876', ec_relationship: 'Parent',
  })
  const verified = () => {
    state.clerkUser = {
      emailAddresses: [{ id: 'e1', emailAddress: 'person@test', verification: { status: 'verified' } }],
      primaryEmailAddressId: 'e1', firstName: 'A', lastName: 'B',
    }
  }
  /** Writes that tie this login to a member row. */
  const links = () => state.writes.filter((w) => w.table === 'members' && (w.payload as { clerk_user_id?: string }).clerk_user_id)

  it('refuses a child under 13 found by email with no guardian agreement, and links nothing', async () => {
    verified()
    state.byEmail = { id: 'm-kid', is_active: true, date_of_birth: yearsAgo(12), clerk_user_id: null }
    state.participants = [{ id: 'p-kid', date_of_birth: yearsAgo(12) }]
    const res = await post(student(yearsAgo(12)))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('guardian_consent_required')
    expect(links()).toEqual([])
  })

  it('reads the youngest date: a child with no date on the member row cannot type an older one past it', async () => {
    verified()
    // Joined through a link: the member row has no date of birth, the participant row does.
    state.byEmail = { id: 'm-kid', is_active: true, date_of_birth: null, clerk_user_id: null }
    state.participants = [{ id: 'p-kid', date_of_birth: yearsAgo(12) }]
    for (const typed of [yearsAgo(12), yearsAgo(16), '1990-01-01']) {
      const res = await post(typed === '1990-01-01' ? ADULT_BODY : student(typed))
      expect(res.status, typed).toBe(403)
    }
    expect(links()).toEqual([])
  })

  it('refuses a teenager with no date on the member row who types an adult one past their participant row', async () => {
    // An existing member who joined through a link or a sheet keeps a blank
    // member date of birth; the registration put 15 on the participant row.
    // Filing 1990 as a parent would make them an adult everywhere the member
    // row is read (the enrolment gate, the membership agreement).
    for (const found of ['byClerk', 'byEmail'] as const) {
      verified()
      state.writes = []
      state.byClerk = null
      state.byEmail = null
      state[found] = { id: 'm-teen', is_active: true, date_of_birth: null, clerk_user_id: null }
      state.participants = [{ id: 'p-teen', date_of_birth: yearsAgo(15) }, { id: 'p-old', date_of_birth: yearsAgo(40) }]
      const res = await post(ADULT_BODY)
      expect(res.status, found).toBe(403)
      expect(state.writes, found).toEqual([])
    }
  })

  it('lets that teenager finish onboarding as the student the participant row says they are', async () => {
    verified()
    state.byClerk = { id: 'm-teen', is_active: true, date_of_birth: null, clerk_user_id: 'clerk-1' }
    state.participants = [{ id: 'p-teen', date_of_birth: yearsAgo(15) }]
    expect((await post(student(yearsAgo(15)))).status).toBe(200)
  })

  it('does not read an unusable participant date of birth as a minor on file', async () => {
    verified()
    state.byClerk = { id: 'm-new', is_active: true, date_of_birth: null }
    state.participants = [{ id: 'p-1', date_of_birth: '2999-01-01' }]
    expect((await post(ADULT_BODY)).status).toBe(200)
  })

  it("does not count an agreement the child signed themselves as a guardian's", async () => {
    verified()
    state.byEmail = { id: 'm-kid', is_active: true, date_of_birth: yearsAgo(12), clerk_user_id: null }
    state.participants = [{ id: 'p-kid', date_of_birth: yearsAgo(12) }]
    state.agreements = [{ envelope_type: 'adult', status: 'completed' }, { envelope_type: 'minor', status: 'sent' }]
    expect((await post(student(yearsAgo(12)))).status).toBe(403)
    expect(links()).toEqual([])
  })

  it("links a child under 13 once a guardian's consent form is signed, only while the row is unlinked", async () => {
    verified()
    state.byEmail = { id: 'm-kid', is_active: true, date_of_birth: yearsAgo(12), clerk_user_id: null }
    state.participants = [{ id: 'p-kid', date_of_birth: yearsAgo(12) }]
    state.agreements = [{ envelope_type: 'minor', status: 'completed' }]
    const res = await post(student(yearsAgo(12)))
    expect(res.status).toBe(200)
    expect(links()).toEqual([expect.objectContaining({
      filters: [['eq', 'id', 'm-kid'], ['is', 'clerk_user_id', null]],
    })])
  })

  it('lets 13- and 14-year-olds through on their date of birth alone', async () => {
    verified()
    for (const dob of [yearsAgo(13), yearsAgo(14)]) {
      state.writes = []
      state.byEmail = { id: 'm-1', is_active: true, date_of_birth: dob, clerk_user_id: null }
      state.participants = [{ id: 'p-1', date_of_birth: dob }]
      expect((await post(student(dob))).status, dob).toBe(200)
      expect(links()).toHaveLength(1)
    }
  })

  it('leaves adults as they were: a self-serve sign-up with no date on file finishes onboarding', async () => {
    verified()
    state.byClerk = { id: 'm-new', is_active: true, date_of_birth: null }
    const res = await post(ADULT_BODY)
    expect(res.status).toBe(200)
  })

  it('refuses a date of birth that is not a real past date', async () => {
    verified()
    for (const date_of_birth of ['not a date', '2999-01-01', '1990-13-45']) {
      const res = await post({ ...ADULT_BODY, date_of_birth })
      expect(res.status, date_of_birth).toBe(400)
      expect((await res.json()).code).toBe('dob_invalid')
    }
    expect(state.updates).toBe(0)
  })

  it('links by email only through a verified address', async () => {
    // Default clerkUser has no verification record.
    state.byEmail = { id: 'm-1', is_active: true, date_of_birth: '1990-01-01', clerk_user_id: null }
    const res = await post(ADULT_BODY)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('email_not_verified')
    expect(links()).toEqual([])
  })

  it('never moves a member row another login already holds', async () => {
    verified()
    state.byEmail = { id: 'm-1', is_active: true, date_of_birth: '1990-01-01', clerk_user_id: 'clerk-other' }
    const res = await post(ADULT_BODY)
    expect(res.status).toBe(409)
    expect(links()).toEqual([])
  })

  it('backs off when another login links the row between the read and the write', async () => {
    verified()
    state.byEmail = { id: 'm-1', is_active: true, date_of_birth: '1990-01-01', clerk_user_id: null }
    state.linkHits = false
    const res = await post(ADULT_BODY)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('member_already_linked')
  })
})
