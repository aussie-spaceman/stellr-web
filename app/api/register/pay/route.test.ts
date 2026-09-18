import { describe, it, expect, vi, beforeEach } from 'vitest'

const { regLookup, getEventBySlug, createRegistrationCheckout } = vi.hoisted(() => ({
  regLookup: vi.fn(async (): Promise<{ data: unknown; error: null }> => ({ data: null, error: null })),
  getEventBySlug: vi.fn(async (_slug: string) => ({ registrationOpenDate: '2026-01-01', registrationCloseDate: '2099-01-01' })),
  createRegistrationCheckout: vi.fn(async () => ({ url: 'https://checkout.stripe.test/cs_1', sessionId: 'cs_1', amountCents: 7500 })),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: regLookup }
      return chain
    },
  }),
}))
vi.mock('@/lib/sanity', () => ({ getEventBySlug }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: () => null }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => ({}) }))
vi.mock('@/lib/registration-checkout', async () => {
  const actual = await vi.importActual<typeof import('@/lib/registration-checkout')>('@/lib/registration-checkout')
  return { ...actual, createRegistrationCheckout }
})

const { POST } = await import('./route')

const TOKEN = 'ab'.repeat(32)

function post(body: unknown) {
  return POST(
    new Request('https://www.stellreducation.org/api/register/pay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  regLookup.mockResolvedValue({ data: null, error: null })
  getEventBySlug.mockResolvedValue({ registrationOpenDate: '2026-01-01', registrationCloseDate: '2099-01-01' })
})

describe('POST /api/register/pay', () => {
  it('404s a malformed token without touching the database', async () => {
    const res = await post({ token: 'not-a-token' })
    expect(res.status).toBe(404)
    expect(regLookup).not.toHaveBeenCalled()
  })

  it('404s an unknown token', async () => {
    const res = await post({ token: TOKEN })
    expect(res.status).toBe(404)
    expect(createRegistrationCheckout).not.toHaveBeenCalled()
  })

  it('409s a confirmed registration', async () => {
    regLookup.mockResolvedValue({ data: { id: 'reg-1', event_slug: 'colorado', type: 'individual', status: 'confirmed' }, error: null })
    const res = await post({ token: TOKEN })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'already_paid' })
  })

  it('403s when registration for the event has closed', async () => {
    regLookup.mockResolvedValue({ data: { id: 'reg-1', event_slug: 'colorado', type: 'individual', status: 'pending' }, error: null })
    getEventBySlug.mockResolvedValue({ registrationOpenDate: '2020-01-01', registrationCloseDate: '2020-02-01' })
    const res = await post({ token: TOKEN })
    expect(res.status).toBe(403)
    expect(createRegistrationCheckout).not.toHaveBeenCalled()
  })

  it('mints a checkout for a pending registration, cancelling back to the pay page', async () => {
    regLookup.mockResolvedValue({ data: { id: 'reg-1', event_slug: 'colorado', type: 'individual', status: 'pending' }, error: null })
    const res = await post({ token: TOKEN })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.test/cs_1' })
    const [, , id, opts] = createRegistrationCheckout.mock.calls[0] as unknown as [unknown, unknown, string, Record<string, unknown>]
    expect(id).toBe('reg-1')
    expect(opts).toMatchObject({
      customerEmail: null,
      successUrl: expect.stringContaining('/register/colorado/confirmation?id=reg-1&type=individual&payment=success'),
      cancelUrl: expect.stringContaining(`/register/colorado/pay/${TOKEN}?cancelled=1`),
    })
  })

  it('maps helper errors to status codes', async () => {
    const { RegistrationCheckoutError } = await import('@/lib/registration-checkout')
    regLookup.mockResolvedValue({ data: { id: 'reg-1', event_slug: 'colorado', type: 'group', status: 'pending' }, error: null })
    createRegistrationCheckout.mockRejectedValueOnce(new RegistrationCheckoutError('no_price', 'no price'))
    expect((await post({ token: TOKEN })).status).toBe(503)
    createRegistrationCheckout.mockRejectedValueOnce(new RegistrationCheckoutError('not_card', 'invoice'))
    expect((await post({ token: TOKEN })).status).toBe(400)
  })
})
