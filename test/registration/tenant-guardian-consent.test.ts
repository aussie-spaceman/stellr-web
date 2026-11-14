import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { rec, TODAY, dateBefore, jsonRequest, settle, type DbCall, type DbResult } from '@/test/registration/fixtures'

// S5 wave 6 (owner decision, 10 Nov 2026): POST /api/register/individual for a
// 14-17-year-old on another organiser's event. The route, the gate, persist, the
// hooks, lib/registration/{eligibility,tenant-guardian-consent} and
// lib/esign/tenant-guardian-consent are real; the database is the recording fake,
// and the signing engine's signer insert, the tenant mail and the audit are spies.
// The body is what the individual form sends: the guardian is its emergency contact.

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'
const EVENT_DAY = dateBefore(0, -30)

const h = vi.hoisted(() => ({
  requestTenant: vi.fn(async (): Promise<{ kind: string; tenantId: string; tenantSlug: string }> => ({
    kind: 'tenant', tenantId: 'c0000000-0000-4000-8000-0000000000aa', tenantSlug: 'canary',
  })),
  getEventBySlug: vi.fn(async (_slug: string): Promise<unknown> => null),
  findExisting: vi.fn(async (_db: unknown, _emails: string[], _slug: string) => new Map()),
  resolveDuplicate: vi.fn((_rows: unknown, _o: unknown): { kind: string } => ({ kind: 'none' })),
  tenantConfirmation: vi.fn(async (_db: unknown, _input: Record<string, unknown>) => ({ ok: true, id: 'em_1' })),
  sender: vi.fn(async (_db: unknown, _tenantId: string): Promise<unknown> => ({ from: '"Canary via Stellr" <no-reply@mail.stellreducation.org>', replyTo: 'hello@canary.test' })),
  invite: vi.fn(async (_db: unknown, _input: Record<string, unknown>): Promise<unknown> => ({ ok: true, result: { sent: 1, deferred: 0, failed: 0 } })),
  template: vi.fn(async (_db: unknown, _key: string): Promise<unknown> => ({ id: 'tpl-1', key: 'tenant_guardian_consent', version: 1, pdfSha256: 'x' })),
  insertSigners: vi.fn(async (_db: unknown, _row: string, _plan: unknown, _t: unknown): Promise<unknown[]> => []),
  dispatch: vi.fn(async (_db: unknown, _a: Record<string, unknown>) => {}),
  provision: vi.fn(async () => ({ signInToken: null, clerkUserId: 'user_1' })),
  audit: vi.fn(async (_m: Record<string, unknown>, _o?: unknown) => ({ ok: false, skipped: 'disabled' })),
  limit: vi.fn(async (_key: string, _o: { limit: number; windowMs: number; tenantId: string | null }) => ({ ok: true, retryAfterSeconds: 0 })),
}))

vi.mock('@/lib/tenancy/request-tenant', () => ({ requestTenant: h.requestTenant }))
vi.mock('@/lib/audit/route', () => ({ auditMutation: h.audit }))
vi.mock('@/lib/supabase', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return { supabaseServer: () => rec.client() }
})
vi.mock('@/lib/field-crypto-shadow', () => ({ shadowSyncFields: () => {} }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: h.getEventBySlug }))
vi.mock('@/lib/community', () => ({ getCurrentMember: async () => null }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/pending-consent', async (orig) => ({
  ...(await orig<typeof import('@/lib/pending-consent')>()),
  sessionChildAwaitingConsentBlock: async () => null,
}))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: null }) }))
vi.mock('@/lib/clerk-provisioning', () => ({ ensureClerkUserAndSignInToken: h.provision }))
vi.mock('@/lib/rate-limit-async', () => ({ rateLimit: async () => null, limit: h.limit }))
vi.mock('@/lib/scholarships', () => ({ findOfferByToken: async () => null, attachOfferToRegistration: async () => {} }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => null }))
vi.mock('@/lib/registration-duplicates', () => ({ findExistingRegistrations: h.findExisting, resolveDuplicate: h.resolveDuplicate }))
vi.mock('@/lib/docusign-agreements', () => ({ dispatchAgreement: h.dispatch }))
vi.mock('@/lib/school-link', () => ({
  resolveAndLinkSchool: async () => ({ state: 'CO' }),
  linkMembersToSchoolByName: async () => {},
  linkMembersToRegistrationSchool: async () => {},
}))
vi.mock('@/lib/member-profile-options', () => ({ syncMemberOptionSelections: async () => {} }))
vi.mock('@/lib/event-participation-sync', () => ({ recordEventParticipation: async () => {} }))
vi.mock('@/lib/auto-membership-grant', () => ({ autoGrantBaseMembership: async () => {} }))
vi.mock('@/lib/space-inheritance', () => ({ syncObjectSpaceRoster: async () => {}, reconcileEventSpaceRoster: async () => {} }))
vi.mock('@/lib/store/event-merch', () => ({ prepareRegistrationAddons: async () => [], addRegistrationAddons: async () => {} }))
vi.mock('@/lib/registration-confirm', () => ({ confirmRegistration: async () => {} }))
vi.mock('@/lib/registration-pay-link', () => ({ sendPayLinkEmail: async () => ({ sent: false }) }))
vi.mock('@/lib/event-emails/tenant-mail', async (orig) => ({
  ...(await orig<typeof import('@/lib/event-emails/tenant-mail')>()),
  sendTenantConfirmation: h.tenantConfirmation,
  loadTenantSender: h.sender,
}))
vi.mock('@/lib/event-emails/tenant-signing', () => ({ sendTenantSigningInvitation: h.invite }))
vi.mock('@/lib/esign/native/templates-store', async (orig) => ({
  ...(await orig<typeof import('@/lib/esign/native/templates-store')>()),
  loadActiveTemplate: h.template,
}))
vi.mock('@/lib/esign/native/flow', async (orig) => ({
  ...(await orig<typeof import('@/lib/esign/native/flow')>()),
  insertSigners: h.insertSigners,
}))
vi.mock('@/lib/registration-checkout', () => ({
  createRegistrationCheckout: async () => ({ url: null }),
  RegistrationCheckoutError: class extends Error {},
  ensurePayToken: async () => 'paytok',
  mintPayToken: () => 'paytok',
  payPageUrl: () => 'https://www.stellreducation.org/pay',
  pendingAddonLines: async () => [],
}))

const { POST } = await import('@/app/api/register/individual/route')

type Person = Record<string, unknown>

const EVENT = { title: 'Canary Cup', activityType: 'live_event', date: EVENT_DAY }
const MIRROR = {
  tenant_id: CANARY,
  activity_type: 'live_event',
  // Local midnight of the first day in Denver, as lib/events/sync.ts stores it.
  starts_at: `${EVENT_DAY}T06:00:00Z` as string | null,
  time_zone: 'America/Denver',
  min_participant_age: null as number | null,
}
const TENANT = { id: CANARY, is_platform_owner: false, min_participant_age: 14, display_name: 'Canary Club' }

/** What the individual form sends for a 15-year-old whose emergency contact is a parent. */
function post(overrides: Person = {}) {
  return POST(jsonRequest('/api/register/individual', {
    event_slug: 'canary-cup',
    email: 'kid@example.com', first_name: 'Kit', last_name: 'Id',
    phone: '555', date_of_birth: dateBefore(15), school_name: 'Sydney High',
    grade: '10', gender: 'female', t_shirt_size: 'M',
    event_role: 'participant', age_bracket: 'high_school',
    emergency_contact_first_name: 'Pat', emergency_contact_last_name: 'Id',
    emergency_contact_email: 'parent@example.com', emergency_contact_phone: '556',
    emergency_contact_relationship: 'Parent',
    ...overrides,
  }))
}

let failOn: string | null = null

function respond(row: Partial<typeof MIRROR> | null = {}) {
  rec.respond((c: DbCall): DbResult | undefined => {
    if (failOn && `${c.op} ${c.table}` === failOn) return { data: null, error: { message: 'boom' } }
    if (c.table === 'events' && c.op === 'select') return { data: row ? { ...MIRROR, ...row } : null, error: null }
    if (c.table === 'tenants' && c.op === 'select') return { data: TENANT, error: null }
    if (c.table === 'tenant_guardian_consents' && c.op === 'upsert') return { data: { id: 'tgc-1' }, error: null }
    if (c.table === 'agreements' && c.op === 'insert') return { data: { id: 'agr-1' }, error: null }
    return undefined
  })
}

const writes = () => rec.calls.filter((c) => c.op !== 'select').map((c) => `${c.op} ${c.table}`)
const APPROVED_REFUSAL = {
  status: 400,
  body: { code: 'under_minimum_age', error: 'You must be 18 or older to register for this event online. Please contact the event organiser.' },
}

beforeEach(() => {
  vi.clearAllMocks()
  rec.reset()
  failOn = null
  vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', 'true')
  vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
  // The readiness guard's other precondition (s5-programme.20, W7-14).
  vi.stubEnv('LOADSCOPED_MODE', 'enforce')
  vi.stubEnv('ESIGN_TOKEN_SECRET', 'x'.repeat(40))
  h.requestTenant.mockResolvedValue({ kind: 'tenant', tenantId: CANARY, tenantSlug: 'canary' })
  h.getEventBySlug.mockResolvedValue(EVENT)
  h.sender.mockResolvedValue({ from: '"Canary via Stellr" <no-reply@mail.stellreducation.org>', replyTo: 'hello@canary.test' })
  h.template.mockResolvedValue({ id: 'tpl-1', key: 'tenant_guardian_consent', version: 1, pdfSha256: 'x' })
  h.invite.mockResolvedValue({ ok: true, result: { sent: 1, deferred: 0, failed: 0 } })
  h.limit.mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
  respond()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('S5 wave 6: a 14-17-year-old on a tenant event', () => {
  it('flag off: refused with the approved copy, nothing written, nobody invited (unchanged)', async () => {
    vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', 'false')
    expect(await settle(await post())).toEqual(APPROVED_REFUSAL)
    expect(writes()).toEqual([])
    expect(h.invite).not.toHaveBeenCalled()
    expect(h.tenantConfirmation).not.toHaveBeenCalled()
  })

  it('flag on: 13 on the event day is still refused by the platform floor, with nothing written', async () => {
    const res = await settle(await post({ date_of_birth: dateBefore(13, 31) }))
    expect(res).toEqual({ status: 400, body: { code: 'under_minimum_age', error: 'You must be 14 or older on the day of the event to take part.' } })
    expect(writes()).toEqual([])
    expect(h.invite).not.toHaveBeenCalled()
  })

  it('flag on: a 15-year-old is saved consent-pending, the guardian is invited from the tenant sender, and the registrant is told', async () => {
    const res = await settle(await post())
    expect(res).toEqual({ status: 201, body: { registrationId: 'reg-1', checkoutUrl: null, signInToken: null, consentPending: true, guardianInvited: true } })

    // Registration, participant, the consent row, the envelope, and the envelope linked to the row.
    expect(writes()).toEqual([
      'insert registrations',
      'insert participants',
      'upsert tenant_guardian_consents',
      'insert agreements',
      'update tenant_guardian_consents',
    ])
    const consent = rec.payloads('upsert', 'tenant_guardian_consents')[0] as Person
    expect(consent).toMatchObject({ tenant_id: CANARY, registration_id: 'reg-1', participant_id: 'p-1', status: 'pending', settled_at: null })
    // The participant insert's trigger already wrote the pending row: this sets its
    // window on that row rather than failing on the participant's unique key.
    expect(rec.calls.find((c) => c.op === 'upsert' && c.table === 'tenant_guardian_consents')?.options).toEqual({ onConflict: 'participant_id' })
    // Within the invitation caps: the guardian's address, unscoped, and this organiser.
    expect(h.limit.mock.calls.map(([key, o]) => [key, o.tenantId])).toEqual([
      ['tenant-guardian-consent:address:parent@example.com', null],
      ['tenant-guardian-consent:invitations', CANARY],
    ])
    // No contact data on the consent row.
    expect(JSON.stringify(consent)).not.toMatch(/parent@example\.com|Pat/)
    // The window: 14 days, the event being 30 days out.
    const expires = new Date(consent.expires_at as string).getTime()
    expect(Math.abs(expires - (Date.now() + 14 * 86_400_000))).toBeLessThan(60_000)

    // The platform-locked document, stamped with the tenant, the guardian its one signer.
    expect(h.template).toHaveBeenCalledWith(expect.anything(), 'tenant_guardian_consent')
    const envelope = rec.payloads('insert', 'agreements')[0] as Person
    expect(envelope).toMatchObject({
      participant_id: 'p-1', member_id: null, tenant_id: CANARY, provider: 'native',
      envelope_type: 'tenant_guardian_consent', status: 'sent', signer_email: 'parent@example.com', signers_total: 1,
    })
    expect((envelope.prefill as Person).OrganiserName).toBe('Canary Club')
    const plan = h.insertSigners.mock.calls[0][2] as { signers: Person[]; minorSubject: boolean }
    expect(plan.signers).toEqual([{ role: 'guardian', name: 'Pat Id', email: 'parent@example.com', memberId: null, order: 1 }])
    expect(plan.minorSubject).toBe(true)

    // Invited through B14's checked call, for this tenant and envelope.
    expect(h.invite).toHaveBeenCalledWith(expect.anything(), { tenantId: CANARY, envelopeRowId: 'agr-1' })
    // The registrant hears only that the place waits on the guardian; no "registered" yet.
    expect(h.tenantConfirmation).toHaveBeenCalledTimes(1)
    const notice = h.tenantConfirmation.mock.calls[0][1] as { to: string; subject: string; tenantId: string }
    expect(notice).toMatchObject({ tenantId: CANARY, to: 'kid@example.com' })
    expect(notice.subject).toBe('Waiting for your parent or guardian: Canary Cup')

    // No Stellr agreement, login or member row.
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.provision).not.toHaveBeenCalled()
    expect(rec.calls.some((c) => c.table === 'members')).toBe(false)

    // Audited, ids and outcome only.
    const request = h.audit.mock.calls.find(([m]) => m.action === 'registration.guardian_consent.request')
    expect(request?.[0]).toMatchObject({ target: { table: 'tenant_guardian_consents', id: 'tgc-1' }, metadata: { event_tenant_id: CANARY, invitation: 'sent' } })
    expect(JSON.stringify(request?.[0])).not.toMatch(/parent@example\.com|kid@example\.com/)
  })

  it.each([
    ['refused for want of a sender', { ok: false, reason: 'no_sender', error: 'x' }, 'no_sender'],
    ['a failed send', { ok: false, reason: 'failed', error: 'x' }, 'failed'],
    ['an outbox send that failed', { ok: true, result: { sent: 0, deferred: 0, failed: 1 } }, 'failed'],
    ['a result that sent nothing', { ok: true, result: { sent: 0, deferred: 0, failed: 0 } }, 'not_sent'],
  ])('flag on: when the guardian invitation is %s, the registrant is not told their guardian was emailed', async (_l, outcome, recorded) => {
    h.invite.mockResolvedValue(outcome)
    // The form sends the registrant to the page that says consent is still needed.
    expect(await settle(await post())).toMatchObject({ status: 201, body: { consentPending: true, guardianInvited: false } })
    expect(h.tenantConfirmation).toHaveBeenCalledTimes(1)
    const notice = h.tenantConfirmation.mock.calls[0][1] as { text: string }
    expect(notice.text).not.toMatch(/(we've|we'll) email(ed)? your parent or guardian/i)
    expect(notice.text).toContain("We couldn't send it to them just now.")
    // Nothing tells the organiser, so the notice does not say they will be in touch.
    expect(notice.text).not.toMatch(/will be in touch/)
    // Recorded where staff can see it: the request audit carries the outcome.
    const request = h.audit.mock.calls.find(([m]) => m.action === 'registration.guardian_consent.request')
    expect(request?.[0]).toMatchObject({ metadata: { invitation: recorded } })
  })

  it('flag on: an invitation waiting in the signing outbox counts as out, and the wording does not say it has gone', async () => {
    h.invite.mockResolvedValue({ ok: true, result: { sent: 0, deferred: 1, failed: 0 } })
    expect(await settle(await post())).toMatchObject({ status: 201, body: { consentPending: true, guardianInvited: true } })
    const text = (h.tenantConfirmation.mock.calls[0][1] as { text: string }).text
    expect(text).toMatch(/we'll email your parent or guardian a consent form/i)
    expect(text).not.toMatch(/we've emailed/i)
    const request = h.audit.mock.calls.find(([m]) => m.action === 'registration.guardian_consent.request')
    expect(request?.[0]).toMatchObject({ metadata: { invitation: 'deferred' } })
  })

  it.each([
    ['no relationship', { emergency_contact_relationship: '' }],
    ['a grandparent', { emergency_contact_relationship: 'Grandparent' }],
    ['no guardian email', { emergency_contact_email: '' }],
    ['the registrant’s own email', { emergency_contact_email: 'KID@example.com' }],
    ['the registrant’s school email', { school_email: 'kit.id@school.test', emergency_contact_email: ' Kit.Id@School.test ' }],
    ['no guardian name', { emergency_contact_last_name: '' }],
  ])('flag on: %s is refused as guardian_required, with nothing written', async (_l, extra) => {
    expect(await settle(await post(extra))).toMatchObject({ status: 400, body: { code: 'guardian_required' } })
    expect(writes()).toEqual([])
    expect(h.invite).not.toHaveBeenCalled()
    // Refused before any invitation is counted.
    expect(h.limit).not.toHaveBeenCalled()
  })

  it.each([
    ['the guardian address', 0],
    ['the organiser', 1],
  ])('flag on: past the invitation cap for %s, a 429 with nothing written and nobody invited', async (_l, which) => {
    let n = 0
    h.limit.mockImplementation(async () => ({ ok: n++ !== which, retryAfterSeconds: 120 }))
    const res = await post()
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('120')
    expect(await res.json()).toEqual({
      code: 'guardian_consent_busy',
      error: "We can't send another consent form just now. Please try again later, or contact the event organiser.",
    })
    expect(writes()).toEqual([])
    expect(h.invite).not.toHaveBeenCalled()
    expect(h.tenantConfirmation).not.toHaveBeenCalled()
  })

  it('flag on: an adult is never counted against the invitation caps', async () => {
    expect((await settle(await post({ date_of_birth: dateBefore(18) }))).status).toBe(201)
    expect(h.limit).not.toHaveBeenCalled()
  })

  it.each([
    ['the tenant has no sender', () => h.sender.mockResolvedValue(null)],
    ['no consent document is published', () => h.template.mockRejectedValue(new Error('none'))],
    ['signing is not configured', () => vi.stubEnv('ESIGN_TOKEN_SECRET', '')],
  ])('flag on but %s: the approved refusal, with nothing written', async (_l, arrange) => {
    arrange()
    expect(await settle(await post())).toEqual(APPROVED_REFUSAL)
    expect(writes()).toEqual([])
  })

  it('flag on but the event has started: no window, so the approved refusal', async () => {
    respond({ starts_at: `${TODAY}T06:00:00Z` })
    h.getEventBySlug.mockResolvedValue({ ...EVENT, date: TODAY })
    expect(await settle(await post())).toEqual(APPROVED_REFUSAL)
    expect(writes()).toEqual([])
  })

  it('flag on: the window ends at the event when it starts within 14 days', async () => {
    const soon = dateBefore(0, -5)
    respond({ starts_at: `${soon}T06:00:00Z` })
    h.getEventBySlug.mockResolvedValue({ ...EVENT, date: soon })
    expect((await settle(await post())).status).toBe(201)
    const consent = rec.payloads('upsert', 'tenant_guardian_consents')[0] as Person
    expect(consent.expires_at).toBe(new Date(`${soon}T06:00:00Z`).toISOString())
  })

  it('flag on: if the envelope cannot be recorded, the registration is taken back and the answer is retryable', async () => {
    failOn = 'insert agreements'
    expect(await settle(await post())).toEqual({ status: 503, body: { error: 'Registration is temporarily unavailable. Please try again shortly.' } })
    expect(writes()).toEqual(['insert registrations', 'insert participants', 'upsert tenant_guardian_consents', 'insert agreements', 'delete registrations'])
    expect(h.invite).not.toHaveBeenCalled()
    expect(h.tenantConfirmation).not.toHaveBeenCalled()
  })

  it('flag on: an adult is registered as before, with no consent', async () => {
    const res = await settle(await post({ date_of_birth: dateBefore(18) }))
    expect(res).toEqual({ status: 201, body: { registrationId: 'reg-1', checkoutUrl: null, signInToken: null } })
    expect(writes()).toEqual(['insert registrations', 'insert participants'])
    expect(h.invite).not.toHaveBeenCalled()
    expect((h.tenantConfirmation.mock.calls[0][1] as { subject: string }).subject).toBe('Registered: Canary Cup')
  })

  it('flag on: a Stellr event on Stellr’s host is unchanged: the 15-year-old gets Stellr’s agreement, no tenant consent', async () => {
    h.requestTenant.mockResolvedValue({ kind: 'stellr', tenantId: STELLR_TENANT_ID, tenantSlug: 'stellr' })
    rec.respond((c: DbCall): DbResult | undefined => {
      // The mirror holds no row for Stellr's slug: an unmirrored slug is Stellr's.
      if (c.table === 'events' && c.op === 'select') return { data: null, error: null }
      return undefined
    })
    const res = await settle(await post())
    expect(res.status).toBe(201)
    expect(rec.calls.some((c) => c.table === 'tenant_guardian_consents' || c.table === 'agreements')).toBe(false)
    expect(h.template).not.toHaveBeenCalled()
    expect(h.invite).not.toHaveBeenCalled()
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    expect((rec.payloads('insert', 'participants')[0] as Person).tenant_id).toBe(STELLR_TENANT_ID)
  })
})
