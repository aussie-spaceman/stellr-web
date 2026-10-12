import { describe, it, expect, vi, beforeEach } from 'vitest'

// Deep-review REG-4 regression test for the group-join route: the event lookup
// must fail closed. A still-valid join link must not admit a new participant
// (with a DocuSign envelope, Space grant and payment email) during a Sanity
// outage or when the event has vanished from the CMS.

const h = vi.hoisted(() => ({
  getEventBySlug: vi.fn(async (_slug: string): Promise<unknown> => ({ title: 'Colorado', activityType: 'live_event' })),
  partInsert: vi.fn(),
  auth: vi.fn(async () => ({ userId: null as string | null })),
  // AUTH-N2: controllable rate-limit guard (null = proceed by default).
  rlGuard: vi.fn((_req: unknown, _route: string, _opts: unknown, _suffix?: string): Response | null => null),
  // REG-7: controllable DB errors (null/false = healthy by default).
  dedupeError: null as { code?: string; message?: string } | null,
  countError: null as { message?: string } | null,
  insertError: null as { code?: string; message?: string } | null,
}))

const tokenRow = {
  token: 'tok', registration_id: 'reg-1', event_slug: 'colorado', event_title: 'Colorado',
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  registrations: { status: 'pending', withdrawn_at: null, school_name: 'Denver High', adult_count: 1, student_count: 2 },
}

vi.mock('@clerk/nextjs/server', () => ({ auth: h.auth }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: h.getEventBySlug }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, not: () => chain, is: () => chain,
        maybeSingle: async () => {
          if (table === 'group_join_tokens') return { data: tokenRow, error: null }
          // participants maybeSingle is the REG-7 dedupe pre-check.
          if (table === 'participants' && h.dedupeError) return { data: null, error: h.dedupeError }
          return { data: null, error: null }
        },
        single: async () =>
          table === 'participants' && h.insertError
            ? { data: null, error: h.insertError }
            : { data: { id: 'p-1' }, error: null },
        insert: (p: unknown) => { if (table === 'participants') h.partInsert(p); return chain },
        upsert: () => chain, update: () => chain,
        then: (onF: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: table === 'participants' ? h.countError : null, count: 0 }).then(onF),
      }
      return chain
    },
  }),
}))
vi.mock('@/lib/email', () => ({ sendEmail: async () => {}, groupMemberJoinedEmail: () => ({ subject: '', html: '', text: '' }) }))
vi.mock('@/lib/individual-payment', () => ({ ensureIndividualPayments: async () => {} }))
vi.mock('@/lib/docusign-agreements', () => ({ dispatchAgreement: vi.fn(async () => {}) }))
vi.mock('@/lib/school-link', () => ({ linkMembersToSchoolByName: async () => {} }))
vi.mock('@/lib/event-participation-sync', () => ({ recordEventParticipation: async () => {} }))
vi.mock('@/lib/space-inheritance', () => ({ syncObjectSpaceRoster: async () => {}, reconcileEventSpaceRoster: async () => {} }))
vi.mock('@/lib/clerk-provisioning', () => ({ ensureClerkUserAndSignInToken: async () => ({ clerkUserId: 'c', signInToken: null }) }))
vi.mock('@/lib/member-sync', () => ({ upsertMember: async () => 'm-1' }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: h.rlGuard, HOUR_MS: 3_600_000 }))

const { POST } = await import('./route')

function post() {
  return POST(
    new Request('https://www.stellreducation.org/api/register/group-join', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'tok', details: { first_name: 'K', last_name: 'Id', email: 'kid@example.com', date_of_birth: '2012-01-01' } }),
    }) as never,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getEventBySlug.mockResolvedValue({ title: 'Colorado', activityType: 'live_event' })
  h.auth.mockResolvedValue({ userId: null })
  h.rlGuard.mockReturnValue(null)
  h.dedupeError = null
  h.countError = null
  h.insertError = null
})

describe('POST /api/register/group-join', () => {
  it('REG-4: a Sanity outage fails closed with 503 and admits no one', async () => {
    h.getEventBySlug.mockRejectedValue(new Error('sanity timeout'))
    const res = await post()
    expect(res.status).toBe(503)
    expect(h.partInsert).not.toHaveBeenCalled()
  })

  it('REG-4: an unresolved event is treated as closed (403), admitting no one', async () => {
    h.getEventBySlug.mockResolvedValue(null)
    const res = await post()
    expect(res.status).toBe(403)
    expect(h.partInsert).not.toHaveBeenCalled()
  })

  // ── AUTH-N2 ────────────────────────────────────────────────────────────────
  it('AUTH-N2: runs the rate-limit guard first, sub-keyed by the join token', async () => {
    await post()
    expect(h.rlGuard).toHaveBeenCalledWith(
      expect.anything(),
      'register-group-join',
      { limit: 3, windowMs: 3_600_000 },
      'tok',
    )
  })

  it('AUTH-N2: a throttled caller gets 429 and admits no one', async () => {
    h.rlGuard.mockReturnValue(
      new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }),
    )
    const res = await post()
    expect(res.status).toBe(429)
    expect(h.partInsert).not.toHaveBeenCalled()
  })

  // ── REG-7 ────────────────────────────────────────────────────────────────
  it('REG-7: fails closed (503) and admits no one when the dedupe lookup errors', async () => {
    h.dedupeError = { message: 'transient db error' }
    const res = await post()
    expect(res.status).toBe(503)
    expect(h.partInsert).not.toHaveBeenCalled()
  })

  it('REG-7: fails closed (503) when the capacity count errors', async () => {
    h.countError = { message: 'transient db error' }
    const res = await post()
    expect(res.status).toBe(503)
    expect(h.partInsert).not.toHaveBeenCalled()
  })

  it('REG-7: a unique-violation on insert (lost race) is a 409, not a 500', async () => {
    h.insertError = { code: '23505', message: 'duplicate key value violates unique constraint' }
    const res = await post()
    expect(res.status).toBe(409)
    // The insert was attempted (the index is what caught the race).
    expect(h.partInsert).toHaveBeenCalled()
  })
})
