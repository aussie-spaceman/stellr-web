import { describe, it, expect, vi, beforeEach } from 'vitest'
import { rec, OPEN_EVENT, eqFilter, jsonRequest, settle, type DbCall, type DbResult } from '@/test/registration/fixtures'

// Tracker member-merge-school-email.7: a member found by their SCHOOL address
// is not new, so a signed-out caller gets no sign-in token for them. Two ways in:
//   - the gate (lib/registration/member-on-file) asks a signed-out caller whose
//     address is on file, as anyone's school address, to sign in first;
//   - an offer sent to this address skips that question, and persist then links
//     the registration to the member found by school address, as "not new".
// The real lib/clerk-provisioning runs here, with Clerk's client mocked, so the
// test proves no ticket is minted rather than trusting a mocked helper.

const h = vi.hoisted(() => ({
  getEventBySlug: vi.fn(),
  findOffer: vi.fn(),
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
vi.mock('@/lib/pending-consent', () => ({ sessionChildAwaitingConsentBlock: async () => null }))
vi.mock('@/lib/rate-limit-async', () => ({ rateLimit: async () => null }))
vi.mock('@/lib/scholarships', () => ({ findOfferByToken: h.findOffer, attachOfferToRegistration: async () => true }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => null }))
vi.mock('@/lib/registration-duplicates', () => ({
  findExistingRegistrations: async () => new Map(),
  resolveDuplicate: () => ({ kind: 'none' }),
}))
vi.mock('@/lib/docusign-agreements', () => ({ dispatchAgreement: async () => {} }))
vi.mock('@/lib/school-link', () => ({ resolveAndLinkSchool: async () => ({ state: 'CO' }) }))
vi.mock('@/lib/member-profile-options', () => ({ syncMemberOptionSelections: async () => {} }))
vi.mock('@/lib/event-participation-sync', () => ({ recordEventParticipation: async () => {} }))
vi.mock('@/lib/auto-membership-grant', () => ({ autoGrantBaseMembership: async () => {} }))
vi.mock('@/lib/store/event-merch', () => ({
  prepareRegistrationAddons: async () => [],
  addRegistrationAddons: async () => {},
}))
vi.mock('@/lib/registration-confirm', () => ({ confirmRegistration: async () => {} }))
vi.mock('@/lib/registration-pay-link', () => ({ sendPayLinkEmail: async () => ({ sent: true, recipients: [] }) }))
vi.mock('@/lib/registration-checkout', () => ({
  createRegistrationCheckout: async () => ({ url: 'https://checkout.test' }),
  RegistrationCheckoutError: class extends Error {},
  ensurePayToken: async () => 'paytok-old',
  mintPayToken: () => 'paytok',
  payPageUrl: (slug: string, token: string) => `https://pay.test/${slug}/${token}`,
  pendingAddonLines: async () => [],
}))

const { POST } = await import('./route')

const BODY = {
  event_slug: 'colorado', event_title: 'Colorado',
  email: 'kid@example.com', first_name: 'K', last_name: 'Id',
  phone: '555', date_of_birth: '1985-04-01', school_name: 'Denver High',
  grade: '9', gender: 'female', t_shirt_size: 'M',
  event_role: 'mentor', age_bracket: 'college',
  emergency_contact_first_name: 'P', emergency_contact_last_name: 'Id',
  emergency_contact_email: 'parent@example.com', emergency_contact_phone: '556',
  emergency_contact_relationship: 'Parent',
}

const post = (overrides: Record<string, unknown> = {}) =>
  POST(jsonRequest('/api/register/individual', { ...BODY, ...overrides }))

/** A member already on file whose school_email is this address. */
const onFileBySchoolAddress = (address: string) => (c: DbCall): DbResult | undefined =>
  c.table === 'members' && c.op === 'select' && eqFilter(c, 'school_email', address)
    ? { data: { id: 'm-prior' }, error: null }
    : undefined

const clerkCalled = () =>
  h.clerk.getUserList.mock.calls.length + h.clerk.create.mock.calls.length + h.clerk.createSignInToken.mock.calls.length

beforeEach(() => {
  vi.clearAllMocks()
  rec.reset()
  h.getEventBySlug.mockResolvedValue(OPEN_EVENT)
  h.findOffer.mockResolvedValue(null)
  h.clerk.getUserList.mockResolvedValue({ data: [] })
  h.clerk.create.mockResolvedValue({ id: 'user_new_placeholder' })
  h.clerk.createSignInToken.mockResolvedValue({ token: 'ticket_placeholder' })
})

describe('POST /api/register/individual — a match by school address is not new', () => {
  it('control: a brand-new address is new, and gets a sign-in token', async () => {
    const res = await settle(await post())
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ signInToken: 'ticket_placeholder' })
    expect(h.clerk.createSignInToken).toHaveBeenCalledTimes(1)
  })

  it("signed out, an address on file as a member's school address is asked to sign in, with no token", async () => {
    rec.respond(onFileBySchoolAddress('kid@example.com'))
    const res = await settle(await post())
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ code: 'sign_in_required', school_address_only: true })
    expect(res.body).not.toHaveProperty('signInToken')
    expect(clerkCalled()).toBe(0)
    expect(rec.calls.filter((c) => c.op !== 'select')).toEqual([])
  })

  it('with an offer to this address, the registration links to that member as not new: no token, no login, no member rewrite', async () => {
    h.findOffer.mockResolvedValue({
      id: 'offer-1', event_slug: 'colorado', email: 'kid@example.com', percent_off: 100, registration_id: null,
    })
    rec.respond(onFileBySchoolAddress('kid@example.com'))
    const res = await settle(await post({ scholarship_token: 'offer-token-placeholder' }))
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ signInToken: null })
    expect(clerkCalled()).toBe(0)
    // The member found by school address is linked, never rewritten or re-keyed.
    expect(rec.payloads('upsert', 'members')).toEqual([])
    expect(rec.payloads('update', 'members')).toEqual([])
    expect(rec.payloads('insert', 'participants')[0]).toMatchObject({ member_id: 'm-prior' })
  })
})
