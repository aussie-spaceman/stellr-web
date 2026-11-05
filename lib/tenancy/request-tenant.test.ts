// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from './constants'
import { TENANT_ID_HEADER, TENANT_SLUG_HEADER } from './host'

const state = vi.hoisted(() => ({ headers: new Headers(), headerReads: 0 }))

vi.mock('next/headers', () => ({
  headers: async () => {
    state.headerReads += 1
    return state.headers
  },
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

import { requestTenant, tenantFromParams } from './request-tenant'

const CANARY = '11111111-1111-4111-8111-111111111111'
const ROWS = [
  { host: 'canary-academy.localhost', tenant_id: CANARY, tenants: { slug: 'canary-academy', status: 'active' } },
  { host: 'stellr.localhost', tenant_id: STELLR_TENANT_ID, tenants: { slug: 'stellr', status: 'active' } },
  { host: 'paused.localhost', tenant_id: CANARY, tenants: { slug: 'paused', status: 'suspended' } },
]
const fetchStub = vi.fn()

beforeEach(() => {
  state.headers = new Headers()
  state.headerReads = 0
  fetchStub.mockReset()
  fetchStub.mockImplementation(async () => new Response(JSON.stringify(ROWS), { status: 200 }))
  vi.stubGlobal('fetch', fetchStub)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.test')
  vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_TESTONLY')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('requestTenant', () => {
  it('with the flag off answers Stellr and never reads the request, whatever was sent', async () => {
    vi.stubEnv('TENANT_ROUTING_ENABLED', undefined)
    state.headers.set(TENANT_ID_HEADER, CANARY)
    state.headers.set(TENANT_SLUG_HEADER, 'canary-academy')
    expect(await requestTenant()).toEqual({ kind: 'stellr', tenantId: STELLR_TENANT_ID, tenantSlug: 'stellr' })
    expect(state.headerReads).toBe(0)
  })

  describe('with the flag on', () => {
    beforeEach(() => vi.stubEnv('TENANT_ROUTING_ENABLED', 'true'))

    it('answers Stellr when the proxy set neither header', async () => {
      expect((await requestTenant()).kind).toBe('stellr')
    })

    it('answers the tenant the proxy set', async () => {
      state.headers.set(TENANT_ID_HEADER, CANARY)
      state.headers.set(TENANT_SLUG_HEADER, 'canary-academy')
      expect(await requestTenant()).toEqual({ kind: 'tenant', tenantId: CANARY, tenantSlug: 'canary-academy' })
    })

    it.each([
      [CANARY, null],
      [null, 'canary-academy'],
      ['not-a-uuid', 'canary-academy'],
      [CANARY, 'Not A Slug'],
      ['', ''],
    ])('throws on a pair the proxy would never set: %s, %s', async (id, slug) => {
      if (id !== null) state.headers.set(TENANT_ID_HEADER, id)
      if (slug !== null) state.headers.set(TENANT_SLUG_HEADER, slug)
      await expect(requestTenant()).rejects.toThrow(/tenant headers/)
    })
  })
})

describe('tenantFromParams', () => {
  // The default resolver caches per module instance, so each test gets its own.
  const load = async () => {
    vi.resetModules()
    return (await import('./request-tenant')).tenantFromParams
  }

  it('returns an active tenant, from a plain or a promised params', async () => {
    vi.stubEnv('TENANT_ROUTING_ENABLED', 'true')
    const from = await load()
    const want = { tenantId: CANARY, tenantSlug: 'canary-academy' }
    expect(await from({ tenant: 'canary-academy' })).toEqual(want)
    expect(await from(Promise.resolve({ tenant: 'canary-academy' }))).toEqual(want)
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })

  it.each(['nobody', 'paused', 'stellr', 'CANARY-ACADEMY', ''])('answers 404 for %s', async (slug) => {
    vi.stubEnv('TENANT_ROUTING_ENABLED', 'true')
    const from = await load()
    await expect(from({ tenant: slug })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('answers 404 with the flag off, without a fetch', async () => {
    vi.stubEnv('TENANT_ROUTING_ENABLED', undefined)
    await expect(tenantFromParams({ tenant: 'canary-academy' })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('answers 404 when the map cannot load', async () => {
    vi.stubEnv('TENANT_ROUTING_ENABLED', 'true')
    fetchStub.mockImplementation(async () => new Response('nope', { status: 500 }))
    const from = await load()
    await expect(from({ tenant: 'canary-academy' })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
