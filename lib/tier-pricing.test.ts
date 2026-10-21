import { describe, it, expect, vi } from 'vitest'

const { cacheOptions } = vi.hoisted(() => ({
  cacheOptions: [] as Array<{ revalidate?: number | false; tags?: string[] }>,
}))

vi.mock('next/cache', () => ({
  unstable_cache: (
    fn: (...args: unknown[]) => unknown,
    _keys: string[],
    opts: { revalidate?: number | false; tags?: string[] },
  ) => {
    cacheOptions.push(opts)
    return fn
  },
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: vi.fn() }))
vi.mock('@/lib/stripe', () => ({ stripeClient: vi.fn(() => null) }))

import { PRICE_CACHE_SECONDS, formatTierPrice } from '@/lib/tier-pricing'

describe('tier price cache window', () => {
  // unstable_cache's revalidate becomes the ISR window of every page that shows
  // a tier price. At 60s the homepage, /competitions and /membership
  // re-rendered each minute they were visited (21 Oct 2026).
  it('is at least the pages’ ISR window (an hour)', () => {
    expect(cacheOptions).toHaveLength(1)
    expect(cacheOptions[0].revalidate).toBe(PRICE_CACHE_SECONDS)
    expect(PRICE_CACHE_SECONDS).toBeGreaterThanOrEqual(3600)
  })
})

describe('formatTierPrice', () => {
  it('formats whole dollars and reads zero or free as Free', () => {
    expect(formatTierPrice({ name: 'Pathfinder', annualCostCents: 5900, isFree: false })).toBe('$59')
    expect(formatTierPrice({ name: 'Explorer', annualCostCents: 0, isFree: true })).toBe('Free')
    expect(formatTierPrice(undefined)).toBe('Free')
  })
})
