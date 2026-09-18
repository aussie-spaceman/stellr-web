import { describe, it, expect, vi, afterEach } from 'vitest'

// Pins the two contracts the 26 former inline constructions had: nullable when
// unconfigured, throwing when required — and that both pass one API version.
const ctor = vi.fn()
vi.mock('stripe', () => ({ default: class { constructor(key: string, opts: unknown) { ctor(key, opts) } } }))

import { stripeClient, requireStripe, STRIPE_API_VERSION } from './stripe'

afterEach(() => { vi.unstubAllEnvs(); ctor.mockClear() })

describe('stripeClient', () => {
  it('returns null without STRIPE_SECRET_KEY', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    expect(stripeClient()).toBeNull()
    expect(ctor).not.toHaveBeenCalled()
  })
  it('constructs with the pinned API version', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x')
    expect(stripeClient()).not.toBeNull()
    expect(ctor).toHaveBeenCalledWith('sk_test_x', { apiVersion: STRIPE_API_VERSION })
  })
})

describe('requireStripe', () => {
  it('throws the message the routes used to throw', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    expect(() => requireStripe()).toThrow('STRIPE_SECRET_KEY not set')
  })
  it('returns the client when configured', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x')
    expect(requireStripe()).toBeTruthy()
  })
})
