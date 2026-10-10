// @vitest-environment node
import Stripe from 'stripe'
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

// deep review TEST-1: the Stripe webhook's signature check decides whether a
// registration becomes "paid" and whether a membership activates. Pin that it
// fails closed with no secret / a bad signature and never reaches the handler,
// and that a correctly signed event gets past the gate.
//
// STRIPE_WEBHOOK_SECRET is read inside POST (per request), but requireStripe()
// needs STRIPE_SECRET_KEY, so each case re-imports through a fresh registry with
// both stubbed. supabaseServer is mocked; on the accept path the idempotency read
// returns a "seen" row so the handler short-circuits before any side effect.

const from = vi.fn()
let seen: unknown = null

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (...args: unknown[]) => {
      from(...args)
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) chain[m] = () => chain
      chain.maybeSingle = async () => ({ data: seen, error: null })
      return chain
    },
  }),
}))
// A real Stripe instance for constructEvent (signature verification needs no
// network); the secret key value is irrelevant to HMAC verification.
vi.mock('@/lib/stripe', () => ({ requireStripe: () => new Stripe('sk_test_dummy') }))

const SECRET = 'whsec_testsecret'
const body = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated', data: { object: {} } })

async function load(webhookSecret: string) {
  vi.resetModules()
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', webhookSecret)
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy')
  return import('./route')
}

function post(POST: (r: NextRequest) => Promise<Response>, sig: string | null) {
  const headers: Record<string, string> = {}
  if (sig !== null) headers['stripe-signature'] = sig
  return POST(new NextRequest('https://app.test/api/stripe/webhook', { method: 'POST', body, headers }))
}

afterEach(() => {
  from.mockReset()
  seen = null
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('POST /api/stripe/webhook', () => {
  it('fails closed when the webhook secret is unset, and writes nothing', async () => {
    const { POST } = await load('')
    const sig = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: 'whsec_whatever' })
    const res = await post(POST, sig)
    expect(res.status).toBe(400)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects a missing signature header and writes nothing', async () => {
    const { POST } = await load(SECRET)
    expect((await post(POST, null)).status).toBe(400)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects a signature made with another secret and writes nothing', async () => {
    const { POST } = await load(SECRET)
    const sig = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: 'whsec_other' })
    expect((await post(POST, sig)).status).toBe(400)
    expect(from).not.toHaveBeenCalled()
  })

  it('accepts a correctly signed event (past the gate, into the handler)', async () => {
    seen = { id: 'evt_1' } // make the idempotency read short-circuit after the gate
    const { POST } = await load(SECRET)
    const sig = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET })
    const res = await post(POST, sig)
    expect(res.status).toBe(200)
    expect(from).toHaveBeenCalledWith('stripe_webhook_events')
  })
})
