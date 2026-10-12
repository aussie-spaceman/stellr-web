import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// hubspotFetch is the one transport behind lib/hubspot, hubspot-deals and
// hubspot-companies. This pins the request it builds; the -deals and
// -companies suites pin the URLs their callers pass through it.
describe('hubspotFetch', () => {
  const OLD = process.env.HUBSPOT_ACCESS_TOKEN
  beforeEach(() => {
    process.env.HUBSPOT_ACCESS_TOKEN = 'test-token'
    vi.resetModules()
  })
  afterEach(() => {
    process.env.HUBSPOT_ACCESS_TOKEN = OLD
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('posts JSON to api.hubapi.com with the bearer token', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { hubspotFetch } = await import('./hubspot')
    await hubspotFetch('/crm/v3/objects/deals', 'POST', { properties: { dealname: 'x' } })
    expect(fetchMock).toHaveBeenCalledWith('https://api.hubapi.com/crm/v3/objects/deals', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { dealname: 'x' } }),
    })
  })

  it('sends no body on GET', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { hubspotFetch } = await import('./hubspot')
    await hubspotFetch('/crm/v3/objects/companies/1', 'GET')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(init).not.toHaveProperty('body')
  })

  // deep review INT-7: a rate-limited READ is retried with backoff instead of
  // being surfaced as a hard failure (which dealsForContact then read as "no
  // deals" → a duplicate deal). Writes are never auto-retried.
  const res429 = () => ({ ok: false, status: 429, headers: { get: () => null } }) as unknown as Response

  it('retries a rate-limited GET with backoff, then succeeds', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res429())
      .mockResolvedValueOnce(res429())
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { hubspotFetch } = await import('./hubspot')
    const p = hubspotFetch('/crm/v4/objects/contacts/1/associations/deals', 'GET')
    await vi.runAllTimersAsync()
    const res = await p
    expect(res.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('retries the batch-read POST (a read) on 429', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res429())
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response)
    vi.stubGlobal('fetch', fetchMock)
    const { hubspotFetch } = await import('./hubspot')
    const p = hubspotFetch('/crm/v3/objects/deals/batch/read', 'POST', { inputs: [] })
    await vi.runAllTimersAsync()
    await p
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry a rate-limited write (a deal-create POST)', async () => {
    const fetchMock = vi.fn(async () => res429())
    vi.stubGlobal('fetch', fetchMock)
    const { hubspotFetch } = await import('./hubspot')
    const res = await hubspotFetch('/crm/v3/objects/deals', 'POST', { properties: {} })
    expect(res.status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('gives up after 3 attempts on a sustained 429', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => res429())
    vi.stubGlobal('fetch', fetchMock)
    const { hubspotFetch } = await import('./hubspot')
    const p = hubspotFetch('/crm/v3/objects/contacts/1', 'GET')
    await vi.runAllTimersAsync()
    const res = await p
    expect(res.status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
