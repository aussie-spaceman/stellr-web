import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rec, OPEN_EVENT, eqFilter, inFilter, jsonRequest, settle, type DbCall, type DbResult } from '@/test/registration/fixtures'

// Tracker member-merge-school-email.7: on the group form, a person found by a
// SCHOOL address is not new. For the organiser that means a signed-out caller is
// asked to sign in (lib/registration/member-on-file) and, if their row appears
// only by school address after that check, still gets no sign-in token. For the
// people they enter, the cross-address match links the existing member instead
// of creating a second one. The real lib/clerk-provisioning runs here, with
// Clerk's client mocked, so the test proves no ticket is minted.

const h = vi.hoisted(() => ({
  getEventBySlug: vi.fn(),
  clerk: {
    getUserList: vi.fn(),
    create: vi.fn(),
    createSignInToken: vi.fn(),
  },
}))

vi.mock('@/lib/supabase', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return { supabaseServer: () => rec.client() }
})
vi.mock('@/lib/field-crypto-shadow', () => ({ shadowSyncFields: () => {} }))
vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: null }),
  clerkClient: async () => ({
    users: { getUserList: h.clerk.getUserList, createUser: h.clerk.create },
    signInTokens: { createSignInToken: h.clerk.createSignInToken },
  }),
}))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: h.getEventBySlug }))
vi.mock('@/lib/community', () => ({ getCurrentMember: async () => null }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/rate-limit-async', () => ({ rateLimit: async () => null }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => null }))
vi.mock('@/lib/registration-duplicates', () => ({
  findExistingRegistrations: async () => new Map(),
  resolveDuplicate: () => ({ kind: 'none' }),
}))
vi.mock('@/lib/registration-checkout', () => ({
  createRegistrationCheckout: async () => ({ url: 'https://checkout.test/cs_1' }),
  RegistrationCheckoutError: class extends Error {},
  ensurePayToken: async () => 'ensured-token',
  mintPayToken: () => 'minted-token',
  payPageUrl: (slug: string, token: string) => `pay:${slug}:${token}`,
}))
vi.mock('@/lib/registration-pay-link', () => ({ sendPayLinkEmail: async () => ({ sent: true, recipients: [] }) }))
vi.mock('@/lib/group-invoice', () => ({ createAndSendGroupInvoice: async () => {} }))
vi.mock('@/lib/individual-payment', () => ({ ensureIndividualPayments: async () => {} }))
vi.mock('@/lib/store/event-merch', () => ({ finalizeRegistrationMerch: async () => {} }))
vi.mock('@/lib/email', () => ({
  sendEmail: async () => {},
  groupConfirmationEmail: () => ({ subject: 's', html: 'h', text: 't' }),
}))
vi.mock('@/lib/google-sheets', () => ({
  isGoogleSheetsConfigured: () => false,
  createGroupRegistrationSheet: async () => null,
}))
vi.mock('@/lib/school-link', () => ({ linkMembersToSchoolByName: async () => {} }))
vi.mock('@/lib/event-participation-sync', () => ({ recordEventParticipation: async () => {} }))
vi.mock('@/lib/space-inheritance', () => ({ syncObjectSpaceRoster: async () => {}, reconcileEventSpaceRoster: async () => {} }))
vi.mock('@/lib/member-profile-options', () => ({ syncMemberOptionSelections: async () => {} }))
vi.mock('@/lib/auto-membership-grant', () => ({ autoGrantBaseMembership: async () => {} }))
vi.mock('@/lib/member-onfile', () => ({ getMemberOnFileByMembershipId: async () => null }))
vi.mock('@/lib/group-registration-followup', () => ({ runGroupRegistrationFollowUp: async () => ({}) }))
vi.mock('@/lib/after-response', () => ({ runAfterResponse: () => {} }))
vi.mock('@/lib/check-in-codes', () => ({ checkInCodeLink: (slug: string, kind: string, id: string) => `code:${slug}:${kind}:${id}` }))

const { POST } = await import('./route')

type Person = Record<string, unknown>

const TEACHER = 'teacher@example.com'

const student = (n: string, overrides: Person = {}): Person => ({
  email: `s${n}@example.com`, first_name: 'Stu', last_name: `Dent${n}`,
  date_of_birth: '2011-01-01', phone: '', gender: '', t_shirt_size: '',
  age_bracket: 'college', event_role: 'mentor',
  emergency_contact_email: `parent${n}@example.com`,
  ...overrides,
})

function body(overrides: Person = {}, teacher: Person = {}): Person {
  return {
    event_slug: 'colorado',
    event_title: 'Colorado',
    registrant_role: 'teacher',
    teacher: {
      email: TEACHER, first_name: 'T', last_name: 'Eacher',
      school_name: 'Denver High', date_of_birth: '1980-01-01',
      phone: '', gender: '', t_shirt_size: '', age_bracket: 'adult',
      ...teacher,
    },
    adult_count: 1, student_count: 2, total_participants: 3,
    details_method: 'add_now',
    payment_method: 'none',
    additional_adults: [],
    students: [student('1'), student('2')],
    school_dpa_agreed: true,
    ...overrides,
  }
}

const post = (b: unknown) => POST(jsonRequest('/api/register/group', b))

const clerkCalled = () =>
  h.clerk.getUserList.mock.calls.length + h.clerk.create.mock.calls.length + h.clerk.createSignInToken.mock.calls.length

/** Emails written as member rows (the group upserts every new person in one batch). */
const upsertedEmails = () =>
  (rec.payloads('upsert', 'members') as Person[][]).flat().map((m) => m.email)

let errors: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  rec.reset()
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  h.getEventBySlug.mockResolvedValue(OPEN_EVENT)
  h.clerk.getUserList.mockResolvedValue({ data: [] })
  h.clerk.create.mockResolvedValue({ id: 'user_new_placeholder' })
  h.clerk.createSignInToken.mockResolvedValue({ token: 'ticket_placeholder' })
})
afterEach(() => { errors.mockRestore() })

describe('POST /api/register/group — a match by school address is not new', () => {
  it('control: a brand-new organiser is new, and gets a sign-in token', async () => {
    const res = await settle(await post(body()))
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ signInToken: 'ticket_placeholder' })
    expect(h.clerk.createSignInToken).toHaveBeenCalledTimes(1)
  })

  it.each<[string, string, string, Person]>([
    ["the organiser's address is a member's school address", 'school_email', TEACHER, {}],
    ['the school address the organiser submits is a member’s email', 'email', 'old@school.example.com', { school_email: 'old@school.example.com' }],
  ])('%s: asked to sign in, with no token, no login and nothing written', async (_case, column, value, teacher) => {
    rec.respond((c: DbCall): DbResult | undefined =>
      c.table === 'members' && c.op === 'select' && eqFilter(c, column, value)
        ? { data: { id: 'm-prior' }, error: null }
        : undefined,
    )
    const res = await settle(await post(body({}, teacher)))
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ code: 'sign_in_required' })
    expect(res.body).not.toHaveProperty('signInToken')
    expect(clerkCalled()).toBe(0)
    expect(rec.calls.filter((c) => c.op !== 'select')).toEqual([])
  })

  it('an organiser whose row turns up by school address after the sign-in check still gets no token', async () => {
    // The gate's reads (eq) find nothing; the save's cross-address read (in)
    // finds a member holding the organiser's address as their school address.
    rec.respond((c: DbCall): DbResult | undefined =>
      c.table === 'members' && c.op === 'select' && inFilter(c, 'school_email', TEACHER)
        ? { data: [{ id: 'm-prior', school_email: TEACHER }], error: null }
        : undefined,
    )
    const res = await settle(await post(body()))
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ signInToken: null })
    expect(clerkCalled()).toBe(0)
    // Linked, not created again.
    expect(upsertedEmails()).not.toContain(TEACHER)
    expect(rec.payloads('update', 'members')).toEqual([])
  })

  it('a person the organiser enters, found by school address, is linked to that member and not created again', async () => {
    rec.respond((c: DbCall): DbResult | undefined => {
      if (c.table !== 'members' || c.op !== 'select') return undefined
      if (inFilter(c, 'school_email', 's1@example.com')) return { data: [{ id: 'm-by-school', school_email: 's1@example.com' }], error: null }
      if (inFilter(c, 'email', 'old2@school.example.com')) return { data: [{ id: 'm-by-email', email: 'old2@school.example.com' }], error: null }
      return undefined
    })
    const res = await settle(await post(body({
      students: [student('1'), student('2', { school_email: 'old2@school.example.com' })],
    })))
    expect(res.status).toBe(201)
    const created = upsertedEmails()
    expect(created).not.toContain('s1@example.com')
    expect(created).not.toContain('s2@example.com')
    const rows = (rec.payloads('insert', 'participants') as Person[][]).flat()
    expect(rows.find((r) => r.email === 's1@example.com')).toMatchObject({ member_id: 'm-by-school' })
    expect(rows.find((r) => r.email === 's2@example.com')).toMatchObject({ member_id: 'm-by-email' })
    // The organiser is new, and is the only one a token can be for.
    expect(h.clerk.createSignInToken).toHaveBeenCalledTimes(1)
  })
})
