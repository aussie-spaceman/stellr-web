// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// C16's routes in the hands of a tenant's own staff, on the tenant's own records. The IDOR
// personas name another tenant's record, so they stop at the 404. This goes past it: what
// the handler does with a record the caller really may reach, while the parts of the
// platform those handlers lean on (Stripe, the activity log, global member lookups) still
// belong to Stellr. Each row is held in a database that applies the filters it is given.

const TENANT = '11111111-1111-4111-8111-111111111111'
const ID = '22222222-2222-4222-8222-222222222222'
const FOREIGN_ID = '33333333-3333-4333-8333-333333333333'

type Row = Record<string, unknown>
interface Query {
  table: string
  op: string
  filters: [string, string, unknown][]
}

const state = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  queries: [] as unknown[],
  stripeClient: vi.fn(() => ({})),
  logActivity: vi.fn(async () => {}),
  addParticipantToGroup: vi.fn(async () => ({ status: 201, body: {}, memberId: 'm' })),
  previewGroupSetup: vi.fn(async () => []),
  finishGroupSetup: vi.fn(async () => ({})),
  groupInvoiceSummary: vi.fn(async () => null),
  loadSignedRecord: vi.fn(async () => ({ kind: 'unavailable', reason: 'test' })),
  resolveRefundBasis: vi.fn(async () => null),
  correctAgreementRecipient: vi.fn(async () => ({
    kind: 'ok',
    memberId: 'm',
    envelopeId: 'e',
    provider: 'native',
    previousEmail: 'old@example.invalid',
    recipient: { email: 'new@example.invalid', roleName: 'signer' },
    eventSlug: 't1',
  })),
  revokeCredential: vi.fn(async () => ({ id: 'c', member_id: 'm', title: 'T', number: 'N' })),
}))

function fakeDb() {
  const from = (table: string) => {
    const q: Query = { table, op: 'select', filters: [] }
    state.queries.push(q)
    const passes = (row: Row) =>
      q.filters.every(([kind, col, value]) => {
        if (kind === 'or') {
          if (!col.startsWith('tenant_id')) return true
          return row.tenant_id == null || col.includes(`tenant_id.eq.${row.tenant_id as string}`)
        }
        if (kind === 'in') return (value as unknown[]).includes(row[col])
        return !(col in row) || row[col] === value
      })
    const answer = () => ((state.rows[table] ?? []) as Row[]).filter(passes)
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    for (const op of ['update', 'delete', 'insert', 'upsert']) {
      chain[op] = () => {
        q.op = op
        return chain
      }
    }
    chain.eq = (col: string, value: unknown) => {
      q.filters.push(['eq', col, value])
      return chain
    }
    chain.in = (col: string, value: unknown) => {
      q.filters.push(['in', col, value])
      return chain
    }
    chain.or = (expr: string) => {
      q.filters.push(['or', expr, null])
      return chain
    }
    for (const m of ['order', 'range', 'not', 'is', 'limit']) chain[m] = () => chain
    chain.maybeSingle = async () => ({ data: answer()[0] ?? null, error: null })
    chain.single = async () => ({ data: answer()[0] ?? null, error: null })
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: answer(), error: null })
    return chain
  }
  return { from, rpc: async () => ({ data: null, error: null }) }
}

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: 'user_tenant_admin' }),
  currentUser: async () => null,
  clerkClient: async () => ({ users: { getUserList: async () => ({ data: [] }) } }),
}))
vi.mock('@/lib/authz', async (importOriginal) => {
  const { tenantWideScope } = await import('@/lib/tenancy/scope-context')
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    currentTenantId: () => TENANT,
    requireTenantStaff: async () => ({ ok: true, tenantId: TENANT }),
    requireEventStaff: async () => ({
      ok: true,
      userId: 'user_tenant_admin',
      isAdmin: true,
      tenantId: TENANT,
      scope: tenantWideScope(TENANT, 'tenant_admin'),
      covers: () => true,
    }),
  }
})
vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  supabaseServer: () => fakeDb(),
}))
vi.mock('@/lib/stripe', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  stripeClient: state.stripeClient,
}))
vi.mock('@/lib/activity-log', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  logActivity: state.logActivity,
  actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: null, actorLabel: 'Admin' }),
}))
vi.mock('@/lib/group-participant-add', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  addParticipantToGroup: state.addParticipantToGroup,
}))
vi.mock('@/lib/group-registration-setup', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  previewGroupSetup: state.previewGroupSetup,
  finishGroupSetup: state.finishGroupSetup,
}))
vi.mock('@/lib/group-billing', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  groupInvoiceSummary: state.groupInvoiceSummary,
}))
vi.mock('@/lib/esign/archive', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadSignedRecord: state.loadSignedRecord,
  logRecordAccess: async () => {},
}))
vi.mock('@/lib/refunds/payment-basis', () => ({ resolveRefundBasis: state.resolveRefundBasis }))
vi.mock('@/lib/agreement-correction', () => ({ correctAgreementRecipient: state.correctAgreementRecipient }))
vi.mock('@/lib/docusign-recipients', () => ({ syncEnvelopeRecipients: async () => {} }))
vi.mock('@/lib/credentials', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revokeCredential: state.revokeCredential,
}))
vi.mock('@/lib/community', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSignedInMember: async () => null,
}))

const req = (body?: unknown) =>
  new Request('https://app.test/x?participant=' + ID, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) })
const queries = (table: string) => (state.queries as Query[]).filter((q) => q.table === table)

const OWN_GROUP = { id: ID, tenant_id: TENANT, type: 'group', event_slug: 't1', event_title: 'T', school_name: null, school_address_state: null, teacher_member_id: 'm' }

beforeEach(() => {
  state.rows = {}
  state.queries = []
  for (const f of [
    state.stripeClient,
    state.logActivity,
    state.addParticipantToGroup,
    state.previewGroupSetup,
    state.finishGroupSetup,
    state.groupInvoiceSummary,
    state.loadSignedRecord,
    state.resolveRefundBasis,
    state.correctAgreementRecipient,
    state.revokeCredential,
  ]) f.mockClear()
  vi.stubEnv('LOADSCOPED_MODE', '')
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('group money and roster actions on a tenant\'s own group', () => {
  const REFUSED = 503

  it('a roster add is refused before anything runs, a Member ID link included', async () => {
    state.rows.registrations = [OWN_GROUP]
    const { POST } = await import('@/app/api/admin/registrations/[id]/participants/route')
    const res = await POST(req({ linked: true, membership_id: 'ST-000001', first_name: 'A', last_name: 'B' }), ctx())
    expect(res.status).toBe(REFUSED)
    expect(JSON.stringify(await res.json())).not.toContain('ST-000001')
    expect(state.addParticipantToGroup).not.toHaveBeenCalled()
    expect(state.stripeClient).not.toHaveBeenCalled()
    expect(state.logActivity).not.toHaveBeenCalled()
  })

  it('finish setup is refused, reading and running', async () => {
    state.rows.registrations = [OWN_GROUP]
    const { GET, POST } = await import('@/app/api/admin/registrations/[id]/finish-setup/route')
    expect((await GET(req(), ctx())).status).toBe(REFUSED)
    expect((await POST(req({ steps: ['invoice'] }), ctx())).status).toBe(REFUSED)
    expect(state.previewGroupSetup).not.toHaveBeenCalled()
    expect(state.finishGroupSetup).not.toHaveBeenCalled()
    expect(state.logActivity).not.toHaveBeenCalled()
  })

  it('the invoice is refused for every action, with no Stripe client made', async () => {
    state.rows.registrations = [OWN_GROUP]
    const { GET, POST } = await import('@/app/api/admin/registrations/[id]/invoice/route')
    expect((await GET(req(), ctx())).status).toBe(REFUSED)
    for (const body of [{ action: 'preview', code: 'X' }, { action: 'apply', code: 'X' }, { action: 'remove' }, { action: 'reissue' }]) {
      expect((await POST(req(body), ctx())).status, body.action).toBe(REFUSED)
    }
    expect(state.stripeClient).not.toHaveBeenCalled()
    expect(state.groupInvoiceSummary).not.toHaveBeenCalled()
    expect(state.logActivity).not.toHaveBeenCalled()
  })

  it('another tenant\'s group still answers as a missing one, not with the refusal', async () => {
    state.rows.registrations = [{ ...OWN_GROUP, tenant_id: STELLR_TENANT_ID }]
    const participants = await import('@/app/api/admin/registrations/[id]/participants/route')
    const setup = await import('@/app/api/admin/registrations/[id]/finish-setup/route')
    const invoice = await import('@/app/api/admin/registrations/[id]/invoice/route')
    const answers = [
      await participants.POST(req({ first_name: 'A' }), ctx()),
      await setup.GET(req(), ctx()),
      await invoice.GET(req(), ctx()),
    ]
    expect(answers.map((r) => r.status)).toEqual([404, 404, 404])
    state.rows.registrations = []
    expect(await answers[0].text()).toBe(await (await participants.POST(req({ first_name: 'A' }), ctx())).text())
  })

  it('a refund preview of a tenant\'s participant does not go to Stripe', async () => {
    state.rows.participants = [{ id: ID, tenant_id: TENANT, registration_id: ID, stellr_scope_parent: { tenant_id: TENANT } }]
    const { EMPTY_REFUND_PREVIEW } = await import('@/lib/refunds/preview')
    const { GET } = await import('@/app/api/admin/refunds/preview/route')
    const res = await GET(req())
    expect(await res.json()).toEqual(EMPTY_REFUND_PREVIEW)
    expect(state.stripeClient).not.toHaveBeenCalled()
    expect(state.resolveRefundBasis).not.toHaveBeenCalled()
  })
})

describe('a signed record reused from elsewhere', () => {
  const COVERAGE = { id: ID, tenant_id: TENANT, status: 'completed', reused_from: FOREIGN_ID, envelope_id: 'x', provider: 'native' }

  it('an original in another tenant answers as a missing one and is not served', async () => {
    state.rows.agreements = [COVERAGE, { id: FOREIGN_ID, tenant_id: STELLR_TENANT_ID, status: 'completed', reused_from: null, envelope_id: 'y', provider: 'native' }]
    const { GET } = await import('@/app/api/admin/docusigns/[id]/download/route')
    const res = await GET(req() as never, ctx())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Original agreement not found' })
    expect(state.loadSignedRecord).not.toHaveBeenCalled()
  })

  it('an original in the same tenant is served', async () => {
    const original = { id: FOREIGN_ID, tenant_id: TENANT, status: 'completed', reused_from: null, envelope_id: 'y', provider: 'native' }
    state.rows.agreements = [COVERAGE, original]
    const { GET } = await import('@/app/api/admin/docusigns/[id]/download/route')
    await GET(req() as never, ctx())
    expect(state.loadSignedRecord).toHaveBeenCalledTimes(1)
    expect(state.loadSignedRecord.mock.calls[0]).toContainEqual(original)
  })
})

describe('a guardian\'s opt-out recorded by a tenant', () => {
  it('touches and counts only that tenant\'s credentials, and writes no activity', async () => {
    state.rows.agreements = [{ id: ID, tenant_id: TENANT, envelope_type: 'minor', status: 'completed', reused_from: null, member_id: 'm', participant_id: null, minor_name: 'A' }]
    state.rows.credentials = [
      { id: 'own', tenant_id: TENANT, member_id: 'm', visibility: 'public', title: 'Own' },
      { id: 'theirs', tenant_id: STELLR_TENANT_ID, member_id: 'm', visibility: 'public', title: 'Theirs' },
    ]
    const { POST } = await import('@/app/api/admin/docusigns/[id]/credential-sharing/route')
    const res = await POST(req({ optOut: true }) as never, ctx())
    expect(await res.json()).toEqual({ ok: true, optOut: true, unpublished: 1 })
    const update = queries('credentials').find((q) => q.op === 'update')
    expect(update?.filters).toContainEqual(['eq', 'tenant_id', TENANT])
    expect(state.logActivity).not.toHaveBeenCalled()
  })
})

describe('the global activity log, on a tenant\'s records', () => {
  it('event participation edits and deletes write none', async () => {
    state.rows.event_participations = [{ id: ID, tenant_id: TENANT, member_id: 'm', team_name: 'Team' }]
    const { PATCH, DELETE } = await import('@/app/api/admin/event-participations/[id]/route')
    expect((await PATCH(req({ award: 'x' }), ctx())).status).toBe(200)
    expect((await DELETE(req({}), ctx())).status).toBe(200)
    expect(state.logActivity).not.toHaveBeenCalled()
  })

  it('revoking a credential writes none', async () => {
    state.rows.credentials = [{ id: ID, tenant_id: TENANT, event_slug: 't1', member_id: 'm' }]
    const { POST } = await import('@/app/api/admin/credentials/[id]/revoke/route')
    expect((await POST(req({ reason: 'r' }), ctx())).status).toBe(200)
    expect(state.revokeCredential).toHaveBeenCalledTimes(1)
    expect(state.logActivity).not.toHaveBeenCalled()
  })

  it('correcting a signer writes none', async () => {
    state.rows.agreements = [{ id: ID, tenant_id: TENANT, event_slug: 't1', envelope_id: 'e', provider: 'native', status: 'sent' }]
    const { POST } = await import('@/app/api/admin/agreements/[id]/correct-recipient/route')
    expect((await POST(req({ recipientId: 'r', email: 'new@example.invalid' }), ctx())).status).toBe(200)
    expect(state.correctAgreementRecipient).toHaveBeenCalledTimes(1)
    expect(state.logActivity).not.toHaveBeenCalled()
  })

  it('withdrawing a quote writes none', async () => {
    state.rows.survey_responses = [{ id: ID, tenant_id: TENANT, member_id: 'm', distribution_id: null, event_slug: 't1' }]
    const { POST } = await import('@/app/api/admin/surveys/responses/[id]/withdraw-quote/route')
    expect((await POST(req({}), ctx())).status).toBe(200)
    expect(state.logActivity).not.toHaveBeenCalled()
  })
})
