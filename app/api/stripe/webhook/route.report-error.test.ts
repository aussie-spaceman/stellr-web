// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// S1 monitoring: a webhook handler failure is caught and answered with the
// route's own 500 (so Stripe retries), which never reaches Next's
// onRequestError. The route reports it to app_errors (lib/app-errors
// reportError) under the fixed label. The 500 and its body are unchanged, and
// the event is still not recorded as processed.

const h = vi.hoisted(() => ({
  reportError: vi.fn(async (_err: unknown, _opts: { route: string }) => {}),
  revalidatePriceCaches: vi.fn(),
  inserts: [] as { table: string; row: unknown }[],
  event: null as unknown,
}))

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/app-errors', () => ({ reportError: h.reportError }))
vi.mock('@/lib/price-cache', () => ({
  PRICE_CHANGE_EVENTS: new Set(['price.updated']),
  revalidatePriceCaches: h.revalidatePriceCaches,
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: null, error: null }),
        insert: async (row: unknown) => {
          h.inserts.push({ table, row })
          return { error: null }
        },
      }
      return q
    },
  }),
}))
vi.mock('@/lib/stripe', () => {
  const stub = { webhooks: { constructEvent: () => h.event } }
  return { requireStripe: () => stub, stripeClient: () => stub, STRIPE_API_VERSION: 'test' }
})
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: () => {} }))
vi.mock('@/lib/registration-confirm', () => ({ confirmRegistration: async () => {} }))
vi.mock('@/lib/store/orders', () => ({ handleStoreOrderPaid: async () => {} }))
vi.mock('@/lib/store/event-merch', () => ({ finalizeRegistrationMerch: async () => {} }))
vi.mock('@/lib/refunds/redeem', () => ({ finalizeRedemption: async () => {} }))
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins: async () => {} }))
vi.mock('@/lib/refunds/stripe-webhook', () => ({ recordExternalChargeRefunds: async () => ({ recorded: 0 }) }))
vi.mock('@/lib/activity-log', () => ({ logActivity: async () => {} }))
vi.mock('@/lib/membership-grants', () => ({ fireTierPurchased: async () => {}, grantTier: async () => ({}) }))
vi.mock('@/lib/mentoring', () => ({ rosterAfterPaidBooking: async () => ({ rostered: true }) }))
vi.mock('@/lib/coaching-requests', () => ({ scheduleFromRequest: async () => {} }))
vi.mock('@/lib/entitlements', () => ({
  confirmPaidBooking: async () => null,
  redeemCoupon: async () => {},
  grantTierAllocations: async () => {},
  grantPurchasedLot: async () => {},
  getOfferingTarget: async () => null,
}))
vi.mock('@/lib/email', () => ({
  sendEmail: async () => ({ id: null }),
  individualConfirmationEmail: () => ({ subject: '', html: '', text: '' }),
}))

const { POST } = await import('./route')

const post = () => {
  h.event = { id: 'evt_placeholder_1', type: 'price.updated', data: { object: {} } }
  return POST(new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=placeholder' },
    body: '{}',
  }) as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.inserts.length = 0
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_placeholder')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/stripe/webhook reports a handler failure', () => {
  it('reports the error under the fixed label; the 500 is unchanged and the event is not recorded', async () => {
    const boom = new Error('cache refresh blew up')
    h.revalidatePriceCaches.mockImplementation(() => { throw boom })
    const res = await post()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Handler failed' })
    expect(h.reportError).toHaveBeenCalledTimes(1)
    expect(h.reportError).toHaveBeenCalledWith(boom, { route: 'POST /api/stripe/webhook' })
    expect(h.inserts.filter((i) => i.table === 'stripe_webhook_events')).toEqual([])
  })

  it('a handled event reports nothing', async () => {
    h.revalidatePriceCaches.mockImplementation(() => {})
    const res = await post()
    expect(res.status).toBe(200)
    expect(h.reportError).not.toHaveBeenCalled()
  })
})
