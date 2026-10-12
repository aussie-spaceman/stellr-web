// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// deep review PUB-7: the route proxies a PAID Google Places SKU with no
// throttle, no minimum length and no cache — an unauthenticated denial-of-wallet
// vector. These tests pin the guard. next/cache is a pass-through here (matching
// lib/event-pricing.test.ts) so the rate-limit and min-length behaviour is
// deterministic and not masked by a warm data-cache hit.
vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
}))

const fetchMock = vi.fn(async () =>
  new Response(JSON.stringify({ places: [{ id: 'p1', formattedAddress: '1 A St', addressComponents: [] }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }),
)

const { GET } = await import('./route')

function get(name: string, ip: string) {
  return GET(
    new Request(`https://www.stellreducation.org/api/schools/lookup?name=${encodeURIComponent(name)}`, {
      headers: { 'x-forwarded-for': ip },
    }),
  )
}

beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key'
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/schools/lookup — denial-of-wallet guard (PUB-7)', () => {
  it('throttles a single IP to the configured limit and stops spending beyond it', async () => {
    const ip = '203.0.113.7'
    let last: Response | undefined
    // 30 allowed, the 31st rejected. Each uses a distinct name so a cache can't
    // be what cuts the calls — the rate limit must.
    for (let i = 0; i < 31; i++) last = await get(`lincoln high school ${i}`, ip)

    expect(last?.status).toBe(429)
    // Never more than the limit of upstream (paid) calls for this IP.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(30)
  })

  it('does not call the paid API for a too-short query', async () => {
    const res = await get('ab', '203.0.113.8')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ address: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does call the API for a query at or above the minimum length', async () => {
    const res = await get('abcd', '203.0.113.9')
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
