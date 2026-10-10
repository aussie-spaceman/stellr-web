import { describe, it, expect, vi, beforeEach } from 'vitest'

// Deep-review REG-4 regression test for the individual registration route: the
// event lookup must fail closed. A Sanity outage is a retryable 503 and an
// unknown slug is a 404 — neither may fall through to creating a member,
// participant and DocuSign envelope for an unresolved event.

const h = vi.hoisted(() => ({
  getEventBySlug: vi.fn(async (_slug: string): Promise<unknown> => ({ title: 'Colorado', activityType: 'live_event' })),
  getCurrentMember: vi.fn(async (): Promise<unknown> => null),
  regInsert: vi.fn(),
  // AUTH-N2: controllable rate-limit guard (null = proceed by default).
  rlGuard: vi.fn((_req: unknown, _route: string, _opts: unknown, _suffix?: string): Response | null => null),
}))

vi.mock('@/lib/sanity', () => ({ getEventBySlug: h.getEventBySlug }))
vi.mock('@/lib/community', () => ({ getCurrentMember: h.getCurrentMember }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, in: () => chain, is: () => chain, maybeSingle: async () => ({ data: null, error: null }), single: async () => ({ data: null, error: null }),
        insert: (p: unknown) => { if (table === 'registrations') h.regInsert(p); return chain },
        upsert: () => chain, update: () => chain, delete: () => chain,
        then: (onF: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(onF),
      }
      return chain
    },
  }),
}))
vi.mock('@/lib/scholarships', () => ({ findOfferByToken: async () => null, attachOfferToRegistration: async () => {} }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => null }))
vi.mock('@/lib/docusign-agreements', () => ({ dispatchAgreement: vi.fn(async () => {}) }))
vi.mock('@/lib/clerk-provisioning', () => ({ ensureClerkUserAndSignInToken: async () => ({ clerkUserId: 'c', signInToken: null }) }))
vi.mock('@/lib/registration-pay-link', () => ({ sendPayLinkEmail: async () => ({ sent: false, recipients: [] }) }))
vi.mock('@/lib/registration-duplicates', () => ({ findExistingRegistrations: async () => new Map(), resolveDuplicate: () => ({ kind: 'none' }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: h.rlGuard, HOUR_MS: 3_600_000 }))

const { POST } = await import('./route')

function post(overrides: Record<string, unknown> = {}) {
  const b = {
    event_slug: 'colorado', event_title: 'Colorado',
    email: 'kid@example.com', first_name: 'K', last_name: 'Id',
    date_of_birth: '2012-01-01', school_name: 'Denver High',
    ...overrides,
  }
  return POST(
    new Request('https://www.stellreducation.org/api/register/individual', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
    }) as never,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getEventBySlug.mockResolvedValue({ title: 'Colorado', activityType: 'live_event' })
  h.getCurrentMember.mockResolvedValue(null)
  h.rlGuard.mockReturnValue(null)
})

describe('POST /api/register/individual', () => {
  it('REG-4: a Sanity outage fails closed with 503 and creates no registration', async () => {
    h.getEventBySlug.mockRejectedValue(new Error('sanity timeout'))
    const res = await post()
    expect(res.status).toBe(503)
    expect(h.regInsert).not.toHaveBeenCalled()
  })

  it('REG-4: an unknown slug fails closed with 404 and creates no registration', async () => {
    h.getEventBySlug.mockResolvedValue(null)
    const res = await post()
    expect(res.status).toBe(404)
    expect(h.regInsert).not.toHaveBeenCalled()
  })

  // ── AUTH-N2 ────────────────────────────────────────────────────────────────
  it('AUTH-N2: runs the rate-limit guard first, sub-keyed by event slug', async () => {
    await post()
    expect(h.rlGuard).toHaveBeenCalledWith(
      expect.anything(),
      'register-individual',
      { limit: 3, windowMs: 3_600_000 },
      'colorado',
    )
  })

  it('AUTH-N2: a throttled caller gets 429 and creates no registration', async () => {
    h.rlGuard.mockReturnValue(
      new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }),
    )
    const res = await post()
    expect(res.status).toBe(429)
    expect(h.regInsert).not.toHaveBeenCalled()
  })
})
