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
})
