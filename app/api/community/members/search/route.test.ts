import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review MP-6: the mentor member-search picker must return id + name only
// (never a personal email), only active members, and no minors; and it must be
// rate-limited per caller.

const h = vi.hoisted(() => ({
  getCurrentMember: vi.fn(async () => ({ id: 'me', isAdmin: false }) as { id: string; isAdmin: boolean } | null),
  getHostCaps: vi.fn(async () => ({ canMentor: true })),
  rlGuard: vi.fn((): Response | null => null),
  rows: [] as Record<string, unknown>[],
  recorded: { filters: {} as Record<string, unknown>, select: '' },
}))

vi.mock('@/lib/community', () => ({ getCurrentMember: h.getCurrentMember }))
vi.mock('@/lib/sessions', () => ({ getHostCaps: h.getHostCaps }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: h.rlGuard, HOUR_MS: 3_600_000 }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => {
      const chain: Record<string, unknown> = {
        select: (c: string) => { h.recorded.select = c; return chain },
        eq: (k: string, v: unknown) => { h.recorded.filters[k] = v; return chain },
        or: () => chain,
        order: () => chain,
        limit: async () => ({ data: h.rows, error: null }),
      }
      return chain
    },
  }),
}))

const { GET } = await import('./route')

const req = () => new Request('https://app.stellreducation.org/api/community/members/search?q=al')

const adult = { id: 'a1', first_name: 'Adult', last_name: 'One', email: 'adult@example.com', date_of_birth: '1985-01-01', age_bracket: 'adult' }
const minor = { id: 'm1', first_name: 'Minor', last_name: 'Two', email: 'minor@example.com', date_of_birth: '2013-01-01', age_bracket: 'high_school' }
const unknownDob = { id: 'u1', first_name: 'Unknown', last_name: 'Three', email: 'u@example.com', date_of_birth: null, age_bracket: 'adult' }

beforeEach(() => {
  vi.clearAllMocks()
  h.recorded = { filters: {}, select: '' }
  h.getCurrentMember.mockResolvedValue({ id: 'me', isAdmin: false })
  h.getHostCaps.mockResolvedValue({ canMentor: true })
  h.rlGuard.mockReturnValue(null)
  h.rows = [adult, minor, unknownDob]
})

describe('GET /api/community/members/search', () => {
  it('MP-6: never returns an email, and filters to active adults', async () => {
    const res = await GET(req())
    const body = await res.json()
    // Only the adult with a known DOB survives; the minor and the unknown-DOB
    // (could-be-a-child) rows are filtered out.
    expect(body.members).toEqual([{ id: 'a1', first_name: 'Adult', last_name: 'One' }])
    for (const m of body.members) expect(m).not.toHaveProperty('email')
    // The query restricts to active members and does not select email.
    expect(h.recorded.filters.is_active).toBe(true)
    expect(h.recorded.select).not.toContain('email')
  })

  it('MP-6: runs the per-caller rate-limit guard', async () => {
    await GET(req())
    expect(h.rlGuard).toHaveBeenCalledWith(expect.anything(), 'member-search', { limit: 40, windowMs: 3_600_000 }, 'me')
  })

  it('MP-6: a throttled caller gets the guard response', async () => {
    h.rlGuard.mockReturnValue(new Response('{}', { status: 429 }))
    const res = await GET(req())
    expect(res.status).toBe(429)
  })

  it('still gates to mentors and admins', async () => {
    h.getCurrentMember.mockResolvedValue({ id: 'me', isAdmin: false })
    h.getHostCaps.mockResolvedValue({ canMentor: false })
    const res = await GET(req())
    expect(res.status).toBe(403)
  })
})
