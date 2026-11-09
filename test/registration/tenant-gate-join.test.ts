import { describe, it, expect, vi, beforeEach } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { rec, TODAY, dateBefore, jsonRequest, settle, type DbCall, type DbResult } from '@/test/registration/fixtures'

// S5 A7: POST /api/register/group-join on a tenant's group, and a tenant's join link
// named on the wrong host. The route, gate, identify and the eligibility and
// event-context libraries are real; the database is the recording fake.

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'
const OTHER = 'd0000000-0000-4000-8000-0000000000bb'

const h = vi.hoisted(() => ({
  requestTenant: vi.fn(async (): Promise<{ kind: string; tenantId: string; tenantSlug: string }> => ({
    kind: 'stellr', tenantId: '00000000-0000-4000-8000-000000000001', tenantSlug: 'stellr',
  })),
  auth: vi.fn(async () => ({ userId: null as string | null })),
  getEventBySlug: vi.fn(async (_slug: string): Promise<unknown> => null),
  upsertMember: vi.fn(async (): Promise<string | null> => 'm-1'),
  provision: vi.fn(async () => ({ signInToken: 'tkt', clerkUserId: 'user_1' })),
  onFile: vi.fn(async () => ({ ok: true, onFile: false, schoolAddressOnly: false })),
  dispatch: vi.fn(async () => {}),
  stellrEmail: vi.fn(async () => {}),
  payments: vi.fn(async () => {}),
  tenantConfirmation: vi.fn(async (_db: unknown, _input: Record<string, unknown>) => ({ ok: true, id: 'em_1' })),
  hook: vi.fn((_name: string) => {}),
  audit: vi.fn(async (_m: Record<string, unknown>, _o?: unknown) => ({ ok: false, skipped: 'disabled' })),
}))

vi.mock('@/lib/tenancy/request-tenant', () => ({ requestTenant: h.requestTenant }))
vi.mock('@/lib/audit/route', () => ({ auditMutation: h.audit }))
vi.mock('@/lib/supabase', async () => {
  const { rec } = await import('@/test/registration/fixtures')
  return { supabaseServer: () => rec.client() }
})
vi.mock('@/lib/field-crypto-shadow', () => ({ shadowSyncFields: () => {} }))
vi.mock('@clerk/nextjs/server', () => ({ auth: h.auth }))
vi.mock('@/lib/clerk-provisioning', () => ({ ensureClerkUserAndSignInToken: h.provision }))
vi.mock('@/lib/pending-consent', async (orig) => ({
  ...(await orig<typeof import('@/lib/pending-consent')>()),
  childAwaitingConsentBlock: async () => null,
}))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: h.getEventBySlug }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/rate-limit-async', () => ({ rateLimit: async () => null }))
vi.mock('@/lib/member-sync', () => ({ upsertMember: h.upsertMember }))
vi.mock('@/lib/registration/member-on-file', async (orig) => ({
  ...(await orig<typeof import('@/lib/registration/member-on-file')>()),
  findMemberOnFile: h.onFile,
}))
vi.mock('@/lib/email', () => ({
  sendEmail: h.stellrEmail,
  groupMemberJoinedEmail: () => ({ subject: '', html: '', text: '' }),
}))
vi.mock('@/lib/individual-payment', () => ({ ensureIndividualPayments: h.payments }))
vi.mock('@/lib/docusign-agreements', () => ({ dispatchAgreement: h.dispatch }))
vi.mock('@/lib/event-emails/tenant-mail', () => ({ sendTenantConfirmation: h.tenantConfirmation }))
vi.mock('@/lib/school-link', () => ({
  linkMembersToSchoolByName: async () => h.hook('linkMembersToSchoolByName'),
  linkMembersToRegistrationSchool: async () => h.hook('linkMembersToRegistrationSchool'),
  resolveAndLinkSchool: async () => null,
}))
vi.mock('@/lib/event-participation-sync', () => ({ recordEventParticipation: async () => h.hook('recordEventParticipation') }))
vi.mock('@/lib/space-inheritance', () => ({
  syncObjectSpaceRoster: async () => h.hook('syncObjectSpaceRoster'),
  reconcileEventSpaceRoster: async () => h.hook('reconcileEventSpaceRoster'),
}))

const { POST } = await import('@/app/api/register/group-join/route')

type Row = Record<string, unknown>

const EVENT = { title: 'Canary Cup', activityType: 'live_event', date: TODAY }
const MIRROR = {
  tenant_id: CANARY,
  activity_type: 'live_event',
  starts_at: `${TODAY}T12:00:00Z`,
  time_zone: 'America/Denver',
  min_participant_age: null as number | null,
}
const TENANT = { id: CANARY, is_platform_owner: false, min_participant_age: 14 }

let tokenRow: Row | null

function token(tenantId: string | null, overrides: Row = {}): Row {
  return {
    token: 'tok', registration_id: 'reg-1', event_slug: 'canary-cup', event_title: 'Canary Cup',
    tenant_id: tenantId,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    registrations: {
      status: 'pending', withdrawn_at: null, school_name: 'Sydney High',
      adult_count: 1, student_count: 2, member_pays_individually: false,
      teacher_email: 'teacher@example.com', teacher_first_name: 'T', tenant_id: tenantId,
    },
    ...overrides,
  }
}

// An adult: nobody under 18 joins a tenant's group until tenants can collect a
// guardian's consent (assertRegistrable).
const DETAILS = {
  first_name: 'K', last_name: 'Id', email: 'kid@example.com', date_of_birth: dateBefore(18),
  type: 'participant', emergency_contact_email: 'parent@example.com',
}

const post = (details: Row | undefined = DETAILS) =>
  POST(jsonRequest('/api/register/group-join', { token: 'tok', ...(details ? { details } : {}) }))

function onHost(tenantId: string) {
  h.requestTenant.mockResolvedValue(
    tenantId === STELLR_TENANT_ID
      ? { kind: 'stellr', tenantId, tenantSlug: 'stellr' }
      : { kind: 'tenant', tenantId, tenantSlug: 'canary' },
  )
}

function db(mirrorRow: Partial<typeof MIRROR> | null) {
  rec.respond((c: DbCall): DbResult | undefined => {
    if (c.table === 'group_join_tokens') return { data: tokenRow, error: null }
    if (c.table === 'events' && c.op === 'select') return { data: mirrorRow ? { ...MIRROR, ...mirrorRow } : null, error: null }
    if (c.table === 'tenants' && c.op === 'select') return { data: TENANT, error: null }
    return undefined
  })
}

const writes = () => rec.calls.filter((c) => c.op !== 'select')
const INVALID = { status: 404, body: { error: 'Invalid or expired registration link' } }

beforeEach(() => {
  vi.clearAllMocks()
  rec.reset()
  h.auth.mockResolvedValue({ userId: null })
  h.getEventBySlug.mockResolvedValue(EVENT)
  onHost(CANARY)
  tokenRow = token(CANARY)
  db({})
})

describe('S5 A7: register/group-join, whose link', () => {
  it('a tenant’s link on Stellr’s host gets the unknown link’s answer, even when it has expired', async () => {
    onHost(STELLR_TENANT_ID)
    expect(await settle(await post())).toEqual(INVALID)
    tokenRow = token(CANARY, { expires_at: '2000-01-01T00:00:00Z' })
    expect(await settle(await post())).toEqual(INVALID)
    tokenRow = null
    expect(await settle(await post())).toEqual(INVALID)
    expect(writes()).toEqual([])
    expect(h.getEventBySlug).not.toHaveBeenCalled()
  })

  it('Stellr’s link, or another tenant’s, on a tenant’s host gets the unknown link’s answer', async () => {
    tokenRow = token(null)
    expect(await settle(await post())).toEqual(INVALID)
    tokenRow = token(OTHER)
    expect(await settle(await post())).toEqual(INVALID)
    expect(writes()).toEqual([])
  })

  it('a link whose row and registration disagree on the tenant is refused the same way', async () => {
    tokenRow = token(CANARY, { registrations: { ...(token(CANARY).registrations as Row), tenant_id: null } })
    expect(await settle(await post())).toEqual(INVALID)
  })

  it('a link stamped Stellr’s for an event the mirror gives a tenant: closed, with nothing written', async () => {
    onHost(STELLR_TENANT_ID)
    tokenRow = token(null)
    expect(await settle(await post())).toEqual({ status: 403, body: { error: 'Registration for this event is closed.' } })
    expect(writes()).toEqual([])
    expect(h.upsertMember).not.toHaveBeenCalled()
  })
})

describe('S5 A7: register/group-join, the audit event', () => {
  it('a join records one event naming the participant row; a refusal records none', async () => {
    await post()
    expect(h.audit.mock.calls).toEqual([[
      {
        action: 'registration.group_join.create',
        actor: { userId: null },
        tenant: { stellr: true },
        target: { table: 'participants', id: 'p-1' },
        metadata: { status: 201, event_tenant_id: CANARY },
      },
      { afterResponse: true },
    ]])
    h.audit.mockClear()
    await post({ ...DETAILS, date_of_birth: dateBefore(13) })
    expect(h.audit).not.toHaveBeenCalled()
  })
})

describe('S5 A7: register/group-join on a tenant’s group', () => {
  it('a 13-year-old joining is refused at the API, with nothing written', async () => {
    const res = await settle(await post({ ...DETAILS, date_of_birth: dateBefore(13) }))
    expect(res).toMatchObject({ status: 400, body: { code: 'under_minimum_age' } })
    expect(writes()).toEqual([])
  })

  it('an unknown date of birth is refused, with nothing written', async () => {
    expect(await settle(await post({ ...DETAILS, date_of_birth: '2999-01-01' }))).toMatchObject({ status: 400, body: { code: 'dob_invalid' } })
    expect(writes()).toEqual([])
  })

  it('a 14- or 17-year-old is refused until tenants can collect a guardian’s consent, with nothing written', async () => {
    for (const years of [14, 17]) {
      const res = await settle(await post({ ...DETAILS, date_of_birth: dateBefore(years) }))
      expect(res).toEqual({
        status: 400,
        body: { code: 'under_minimum_age', error: 'You must be 18 or older to register for this event online. Please contact the event organiser.' },
      })
    }
    expect(writes()).toEqual([])
    expect(h.tenantConfirmation).not.toHaveBeenCalled()
  })

  describe('signed in', () => {
    const MEMBER = {
      id: 'm-1', first_name: 'Stored', last_name: 'Profile', email: 'stored@example.com', date_of_birth: dateBefore(30),
      phone: '555-0100', ec_first_name: 'Stored', ec_email: 'stored-ec@example.com', age_bracket: 'adult',
    }
    beforeEach(() => {
      h.auth.mockResolvedValue({ userId: 'user_1' })
      rec.respond((c: DbCall): DbResult | undefined => {
        if (c.table === 'group_join_tokens') return { data: tokenRow, error: null }
        if (c.table === 'events') return { data: MIRROR, error: null }
        if (c.table === 'tenants') return { data: TENANT, error: null }
        if (c.table === 'members') return { data: MEMBER, error: null }
        return undefined
      })
    })

    it('Stellr’s member record is not read or linked: the row is the typed details, with no member', async () => {
      const res = await settle(await post())
      expect(res).toMatchObject({ status: 201, body: { success: true, signInToken: null } })
      expect(rec.calls.filter((c) => c.table === 'members')).toEqual([])
      expect(writes().map((c) => `${c.op} ${c.table}`)).toEqual(['insert participants'])
      const row = rec.payloads('insert', 'participants')[0]
      expect(row).toMatchObject({ tenant_id: CANARY, member_id: null, email: 'kid@example.com', first_name: 'K' })
      expect(JSON.stringify(row)).not.toMatch(/stored|555-0100/i)
    })

    it('with no details typed, the details are asked for, and nothing is read or written', async () => {
      // null, not undefined: undefined takes post's default details.
      expect(await settle(await post(null as unknown as Row))).toEqual({ status: 400, body: { error: 'Please complete your details to join.' } })
      expect(rec.calls.filter((c) => c.table === 'members')).toEqual([])
      expect(writes()).toEqual([])
    })

    it('a 13-year-old’s typed details are refused, with nothing written', async () => {
      const res = await settle(await post({ ...DETAILS, date_of_birth: dateBefore(13) }))
      expect(res).toMatchObject({ status: 400, body: { code: 'under_minimum_age' } })
      expect(writes()).toEqual([])
    })
  })

  it('an adult joins: one participant row with the tenant, no member or login, the tenant’s confirmation only', async () => {
    const res = await settle(await post())
    expect(res).toEqual({ status: 201, body: { success: true, eventSlug: 'canary-cup', eventTitle: 'Canary Cup', signInToken: null } })
    expect(writes().map((c) => `${c.op} ${c.table}`)).toEqual(['insert participants'])
    expect(rec.payloads('insert', 'participants')[0]).toMatchObject({ tenant_id: CANARY, member_id: null })
    expect(h.onFile).not.toHaveBeenCalled()
    expect(h.upsertMember).not.toHaveBeenCalled()
    expect(h.provision).not.toHaveBeenCalled()
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(h.hook).not.toHaveBeenCalled()
    expect(h.stellrEmail).not.toHaveBeenCalled()
    expect(h.payments).not.toHaveBeenCalled()
    expect(h.tenantConfirmation).toHaveBeenCalledTimes(1)
    expect(h.tenantConfirmation.mock.calls[0][1]).toMatchObject({ tenantId: CANARY, to: 'kid@example.com' })
  })
})
