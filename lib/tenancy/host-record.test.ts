// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from './constants'
import { TENANT_ID_HEADER, TENANT_ROUTING_FLAG, TENANT_SLUG_HEADER } from './host'

// S5 wave 7, A10a: a record named in an API request is checked against the request's
// host tenant before anything else. NULL is Stellr's; a missing column is nobody's.

const state = vi.hoisted(() => ({ headers: new Headers(), headerReads: 0 }))
vi.mock('next/headers', () => ({
  headers: async () => {
    state.headerReads += 1
    return state.headers
  },
}))

import { onHost, recordOnHost, recordTenant } from './host-record'

const CANARY = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  state.headers = new Headers()
  state.headerReads = 0
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('recordTenant and onHost', () => {
  it('a NULL tenant is Stellr’s, and only NULL', () => {
    expect(recordTenant(null)).toBe(STELLR_TENANT_ID)
    expect(recordTenant(CANARY)).toBe(CANARY)
    expect(onHost({ tenant_id: null }, STELLR_TENANT_ID)).toBe(true)
    expect(onHost({ tenant_id: null }, CANARY)).toBe(false)
  })

  it('holds in both directions', () => {
    expect(onHost({ tenant_id: STELLR_TENANT_ID }, STELLR_TENANT_ID)).toBe(true)
    expect(onHost({ tenant_id: CANARY }, CANARY)).toBe(true)
    expect(onHost({ tenant_id: CANARY }, STELLR_TENANT_ID)).toBe(false)
    expect(onHost({ tenant_id: STELLR_TENANT_ID }, CANARY)).toBe(false)
  })

  it('a row whose select lost the column is on no host, Stellr’s included', () => {
    const lost = {} as { tenant_id: string | null }
    expect(onHost(lost, STELLR_TENANT_ID)).toBe(false)
    expect(onHost(lost, CANARY)).toBe(false)
  })
})

describe('recordOnHost', () => {
  it('with routing off: Stellr’s and NULL rows pass, another tenant’s is refused, and the request is not read', async () => {
    expect(await recordOnHost({ tenant_id: null })).toBe(true)
    expect(await recordOnHost({ tenant_id: STELLR_TENANT_ID })).toBe(true)
    expect(await recordOnHost({ tenant_id: CANARY })).toBe(false)
    expect(state.headerReads).toBe(0)
  })

  it('with routing on, on Stellr’s host (no tenant headers): the same answers', async () => {
    vi.stubEnv(TENANT_ROUTING_FLAG, 'true')
    expect(await recordOnHost({ tenant_id: null })).toBe(true)
    expect(await recordOnHost({ tenant_id: CANARY })).toBe(false)
  })

  it('on a tenant’s host: that tenant’s rows pass, and Stellr’s, NULL ones included, are refused', async () => {
    vi.stubEnv(TENANT_ROUTING_FLAG, 'true')
    state.headers = new Headers({ [TENANT_ID_HEADER]: CANARY, [TENANT_SLUG_HEADER]: 'canary-academy' })
    expect(await recordOnHost({ tenant_id: CANARY })).toBe(true)
    expect(await recordOnHost({ tenant_id: STELLR_TENANT_ID })).toBe(false)
    expect(await recordOnHost({ tenant_id: null })).toBe(false)
  })

  it('leaves a throw on tenant headers the proxy did not write to the route', async () => {
    vi.stubEnv(TENANT_ROUTING_FLAG, 'true')
    state.headers = new Headers({ [TENANT_ID_HEADER]: CANARY })
    await expect(recordOnHost({ tenant_id: CANARY })).rejects.toThrow('requestTenant')
  })
})
