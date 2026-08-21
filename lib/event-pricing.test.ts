import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories are hoisted above the file body, so the spies they close
// over must be created inside vi.hoisted().
const { retrieve } = vi.hoisted(() => ({
  retrieve: vi.fn(
    async (_id: string): Promise<{ unit_amount: number | null; currency: string; active: boolean }> => ({
      unit_amount: 13500,
      currency: 'usd',
      active: true,
    }),
  ),
}))

// unstable_cache memoises across calls in Next; here it's a pass-through so each
// test sees its own Stripe stub rather than the first test's cached answer.
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}))
vi.mock('stripe', () => ({
  default: class {
    prices = { retrieve }
  },
}))

import { getEventPrice, formatEventPrice, eventPriceLabel, collectsNothing } from '@/lib/event-pricing'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_SECRET_KEY = 'sk_test_x'
  retrieve.mockResolvedValue({ unit_amount: 13500, currency: 'usd', active: true })
})

describe('getEventPrice', () => {
  // An unset fee is not a decision to charge nothing — free events carry an
  // explicit $0 price object instead.
  it('treats a blank price ID as "to be confirmed", not free, without calling Stripe', async () => {
    expect(await getEventPrice(undefined)).toEqual({ kind: 'tbc' })
    expect(await getEventPrice(null)).toEqual({ kind: 'tbc' })
    expect(await getEventPrice('')).toEqual({ kind: 'tbc' })
    expect(retrieve).not.toHaveBeenCalled()
  })

  it('resolves an explicit $0 price to free', async () => {
    retrieve.mockResolvedValue({ unit_amount: 0, currency: 'usd', active: true })
    expect(await getEventPrice('price_free')).toEqual({ kind: 'free' })
  })

  it('resolves an active price to cents', async () => {
    expect(await getEventPrice('price_abc')).toEqual({ kind: 'priced', cents: 13500, currency: 'usd' })
  })

  // Stripe rejects inactive prices as checkout line items, so an amount read off
  // one is an amount nobody can be charged — it must never reach the page.
  it('hides an inactive price rather than displaying it', async () => {
    retrieve.mockResolvedValue({ unit_amount: 52, currency: 'usd', active: false })
    expect(await getEventPrice('price_stale')).toEqual({ kind: 'unavailable' })
  })

  it('hides a price that does not exist in the account', async () => {
    retrieve.mockRejectedValue(new Error('No such price'))
    expect(await getEventPrice('price_gone')).toEqual({ kind: 'unavailable' })
  })

  it('hides a price with no unit amount', async () => {
    retrieve.mockResolvedValue({ unit_amount: null, currency: 'usd', active: true })
    expect(await getEventPrice('price_tiered')).toEqual({ kind: 'unavailable' })
  })

  // Without a key the event is still priced — we just can't read it. Reporting
  // "free" here would publish a fee the checkout would then contradict.
  it('hides rather than free-ing a priced event when Stripe is unconfigured', async () => {
    delete process.env.STRIPE_SECRET_KEY
    expect(await getEventPrice('price_abc')).toEqual({ kind: 'unavailable' })
  })
})

describe('collectsNothing', () => {
  it('is true for an event with no price configured at all', () => {
    expect(collectsNothing(null, null)).toBe(true)
    expect(collectsNothing(undefined, null)).toBe(true)
    expect(collectsNothing('', null)).toBe(true)
  })

  it('is true for an explicit $0 price object', () => {
    expect(collectsNothing('price_free', 0)).toBe(true)
  })

  it('is false for a real fee', () => {
    expect(collectsNothing('price_abc', 13500)).toBe(false)
  })

  // The distinction that matters: a lookup failure leaves the amount null, and
  // confirming those registrations would waive a fee that was never collected.
  it('is false when the amount never resolved, so a blip is not read as free', () => {
    expect(collectsNothing('price_abc', null)).toBe(false)
  })
})

describe('formatEventPrice', () => {
  it('drops the decimals on whole-dollar amounts and groups thousands', () => {
    expect(formatEventPrice(13500)).toBe('$135')
    expect(formatEventPrice(125000)).toBe('$1,250')
  })

  it('keeps decimals when the price has cents', () => {
    expect(formatEventPrice(13550)).toBe('$135.50')
    expect(formatEventPrice(52)).toBe('$0.52')
  })

  it('prefixes non-USD currencies with their code', () => {
    expect(formatEventPrice(13500, 'aud')).toBe('AUD 135')
  })
})

describe('eventPriceLabel', () => {
  it('labels each outcome distinctly, and renders nothing when unresolved', () => {
    expect(eventPriceLabel({ kind: 'priced', cents: 13500, currency: 'usd' })).toBe('$135 per participant')
    expect(eventPriceLabel({ kind: 'free' })).toBe('Free to enter')
    expect(eventPriceLabel({ kind: 'tbc' })).toBe('Pricing TBC')
    expect(eventPriceLabel({ kind: 'unavailable' })).toBeNull()
  })
})
