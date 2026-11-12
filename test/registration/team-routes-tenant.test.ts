// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { ADULT, FIFTEEN, rosterDb, stellrGroup, tenantGroup, TENANT, type RosterDb } from './roster-db'

// S5 A8: app/api/members/teams/** and the member billing link, for a tenant's group.
// The signed-in member is a Stellr member whose address is the one a tenant's organiser
// typed on their own group. On Stellr's hosts (routing off, the default) every team
// route answers that group as a missing one. On the tenant's own host (simulated by
// the request's tenant), the writers apply the tenant's rules and take no money.

const s = vi.hoisted(() => ({
  db: null as unknown as { client: never },
  hostTenant: '',
  executeRefund: vi.fn(async () => null),
  applyRosterChange: vi.fn(async () => ({ action: 'none', message: null, seatsAfter: 0 })),
  stripeClient: vi.fn(() => ({})),
  upsertMember: vi.fn(async () => 'member-new'),
  dispatchAgreement: vi.fn(async () => ({})),
  remind: vi.fn(async () => {}),
  sendEmail: vi.fn(async () => ({})),
  setGroupDiscount: vi.fn(),
  changeGroupPaymentMethod: vi.fn(),
  removeEventParticipation: vi.fn(async () => {}),
  correctFromRosterEdit: vi.fn(async () => null),
  staff: null as null | Record<string, unknown>,
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'user_org' }) }))
vi.mock('@/lib/impersonation', () => ({
  assertNotImpersonating: async () => null,
  resolveRequestMember: async () => ({ member: { id: 'member-org', email: 'org@example.com' }, unauthorised: false, impersonating: false }),
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => s.db.client }))
vi.mock('@/lib/tenancy/request-tenant', () => ({
  requestTenant: async () => (s.hostTenant === STELLR_TENANT_ID
    ? { kind: 'stellr', tenantId: s.hostTenant, tenantSlug: 'stellr' }
    : { kind: 'tenant', tenantId: s.hostTenant, tenantSlug: 'acme' }),
}))
vi.mock('@/lib/rate-limit-async', () => ({ rateLimit: async () => null }))
vi.mock('@/lib/refunds/execute', () => ({ executeRefund: s.executeRefund }))
vi.mock('@/lib/group-billing', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  applyRosterChange: s.applyRosterChange,
  setGroupDiscount: s.setGroupDiscount,
}))
vi.mock('@/lib/group-payment-change', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  changeGroupPaymentMethod: s.changeGroupPaymentMethod,
}))
vi.mock('@/lib/stripe', () => ({ stripeClient: s.stripeClient }))
vi.mock('@/lib/member-sync', () => ({ upsertMember: s.upsertMember }))
vi.mock('@/lib/docusign-agreements', () => ({ dispatchAgreement: s.dispatchAgreement }))
vi.mock('@/lib/school-link', () => ({ linkMembersToRegistrationSchool: async () => {} }))
vi.mock('@/lib/event-participation-sync', () => ({ recordEventParticipationForRegistration: async () => {}, removeEventParticipation: s.removeEventParticipation }))
vi.mock('@/lib/individual-payment', async (orig) => ({ ...(await orig<Record<string, unknown>>()), ensureIndividualPayments: async () => ({ charged: 0, waived: 0, skipped: 0 }) }))
vi.mock('@/lib/field-crypto-shadow', () => ({ shadowSyncFields: () => {} }))
vi.mock('@/lib/esign/operations', () => ({ remindEnvelopeRow: s.remind }))
vi.mock('@/lib/esign/email-changes', async (orig) => ({ ...(await orig<Record<string, unknown>>()), correctFromRosterEdit: s.correctFromRosterEdit }))
vi.mock('@/lib/email', async (orig) => ({ ...(await orig<Record<string, unknown>>()), sendEmail: s.sendEmail }))
vi.mock('@/lib/activity-log', () => ({ actorFromAuth: async () => ({}), logActivity: async () => {} }))
vi.mock('@/lib/authz', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  requireEventStaff: async () => s.staff,
}))
vi.mock('@/lib/google-sheets', () => ({ isGoogleSheetsConfigured: () => true, watchSheet: async () => ({}), readSheetParticipants: async () => [] }))

const teams = await import('@/app/api/members/teams/route')
const team = await import('@/app/api/members/teams/[id]/route')
const add = await import('@/app/api/members/teams/[id]/participants/route')
const one = await import('@/app/api/members/teams/[id]/participants/[pid]/route')
const sheet = await import('@/app/api/members/teams/[id]/sheet-sync/route')
const resend = await import('@/app/api/members/teams/[id]/participants/[pid]/docusign-resend/route')
const seatLink = await import('@/app/api/members/teams/[id]/payment-link/route')
const discount = await import('@/app/api/members/teams/[id]/discount/route')
const paymentMethod = await import('@/app/api/members/teams/[id]/payment-method/route')
const billingLink = await import('@/app/api/members/billing/payment-link/route')
const staffAdd = await import('@/app/api/admin/registrations/[id]/participants/route')
const { makeScope, stellrScope, tenantWideScope } = await import('@/lib/tenancy/scope-context')

const MISSING = '55555555-5555-4555-8555-555555555555'
const url = (path: string) => `https://app.test/api/members/teams/${path}`
const json = (method: string, path: string, body?: unknown) =>
  new NextRequest(url(path), body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const ctx = (id: string, pid?: string) => ({ params: Promise.resolve(pid ? { id, pid } : { id }) }) as never

let db: RosterDb
const seedParticipants = () => {
  db.fake.tables.participants = [
    { id: 'p-s', registration_id: stellrGroup.id, member_id: 'member-org', event_role: 'participant', first_name: 'A', last_name: 'B', email: 'a@example.com', date_of_birth: ADULT, join_completed_at: '2026-10-01T00:00:00Z', individual_payment_status: 'pending' },
    { id: 'p-t', registration_id: tenantGroup.id, tenant_id: TENANT, member_id: 'member-org', event_role: 'adult', first_name: 'C', last_name: 'D', email: 'c@example.com', date_of_birth: ADULT, join_completed_at: '2026-10-01T00:00:00Z', individual_payment_status: 'pending' },
  ]
}

beforeEach(() => {
  db = rosterDb()
  seedParticipants()
  s.db = db
  s.hostTenant = STELLR_TENANT_ID
  for (const f of Object.values(s)) if (typeof f === 'function' && 'mockClear' in f) f.mockClear()
})

describe('on Stellr’s host, a tenant’s group is not the Stellr member’s', () => {
  it('the team list holds Stellr’s group only, and no tenant_id', async () => {
    const body = await (await teams.GET()).json()
    expect(body.teams.map((t: { id: string }) => t.id)).toEqual([stellrGroup.id])
    expect(JSON.stringify(body)).not.toContain('tenant_id')
    expect(JSON.stringify(body)).not.toContain(tenantGroup.id)
  })

  it('the team detail answers as a missing group', async () => {
    const tenant = await team.GET(json('GET', tenantGroup.id), ctx(tenantGroup.id))
    const missing = await team.GET(json('GET', MISSING), ctx(MISSING))
    expect(tenant.status).toBe(404)
    expect(await tenant.json()).toEqual(await missing.json())
    // The fake returns a row as stored, so the embedded roster is stored on it.
    db.fake.tables.registrations.find((r) => r.id === stellrGroup.id)!.participants = [
      { id: 'p-s', member_id: 'member-org', first_name: 'A', last_name: 'B', tenant_id: STELLR_TENANT_ID },
      { id: 'p-s2', member_id: null, first_name: 'E', last_name: 'F', tenant_id: STELLR_TENANT_ID },
    ]
    const own = await team.GET(json('GET', stellrGroup.id), ctx(stellrGroup.id))
    expect(own.status).toBe(200)
    const body = await own.json()
    expect(body.registration).not.toHaveProperty('tenant_id')
    expect(body.registration.participants.map((p: { id: string }) => p.id)).toEqual(['p-s', 'p-s2'])
    expect(JSON.stringify(body)).not.toContain('tenant_id')
  })

  it('an add and an edit answer with the participant row less its tenant_id', async () => {
    const added = await add.POST(json('POST', `${stellrGroup.id}/participants`, { first_name: 'X', last_name: 'Y', email: 'x@example.com', date_of_birth: ADULT }), ctx(stellrGroup.id))
    const addedBody = await added.json()
    expect(addedBody.participant).toMatchObject({ email: 'x@example.com' })
    expect(addedBody.participant).not.toHaveProperty('tenant_id')
    db.fake.table('participants').find((p) => p.id === 'p-s')!.tenant_id = STELLR_TENANT_ID
    const edited = await one.PATCH(json('PATCH', `${stellrGroup.id}/participants/p-s`, { first_name: 'Z' }), ctx(stellrGroup.id, 'p-s'))
    const editedBody = await edited.json()
    expect(editedBody.participant).toMatchObject({ id: 'p-s', first_name: 'Z' })
    expect(editedBody.participant).not.toHaveProperty('tenant_id')
  })

  it.each([
    ['add a participant', () => add.POST(json('POST', `${tenantGroup.id}/participants`, { first_name: 'X', last_name: 'Y', email: 'x@example.com', date_of_birth: ADULT }), ctx(tenantGroup.id)), 404],
    ['edit a participant', () => one.PATCH(json('PATCH', `${tenantGroup.id}/participants/p-t`, { first_name: 'Z' }), ctx(tenantGroup.id, 'p-t')), 404],
    ['remove a participant', () => one.DELETE(json('DELETE', `${tenantGroup.id}/participants/p-t`), ctx(tenantGroup.id, 'p-t')), 404],
    ['sync the sheet', () => sheet.POST(json('POST', `${tenantGroup.id}/sheet-sync`), ctx(tenantGroup.id)), 404],
    ['re-send a consent form', () => resend.POST(json('POST', `${tenantGroup.id}/participants/p-t/docusign-resend`), ctx(tenantGroup.id, 'p-t')), 403],
    ['make a seat payment link', () => seatLink.POST(json('POST', `${tenantGroup.id}/payment-link`), ctx(tenantGroup.id)), 404],
    ['read the discount', () => discount.GET(json('GET', `${tenantGroup.id}/discount`), ctx(tenantGroup.id)), 404],
    ['read the payment method', () => paymentMethod.GET(json('GET', `${tenantGroup.id}/payment-method`), ctx(tenantGroup.id)), 404],
    ['change the payment method', () => paymentMethod.POST(json('POST', `${tenantGroup.id}/payment-method`, { method: 'invoice' }), ctx(tenantGroup.id)), 404],
  ])('%s: refused as the route refuses a group that is not the caller’s, and nothing is written', async (_l, call, status) => {
    const before = JSON.stringify(db.fake.tables)
    const res = await call()
    expect(res.status).toBe(status)
    expect(JSON.stringify(db.fake.tables)).toBe(before)
    expect(s.executeRefund).not.toHaveBeenCalled()
    expect(s.stripeClient).not.toHaveBeenCalled()
    expect(s.changeGroupPaymentMethod).not.toHaveBeenCalled()
    expect(s.remind).not.toHaveBeenCalled()
  })

  it('the Stellr member’s own group still takes an add', async () => {
    const res = await add.POST(json('POST', `${stellrGroup.id}/participants`, { first_name: 'X', last_name: 'Y', email: 'x@example.com', date_of_birth: ADULT }), ctx(stellrGroup.id))
    expect(res.status).toBe(201)
    expect(db.fake.table('participants').find((p) => p.email === 'x@example.com')).toMatchObject({ tenant_id: STELLR_TENANT_ID })
  })

  it('the member billing link for a seat on a tenant’s group gets the tenant payments answer, before Stripe', async () => {
    const req = new NextRequest('https://app.test/api/members/billing/payment-link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ registrationId: tenantGroup.id }) })
    const res = await billingLink.POST(req)
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('tenant_payments_unavailable')
    expect(s.stripeClient).not.toHaveBeenCalled()
  })
})

describe('on the tenant’s own host', () => {
  beforeEach(() => { s.hostTenant = TENANT })

  it('Stellr’s group answers as a missing one there', async () => {
    const res = await team.GET(json('GET', stellrGroup.id), ctx(stellrGroup.id))
    expect(res.status).toBe(404)
  })

  it('an organiser’s add writes the tenant row only', async () => {
    const res = await add.POST(json('POST', `${tenantGroup.id}/participants`, { first_name: 'X', last_name: 'Y', email: 'x@example.com', date_of_birth: ADULT, event_role: 'adult' }), ctx(tenantGroup.id))
    expect(res.status).toBe(201)
    expect(db.fake.table('participants').find((p) => p.email === 'x@example.com')).toMatchObject({ tenant_id: TENANT, registration_id: tenantGroup.id })
    expect(s.upsertMember).not.toHaveBeenCalled()
    expect(s.dispatchAgreement).not.toHaveBeenCalled()
    expect(s.applyRosterChange).not.toHaveBeenCalled()
  })

  it('an edit that makes someone 15 is refused in the approved words; an adult date is saved', async () => {
    const minor = await one.PATCH(json('PATCH', `${tenantGroup.id}/participants/p-t`, { date_of_birth: FIFTEEN, first_name: 'C', last_name: 'D' }), ctx(tenantGroup.id, 'p-t'))
    expect(minor.status).toBe(400)
    expect(await minor.json()).toEqual({ code: 'under_minimum_age', error: 'C D must be 18 or older to register for this event online. Please contact the event organiser.' })
    expect(db.fake.table('participants').find((p) => p.id === 'p-t')?.date_of_birth).toBe(ADULT)
    const adult = await one.PATCH(json('PATCH', `${tenantGroup.id}/participants/p-t`, { date_of_birth: '1990-02-03' }), ctx(tenantGroup.id, 'p-t'))
    expect(adult.status).toBe(200)
    expect(db.fake.table('participants').find((p) => p.id === 'p-t')?.date_of_birth).toBe('1990-02-03')
  })

  it('an edited address on a tenant’s group never reaches Stellr’s consent-form correction', async () => {
    const res = await one.PATCH(json('PATCH', `${tenantGroup.id}/participants/p-t`, { email: 'c2@example.com', emergency_contact_email: 'g@example.com' }), ctx(tenantGroup.id, 'p-t'))
    expect(res.status).toBe(200)
    expect(s.correctFromRosterEdit).not.toHaveBeenCalled()
    // Stellr's own group on Stellr's host still does.
    s.hostTenant = STELLR_TENANT_ID
    const own = await one.PATCH(json('PATCH', `${stellrGroup.id}/participants/p-s`, { email: 'a2@example.com' }), ctx(stellrGroup.id, 'p-s'))
    expect(own.status).toBe(200)
    expect(s.correctFromRosterEdit).toHaveBeenCalledTimes(1)
  })

  it('an edit the database’s eligibility check refuses answers as the eligibility check, not as a failed save', async () => {
    db.refuse = (op) => op === 'update'
    const res = await one.PATCH(json('PATCH', `${tenantGroup.id}/participants/p-t`, { date_of_birth: '1990-02-03' }), ctx(tenantGroup.id, 'p-t'))
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('eligibility_unavailable')
  })

  it('a removal makes no refund or billing call, and a group that takes money is refused first', async () => {
    db.fake.tables.registrations.find((r) => r.id === tenantGroup.id)!.invoice_requested = true
    const refused = await one.DELETE(json('DELETE', `${tenantGroup.id}/participants/p-t`), ctx(tenantGroup.id, 'p-t'))
    expect(refused.status).toBe(503)
    expect((await refused.json()).code).toBe('tenant_payments_unavailable')
    expect(db.fake.table('participants').some((p) => p.id === 'p-t')).toBe(true)
    db.fake.tables.registrations.find((r) => r.id === tenantGroup.id)!.invoice_requested = false
    const removed = await one.DELETE(json('DELETE', `${tenantGroup.id}/participants/p-t`), ctx(tenantGroup.id, 'p-t'))
    expect(removed.status).toBe(200)
    expect(db.fake.table('participants').some((p) => p.id === 'p-t')).toBe(false)
    expect(s.executeRefund).not.toHaveBeenCalled()
    expect(s.applyRosterChange).not.toHaveBeenCalled()
    expect(s.sendEmail).not.toHaveBeenCalled()
  })

  it('removing a row written before A8 that carries a member_id revokes what it was granted', async () => {
    // p-t carries member-org: an organiser's add before A8 went down Stellr's path and
    // recorded event history and Space access for that member.
    const res = await one.DELETE(json('DELETE', `${tenantGroup.id}/participants/p-t`), ctx(tenantGroup.id, 'p-t'))
    expect(res.status).toBe(200)
    expect(s.removeEventParticipation).toHaveBeenCalledWith(expect.anything(), { memberId: 'member-org', eventSlug: 'acme-day' })
  })

  it('a failed add or edit logs the error’s code and message, never its details (the row)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      db.refuse = () => ({ code: '23502', message: 'null value in column', details: 'Failing row contains (c@example.com, 1990-02-03)' })
      const added = await add.POST(json('POST', `${tenantGroup.id}/participants`, { first_name: 'X', last_name: 'Y', email: 'x@example.com', date_of_birth: ADULT, event_role: 'adult' }), ctx(tenantGroup.id))
      const edited = await one.PATCH(json('PATCH', `${tenantGroup.id}/participants/p-t`, { first_name: 'Z' }), ctx(tenantGroup.id, 'p-t'))
      expect([added.status, edited.status]).toEqual([500, 500])
      expect(spy).toHaveBeenCalled()
      expect(JSON.stringify(spy.mock.calls)).not.toContain('Failing row')
    } finally {
      spy.mockRestore()
    }
  })

  it('a seat payment link and a discount change get the tenant payments answer, before Stripe', async () => {
    const link = await seatLink.POST(json('POST', `${tenantGroup.id}/payment-link`), ctx(tenantGroup.id))
    expect(link.status).toBe(503)
    expect((await link.json()).code).toBe('tenant_payments_unavailable')
    db.fake.tables.registrations.find((r) => r.id === tenantGroup.id)!.invoice_requested = true
    const code = await discount.POST(json('POST', `${tenantGroup.id}/discount`, { action: 'apply', code: 'SAVE10' }), ctx(tenantGroup.id))
    expect(code.status).toBe(503)
    expect((await code.json()).code).toBe('tenant_payments_unavailable')
    expect(s.stripeClient).not.toHaveBeenCalled()
    expect(s.setGroupDiscount).not.toHaveBeenCalled()
  })
})

describe('the staff roster add (C16’s refusal lifted for a tenant’s own group)', () => {
  const staffAs = (tenantId: string, scope: unknown, covers: (slug: string) => boolean = () => true) => {
    s.staff = { ok: true, userId: 'user_staff', isAdmin: true, tenantId, scope, covers }
  }
  const call = (id: string, body: Record<string, unknown> = { first_name: 'E', last_name: 'F', email: 'e@example.com', date_of_birth: ADULT, event_role: 'adult' }) =>
    staffAdd.POST(new Request('https://app.test/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) })

  it('a tenant’s admin adds to their own group: the tenant row only, no Member ID lookup', async () => {
    staffAs(TENANT, tenantWideScope(TENANT, 'tenant_admin'))
    const res = await call(tenantGroup.id, { first_name: 'E', last_name: 'F', email: 'e@example.com', date_of_birth: ADULT, event_role: 'adult', linked: true, membership_id: '0000271' })
    expect(res.status).toBe(201)
    const row = db.fake.table('participants').find((p) => p.email === 'e@example.com')
    expect(row).toMatchObject({ tenant_id: TENANT, registration_id: tenantGroup.id })
    expect(row).not.toHaveProperty('membership_id')
    expect(s.upsertMember).not.toHaveBeenCalled()
    expect(s.stripeClient).not.toHaveBeenCalled()
  })

  it('the event’s manager in that tenant adds too; a 15-year-old is refused', async () => {
    staffAs(TENANT, makeScope({ tenantId: TENANT, eventSlugs: ['acme-day'], actor: { kind: 'event_manager', memberId: null } }), (slug) => slug === 'acme-day')
    expect((await call(tenantGroup.id)).status).toBe(201)
    const minor = await call(tenantGroup.id, { first_name: 'G', last_name: 'H', email: 'g@example.com', date_of_birth: FIFTEEN })
    expect(minor.status).toBe(400)
    expect((await minor.json()).code).toBe('under_minimum_age')
  })

  it('a tenant’s admin naming Stellr’s group, and Stellr’s admin naming the tenant’s, both get the missing group’s answer', async () => {
    staffAs(TENANT, tenantWideScope(TENANT, 'tenant_admin'))
    const crossed = await call(stellrGroup.id)
    staffAs(STELLR_TENANT_ID, stellrScope({ kind: 'platform_admin', memberId: null } as never, null))
    const reverse = await call(tenantGroup.id)
    const missing = await call(MISSING)
    expect([crossed.status, reverse.status, missing.status]).toEqual([404, 404, 404])
    const body = await missing.json()
    expect(await crossed.json()).toEqual(body)
    expect(await reverse.json()).toEqual(body)
    expect(db.fake.table('participants')).toHaveLength(2)
  })
})
