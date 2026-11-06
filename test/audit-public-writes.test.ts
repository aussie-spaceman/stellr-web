// @vitest-environment node
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// The public and store writes (docs/TENANCY-S5.md, B18). Each case runs the real route and
// the real lib/audit, down to the rpc the database would receive. What lies under a route
// is replaced only so far as it would reach the network.
//
// Three things hold for every route: with the flag off nothing is scheduled and nothing is
// written, a failed audit never changes the answer, and an event holds ids and short codes
// only. A refusal and a request that wrote nothing write no event.

const ORDER = '11111111-1111-4111-8111-111111111111'
const BATCH = '22222222-2222-4222-8222-222222222222'
const MEMBER = '33333333-3333-4333-8333-333333333333'
const REGISTRATION = '44444444-4444-4444-8444-444444444444'
const APPLICATION = '55555555-5555-4555-8555-555555555555'
const PRIVACY_REQUEST = '66666666-6666-4666-8666-666666666666'
const RESHIP = '77777777-7777-4777-8777-777777777777'
const USER = 'user_abc123'
const SECRET = 'pf-secret-123'

type Row = Record<string, unknown>

const h = vi.hoisted(() => ({
  after: vi.fn(),
  rpc: vi.fn(),
  tables: {} as Record<string, Record<string, unknown>[]>,
  insertError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  updates: [] as { table: string; set: Record<string, unknown>; where: Record<string, unknown> }[],
  userId: 'user_abc123' as string | null,
  member: null as { id: string; email: string | null; first_name?: string | null } | null,
  registration: null as Record<string, unknown> | null,
  limited: null as Response | null,
  impersonating: null as Response | null,
  verifyOptOut: true,
  upsertContact: vi.fn(),
  captureLead: vi.fn(),
  sendEmail: vi.fn(),
  claimUpload: vi.fn(),
  watermarkIfPdf: vi.fn(),
  createPendingOrder: vi.fn(),
  sessionsCreate: vi.fn(),
  upsertMember: vi.fn(),
  linkMembersToSchoolByName: vi.fn(),
  autoGrantBaseMembership: vi.fn(),
  requestHeldBack: vi.fn(),
  submitRequest: vi.fn(),
  readRequestLink: vi.fn(),
  confirmRequest: vi.fn(),
}))

function from(table: string) {
  const filters: ((r: Row) => boolean)[] = []
  const where: Row = {}
  let pending: Row | null = null
  let inserted: Row | null = null
  let head = false
  const matched = () => (h.tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
  const settled = () => {
    if (pending) {
      h.updates.push({ table, set: pending, where })
      return { data: matched(), error: h.updateError }
    }
    return head ? { count: matched().length, error: null } : { data: matched(), error: null }
  }
  const q: Record<string, unknown> = {
    select: (_c?: string, opts?: { head?: boolean }) => ((head = !!opts?.head), q),
    eq: (c: string, v: unknown) => ((where[c] = v), filters.push((r) => r[c] === v), q),
    neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
    lt: () => q,
    gte: () => q,
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
    update: (set: Row) => ((pending = set), q),
    insert: (row: Row) => ((inserted = row), q),
    maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
    single: async () => (h.insertError ? { data: null, error: h.insertError } : { data: { id: APPLICATION, ...inserted }, error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(settled()).then(resolve),
  }
  return q
}

vi.mock('server-only', () => ({}))
vi.mock('next/server', async (original) => ({ ...(await original<typeof import('next/server')>()), after: (task: () => unknown) => h.after(task) }))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: h.userId }) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from, rpc: h.rpc }) }))
vi.mock('@/lib/app-errors', () => ({ captureRequestError: async () => {} }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: () => h.limited, HOUR_MS: 3_600_000 }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => h.impersonating }))
vi.mock('@/lib/community', () => ({ getCurrentMember: async () => h.member }))
vi.mock('@/lib/sanity', () => ({
  getAllEvents: async () => [],
  getEventBySlug: async () => ({ title: 'Campaign', date: '2020-01-01' }),
}))
vi.mock('@/lib/hubspot', () => ({
  upsertContact: h.upsertContact,
  captureLead: h.captureLead,
  logLine: () => 'log',
  readHubspotCookie: () => undefined,
}))
vi.mock('@/lib/waitlist-optout', () => ({ verifyOptOutToken: () => h.verifyOptOut }))
vi.mock('@/lib/email', () => ({
  sendEmail: h.sendEmail,
  campaignProposalReceivedEmail: () => ({ subject: '', html: '', text: '' }),
}))
vi.mock('@/lib/scholarship-emails', () => ({
  scholarshipReceivedEmail: () => ({ subject: '', html: '', text: '' }),
  scholarshipStaffAlertEmail: () => ({ subject: '', html: '', text: '' }),
}))
vi.mock('@/lib/campaign-registrations', () => ({ getMemberCampaignRegistration: async () => h.registration }))
vi.mock('@/lib/uploads', () => ({ claimUpload: h.claimUpload }))
vi.mock('@/lib/resource-finalise', () => ({ watermarkIfPdf: h.watermarkIfPdf }))
vi.mock('@/lib/store/orders', () => ({ createPendingOrder: h.createPendingOrder, STORE_FLAT_SHIPPING_CENTS: 595 }))
vi.mock('@/lib/store/pricing', () => ({ computeUnitPrice: async () => ({ base_cents: 2000, unit_cents: 2000 }) }))
vi.mock('@/lib/store/auth', () => ({ currentStoreMember: async () => h.member }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => ({ checkout: { sessions: { create: h.sessionsCreate } } }) }))
vi.mock('@/lib/stripe-customer', () => ({ ensureStripeCustomer: async () => 'cus_1' }))
vi.mock('@/lib/tiers-server', () => ({ getActiveTierIdsByMember: async () => new Map() }))
vi.mock('@/lib/env-guards', () => ({ assertLiveCredentials: () => {} }))
vi.mock('@/lib/member-sync', () => ({ upsertMember: h.upsertMember }))
vi.mock('@/lib/school-link', () => ({ linkMembersToSchoolByName: h.linkMembersToSchoolByName }))
vi.mock('@/lib/auto-membership-grant', () => ({ autoGrantBaseMembership: h.autoGrantBaseMembership }))
vi.mock('@/lib/privacy-requests', async (original) => ({
  ...(await original<typeof import('@/lib/privacy-requests')>()),
  requestHeldBack: h.requestHeldBack,
  submitRequest: h.submitRequest,
  readRequestLink: h.readRequestLink,
  confirmRequest: h.confirmRequest,
}))

const unsubscribe = await import('@/app/api/email/unsubscribe/route')
const printful = await import('@/app/api/printful/webhook/route')
const campaign = await import('@/app/api/campaigns/[slug]/submit/route')
const scholarship = await import('@/app/api/scholarship/route')
const checkout = await import('@/app/api/store/checkout/route')
const reship = await import('@/app/api/store/reship/route')
const privacy = await import('@/app/api/privacy-requests/route')
const privacyConfirm = await import('@/app/api/privacy-requests/confirm/route')
const grant = await import('@/app/api/teacher-grant/route')

const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://www.stellreducation.org${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

const CHILD_NAME = 'Robin Childname'
const ADDRESS = 'robin.childname@example.com'

const scholarshipBody = { firstName: 'Robin', lastName: 'Childname', email: ADDRESS, phone: '555-0100', activity: 'Space Design Challenge', brief: 'I have asthma and would love to take part.' }
const grantBody = {
  firstName: 'Dana', lastName: 'Teacherson', email: 'dana.teacherson@example.com', phone: '555-0100', schoolName: 'Lincoln High School', schoolCity: 'Reno', schoolState: 'nv',
  subjects: 'Physics', yearsTeaching: '8', dateOfBirth: '1988-04-12', gender: 'Female', plannedActivities: 'both', expectedStudents: '12', priorStellr: 'no',
  motivation: 'I have been looking for a way to give my seniors a real engineering problem to work on.', referralSource: 'A colleague', consent: true, acknowledgePayment: true,
}
const privacyBody = { kind: 'deletion', relationship: 'parent_guardian', requesterName: 'A Parent', requesterEmail: ADDRESS, subjectName: CHILD_NAME, details: 'Please remove my child, who has asthma.' }
const shipped = { type: 'package_shipped', data: { order: { external_id: ORDER }, shipment: { tracking_url: 'https://track.example.test/secret-tracking' } } }

const postPrintful = (body: unknown, secret = SECRET) => printful.POST(json('/api/printful/webhook', body, { 'x-printful-secret': secret }))
const postCampaign = (body: unknown = { storagePath: `c1/${REGISTRATION}/f.pdf`, fileName: 'robin-childname.pdf', fileType: 'application/pdf', notes: 'Notes from a child' }) =>
  campaign.POST(new NextRequest('https://app.stellreducation.org/api/campaigns/c1/submit', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ slug: 'c1' }) })
const postUnsubscribe = (qs: string) => unsubscribe.POST(new NextRequest(`https://www.stellreducation.org/api/email/unsubscribe${qs}`, { method: 'POST' }))
const postCheckout = () => checkout.POST(json('/api/store/checkout', { items: [{ variantId: 'v1', qty: 2 }] }))
const postReship = () => reship.POST(json('/api/store/reship', { orderId: ORDER }))

/** Run what after() was given, as Next does once the response has gone. */
const settle = () => Promise.all(h.after.mock.calls.map(([task]) => (task as () => Promise<unknown>)()))

async function events() {
  await settle()
  return h.rpc.mock.calls.map((c) => c[1] as Record<string, unknown>)
}

beforeEach(() => {
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
  vi.stubEnv('PRINTFUL_WEBHOOK_SECRET', SECRET)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.clearAllMocks()
  h.after.mockReset()
  h.rpc.mockReset()
  h.rpc.mockResolvedValue({ data: { id: 1, chain_seq: 1 }, error: null })
  h.insertError = null
  h.updateError = null
  h.updates = []
  h.userId = USER
  h.member = { id: MEMBER, email: ADDRESS, first_name: 'Robin' }
  h.registration = { id: REGISTRATION, event_slug: 'c1', event_title: 'Campaign', group_name: null }
  h.limited = null
  h.impersonating = null
  h.verifyOptOut = true
  h.tables = {
    members: [{ id: MEMBER, email: ADDRESS, marketing_unsubscribe_token: 'tok', clerk_user_id: USER, stripe_customer_id: 'cus_1' }],
    store_orders: [{ id: ORDER, member_id: MEMBER, channel: 'event_registration', status: 'paid', event_slug: 'c1', registration_id: REGISTRATION, pod_order_id: 'pod1', items: [{ variant_id: 'v1', sku: 'S', name: 'Shirt', qty: 1, participant_member_id: MEMBER, fulfillment_status: 'awaiting_batch' }] }],
    merch_batches: [{ id: BATCH, pod_order_id: 'pod2' }],
    store_variants: [{ id: 'v1', sku: 'SKU1', label: 'M', market_price_cents: 2000, active: true, product: { id: 'p1', name: 'Tee', status: 'active', product_type: 'apparel' } }],
    participants: [{ id: 'p1', registration_id: REGISTRATION, member_id: MEMBER, merch_collected: false }],
  }
  h.upsertContact.mockResolvedValue({ ok: true })
  h.captureLead.mockResolvedValue({ ok: true })
  h.sendEmail.mockResolvedValue(undefined)
  h.claimUpload.mockResolvedValue({ bucket: 'b', bytes: new Uint8Array() })
  h.watermarkIfPdf.mockResolvedValue({ ok: true })
  h.createPendingOrder.mockResolvedValue({ orderId: RESHIP, subtotalCents: 0 })
  h.sessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/x' })
  h.upsertMember.mockImplementation(async (_db: unknown, _input: unknown, opts?: { onCreated?: (id: string) => void }) => {
    opts?.onCreated?.(MEMBER)
    return MEMBER
  })
  h.linkMembersToSchoolByName.mockResolvedValue(undefined)
  h.autoGrantBaseMembership.mockResolvedValue(undefined)
  h.requestHeldBack.mockResolvedValue(false)
  h.submitRequest.mockResolvedValue(PRIVACY_REQUEST)
  h.readRequestLink.mockResolvedValue({ state: 'open', row: { id: PRIVACY_REQUEST }, version: 1 })
  h.confirmRequest.mockResolvedValue({ state: 'confirmed', requestId: PRIVACY_REQUEST })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const stellr = { p_tenant: STELLR_TENANT_ID }
const anonymous = { p_actor: 'system', p_actor_kind: 'system' }
const signedIn = { p_actor: USER, p_actor_kind: 'user' }

/** A write that went through, the event it owes, and how to make the answer the same. */
const ROUTES: { name: string; run: () => Promise<Response>; arrange?: () => void; status: number; event: Record<string, unknown> }[] = [
  {
    name: 'email/unsubscribe, a member',
    run: () => postUnsubscribe('?token=tok'),
    status: 200,
    event: { ...stellr, ...anonymous, p_action: 'email.unsubscribe.apply', p_target_table: 'members', p_target_id: MEMBER, p_metadata: { audience: 'member', write_failed: false, actor_anonymous: true } },
  },
  {
    name: 'email/unsubscribe, a waitlist contact',
    run: () => postUnsubscribe(`?wl=sig&e=${encodeURIComponent(ADDRESS)}`),
    status: 200,
    event: { ...stellr, ...anonymous, p_action: 'email.unsubscribe.apply', p_target_table: null, p_target_id: null, p_metadata: { audience: 'waitlist', actor_anonymous: true } },
  },
  {
    name: 'printful/webhook, an order shipped',
    run: () => postPrintful(shipped),
    status: 200,
    event: { ...stellr, p_actor: 'webhook:printful', p_actor_kind: 'webhook', p_action: 'store.order.fulfilment_update', p_target_table: 'store_orders', p_target_id: ORDER, p_metadata: { event_type: 'package_shipped', write_failed: false } },
  },
  {
    name: 'campaigns/[slug]/submit',
    run: () => postCampaign(),
    status: 200,
    event: { ...stellr, ...signedIn, p_action: 'campaign.submission.create', p_target_table: 'registrations', p_target_id: REGISTRATION, p_metadata: { status: 200 } },
  },
  {
    name: 'scholarship',
    run: () => scholarship.POST(json('/api/scholarship', scholarshipBody)),
    status: 200,
    event: { ...stellr, ...signedIn, p_action: 'scholarship.application.create', p_target_table: 'scholarship_applications', p_target_id: APPLICATION, p_metadata: { saved: true, status: 200 } },
  },
  {
    name: 'store/checkout',
    run: postCheckout,
    status: 200,
    event: { ...stellr, ...signedIn, p_action: 'store.checkout.create', p_target_table: 'store_orders', p_target_id: RESHIP, p_metadata: { line_count: 1, guest: false } },
  },
  {
    name: 'store/reship',
    run: postReship,
    status: 200,
    event: { ...stellr, ...signedIn, p_action: 'store.order.reship', p_target_table: 'store_orders', p_target_id: RESHIP, p_metadata: { source_order_id: ORDER } },
  },
  {
    name: 'privacy-requests',
    run: () => privacy.POST(json('/api/privacy-requests', privacyBody)),
    status: 200,
    event: { ...stellr, ...anonymous, p_action: 'privacy.request.create', p_target_table: 'privacy_requests', p_target_id: PRIVACY_REQUEST, p_metadata: { request_kind: 'deletion', recorded: true, status: 200, actor_anonymous: true } },
  },
  {
    name: 'privacy-requests/confirm',
    run: () => privacyConfirm.POST(json('/api/privacy-requests/confirm', { token: 'a-link-token' })),
    status: 200,
    event: { ...stellr, ...anonymous, p_action: 'privacy.request.confirm', p_target_table: 'privacy_requests', p_target_id: PRIVACY_REQUEST, p_metadata: { state: 'confirmed', actor_anonymous: true } },
  },
  {
    name: 'teacher-grant',
    run: () => grant.POST(json('/api/teacher-grant', grantBody)),
    arrange: () => {
      h.tables.members = []
    },
    status: 200,
    event: { ...stellr, ...anonymous, p_action: 'teacher_grant.application.create', p_target_table: 'members', p_target_id: MEMBER, p_metadata: { member_created: true, status: 200, actor_anonymous: true } },
  },
]

describe.each(ROUTES)('$name', ({ run, arrange, status, event }) => {
  it('writes one event once the response has gone, on Stellr\'s chain, holding ids and codes only', async () => {
    arrange?.()
    const res = await run()
    expect(res.status).toBe(status)
    expect(h.rpc, 'not before the response').not.toHaveBeenCalled()
    const written = await events()
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ ...event, p_reason: null })
    expect(written[0].p_metadata).toEqual(event.p_metadata)
    const stored = JSON.stringify(written[0])
    for (const personal of ['@', 'Robin', 'Childname', 'Teacherson', 'asthma', '555-0100', 'Lincoln', '1988', 'secret-tracking', 'a-link-token', 'cus_1', '2000']) {
      expect(stored, personal).not.toContain(personal)
    }
  })

  it('with the flag off, the default: the same answer, nothing scheduled, nothing written', async () => {
    arrange?.()
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
    const res = await run()
    expect(res.status).toBe(status)
    expect(h.after).not.toHaveBeenCalled()
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('an audit that fails changes nothing about the answer', async () => {
    arrange?.()
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
    const quiet = await (await run()).text()
    h.updates = []
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
    h.rpc.mockRejectedValue(new Error('connection refused'))
    const res = await run()
    expect(res.status).toBe(status)
    expect(await res.text()).toBe(quiet)
    await expect(settle()).resolves.toBeDefined()
  })
})

describe('email/unsubscribe', () => {
  it('a token nobody holds answers the same, and writes no event: an anonymous caller cannot fill the log', async () => {
    const res = await postUnsubscribe('?token=nobody')
    expect(res.status).toBe(200)
    expect(await events()).toEqual([])
  })

  it('a bad signature on a waitlist link writes no event', async () => {
    h.verifyOptOut = false
    expect((await postUnsubscribe('?wl=sig&e=a%40example.test')).status).toBe(200)
    expect(h.upsertContact).not.toHaveBeenCalled()
    expect(await events()).toEqual([])
  })

  it('no identifiers: refused, no event', async () => {
    expect((await postUnsubscribe('')).status).toBe(400)
    expect(await events()).toEqual([])
  })

  it('a HubSpot write that failed answers 502 and writes no event', async () => {
    h.upsertContact.mockResolvedValue({ ok: false })
    expect((await postUnsubscribe('?wl=sig&e=a%40example.test')).status).toBe(502)
    expect(await events()).toEqual([])
  })

  it('an update that failed still answers as it did, and the event says so', async () => {
    h.updateError = { message: 'down' }
    expect((await postUnsubscribe('?token=tok')).status).toBe(200)
    expect((await events())[0].p_metadata).toMatchObject({ write_failed: true })
  })

  it('a link used again writes again, so it records again', async () => {
    await postUnsubscribe('?token=tok')
    await postUnsubscribe('?token=tok')
    expect(h.updates).toHaveLength(2)
    expect(await events()).toHaveLength(2)
  })
})

describe('printful/webhook', () => {
  it('a wrong secret: refused, no event', async () => {
    expect((await postPrintful(shipped, 'wrong')).status).toBe(401)
    expect(await events()).toEqual([])
  })

  it.each([
    ['no type', {}],
    ['a type that changes nothing', { type: 'stock_updated', data: { order: { external_id: ORDER } } }],
    ['an order it does not know', { type: 'package_shipped', data: { order: { external_id: 'nope' } } }],
    ['a failure for a batch, which changes nothing', { type: 'order_failed', data: { order: { external_id: BATCH } } }],
  ])('%s: the same answer, no write and no event', async (_name, body) => {
    const res = await postPrintful(body)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(h.updates).toEqual([])
    expect(await events()).toEqual([])
  })

  it('shipped: both tables are written as before', async () => {
    await postPrintful(shipped)
    expect(h.updates).toEqual([
      { table: 'store_orders', set: { status: 'shipped', tracking_url: 'https://track.example.test/secret-tracking' }, where: { id: ORDER } },
      { table: 'store_order_items', set: { fulfillment_status: 'shipped' }, where: { order_id: ORDER } },
    ])
  })

  it.each(['order_canceled', 'order_failed'])('%s: the order is cancelled as before, and recorded', async (type) => {
    await postPrintful({ type, data: { order: { id: 'pod1' } } })
    expect(h.updates).toEqual([{ table: 'store_orders', set: { status: 'cancelled' }, where: { id: ORDER } }])
    expect((await events())[0]).toMatchObject({ p_target_id: ORDER, p_metadata: { event_type: type, write_failed: false } })
  })

  it.each([
    ['its external id', { external_id: BATCH }],
    ["Printful's order id", { id: 'pod2' }],
  ])('a batch shipped, found by %s, is written as before, and recorded against the batch', async (_name, order) => {
    await postPrintful({ type: 'package_shipped', data: { order, shipment: { tracking_url: null } } })
    expect(h.updates).toEqual([
      { table: 'merch_batches', set: { status: 'shipped', tracking_url: null }, where: { id: BATCH } },
      { table: 'store_order_items', set: { fulfillment_status: 'shipped' }, where: { batch_id: BATCH } },
    ])
    expect((await events())[0]).toMatchObject({ p_target_table: 'merch_batches', p_target_id: BATCH })
  })

  it('an update that failed still answers ok, and the event says so', async () => {
    h.updateError = { message: 'down' }
    expect((await postPrintful(shipped)).status).toBe(200)
    expect((await events())[0].p_metadata).toMatchObject({ write_failed: true })
  })
})

describe('campaigns/[slug]/submit', () => {
  it('a submission answers with the file name, through the wrapper', async () => {
    const res = await postCampaign()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, fileName: 'robin-childname.pdf' })
  })

  it.each([
    ['signed out', () => { h.member = null }, 401],
    ['not registered', () => { h.registration = null }, 404],
    ['a path outside the registration', () => { h.claimUpload.mockClear() }, 403],
    ['a file that is refused', () => { h.claimUpload.mockResolvedValue({ error: 'No', status: 415 }) }, 415],
    ['while viewing as a member', () => { h.impersonating = new Response(null, { status: 403 }) }, 403],
  ])('%s: refused, no event', async (name, arrange, status) => {
    arrange()
    const body = name.startsWith('a path') ? { storagePath: 'other/x.pdf', fileName: 'x.pdf' } : undefined
    expect((await postCampaign(body)).status).toBe(status)
    expect(await events()).toEqual([])
  })

  it('a failed save answers 500 and is recorded, with the registration it was for', async () => {
    h.updateError = { message: 'down' }
    expect((await postCampaign()).status).toBe(500)
    expect((await events())[0]).toMatchObject({ p_action: 'campaign.submission.create', p_target_id: REGISTRATION, p_metadata: { status: 500 } })
  })
})

describe('scholarship', () => {
  it('rate limited, viewing as a member, or a bad body: refused, no event', async () => {
    h.limited = new Response(null, { status: 429 })
    expect((await scholarship.POST(json('/api/scholarship', scholarshipBody))).status).toBe(429)
    h.limited = null
    h.impersonating = new Response(null, { status: 403 })
    expect((await scholarship.POST(json('/api/scholarship', scholarshipBody))).status).toBe(403)
    h.impersonating = null
    expect((await scholarship.POST(json('/api/scholarship', { firstName: 'x' }))).status).toBe(400)
    expect(await events()).toEqual([])
  })

  it('a save that failed still emails staff and answers ok, and the event says so', async () => {
    h.insertError = { message: 'down' }
    expect((await scholarship.POST(json('/api/scholarship', scholarshipBody))).status).toBe(200)
    expect(h.sendEmail).toHaveBeenCalled()
    expect((await events())[0]).toMatchObject({ p_target_id: null, p_metadata: { saved: false, status: 200 } })
  })

  it('a staff email that failed answers 500, and the event keeps the row that was saved', async () => {
    h.sendEmail.mockRejectedValue(new Error('down'))
    expect((await scholarship.POST(json('/api/scholarship', scholarshipBody))).status).toBe(500)
    expect((await events())[0]).toMatchObject({ p_target_id: APPLICATION, p_metadata: { saved: true, status: 500 } })
  })

  it('nobody signed in: the event says so', async () => {
    h.userId = null
    h.member = null
    await scholarship.POST(json('/api/scholarship', scholarshipBody))
    expect((await events())[0]).toMatchObject({ p_actor: 'system', p_metadata: { actor_anonymous: true } })
  })
})

describe('store/checkout', () => {
  it('an empty cart or nothing purchasable: refused, no event', async () => {
    expect((await checkout.POST(json('/api/store/checkout', { items: [] }))).status).toBe(400)
    h.tables.store_variants = []
    expect((await postCheckout()).status).toBe(400)
    expect(await events()).toEqual([])
  })

  it('a guest: the event says so, and carries no address', async () => {
    h.userId = null
    await postCheckout()
    const [event] = await events()
    expect(event).toMatchObject({ p_actor: 'system', p_metadata: { guest: true, actor_anonymous: true } })
  })

  it('the event is written even when Stripe then fails, because the pending order exists', async () => {
    h.sessionsCreate.mockRejectedValue(new Error('stripe down'))
    await expect(postCheckout()).rejects.toThrow('stripe down')
    expect((await events())[0]).toMatchObject({ p_action: 'store.checkout.create', p_target_id: RESHIP })
  })
})

describe('store/reship', () => {
  it('not the caller\'s order, or nothing owed: refused, no event', async () => {
    h.member = { id: 'someone-else', email: null }
    expect((await postReship()).status).toBe(404)
    h.member = { id: MEMBER, email: ADDRESS }
    h.tables.participants = []
    expect((await postReship()).status).toBe(400)
    expect(await events()).toEqual([])
  })

  it('a stale pending reship is cancelled and recorded, even when the request then ends in a refusal', async () => {
    h.tables.store_orders.push({ id: RESHIP, source_order_id: ORDER, channel: 'reship', status: 'pending' })
    expect((await postReship()).status).toBe(409)
    expect(h.updates).toEqual([{ table: 'store_orders', set: { status: 'cancelled' }, where: { source_order_id: ORDER, channel: 'reship', status: 'pending' } }])
    const written = await events()
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ p_action: 'store.order.stale_reship_cancel', p_target_table: 'store_orders', p_target_id: RESHIP, p_metadata: { source_order_id: ORDER, cancelled: 1 } })
  })
})

describe('privacy-requests', () => {
  it('a bad body or another origin: refused, no event', async () => {
    expect((await privacy.POST(json('/api/privacy-requests', { kind: 'nonsense' }))).status).toBe(400)
    expect((await privacy.POST(json('/api/privacy-requests', privacyBody, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    expect(await events()).toEqual([])
  })

  it('a filled honeypot is refused by the schema, and writes no event', async () => {
    expect((await privacy.POST(json('/api/privacy-requests', { ...privacyBody, website: 'spam' }))).status).toBe(400)
    expect(await events()).toEqual([])
  })

  it('held back: the same answer as one that was recorded, nothing written and no event', async () => {
    const recorded = await privacy.POST(json('/api/privacy-requests', privacyBody))
    h.after.mockReset()
    h.submitRequest.mockClear()
    h.requestHeldBack.mockResolvedValue(true)
    const res = await privacy.POST(json('/api/privacy-requests', privacyBody))
    expect(res.status).toBe(recorded.status)
    expect(await res.text()).toBe(await recorded.text())
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(h.submitRequest).not.toHaveBeenCalled()
    expect(h.after).not.toHaveBeenCalled()
  })

  it('the row saved and the email failed: 502 as before, and the event names the row that exists', async () => {
    vi.stubEnv('ESIGN_TOKEN_SECRET', 'k'.repeat(48))
    const real = await vi.importActual<typeof import('@/lib/privacy-requests')>('@/lib/privacy-requests')
    h.submitRequest.mockImplementation(real.submitRequest)
    h.sendEmail.mockRejectedValue(new Error('down'))
    expect((await privacy.POST(json('/api/privacy-requests', privacyBody))).status).toBe(502)
    expect((await events())[0]).toMatchObject({ p_target_table: 'privacy_requests', p_target_id: APPLICATION, p_metadata: { recorded: true, status: 502 } })
  })

  it('the row could not be saved: 502 as before, and the event says nothing was recorded', async () => {
    h.submitRequest.mockRejectedValue(new Error('down'))
    expect((await privacy.POST(json('/api/privacy-requests', privacyBody))).status).toBe(502)
    expect((await events())[0]).toMatchObject({ p_target_id: null, p_metadata: { recorded: false, status: 502 } })
  })
})

describe('privacy-requests/confirm', () => {
  it('an invalid token answers 404, no event', async () => {
    h.readRequestLink.mockResolvedValue({ state: 'invalid' })
    const res = await privacyConfirm.POST(json('/api/privacy-requests/confirm', { token: 'x' }))
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ state: 'invalid' })
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await events()).toEqual([])
  })

  it('no token at all answers 404, no event', async () => {
    expect((await privacyConfirm.POST(json('/api/privacy-requests/confirm', {}))).status).toBe(404)
    expect(await events()).toEqual([])
  })

  it('a link followed again answers as before, changes nothing and writes no event', async () => {
    h.readRequestLink.mockResolvedValue({ state: 'already_confirmed' })
    const res = await privacyConfirm.POST(json('/api/privacy-requests/confirm', { token: 'x' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ state: 'already_confirmed' })
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(h.confirmRequest).not.toHaveBeenCalled()
    expect(await events()).toEqual([])
  })

  it('the answer holds the state and never the row', async () => {
    const res = await privacyConfirm.POST(json('/api/privacy-requests/confirm', { token: 'x' }))
    await expect(res.json()).resolves.toEqual({ state: 'confirmed' })
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })

  it('two at once: the one that lost answers already_confirmed, and its event says so', async () => {
    h.confirmRequest.mockResolvedValue({ state: 'already_confirmed', requestId: PRIVACY_REQUEST })
    const res = await privacyConfirm.POST(json('/api/privacy-requests/confirm', { token: 'x' }))
    await expect(res.json()).resolves.toEqual({ state: 'already_confirmed' })
    expect((await events())[0]).toMatchObject({ p_target_id: PRIVACY_REQUEST, p_metadata: { state: 'already_confirmed' } })
  })
})

describe('teacher-grant', () => {
  beforeEach(() => {
    h.tables.members = []
  })

  it('the honeypot: the same answer, nothing sent and no event, so a bot cannot fill the log', async () => {
    const res = await grant.POST(json('/api/teacher-grant', { ...grantBody, website: 'spam' }))
    expect(res.status).toBe(200)
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(await events()).toEqual([])
  })

  it('a bad body answers 400 with the fields, and malformed JSON still answers 500: no event', async () => {
    const bad = await grant.POST(json('/api/teacher-grant', { firstName: 'x' }))
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({ error: 'Some answers need attention.' })
    const malformed = await grant.POST(new Request('https://www.stellreducation.org/api/teacher-grant', { method: 'POST', body: '{' }))
    expect(malformed.status).toBe(500)
    await expect(malformed.json()).resolves.toEqual({ error: 'Server error' })
    expect(await events()).toEqual([])
  })

  it('an existing member is left alone, and the event names no one', async () => {
    h.tables.members = [{ id: MEMBER, email: grantBody.email }]
    expect((await grant.POST(json('/api/teacher-grant', grantBody))).status).toBe(200)
    expect((await events())[0]).toMatchObject({ p_target_id: null, p_metadata: { member_created: false, status: 200 } })
  })

  it('member_created follows upsertMember, not its returning an id, and the event names the id', async () => {
    h.upsertMember.mockImplementation(async () => MEMBER)
    expect((await grant.POST(json('/api/teacher-grant', grantBody))).status).toBe(200)
    expect(h.linkMembersToSchoolByName).toHaveBeenCalled()
    expect(h.autoGrantBaseMembership).toHaveBeenCalled()
    const [event] = await events()
    expect(event).toMatchObject({
      p_target_table: 'members',
      p_target_id: MEMBER,
      p_metadata: { member_created: false, status: 200 },
    })
    expect(Object.keys(event.p_metadata as object).sort()).toEqual(['actor_anonymous', 'member_created', 'status'])
  })

  it("a date of birth that is not an adult's: no record, and the event says only that no member was created", async () => {
    const res = await grant.POST(json('/api/teacher-grant', { ...grantBody, dateOfBirth: `${new Date().getUTCFullYear() - 10}-01-01` }))
    expect(res.status).toBe(200)
    expect(h.upsertMember).not.toHaveBeenCalled()
    const [event] = await events()
    expect(event).toMatchObject({ p_target_id: null, p_metadata: { member_created: false, status: 200 } })
    expect(Object.keys(event.p_metadata as object).sort()).toEqual(['actor_anonymous', 'member_created', 'status'])
  })

  it('a failed staff email answers 500 as before, and is recorded', async () => {
    h.sendEmail.mockRejectedValue(new Error('down'))
    expect((await grant.POST(json('/api/teacher-grant', grantBody))).status).toBe(500)
    expect((await events())[0]).toMatchObject({ p_action: 'teacher_grant.application.create', p_metadata: { member_created: false, status: 500 } })
  })
})

describe('the gate', () => {
  it('none of these handlers is left on the unaudited list', () => {
    const baseline = JSON.parse(readFileSync('test/baselines/unaudited-mutations.json', 'utf8')) as { mutations: string[]; getMutations: string[] }
    for (const file of [
      'app/api/email/unsubscribe/route.ts',
      'app/api/printful/webhook/route.ts',
      'app/api/campaigns/[slug]/submit/route.ts',
      'app/api/scholarship/route.ts',
      'app/api/store/checkout/route.ts',
      'app/api/store/reship/route.ts',
      'app/api/privacy-requests/route.ts',
      'app/api/privacy-requests/confirm/route.ts',
      'app/api/teacher-grant/route.ts',
    ]) {
      expect(baseline.mutations, file).not.toContain(`${file}#POST`)
      expect(baseline.getMutations, file).not.toContain(`${file}#GET`)
    }
  })
})
