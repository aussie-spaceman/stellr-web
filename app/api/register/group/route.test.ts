import { describe, it, expect, vi, beforeEach } from 'vitest'

// Deep-review REG-3 / REG-4 / REG-5 regression tests for the group registration
// route. The route has a very large side-effect surface (Supabase, Stripe,
// Sanity, Clerk, DocuSign, Google Sheets, email); everything below the security
// gate is mocked to a no-op so the tests can assert on (a) the status code and
// (b) the exact `registrations` row the route would insert.

const h = vi.hoisted(() => ({
  getEventBySlug: vi.fn(async (_slug: string): Promise<unknown> => ({
    title: 'Colorado Space Challenge',
    activityType: 'live_event',
    stripePriceId: 'price_x',
  })),
  priceRetrieve: vi.fn(async () => ({ unit_amount: 13500, currency: 'usd' })),
  getCurrentMember: vi.fn(async (): Promise<unknown> => null),
  findExistingRegistrations: vi.fn(async () => new Map<string, unknown[]>()),
  resolveDuplicate: vi.fn(() => ({ kind: 'none' })),
  ensureClerk: vi.fn(async () => ({ clerkUserId: 'c-1', signInToken: null, created: false })),
  // Captures every row passed to `.insert()`, keyed by table name.
  captures: {} as Record<string, unknown[]>,
}))

// A thenable Supabase chain: terminal `.single()`/`.maybeSingle()` resolve, and
// awaiting the chain directly (e.g. `await db.from(t).insert(x)`) resolves too.
function makeDb(captures: Record<string, unknown[]>) {
  const from = (table: string) => {
    const state: { op: string; payload: unknown; single: boolean } = { op: 'select', payload: null, single: false }
    const result = () => {
      if (state.op === 'insert' && table === 'registrations') return { data: { id: 'reg-1' }, error: null }
      if (state.op === 'insert' && table === 'participants') {
        const rows = Array.isArray(state.payload) ? state.payload : [state.payload]
        return { data: rows.map((r: Record<string, unknown>, i: number) => ({ id: `p-${i}`, email: r.email })), error: null }
      }
      if (table === 'members' && state.op === 'upsert') {
        return state.single ? { data: { id: 'm-teacher' }, error: null } : { data: [], error: null }
      }
      if (table === 'members' && state.op === 'select') return { data: [], error: null }
      return { data: null, error: null }
    }
    const chain: Record<string, unknown> = {
      select: () => chain, eq: () => chain, in: () => chain, not: () => chain, is: () => chain,
      insert: (p: unknown) => { state.op = 'insert'; state.payload = p; (captures[table] ||= []).push(p); return chain },
      upsert: (p: unknown) => { state.op = 'upsert'; state.payload = p; return chain },
      update: (p: unknown) => { state.op = 'update'; state.payload = p; return chain },
      delete: () => { state.op = 'delete'; return chain },
      single: async () => { state.single = true; return result() },
      maybeSingle: async () => { state.single = true; return result() },
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(result()).then(onF, onR),
    }
    return chain
  }
  return { from }
}

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => makeDb(h.captures) }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: h.getEventBySlug }))
vi.mock('@/lib/community', () => ({ getCurrentMember: h.getCurrentMember }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => ({ prices: { retrieve: h.priceRetrieve } }) }))
vi.mock('@/lib/registration-duplicates', () => ({
  findExistingRegistrations: h.findExistingRegistrations,
  resolveDuplicate: h.resolveDuplicate,
}))
vi.mock('@/lib/clerk-provisioning', () => ({ ensureClerkUserAndSignInToken: h.ensureClerk }))
vi.mock('@/lib/docusign-agreements', () => ({ dispatchAgreement: vi.fn(async () => {}) }))
vi.mock('@/lib/esign/outbox', () => ({ batchInvites: async () => {} }))
vi.mock('@/lib/email', () => ({ sendEmail: async () => {}, groupConfirmationEmail: () => ({ subject: '', html: '', text: '' }) }))
vi.mock('@/lib/individual-payment', () => ({ ensureIndividualPayments: async () => {} }))
vi.mock('@/lib/store/event-merch', () => ({ finalizeRegistrationMerch: async () => {} }))
vi.mock('@/lib/google-sheets', () => ({ isGoogleSheetsConfigured: () => false, createGroupRegistrationSheet: async () => ({ url: '', spreadsheetId: '' }) }))
vi.mock('@/lib/school-link', () => ({ linkMembersToSchoolByName: async () => {} }))
vi.mock('@/lib/event-participation-sync', () => ({ recordEventParticipation: async () => {} }))
vi.mock('@/lib/space-inheritance', () => ({ syncObjectSpaceRoster: async () => {}, reconcileEventSpaceRoster: async () => {} }))
vi.mock('@/lib/member-profile-options', () => ({ syncMemberOptionSelections: async () => {} }))
vi.mock('@/lib/member-onfile', () => ({ getMemberOnFileByMembershipId: async () => null }))
vi.mock('@/lib/auto-membership-grant', () => ({ autoGrantBaseMembership: async () => {} }))
vi.mock('@/lib/registration-pay-link', () => ({ sendPayLinkEmail: async () => ({ sent: false, reason: undefined, recipients: [] }) }))
vi.mock('@/lib/registration-checkout', () => ({
  createRegistrationCheckout: async () => ({ url: 'https://checkout.test/cs_1' }),
  RegistrationCheckoutError: class extends Error {},
  ensurePayToken: async () => 'paytok',
  mintPayToken: () => 'paytok',
  payPageUrl: () => 'https://www.stellreducation.org/pay',
}))

const { POST } = await import('./route')

const STUDENT = (email: string) => ({
  email, first_name: 'S', last_name: email, date_of_birth: '2012-01-01',
  phone: '', gender: '', t_shirt_size: '', age_bracket: 'high_school', event_role: 'Student',
})

function body(overrides: Record<string, unknown> = {}) {
  return {
    event_slug: 'colorado',
    event_title: 'FORGED TITLE',
    registrant_role: 'teacher',
    teacher: {
      email: 'teacher@example.com', first_name: 'T', last_name: 'Eacher',
      school_name: 'Denver High', date_of_birth: '1980-01-01',
      phone: '', gender: '', t_shirt_size: '', age_bracket: 'adult',
    },
    adult_count: 1, student_count: 2, total_participants: 3,
    details_method: 'add_now',
    payment_method: 'none',
    additional_adults: [],
    students: [STUDENT('s1@example.com'), STUDENT('s2@example.com')],
    school_dpa_agreed: true,
    ...overrides,
  }
}

function post(b: Record<string, unknown>) {
  return POST(
    new Request('https://www.stellreducation.org/api/register/group', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
    }) as never,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(h.captures)) delete h.captures[k]
  h.getEventBySlug.mockResolvedValue({ title: 'Colorado Space Challenge', activityType: 'live_event', stripePriceId: 'price_x' })
  h.priceRetrieve.mockResolvedValue({ unit_amount: 13500, currency: 'usd' })
  h.getCurrentMember.mockResolvedValue(null)
  h.findExistingRegistrations.mockResolvedValue(new Map())
  h.resolveDuplicate.mockReturnValue({ kind: 'none' })
  h.ensureClerk.mockResolvedValue({ clerkUserId: 'c-1', signInToken: null, created: false })
})

describe('POST /api/register/group', () => {
  // ── REG-3 ──────────────────────────────────────────────────────────────────
  it('REG-3: a client is_campaign flag cannot confirm a paid event unpaid', async () => {
    const res = await post(body({ is_campaign: true, payment_method: 'none' }))
    expect(res.status).toBe(201)
    const reg = (h.captures.registrations?.[0] ?? {}) as Record<string, unknown>
    // The paid live event stays pending (unpaid) and keeps type 'group' — the
    // forged flag is ignored because status/type derive from the CMS event.
    expect(reg.status).toBe('pending')
    expect(reg.type).toBe('group')
    expect(reg.amount_due_cents).toBe(13500 * 3)
  })

  it('REG-3/REG-4: event_title is taken from the server, not the client body', async () => {
    await post(body({ event_title: 'FORGED TITLE' }))
    const reg = (h.captures.registrations?.[0] ?? {}) as Record<string, unknown>
    expect(reg.event_title).toBe('Colorado Space Challenge')
  })

  // ── REG-4 ──────────────────────────────────────────────────────────────────
  it('REG-4: a Sanity outage fails closed with 503 and inserts nothing', async () => {
    h.getEventBySlug.mockRejectedValue(new Error('sanity timeout'))
    const res = await post(body())
    expect(res.status).toBe(503)
    expect(h.captures.registrations).toBeUndefined()
  })

  it('REG-4: an unknown slug fails closed with 404 and inserts nothing', async () => {
    h.getEventBySlug.mockResolvedValue(null)
    const res = await post(body())
    expect(res.status).toBe(404)
    expect(h.captures.registrations).toBeUndefined()
  })

  // ── REG-5 ──────────────────────────────────────────────────────────────────
  it('REG-5: more students than declared is rejected before any insert', async () => {
    const res = await post(body({
      student_count: 2, total_participants: 3,
      students: [STUDENT('a@x.com'), STUDENT('b@x.com'), STUDENT('c@x.com'), STUDENT('d@x.com'), STUDENT('e@x.com')],
    }))
    expect(res.status).toBe(400)
    expect(h.captures.registrations).toBeUndefined()
  })

  it('REG-5: more additional adults than the group allows is rejected', async () => {
    const res = await post(body({
      adult_count: 1, // teacher only → 0 additional adults allowed
      additional_adults: [{ email: 'extra@x.com', first_name: 'E', last_name: 'X', date_of_birth: '1990-01-01', phone: '', gender: '', t_shirt_size: '', age_bracket: 'adult', event_role: 'Adult' }],
    }))
    expect(res.status).toBe(400)
    expect(h.captures.registrations).toBeUndefined()
  })

  it('REG-5: a negative adult_count that nets to the declared total is rejected', async () => {
    // adult_count:-10 + student_count:12 == total_participants:2 passed the sum
    // equality check before the count validation existed.
    const res = await post(body({ adult_count: -10, student_count: 12, total_participants: 2, students: [STUDENT('s1@example.com'), STUDENT('s2@example.com')] }))
    expect(res.status).toBe(400)
    expect(h.captures.registrations).toBeUndefined()
  })

  it('accepts a well-formed add_now group within the declared counts', async () => {
    const res = await post(body())
    expect(res.status).toBe(201)
    expect(h.captures.registrations?.length).toBe(1)
    // teacher + 2 students
    expect((h.captures.participants?.[0] as unknown[]).length).toBe(3)
  })
})
