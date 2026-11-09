import { describe, it, expect, vi, beforeEach } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { rec, OPEN_EVENT, jsonRequest, settle, type DbCall, type DbResult } from '@/test/registration/fixtures'

// S5 A7: the two pay-link routes and a tenant's registration. No Checkout session is
// ever made on Stellr's Stripe account for a tenant, and a registration of a tenant
// other than the request's gets the unknown link's answer before anything about it
// is told.

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'

const h = vi.hoisted(() => ({
  requestTenant: vi.fn(async (): Promise<{ kind: string; tenantId: string; tenantSlug: string }> => ({
    kind: 'stellr', tenantId: '00000000-0000-4000-8000-000000000001', tenantSlug: 'stellr',
  })),
  getEventBySlug: vi.fn(async (_slug: string): Promise<unknown> => null),
  createCheckout: vi.fn(async (): Promise<unknown> => ({ url: 'https://checkout.test/cs_1' })),
  createSeatCheckout: vi.fn(async (): Promise<unknown> => ({ url: 'https://checkout.test/cs_2', sessionId: 'cs_2' })),
  createSharedSeatCheckout: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ url: 'https://checkout.test/cs_3', sessionId: 'cs_3' })),
  audit: vi.fn(async (_m: Record<string, unknown>, _o?: unknown) => ({ ok: false, skipped: 'disabled' })),
}))

vi.mock('@/lib/tenancy/request-tenant', () => ({ requestTenant: h.requestTenant }))
vi.mock('@/lib/audit/route', () => ({ auditMutation: h.audit }))
vi.mock('@/lib/supabase', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return { supabaseServer: () => rec.client() }
})
vi.mock('@/lib/sanity', () => ({ getEventBySlug: h.getEventBySlug }))
vi.mock('@/lib/rate-limit-async', () => ({ rateLimit: async () => null }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => ({}) }))
vi.mock('@/lib/registration-checkout', async () => {
  const actual = await vi.importActual<typeof import('@/lib/registration-checkout')>('@/lib/registration-checkout')
  return { ...actual, createRegistrationCheckout: h.createCheckout }
})
vi.mock('@/lib/individual-payment', () => ({
  createSeatCheckout: h.createSeatCheckout,
  seatPayPageUrl: () => 'https://www.stellreducation.org/pay-seat',
}))
vi.mock('@/lib/teacher-share', () => ({ createSharedSeatCheckout: h.createSharedSeatCheckout }))

const pay = (await import('@/app/api/register/pay/route')).POST
const paySeat = (await import('@/app/api/register/pay-seat/route')).POST

const TOKEN = 'ab'.repeat(32)
const NOT_VALID = { status: 404, body: { error: 'This link isn’t valid.' } }
const MIRROR = { tenant_id: CANARY, activity_type: 'live_event', starts_at: null, time_zone: 'America/Denver', min_participant_age: null }

function onHost(tenantId: string) {
  h.requestTenant.mockResolvedValue(
    tenantId === STELLR_TENANT_ID
      ? { kind: 'stellr', tenantId, tenantSlug: 'stellr' }
      : { kind: 'tenant', tenantId, tenantSlug: 'canary' },
  )
}

function db(opts: { reg: Record<string, unknown> | null; seat?: Record<string, unknown> | null; eventTenant: string | null }) {
  rec.respond((c: DbCall): DbResult | undefined => {
    if (c.table === 'registrations' && c.op === 'select') return { data: opts.reg, error: null }
    if (c.table === 'participants' && c.op === 'select') return { data: opts.seat ?? null, error: null }
    if (c.table === 'events' && c.op === 'select') {
      return { data: opts.eventTenant ? { ...MIRROR, tenant_id: opts.eventTenant } : null, error: null }
    }
    return undefined
  })
}

const PENDING = { id: 'reg-1', event_slug: 'canary-cup', type: 'group', status: 'pending', member_pays_individually: true, event_title: 'Canary Cup', invoice_coupon_id: null }
const SEAT = { id: 'p-1', email: 'kid@example.com', registration_id: 'reg-1', individual_payment_status: 'pending' }

const postPay = () => pay(jsonRequest('/api/register/pay', { token: TOKEN }))
const postSeat = () => paySeat(jsonRequest('/api/register/pay-seat', { token: TOKEN }))

beforeEach(() => {
  vi.clearAllMocks()
  rec.reset()
  h.getEventBySlug.mockResolvedValue(OPEN_EVENT)
  onHost(STELLR_TENANT_ID)
})

describe('S5 A7: register/pay', () => {
  it('a tenant’s registration on Stellr’s host: the unknown link’s answer, even when it is paid', async () => {
    db({ reg: { ...PENDING, tenant_id: CANARY }, eventTenant: CANARY })
    expect(await settle(await postPay())).toEqual(NOT_VALID)
    db({ reg: { ...PENDING, status: 'confirmed', tenant_id: CANARY }, eventTenant: CANARY })
    expect(await settle(await postPay())).toEqual(NOT_VALID)
    expect(h.createCheckout).not.toHaveBeenCalled()
    expect(h.getEventBySlug).not.toHaveBeenCalled()
  })

  it('a tenant’s registration on its own host takes no payment', async () => {
    onHost(CANARY)
    db({ reg: { ...PENDING, tenant_id: CANARY }, eventTenant: CANARY })
    expect(await settle(await postPay())).toMatchObject({ status: 503, body: { code: 'tenant_payments_unavailable' } })
    expect(h.createCheckout).not.toHaveBeenCalled()
  })

  it('Stellr’s registration on a tenant’s host: the unknown link’s answer', async () => {
    onHost(CANARY)
    db({ reg: { ...PENDING, tenant_id: null }, eventTenant: null })
    expect(await settle(await postPay())).toEqual(NOT_VALID)
  })

  it('a registration stamped Stellr’s, for an event the mirror gives a tenant, opens no Checkout', async () => {
    db({ reg: { ...PENDING, tenant_id: STELLR_TENANT_ID }, eventTenant: CANARY })
    const res = await settle(await postPay())
    expect(res).toMatchObject({ status: 503, body: { code: 'tenant_payments_unavailable' } })
    expect(h.createCheckout).not.toHaveBeenCalled()
  })

  it('a tenant’s registration with no mirror row, on its own host: refused by its stamp alone', async () => {
    onHost(CANARY)
    db({ reg: { ...PENDING, tenant_id: CANARY }, eventTenant: null })
    expect(await settle(await postPay())).toMatchObject({ status: 503, body: { code: 'tenant_payments_unavailable' } })
    expect(h.createCheckout).not.toHaveBeenCalled()
  })

  it('Stellr’s own registration still opens its Checkout', async () => {
    db({ reg: { ...PENDING, tenant_id: STELLR_TENANT_ID }, eventTenant: STELLR_TENANT_ID })
    expect(await settle(await postPay())).toEqual({ status: 200, body: { url: 'https://checkout.test/cs_1' } })
  })
})

describe('S5 A7: the pay routes’ audit events', () => {
  it('a Checkout started records one event; a refusal records none', async () => {
    db({ reg: { ...PENDING, tenant_id: null }, seat: SEAT, eventTenant: null })
    await postPay()
    await postSeat()
    expect(h.audit.mock.calls.map(([m]) => [m.action, (m.target as { id: string }).id, (m.metadata as { status: number }).status])).toEqual([
      ['registration.payment.start', 'reg-1', 200],
      ['registration.seat_payment.start', 'p-1', 200],
    ])
    h.audit.mockClear()
    db({ reg: { ...PENDING, tenant_id: CANARY }, seat: SEAT, eventTenant: CANARY })
    await postPay()
    await postSeat()
    expect(h.audit).not.toHaveBeenCalled()
  })

  it('a refusal before any Checkout records none, a 503 included: a tenant’s own registration and seat, a tenant’s event', async () => {
    onHost(CANARY)
    db({ reg: { ...PENDING, tenant_id: CANARY }, seat: SEAT, eventTenant: CANARY })
    expect(await settle(await postPay())).toMatchObject({ status: 503, body: { code: 'tenant_payments_unavailable' } })
    expect(await settle(await postSeat())).toMatchObject({ status: 503, body: { code: 'tenant_payments_unavailable' } })
    onHost(STELLR_TENANT_ID)
    db({ reg: { ...PENDING, tenant_id: null }, seat: SEAT, eventTenant: CANARY })
    expect(await settle(await postPay())).toMatchObject({ status: 503, body: { code: 'tenant_payments_unavailable' } })
    expect(await settle(await postSeat())).toMatchObject({ status: 503, body: { code: 'tenant_payments_unavailable' } })
    expect(h.audit).not.toHaveBeenCalled()
  })

  it('a Checkout that was tried and failed is still recorded', async () => {
    db({ reg: { ...PENDING, tenant_id: null }, seat: SEAT, eventTenant: null })
    h.createSeatCheckout.mockRejectedValueOnce(new Error('stripe down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await settle(await postSeat())).toMatchObject({ status: 502 })
    err.mockRestore()
    expect(h.audit.mock.calls.map(([m]) => [m.action, (m.metadata as { status: number }).status])).toEqual([
      ['registration.seat_payment.start', 502],
    ])
  })

  it('a handler that throws is still recorded, as a 500', async () => {
    h.requestTenant.mockRejectedValueOnce(new Error('boom'))
    await expect(postPay()).rejects.toThrow('boom')
    expect(h.audit.mock.calls.map(([m]) => [m.action, (m.metadata as { status: number }).status])).toEqual([
      ['registration.payment.start', 500],
    ])
  })
})

describe('S5 A7: register/pay-seat', () => {
  it('a tenant’s seat on Stellr’s host: the unknown link’s answer, even when it is paid', async () => {
    db({ reg: { ...PENDING, tenant_id: CANARY }, seat: SEAT, eventTenant: CANARY })
    expect(await settle(await postSeat())).toEqual(NOT_VALID)
    db({ reg: { ...PENDING, tenant_id: CANARY }, seat: { ...SEAT, individual_payment_status: 'paid' }, eventTenant: CANARY })
    expect(await settle(await postSeat())).toEqual(NOT_VALID)
    expect(h.createSeatCheckout).not.toHaveBeenCalled()
  })

  it('a tenant’s seat on its own host takes no payment', async () => {
    onHost(CANARY)
    db({ reg: { ...PENDING, tenant_id: CANARY }, seat: SEAT, eventTenant: CANARY })
    expect(await settle(await postSeat())).toMatchObject({ status: 503, body: { code: 'tenant_payments_unavailable' } })
    expect(h.createSeatCheckout).not.toHaveBeenCalled()
  })

  it('a seat stamped Stellr’s, for an event the mirror gives a tenant, opens no Checkout', async () => {
    db({ reg: { ...PENDING, tenant_id: null }, seat: SEAT, eventTenant: CANARY })
    expect(await settle(await postSeat())).toMatchObject({ status: 503, body: { code: 'tenant_payments_unavailable' } })
    expect(h.createSeatCheckout).not.toHaveBeenCalled()
  })

  it('a tenant’s seat with no mirror row, on its own host: refused by its stamp alone', async () => {
    onHost(CANARY)
    db({ reg: { ...PENDING, tenant_id: CANARY }, seat: SEAT, eventTenant: null })
    expect(await settle(await postSeat())).toMatchObject({ status: 503, body: { code: 'tenant_payments_unavailable' } })
    db({ reg: { ...PENDING, share_estimate: 12, tenant_id: CANARY }, seat: SEAT, eventTenant: null })
    expect(await settle(await postSeat())).toMatchObject({ status: 503, body: { code: 'tenant_payments_unavailable' } })
    expect(h.createSeatCheckout).not.toHaveBeenCalled()
    expect(h.createSharedSeatCheckout).not.toHaveBeenCalled()
  })

  it('Stellr’s own seat still opens its Checkout', async () => {
    db({ reg: { ...PENDING, tenant_id: null }, seat: SEAT, eventTenant: null })
    expect(await settle(await postSeat())).toEqual({ status: 200, body: { url: 'https://checkout.test/cs_2' } })
  })
})

// #584 on top of A7: a part-invoiced group's own-link seat, and a group sharing the
// teacher's cost, pay through the same route, so the same tenant checks come first.
describe('S5 A7 with #584: split groups and the shared teacher’s cost', () => {
  const SPLIT = { ...PENDING, member_pays_individually: false }
  const SHARED = { ...PENDING, share_estimate: 12 }
  const postSeatWithCode = (code: string) => paySeat(jsonRequest('/api/register/pay-seat', { token: TOKEN, code }))

  it('Stellr’s part-invoiced group: a pending seat of its own opens its Checkout; one on the invoice does not', async () => {
    db({ reg: { ...SPLIT, tenant_id: null }, seat: SEAT, eventTenant: null })
    expect(await settle(await postSeat())).toEqual({ status: 200, body: { url: 'https://checkout.test/cs_2' } })
    db({ reg: { ...SPLIT, tenant_id: null }, seat: { ...SEAT, individual_payment_status: null }, eventTenant: null })
    expect(await settle(await postSeat())).toMatchObject({ status: 409, body: { code: 'not_individual' } })
    expect(h.createSeatCheckout).toHaveBeenCalledTimes(1)
  })

  it('a tenant’s pending seat in a part-invoiced group: the unknown link on Stellr’s host, no payment on its own', async () => {
    db({ reg: { ...SPLIT, tenant_id: CANARY }, seat: SEAT, eventTenant: CANARY })
    expect(await settle(await postSeat())).toEqual(NOT_VALID)
    onHost(CANARY)
    expect(await settle(await postSeat())).toMatchObject({ status: 503, body: { code: 'tenant_payments_unavailable' } })
    expect(h.createSeatCheckout).not.toHaveBeenCalled()
  })

  it('Stellr’s group sharing the teacher’s cost opens the shared Checkout, with and without a code', async () => {
    db({ reg: { ...SHARED, tenant_id: null }, seat: SEAT, eventTenant: null })
    expect(await settle(await postSeat())).toEqual({ status: 200, body: { url: 'https://checkout.test/cs_3' } })
    expect(h.createSharedSeatCheckout.mock.calls[0][2]).toMatchObject({ participantId: 'p-1', discountCode: null })
    expect(await settle(await postSeatWithCode('SPRING10'))).toEqual({ status: 200, body: { url: 'https://checkout.test/cs_3' } })
    expect(h.createSharedSeatCheckout.mock.calls[1][2]).toMatchObject({ discountCode: 'SPRING10' })
    expect(h.createSeatCheckout).not.toHaveBeenCalled()
  })

  it('the shared Checkout’s answers: a bad code is a 400, a waived seat a 200 with nothing to pay', async () => {
    db({ reg: { ...SHARED, tenant_id: null }, seat: SEAT, eventTenant: null })
    h.createSharedSeatCheckout.mockResolvedValueOnce({ error: 'bad_code', message: 'That code isn’t valid.' })
    expect(await settle(await postSeatWithCode('NOPE'))).toEqual({ status: 400, body: { error: 'That code isn’t valid.', code: 'bad_code' } })
    h.createSharedSeatCheckout.mockResolvedValueOnce({ waived: true, charge: {} })
    expect(await settle(await postSeatWithCode('FREE'))).toEqual({ status: 200, body: { waived: true, message: 'Nothing to pay: your place is confirmed.' } })
    h.createSharedSeatCheckout.mockResolvedValueOnce({ error: 'no_price', message: 'No price.' })
    expect(await settle(await postSeat())).toEqual({ status: 503, body: { error: 'No price.', code: 'no_price' } })
    h.createSharedSeatCheckout.mockResolvedValueOnce({ error: 'closed', message: 'Closed.' })
    expect(await settle(await postSeat())).toEqual({ status: 409, body: { error: 'Closed.', code: 'closed' } })
  })

  it('the shared Checkout carries the group’s coupon and caps the code at 64 characters', async () => {
    db({ reg: { ...SHARED, invoice_coupon_id: 'coupon_grp', tenant_id: null }, seat: SEAT, eventTenant: null })
    await postSeatWithCode('X'.repeat(80))
    expect(h.createSharedSeatCheckout.mock.calls[0][2]).toMatchObject({ groupCouponId: 'coupon_grp', discountCode: 'X'.repeat(64) })
  })

  it('a shared seat never reaches the shared Checkout for a tenant, by its stamp or by the event’s owner', async () => {
    db({ reg: { ...SHARED, tenant_id: CANARY }, seat: SEAT, eventTenant: CANARY })
    expect(await settle(await postSeatWithCode('SPRING10'))).toEqual(NOT_VALID)
    onHost(CANARY)
    expect(await settle(await postSeatWithCode('SPRING10'))).toMatchObject({ status: 503, body: { code: 'tenant_payments_unavailable' } })
    onHost(STELLR_TENANT_ID)
    db({ reg: { ...SHARED, tenant_id: null }, seat: SEAT, eventTenant: CANARY })
    expect(await settle(await postSeatWithCode('SPRING10'))).toMatchObject({ status: 503, body: { code: 'tenant_payments_unavailable' } })
    expect(h.createSharedSeatCheckout).not.toHaveBeenCalled()
  })
})
