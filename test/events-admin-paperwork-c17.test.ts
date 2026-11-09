// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { auditHandlers } from '@/lib/security/audit-coverage'
import { ROUTE_MANIFEST } from '@/lib/security/route-manifest'
import { STELLR_ONLY_DISPOSITIONS } from '@/lib/security/stellr-only-dispositions'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// C17 (docs/TENANCY-S5.md): events admin routes for paperwork and communications.
//
// The IDOR personas name another tenant's event, so they stop at the event check. This drives
// the handlers past it under real lib/authz, with Clerk, the database and everything that sends
// or signs as stand-ins: Stellr's admins and managers under today's settings, a manager naming
// another event's record inside their own event, and a tenant's staff on their own event.
// The database applies the filters it is given and records each query, because "today's
// settings keep today's reads" is a claim about the query.

const TENANT = '11111111-1111-4111-8111-111111111111'
const ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ID = '33333333-3333-4333-8333-333333333333'

type Row = Record<string, unknown>
interface Query {
  table: string
  op: string
  select?: string
  limit?: number
  filters: [string, string, unknown][]
  payload?: unknown
  options?: unknown
}

const state = vi.hoisted(() => ({
  session: {} as Record<string, unknown>,
  tenant: '',
  rows: {} as Record<string, unknown[]>,
  queries: [] as unknown[],
  storageRemoved: [] as string[][],
  failEvents: false,
  /** A write to this table answers an error. */
  failWritesTo: null as string | null,
  /** A write to this table touches no row: it lost a race. */
  missWritesTo: null as string | null,
  sanityEvent: null as unknown,
  mediaForParticipants: vi.fn(async (..._a: unknown[]) => new Map<string, { status: string; reason: string }>()),
  buildMentorReportPdf: vi.fn(async (..._a: unknown[]) => ({ pdf: new Uint8Array(1), rows: [] as unknown[] })),
  audits: [] as unknown[],
  logActivity: vi.fn(async (..._a: unknown[]) => {}),
  sendEventEmail: vi.fn(async (..._a: unknown[]) => ({ ok: true, sendId: 's', recipients: 1, sent: 1, failed: 0, docusignResent: 0 })),
  sendCatchUp: vi.fn(async (..._a: unknown[]) => ({ ok: true, sendId: null, recipients: 0, sent: 0, failed: 0, docusignResent: 0 })),
  catchUpStatus: vi.fn(async (..._a: unknown[]) => ({ eligible: false, open: false, audiences: [], pending: [] })),
  resolveAudience: vi.fn(async (..._a: unknown[]) => ({ recipients: [], docusignParticipantIds: [] })),
  getEventRoster: vi.fn(async (..._a: unknown[]) => ({ groups: [] as unknown[] })),
  sendEmail: vi.fn(async (..._a: unknown[]) => {}),
  sendPayLinkEmail: vi.fn(async (..._a: unknown[]) => ({ sent: true, recipients: ['payer@example.invalid'] })),
  reissue: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ kind: 'not_found' })),
  adminSurveyView: vi.fn(async (..._a: unknown[]) => ({ distribution: null, rows: [] })),
  resendInvitation: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  distributionForEvent: vi.fn(async (..._a: unknown[]): Promise<unknown> => null),
  resendTeamProfile: vi.fn(async (..._a: unknown[]) => ({ ok: true, email: 'x@example.invalid' })),
  resendOutstanding: vi.fn(async (..._a: unknown[]) => ({ sent: 1, failed: 0, waiting: 0, remaining: 0 })),
  dispatchVolunteerAgreement: vi.fn(async (..._a: unknown[]) => 'linked'),
  issueCredential: vi.fn(async (..._a: unknown[]) => ({ created: true, row: { id: 'c', number: 'N' } })),
  loadEventMentors: vi.fn(async (..._a: unknown[]) => []),
  claimUpload: vi.fn(async (..._a: unknown[]) => ({ bytes: new Uint8Array(1), bucket: 'b', format: 'pdf' })),
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
        if (col.includes('.')) return true
        if (!(col in row)) return true
        if (kind === 'in') return (value as unknown[]).includes(row[col])
        if (kind === 'neq') return row[col] !== value
        if (kind === 'is') return row[col] == null
        if (kind === 'not') {
          const [operator, operand] = value as [string, unknown]
          if (operator === 'is') return row[col] != null
          if (operator === 'like') return !String(row[col]).startsWith(String(operand).replace('%', ''))
          return true
        }
        return row[col] === value
      })
    const answer = () => ((state.rows[table] ?? []) as Row[]).filter(passes)
    const failed = () => (table === 'events' && state.failEvents) || (q.op !== 'select' && state.failWritesTo === table)
    const missed = () => q.op !== 'select' && state.missWritesTo === table
    const DOWN = { data: null, error: { code: 'XX000', message: 'down' } }
    const chain: Record<string, unknown> = {}
    chain.select = (cols?: string) => {
      if (cols) q.select = cols
      return chain
    }
    for (const op of ['update', 'delete', 'insert', 'upsert']) {
      chain[op] = (payload?: unknown, options?: unknown) => {
        q.op = op
        q.payload = payload
        q.options = options
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
    chain.limit = (n: number) => {
      q.limit = n
      return chain
    }
    chain.neq = (col: string, value: unknown) => {
      q.filters.push(['neq', col, value])
      return chain
    }
    chain.not = (col: string, operator: string, operand: unknown) => {
      q.filters.push(['not', col, [operator, operand]])
      return chain
    }
    chain.is = (col: string, value: unknown) => {
      q.filters.push(['is', col, value])
      return chain
    }
    chain.order = () => chain
    chain.maybeSingle = async () => (failed() ? DOWN : { data: missed() ? null : (answer()[0] ?? null), error: null })
    chain.single = async () => ({ data: answer()[0] ?? { id: 'new' }, error: null })
    chain.then = (resolve: (v: unknown) => unknown) => resolve(failed() ? DOWN : { data: missed() ? [] : answer(), error: null })
    return chain
  }
  return {
    from,
    rpc: async () => ({ data: null, error: null }),
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          state.storageRemoved.push(paths)
          return {}
        },
      }),
    },
  }
}

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => state.session,
  currentUser: async () => null,
  clerkClient: async () => ({ users: { getUserList: async () => ({ data: [] }) } }),
}))
vi.mock('@/lib/authz/tenant', () => ({ currentTenantId: () => state.tenant }))
vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  supabaseServer: () => fakeDb(),
}))
vi.mock('@/lib/events/repo', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getEventBySlug: async () => state.sanityEvent,
}))
vi.mock('@/lib/audit/platform', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  audit: async (input: unknown) => {
    state.audits.push(input)
    return { ok: true, id: 1, seq: 1 }
  },
}))
vi.mock('@/lib/after-response', () => ({
  runAfterResponse: (_label: string, task: () => Promise<unknown>) => {
    pending.push(task())
  },
}))
vi.mock('@/lib/activity-log', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  logActivity: state.logActivity,
  actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: null, actorLabel: 'Admin' }),
}))
vi.mock('@/lib/community', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSignedInMember: async () => null,
}))
vi.mock('@/lib/event-emails/send', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendEventEmail: state.sendEventEmail,
  loadEventForEmail: async () => ({ slug: 'nevada', title: 'Nevada' }),
}))
vi.mock('@/lib/event-emails/catch-up', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendCatchUp: state.sendCatchUp,
  catchUpStatus: state.catchUpStatus,
}))
vi.mock('@/lib/event-emails/audiences', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveAudience: state.resolveAudience,
}))
vi.mock('@/lib/event-admin', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getEventRoster: state.getEventRoster,
}))
vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendEmail: state.sendEmail,
}))
vi.mock('@/lib/registration-pay-link', () => ({ sendPayLinkEmail: state.sendPayLinkEmail }))
vi.mock('@/lib/docusign-reissue', () => ({ reissueParticipantAgreement: state.reissue }))
vi.mock('@/lib/docusign-agreements', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  adoptOpenEnvelope: async () => {},
}))
vi.mock('@/lib/survey/admin', () => ({ adminSurveyView: state.adminSurveyView }))
vi.mock('@/lib/survey/distributions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  distributionForEvent: state.distributionForEvent,
  loadDefinition: async () => ({ def: {} }),
}))
vi.mock('@/lib/survey/send', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resendInvitation: state.resendInvitation,
}))
vi.mock('@/lib/survey/audit', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  writeAudit: async () => {},
  logSurveyAccess: async () => {},
}))
vi.mock('@/lib/survey/media', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  mediaForParticipants: state.mediaForParticipants,
}))
vi.mock('@/lib/team-profile/store', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resendTeamProfile: state.resendTeamProfile,
  resendOutstanding: state.resendOutstanding,
}))
vi.mock('@/lib/volunteer', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  dispatchVolunteerAgreement: state.dispatchVolunteerAgreement,
  grantVolunteerRole: async () => {},
  getVolunteerStatuses: async () => ({}),
}))
vi.mock('@/lib/container-sync', () => ({ ensureEventContainer: async () => 'container' }))
vi.mock('@/lib/space-inheritance', () => ({ syncObjectSpaceRoster: async () => {} }))
vi.mock('@/lib/event-participation-sync', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  removeEventParticipation: async () => {},
}))
vi.mock('@/lib/credentials', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  issueCredential: state.issueCredential,
}))
vi.mock('@/lib/credentials-notify', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendCredentialIssuedEmail: async () => true,
}))
vi.mock('@/lib/background-report-export', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadEventMentors: state.loadEventMentors,
  classifyMentors: async () => [],
  buildMentorReportPdf: state.buildMentorReportPdf,
  logReportExport: async () => {},
}))
vi.mock('@/lib/uploads', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  claimUpload: state.claimUpload,
  discardUpload: async () => {},
}))

let pending: Promise<unknown>[] = []

const asAdmin = () => {
  state.session = { userId: 'user_admin', sessionClaims: { metadata: { role: 'admin' } } }
  state.rows.event_manager_assignments = []
}
const asEventManager = (...slugs: string[]) => {
  state.session = { userId: 'user_em', sessionClaims: { metadata: { role: 'event_manager' } } }
  state.rows.event_manager_assignments = slugs.map((event_slug) => ({ clerk_user_id: 'user_em', event_slug, tenant_id: null }))
}
/** An admin of another tenant, holding no Clerk staff role: only a membership. */
const asTenantAdmin = () => {
  state.session = { userId: 'user_tenant', sessionClaims: { metadata: { role: 'student' } } }
  state.tenant = TENANT
  vi.stubEnv('AUTHZ_SOURCE', 'postgres')
  state.rows.members = [{ id: 'm', clerk_user_id: 'user_tenant' }]
  state.rows.tenant_memberships = [{ clerk_user_id: 'user_tenant', member_id: 'm', tenant_id: TENANT, role: 'tenant_admin' }]
  state.rows.tenants = [{ id: TENANT, status: 'active' }]
  state.rows.events = [{ slug: 'own', tenant_id: TENANT }, { slug: 'nevada', tenant_id: STELLR_TENANT_ID }]
}

const queries = (table: string) => (state.queries as Query[]).filter((q) => q.table === table)
const SLUG = 'nevada'
const slugCtx = (slug = SLUG) => ({ params: Promise.resolve({ slug }) })
const idCtx = (slug = SLUG, id = ID) => ({ params: Promise.resolve({ slug, id }) })
const req = (body?: unknown, method = 'POST') =>
  new Request('https://app.test/x', body === undefined ? {} : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const EMAIL = (over: Row = {}) => ({
  id: ID,
  event_slug: SLUG,
  tenant_id: STELLR_TENANT_ID,
  name: 'E',
  subject: 'S',
  body_json: null,
  audiences: ['all'],
  attachments: [],
  status: 'draft',
  schedule_days_before: 3,
  ...over,
})
const REGISTRATION = (over: Row = {}) => ({
  id: ID,
  event_slug: SLUG,
  tenant_id: STELLR_TENANT_ID,
  status: 'pending',
  invoice_requested: true,
  member_pays_individually: false,
  teacher_member_id: null,
  ...over,
})

beforeEach(() => {
  state.rows = {}
  state.queries = []
  state.storageRemoved = []
  state.tenant = STELLR_TENANT_ID
  state.failEvents = false
  state.failWritesTo = null
  state.missWritesTo = null
  state.sanityEvent = null
  state.audits = []
  pending = []
  for (const f of [
    state.mediaForParticipants,
    state.buildMentorReportPdf,
    state.logActivity,
    state.sendEventEmail,
    state.sendCatchUp,
    state.catchUpStatus,
    state.resolveAudience,
    state.getEventRoster,
    state.sendEmail,
    state.sendPayLinkEmail,
    state.reissue,
    state.adminSurveyView,
    state.resendInvitation,
    state.distributionForEvent,
    state.resendTeamProfile,
    state.resendOutstanding,
    state.dispatchVolunteerAgreement,
    state.issueCredential,
    state.loadEventMentors,
    state.claimUpload,
  ]) f.mockClear()
  state.getEventRoster.mockReset()
  state.getEventRoster.mockResolvedValue({ groups: [] })
  state.mediaForParticipants.mockResolvedValue(new Map())
  state.loadEventMentors.mockResolvedValue([])
  state.reissue.mockResolvedValue({ kind: 'not_found' })
  state.distributionForEvent.mockResolvedValue(null)
  vi.stubEnv('LOADSCOPED_MODE', '')
  vi.stubEnv('AUTHZ_SOURCE', '')
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
  asAdmin()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

const CONVERTED = [
  'background-reports',
  'docusign-reissue',
  'emails',
  'emails/[id]',
  'emails/[id]/attachments',
  'emails/[id]/catch-up',
  'emails/[id]/preview',
  'emails/[id]/send',
  'export',
  'invoice-paid',
  'participants/[pid]/guardian',
  'payment-link',
  'pd-credentials',
  'remind',
  'survey',
  'team-profiles',
  'volunteers',
].map((r) => `app/api/admin/events/[slug]/${r}/route.ts`)

describe('the routes C17 converted', () => {
  it('are tenant_staff, on requireEventRoute with the URL\'s slug, and have left the register', () => {
    for (const f of CONVERTED) {
      expect(ROUTE_MANIFEST[f], f).toBe('tenant_staff')
      expect(STELLR_ONLY_DISPOSITIONS[f], f).toBeUndefined()
      const src = readFileSync(f, 'utf8')
      expect(src, f).toMatch(/requireEventRoute\(slug,/)
      expect(src, f).not.toMatch(/@\/lib\/event-access/)
    }
  })

  it('every handler that writes goes through the audit gate, with a catalogued action', () => {
    for (const f of CONVERTED) {
      for (const h of auditHandlers(f, readFileSync(f, 'utf8'))) {
        if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(h.method)) expect(h.audited, `${f} ${h.method}`).toBe(true)
      }
      for (const m of readFileSync(f, 'utf8').matchAll(/action: '([a-z_.]+)', \.\.\.auditSubject/g)) {
        expect(AUDIT_ACTIONS as readonly string[], f).toContain(m[1])
      }
    }
  })
})

describe('Stellr, with LOADSCOPED_MODE unset', () => {
  it('reads no event, and the email list is today\'s two queries', async () => {
    state.rows.event_emails = [EMAIL()]
    const { GET } = await import('@/app/api/admin/events/[slug]/emails/route')
    const res = await GET(req(), slugCtx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ emails: [EMAIL()], history: [] })
    expect(queries('events')).toEqual([])
    expect(queries('event_emails')[0].filters).toEqual([['eq', 'event_slug', SLUG]])
    const sends = queries('event_email_sends')[0]
    expect(sends.filters).toEqual([['eq', 'event_slug', SLUG]])
    expect(sends.limit).toBe(100)
  })

  it('a manager keeps their own event, and another answers today\'s 403 with nothing read', async () => {
    asEventManager(SLUG)
    state.rows.event_emails = [EMAIL()]
    const { GET } = await import('@/app/api/admin/events/[slug]/emails/route')
    expect((await GET(req(), slugCtx())).status).toBe(200)

    state.queries = []
    const refused = await GET(req(), slugCtx('texas'))
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: 'Forbidden' })
    expect(queries('event_emails')).toEqual([])
  })

  it('signed out answers today\'s 401, and a student today\'s 403', async () => {
    const { GET } = await import('@/app/api/admin/events/[slug]/export/route')
    state.session = { userId: null, sessionClaims: null }
    const out = await GET(req(), slugCtx())
    expect(out.status).toBe(401)
    expect(await out.json()).toEqual({ error: 'Forbidden' })
    state.session = { userId: 'user_s', sessionClaims: { metadata: { role: 'student' } } }
    expect((await GET(req(), slugCtx())).status).toBe(403)
  })

  it('an event with no mirror row still runs: nothing here may depend on the mirror', async () => {
    state.rows.events = []
    const { GET } = await import('@/app/api/admin/events/[slug]/export/route')
    expect((await GET(req(), slugCtx())).status).toBe(200)
    expect(state.getEventRoster).toHaveBeenCalledWith(SLUG, undefined, { tenant: null })
  })

  it('"Send now" sends once, and a test copy once, as today', async () => {
    state.rows.event_emails = [EMAIL()]
    const { POST } = await import('@/app/api/admin/events/[slug]/emails/[id]/send/route')
    expect((await POST(req({}), idCtx())).status).toBe(200)
    expect(state.sendEventEmail).toHaveBeenCalledTimes(1)
    expect(state.sendEventEmail.mock.calls[0][1]).toBe(ID)
    expect(state.sendEventEmail.mock.calls[0][2]).toMatchObject({ trigger: 'manual', triggeredBy: 'Admin' })
    expect((await POST(req({ test: true }), idCtx())).status).toBe(200)
    expect(state.sendEventEmail).toHaveBeenCalledTimes(2)
    expect(state.sendEventEmail.mock.calls[1][2]).toMatchObject({ trigger: 'test' })
  })

  it('the reminder mails exactly the people it mailed', async () => {
    state.sanityEvent = { title: 'Nevada', date: '2026-12-01' }
    state.getEventRoster.mockResolvedValue({
      groups: [
        {
          registrationId: ID,
          type: 'individual',
          payLinkSendable: false,
          participants: [
            { first_name: 'A', email: 'a@example.invalid', paid: false, docusign: 'outstanding', payment_pill: 'link', minor: false },
            { first_name: 'B', email: 'b@example.invalid', paid: true, docusign: 'outstanding', payment_pill: 'link', minor: false },
            { first_name: 'C', email: null, paid: false, docusign: 'outstanding', payment_pill: 'link', minor: false },
          ],
        },
      ],
    })
    const { POST } = await import('@/app/api/admin/events/[slug]/remind/route')
    const res = await POST(req({ payment: true }), slugCtx())
    expect(await res.json()).toEqual({ sent: 1, failed: 0 })
    expect(state.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('a reissue passes the event, so the helper\'s own check still holds it', async () => {
    state.reissue.mockResolvedValue({ kind: 'not_found' })
    const { POST } = await import('@/app/api/admin/events/[slug]/docusign-reissue/route')
    const res = await POST(req({ participantId: ID }), slugCtx())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Participant not found for this event' })
    expect(state.reissue.mock.calls[0][2]).toEqual({ eventSlug: SLUG, allowNewEnvelope: false })
    expect(state.logActivity).not.toHaveBeenCalled()
  })

  it('writes the activity log as today, and the write after a load is by id', async () => {
    state.rows.registrations = [REGISTRATION({ teacher_member_id: 'teacher' })]
    const { POST } = await import('@/app/api/admin/events/[slug]/invoice-paid/route')
    expect((await POST(req({ registrationId: ID, paid: true }), slugCtx())).status).toBe(200)
    expect(queries('registrations').find((q) => q.op === 'update')?.filters).toEqual([['eq', 'id', ID]])
    expect(state.logActivity).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'teacher', action: 'invoice_marked_paid' }), expect.anything())
  })

  it('a manager is not stopped from removing a stored attachment', async () => {
    asEventManager(SLUG)
    state.rows.event_emails = [EMAIL({ attachments: [{ path: `event-email/${SLUG}/1-file`, filename: 'f', size: 1, contentType: 'x' }] })]
    const { DELETE } = await import('@/app/api/admin/events/[slug]/emails/[id]/route')
    expect((await DELETE(req({}, 'DELETE'), idCtx())).status).toBe(200)
    expect(state.storageRemoved).toEqual([[`event-email/${SLUG}/1-file`]])
  })

  it('a guardian correction keeps its order, and its member write\'s guard', async () => {
    state.rows.participants = [
      {
        id: ID,
        tenant_id: STELLR_TENANT_ID,
        member_id: 'm',
        emergency_contact_email: 'old@example.invalid',
        event_role: 'student',
        date_of_birth: '2010-01-01',
        registrations: { event_slug: SLUG, school_address_state: 'NV' },
      },
    ]
    state.reissue.mockResolvedValue({ kind: 'reissued', outcome: 'issued' })
    const { POST } = await import('@/app/api/admin/events/[slug]/participants/[pid]/guardian/route')
    const res = await POST(req({ email: 'new@example.invalid' }), { params: Promise.resolve({ slug: SLUG, pid: ID }) })
    expect(await res.json()).toEqual({ saved: true, outcome: 'issued' })
    expect(queries('participants').find((q) => q.op === 'update')?.filters).toEqual([['eq', 'id', ID]])
    expect(queries('members').find((q) => q.op === 'update')?.filters).toEqual([['eq', 'id', 'm'], ['eq', 'ec_email', 'old@example.invalid']])
    expect(state.reissue).toHaveBeenCalledTimes(1)
    expect(state.reissue.mock.calls[0][2]).toEqual({ eventSlug: SLUG, allowNewEnvelope: true })
  })
})

describe('a record of another event, inside the caller\'s own event', () => {
  const FOREIGN_EVENT = 'texas'
  type Case = [string, () => Promise<Response>, string]
  const CASES: Case[] = [
    ['edit an email', async () => (await import('@/app/api/admin/events/[slug]/emails/[id]/route')).PATCH(req({ name: 'x' }, 'PATCH'), idCtx()), 'Email not found'],
    ['delete an email', async () => (await import('@/app/api/admin/events/[slug]/emails/[id]/route')).DELETE(req({}, 'DELETE'), idCtx()), 'Email not found'],
    ['copy an email', async () => (await import('@/app/api/admin/events/[slug]/emails/route')).POST(req({ duplicateOf: ID }), slugCtx()), 'Email not found'],
    ['send an email', async () => (await import('@/app/api/admin/events/[slug]/emails/[id]/send/route')).POST(req({}), idCtx()), 'Email not found'],
    ['preview an email', async () => (await import('@/app/api/admin/events/[slug]/emails/[id]/preview/route')).GET(req(), idCtx()), 'Email not found'],
    ['read a catch-up', async () => (await import('@/app/api/admin/events/[slug]/emails/[id]/catch-up/route')).GET(req(), idCtx()), 'Email not found'],
    ['send a catch-up', async () => (await import('@/app/api/admin/events/[slug]/emails/[id]/catch-up/route')).POST(req({}), idCtx()), 'Email not found'],
    [
      'attach a file',
      async () =>
        (await import('@/app/api/admin/events/[slug]/emails/[id]/attachments/route')).POST(req({ storagePath: `event-email/${SLUG}/1-f`, filename: 'f.pdf' }), idCtx()),
      'Email not found',
    ],
  ]

  for (const who of ['an admin', 'the event\'s manager'] as const) {
    for (const mode of ['', 'enforce'] as const) {
      it.each(CASES)(`${who}, mode "${mode}": %s answers as a missing one`, async (_name, run, error) => {
        if (who !== 'an admin') asEventManager(SLUG)
        vi.stubEnv('LOADSCOPED_MODE', mode)
        state.sanityEvent = { title: 'Nevada' }
        state.rows.event_emails = [EMAIL({ event_slug: FOREIGN_EVENT })]
        const res = await run()
        expect(res.status).toBe(404)
        expect(await res.json()).toEqual({ error })
        expect(queries('event_emails').filter((q) => q.op !== 'select')).toEqual([])
        expect(state.sendEventEmail).not.toHaveBeenCalled()
        expect(state.sendCatchUp).not.toHaveBeenCalled()
        expect(state.catchUpStatus).not.toHaveBeenCalled()
        expect(state.resolveAudience).not.toHaveBeenCalled()
        expect(state.claimUpload).not.toHaveBeenCalled()
      })
    }
  }

  it.each(['', 'enforce'] as const)('mode "%s": a pay link and a paid mark stop at the registration', async (mode) => {
    asEventManager(SLUG)
    vi.stubEnv('LOADSCOPED_MODE', mode)
    state.sanityEvent = { title: 'Nevada' }
    state.rows.registrations = [REGISTRATION({ event_slug: FOREIGN_EVENT })]
    const link = await import('@/app/api/admin/events/[slug]/payment-link/route')
    const paid = await import('@/app/api/admin/events/[slug]/invoice-paid/route')
    for (const res of [await link.POST(req({ registrationId: ID }), slugCtx()), await paid.POST(req({ registrationId: ID, paid: true }), slugCtx())]) {
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Registration not found for this event' })
    }
    expect(state.sendPayLinkEmail).not.toHaveBeenCalled()
    expect(queries('registrations').filter((q) => q.op === 'update')).toEqual([])
    expect(state.logActivity).not.toHaveBeenCalled()
  })

  it('a guardian correction stops at the participant, before any write or form', async () => {
    asEventManager(SLUG)
    state.rows.participants = [{ id: ID, member_id: 'm', registrations: { event_slug: FOREIGN_EVENT, school_address_state: null } }]
    const { POST } = await import('@/app/api/admin/events/[slug]/participants/[pid]/guardian/route')
    const res = await POST(req({ email: 'new@example.invalid' }), { params: Promise.resolve({ slug: SLUG, pid: ID }) })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Participant not found for this event' })
    expect(queries('participants').filter((q) => q.op === 'update')).toEqual([])
    expect(queries('members').filter((q) => q.op === 'update')).toEqual([])
    expect(state.reissue).not.toHaveBeenCalled()
  })

  it('a survey resend stops at an invitation of another distribution', async () => {
    asEventManager(SLUG)
    state.distributionForEvent.mockResolvedValue({ id: ID, status: 'open', definition_id: 'd' })
    state.rows.survey_invitations = [{ id: OTHER_ID, distribution_id: 'another' }]
    const { POST } = await import('@/app/api/admin/events/[slug]/survey/route')
    const res = await POST(req({ action: 'resend', invitationId: OTHER_ID }), slugCtx())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    expect(state.resendInvitation).not.toHaveBeenCalled()
  })

  it('a survey resend still sends for an invitation of this distribution', async () => {
    state.distributionForEvent.mockResolvedValue({ id: ID, status: 'open', definition_id: 'd' })
    state.rows.survey_invitations = [{ id: OTHER_ID, distribution_id: ID }]
    const { POST } = await import('@/app/api/admin/events/[slug]/survey/route')
    expect((await POST(req({ action: 'resend', invitationId: OTHER_ID }), slugCtx())).status).toBe(200)
    expect(state.resendInvitation).toHaveBeenCalledTimes(1)
  })
})

describe('whether the URL\'s event is in the scope', () => {
  const run = async (slug = SLUG) => (await import('@/app/api/admin/events/[slug]/export/route')).GET(req(), slugCtx(slug))

  describe('under LOADSCOPED_MODE=enforce, for Stellr', () => {
    beforeEach(() => {
      vi.stubEnv('LOADSCOPED_MODE', 'enforce')
    })

    it('its own mirrored event runs', async () => {
      state.rows.events = [{ slug: SLUG, tenant_id: STELLR_TENANT_ID }]
      expect((await run()).status).toBe(200)
    })

    it('an event only Sanity knows runs: it is Stellr\'s, as the derivation trigger reads it', async () => {
      state.sanityEvent = { title: 'Nevada' }
      expect((await run()).status).toBe(200)
    })

    it('another tenant\'s event, an unknown slug and a failed read all answer one 404, and read no roster', async () => {
      state.rows.events = [{ slug: SLUG, tenant_id: TENANT }]
      const foreign = await run()
      state.rows.events = []
      const unknown = await run()
      state.rows.events = [{ slug: SLUG, tenant_id: STELLR_TENANT_ID }]
      state.failEvents = true
      const failed = await run()
      const malformed = await run('a,b')
      const bodies = await Promise.all([foreign, unknown, failed, malformed].map(async (r) => [r.status, await r.text()]))
      expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1)
      expect(bodies[0][0]).toBe(404)
      expect(state.getEventRoster).not.toHaveBeenCalled()
    })
  })

  it('shadow runs today\'s path whatever the mirror says, and logs a no', async () => {
    vi.stubEnv('LOADSCOPED_MODE', 'shadow')
    const errors = await import('@/lib/app-errors')
    const logged = vi.spyOn(errors, 'captureRequestError').mockResolvedValue(undefined as never)
    state.rows.events = [{ slug: SLUG, tenant_id: TENANT }]
    expect((await run()).status).toBe(200)
    expect(state.getEventRoster).toHaveBeenCalledTimes(1)
    expect(logged).toHaveBeenCalledTimes(1)
    logged.mockClear()
    state.rows.events = [{ slug: SLUG, tenant_id: STELLR_TENANT_ID }]
    expect((await run()).status).toBe(200)
    expect(logged).not.toHaveBeenCalled()
    logged.mockRestore()
  })
})

describe('a tenant\'s staff', () => {
  beforeEach(() => {
    asTenantAdmin()
  })

  const OWN = 'own'
  type Case = [string, () => Promise<Response>]
  const REFUSED: Case[] = [
    ['send an email', async () => (await import('@/app/api/admin/events/[slug]/emails/[id]/send/route')).POST(req({}), idCtx(OWN))],
    ['send a test copy', async () => (await import('@/app/api/admin/events/[slug]/emails/[id]/send/route')).POST(req({ test: true }), idCtx(OWN))],
    ['preview an audience', async () => (await import('@/app/api/admin/events/[slug]/emails/[id]/preview/route')).GET(req(), idCtx(OWN))],
    ['read a catch-up', async () => (await import('@/app/api/admin/events/[slug]/emails/[id]/catch-up/route')).GET(req(), idCtx(OWN))],
    ['send a catch-up', async () => (await import('@/app/api/admin/events/[slug]/emails/[id]/catch-up/route')).POST(req({}), idCtx(OWN))],
    ['attach a file', async () => (await import('@/app/api/admin/events/[slug]/emails/[id]/attachments/route')).POST(req({ storagePath: `event-email/${OWN}/1-f`, filename: 'f.pdf' }), idCtx(OWN))],
    ['schedule an email', async () => (await import('@/app/api/admin/events/[slug]/emails/[id]/route')).PATCH(req({ status: 'scheduled' }, 'PATCH'), idCtx(OWN))],
    ['open the survey tab', async () => (await import('@/app/api/admin/events/[slug]/survey/route')).GET(req(), slugCtx(OWN))],
    ['send the survey', async () => (await import('@/app/api/admin/events/[slug]/survey/route')).POST(req({ action: 'send_now' }), slugCtx(OWN))],
    ['reissue an agreement', async () => (await import('@/app/api/admin/events/[slug]/docusign-reissue/route')).POST(req({ participantId: ID }), slugCtx(OWN))],
    [
      'correct a guardian',
      async () => (await import('@/app/api/admin/events/[slug]/participants/[pid]/guardian/route')).POST(req({ email: 'x@example.invalid' }), { params: Promise.resolve({ slug: OWN, pid: ID }) }),
    ],
    ['send reminders', async () => (await import('@/app/api/admin/events/[slug]/remind/route')).POST(req({ payment: true }), slugCtx(OWN))],
    ['send a pay link', async () => (await import('@/app/api/admin/events/[slug]/payment-link/route')).POST(req({ registrationId: ID }), slugCtx(OWN))],
    ['mark an invoice paid', async () => (await import('@/app/api/admin/events/[slug]/invoice-paid/route')).POST(req({ registrationId: ID, paid: true }), slugCtx(OWN))],
    ['read background reports', async () => (await import('@/app/api/admin/events/[slug]/background-reports/route')).GET(req(), slugCtx(OWN))],
    ['send a team profile', async () => (await import('@/app/api/admin/events/[slug]/team-profiles/route')).POST(req({ all: true }), slugCtx(OWN))],
    ['list volunteers', async () => (await import('@/app/api/admin/events/[slug]/volunteers/route')).GET(req(), slugCtx(OWN))],
    ['assign a volunteer', async () => (await import('@/app/api/admin/events/[slug]/volunteers/route')).POST(req({ memberId: ID }), slugCtx(OWN))],
    ['remove a volunteer', async () => (await import('@/app/api/admin/events/[slug]/volunteers/route')).DELETE(req({ memberId: ID }, 'DELETE'), slugCtx(OWN))],
    ['issue a PD credential', async () => (await import('@/app/api/admin/events/[slug]/pd-credentials/route')).POST(req({ memberId: ID, hours: 2 }), slugCtx(OWN))],
  ]

  it.each(REFUSED)('%s on their own event is refused, and nothing leaves Stellr\'s accounts', async (_name, run) => {
    state.rows.event_emails = [EMAIL({ event_slug: OWN, tenant_id: TENANT })]
    state.rows.registrations = [REGISTRATION({ event_slug: OWN, tenant_id: TENANT })]
    state.rows.participants = [{ id: ID, member_id: 'm', registrations: { event_slug: OWN, school_address_state: null } }]
    const res = await run()
    expect(res.status).toBe(503)
    for (const f of [
      state.sendEventEmail,
      state.sendCatchUp,
      state.catchUpStatus,
      state.resolveAudience,
      state.sendEmail,
      state.sendPayLinkEmail,
      state.reissue,
      state.adminSurveyView,
      state.resendTeamProfile,
      state.resendOutstanding,
      state.dispatchVolunteerAgreement,
      state.issueCredential,
      state.loadEventMentors,
      state.claimUpload,
      state.logActivity,
    ]) expect(f).not.toHaveBeenCalled()
    for (const table of ['event_emails', 'registrations', 'participants', 'members', 'cohort_members', 'event_participations', 'survey_distributions']) {
      expect(queries(table).filter((q) => q.op !== 'select'), table).toEqual([])
    }
  })

  it('reads and edits their own event\'s drafts, with the tenant\'s filter on every query', async () => {
    state.rows.event_emails = [EMAIL({ event_slug: OWN, tenant_id: TENANT }), EMAIL({ id: OTHER_ID, event_slug: OWN, tenant_id: STELLR_TENANT_ID })]
    const list = await import('@/app/api/admin/events/[slug]/emails/route')
    const body = await (await list.GET(req(), slugCtx(OWN))).json()
    expect(body.emails.map((e: Row) => e.id)).toEqual([ID])

    const one = await import('@/app/api/admin/events/[slug]/emails/[id]/route')
    expect((await one.PATCH(req({ name: 'New' }, 'PATCH'), idCtx(OWN))).status).toBe(200)
    expect(queries('event_emails').find((q) => q.op === 'update')?.filters).toContainEqual(['eq', 'tenant_id', TENANT])
    expect((await one.DELETE(req({}, 'DELETE'), idCtx(OWN))).status).toBe(200)
    expect(queries('event_emails').find((q) => q.op === 'delete')?.filters).toContainEqual(['eq', 'tenant_id', TENANT])
  })

  it('deletes only what is in their own storage folder', async () => {
    const own = `${TENANT}/event-email/${OWN}/1-file`
    const legacy = `event-email/${OWN}/2-file`
    const foreign = `${STELLR_TENANT_ID}/event-email/${OWN}/3-file`
    const attachments = [own, legacy, foreign].map((path) => ({ path, filename: 'f', size: 1, contentType: 'x' }))
    state.rows.event_emails = [EMAIL({ event_slug: OWN, tenant_id: TENANT, attachments })]
    const { DELETE } = await import('@/app/api/admin/events/[slug]/emails/[id]/route')
    expect((await DELETE(req({}, 'DELETE'), idCtx(OWN))).status).toBe(200)
    expect(state.storageRemoved).toEqual([[own]])
  })

  it('a refused schedule touches no stored file', async () => {
    const own = `${TENANT}/event-email/${OWN}/1-file`
    state.rows.event_emails = [EMAIL({ event_slug: OWN, tenant_id: TENANT, attachments: [{ path: own, filename: 'f', size: 1, contentType: 'x' }] })]
    const { PATCH } = await import('@/app/api/admin/events/[slug]/emails/[id]/route')
    expect((await PATCH(req({ status: 'scheduled', attachments: [] }, 'PATCH'), idCtx(OWN))).status).toBe(503)
    expect(state.storageRemoved).toEqual([])
  })

  it('exports their own event, and sees PD credentials they cannot issue', async () => {
    const out = await import('@/app/api/admin/events/[slug]/export/route')
    expect((await out.GET(req(), slugCtx(OWN))).status).toBe(200)
    state.rows.credentials = [
      { id: 'mine', event_slug: OWN, source: 'pd', tenant_id: TENANT },
      { id: 'theirs', event_slug: OWN, source: 'pd', tenant_id: STELLR_TENANT_ID },
    ]
    const pd = await import('@/app/api/admin/events/[slug]/pd-credentials/route')
    const body = await (await pd.GET(req(), slugCtx(OWN))).json()
    expect(body.credentials.map((c: Row) => c.id)).toEqual(['mine'])
    expect(body.canIssue).toBe(false)
  })

  it('Stellr\'s event and an event nobody knows answer one 404, on a read and on a write', async () => {
    state.sanityEvent = { title: 'A Sanity document proves nothing for a tenant' }
    const { GET, POST } = await import('@/app/api/admin/events/[slug]/emails/route')
    const answers = [
      await GET(req(), slugCtx(SLUG)),
      await GET(req(), slugCtx('nobody-knows')),
      await POST(req({ templateKey: 'blank' }), slugCtx(SLUG)),
      await POST(req({ templateKey: 'blank' }), slugCtx('nobody-knows')),
    ]
    const bodies = await Promise.all(answers.map(async (r) => JSON.stringify([r.status, await r.text()])))
    expect(new Set(bodies).size).toBe(1)
    expect(answers[0].status).toBe(404)
    expect(queries('event_emails')).toEqual([])
  })
})

describe('the roster export, on the real roster', () => {
  const participant = (id: string, first: string) => ({
    id,
    member_id: null,
    first_name: first,
    last_name: 'P',
    email: `${id}@example.invalid`,
    event_role: 'participant',
    date_of_birth: '2010-01-01',
    dietary_requirements: [],
  })
  const seed = () => {
    const registration = (id: string, tenant: string | null, person: Row) => ({
      id,
      event_slug: 'own',
      tenant_id: tenant,
      type: 'individual',
      status: 'confirmed',
      participants: [person],
    })
    state.rows.registrations = [
      registration('reg-t', TENANT, participant('p-t', 'Tenant')),
      registration('reg-s', STELLR_TENANT_ID, participant('p-s', 'Stamped')),
      registration('reg-n', null, participant('p-n', 'Unstamped')),
    ]
    state.rows.scholarship_applications = [
      { id: 'o-s', event_slug: 'own', tenant_id: STELLR_TENANT_ID, status: 'offered', first_name: 'Offer', last_name: 'S', email: 'o@example.invalid', percent_off: 50, registration_id: null },
    ]
  }
  const useRealRoster = async () => {
    const real = await vi.importActual<typeof import('@/lib/event-admin')>('@/lib/event-admin')
    state.getEventRoster.mockImplementation(real.getEventRoster as never)
  }
  const run = async (slug: string) => (await import('@/app/api/admin/events/[slug]/export/route')).GET(req(), slugCtx(slug))
  const SLUG_KEYED = ['registrations', 'agreements', 'scholarship_applications', 'event_refunds', 'team_profiles']

  it("a tenant's export holds only that tenant's rows, on every read the slug keys", async () => {
    asTenantAdmin()
    seed()
    await useRealRoster()
    const res = await run('own')
    expect(res.status).toBe(200)
    const csv = await res.text()
    expect(csv).toContain('Tenant')
    expect(csv).not.toContain('Stamped')
    expect(csv).not.toContain('Unstamped')
    for (const table of SLUG_KEYED) {
      const reads = queries(table)
      expect(reads.length, table).toBeGreaterThan(0)
      for (const q of reads) expect(q.filters, table).toContainEqual(['eq', 'tenant_id', TENANT])
    }
  })

  it("with the filter, another tenant's registration and offer are not in the roster", async () => {
    seed()
    const real = await vi.importActual<typeof import('@/lib/event-admin')>('@/lib/event-admin')
    const roster = await real.getEventRoster('own', undefined, { tenant: { column: 'tenant_id', value: TENANT, includeNull: false } })
    expect(roster.scholarshipOffers).toEqual([])
    expect(roster.groups.map((g) => g.registrationId)).toEqual(['reg-t'])
  })

  it('Stellr with the mode off reads as today, with no tenant filter on any read', async () => {
    seed()
    await useRealRoster()
    const csv = await (await run('own')).text()
    for (const name of ['Tenant', 'Stamped', 'Unstamped']) expect(csv).toContain(name)
    expect(queries('registrations')[0].filters).toEqual([['eq', 'event_slug', 'own'], ['neq', 'status', 'withdrawn']])
    expect(queries('agreements')[0].filters).toEqual([['eq', 'event_slug', 'own']])
    expect(queries('scholarship_applications')[0].filters).toEqual([['eq', 'event_slug', 'own'], ['eq', 'status', 'offered']])
    expect(queries('team_profiles')[0].filters).toEqual([['eq', 'event_slug', 'own'], ['not', 'submitted_at', ['is', null]]])
    expect(queries('event_refunds').map((q) => q.filters[0])).toEqual([['eq', 'event_slug', 'own'], ['eq', 'event_slug', 'own']])
    for (const q of queries('event_refunds')) expect(q.filters.some(([, col]) => col.startsWith('tenant_id'))).toBe(false)
  })

  it("Stellr enforced keeps its own rows and the unstamped ones, and not another tenant's", async () => {
    vi.stubEnv('LOADSCOPED_MODE', 'enforce')
    seed()
    state.rows.events = [{ slug: 'own', tenant_id: STELLR_TENANT_ID }]
    ;(state.rows.registrations as Row[])[0].tenant_id = TENANT
    await useRealRoster()
    const csv = await (await run('own')).text()
    expect(csv).toContain('Stamped')
    expect(csv).toContain('Unstamped')
    expect(csv).not.toContain('Tenant')
  })

  it("media answers are Stellr's: a tenant reads no shared record and gets check for everyone", async () => {
    asTenantAdmin()
    state.mediaForParticipants.mockResolvedValue(new Map([['p-t', { status: 'yes', reason: 'default' }]]))
    state.getEventRoster.mockResolvedValue({ groups: [{ type: 'individual', groupLabel: null, participants: [{ ...participant('p-t', 'Tenant'), paid: true }] }] })
    const csv = await (await run('own')).text()
    expect(state.mediaForParticipants).not.toHaveBeenCalled()
    expect(csv).toContain('check')
    expect(csv).toContain('Not available for your organisation yet')
    expect(csv).not.toContain('No opt-out on file')
  })

  it('Stellr still gets its media answer and its reason', async () => {
    state.mediaForParticipants.mockResolvedValue(new Map([['p-s', { status: 'yes', reason: 'default' }]]))
    state.getEventRoster.mockResolvedValue({ groups: [{ type: 'individual', groupLabel: null, participants: [{ ...participant('p-s', 'Stamped'), paid: true }] }] })
    const csv = await (await run(SLUG)).text()
    expect(state.mediaForParticipants).toHaveBeenCalledTimes(1)
    expect(csv).toContain(',yes,No opt-out on file')
  })

  it('the reminder asks for the same filter, which off leaves out', async () => {
    state.sanityEvent = { title: 'Nevada', date: '2026-12-01' }
    const { POST } = await import('@/app/api/admin/events/[slug]/remind/route')
    await POST(req({ payment: true }), slugCtx())
    expect(state.getEventRoster).toHaveBeenLastCalledWith(SLUG, '2026-12-01', { tenant: null })
    vi.stubEnv('LOADSCOPED_MODE', 'enforce')
    state.rows.events = [{ slug: SLUG, tenant_id: STELLR_TENANT_ID }]
    await POST(req({ payment: true }), slugCtx())
    expect(state.getEventRoster).toHaveBeenLastCalledWith(SLUG, '2026-12-01', { tenant: { column: 'tenant_id', value: STELLR_TENANT_ID, includeNull: true } })
  })
})

describe('under AUTHZ_SOURCE=postgres, with LOADSCOPED_MODE off', () => {
  const asStellrTenantAdmin = () => {
    state.session = { userId: 'user_stellr', sessionClaims: { metadata: { role: 'student' } } }
    vi.stubEnv('AUTHZ_SOURCE', 'postgres')
    state.rows.members = [{ id: 'm', clerk_user_id: 'user_stellr' }]
    state.rows.tenant_memberships = [{ clerk_user_id: 'user_stellr', member_id: 'm', tenant_id: STELLR_TENANT_ID, role: 'tenant_admin' }]
    state.rows.tenants = [{ id: STELLR_TENANT_ID, status: 'active' }]
    state.rows.events = [{ slug: 'theirs', tenant_id: TENANT }, { slug: SLUG, tenant_id: STELLR_TENANT_ID }]
  }
  const run = async (slug: string) => (await import('@/app/api/admin/events/[slug]/export/route')).GET(req(), slugCtx(slug))

  it("a Stellr admin stops at another tenant's event, with the answer a missing one gets", async () => {
    asStellrTenantAdmin()
    const res = await run('theirs')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    expect(state.getEventRoster).not.toHaveBeenCalled()
  })

  it('and keeps their own event, and one the mirror does not hold', async () => {
    asStellrTenantAdmin()
    expect((await run(SLUG)).status).toBe(200)
    expect((await run('not-mirrored')).status).toBe(200)
    expect(state.getEventRoster).toHaveBeenCalledTimes(2)
  })

  it('a failed read of the event refuses', async () => {
    asStellrTenantAdmin()
    state.failEvents = true
    expect((await run(SLUG)).status).toBe(404)
    expect(state.getEventRoster).not.toHaveBeenCalled()
  })

  it('shadow still answers from Clerk', async () => {
    vi.stubEnv('AUTHZ_SOURCE', 'shadow')
    state.rows.events = [{ slug: 'theirs', tenant_id: TENANT }]
    expect((await run('theirs')).status).toBe(200)
  })

  it("shadow logs the event's tenant disagreeing, and only then, before the flip makes it a refusal", async () => {
    asStellrTenantAdmin()
    state.session = { userId: 'user_stellr', sessionClaims: { metadata: { role: 'admin' } } }
    vi.stubEnv('AUTHZ_SOURCE', 'shadow')
    const errors = await import('@/lib/app-errors')
    const logged = vi.spyOn(errors, 'recordBuiltAppError').mockResolvedValue(true as never)
    try {
      expect((await run('theirs')).status).toBe(200)
      const messages = logged.mock.calls.map((c) => String(c[1]))
      expect(messages.filter((m) => m.startsWith('authz_mismatch event_access'))).toHaveLength(1)
      expect(messages.find((m) => m.startsWith('authz_mismatch event_access'))).toContain('postgres=deny_403')
      logged.mockClear()
      expect((await run(SLUG)).status).toBe(200)
      expect((await run('not-mirrored')).status).toBe(200)
      expect(logged).not.toHaveBeenCalled()
    } finally {
      logged.mockRestore()
    }
  })
})

describe('stored attachments follow the row', () => {
  const PATH = `event-email/${SLUG}/1-file`
  const stored = () => EMAIL({ attachments: [{ path: PATH, filename: 'f', size: 1, contentType: 'x' }] })
  const route = () => import('@/app/api/admin/events/[slug]/emails/[id]/route')

  it.each<[string, Row, number]>([
    ['an unknown status', { attachments: [], status: 'bogus' }, 400],
    ['a schedule with no subject', { attachments: [], status: 'scheduled', subject: ' ' }, 400],
    ['an unknown group', { attachments: [], audiences: ['nobody'] }, 400],
  ])('%s removes nothing', async (_name, body, status) => {
    state.rows.event_emails = [stored()]
    const res = await (await route()).PATCH(req(body, 'PATCH'), idCtx())
    expect(res.status).toBe(status)
    expect(state.storageRemoved).toEqual([])
  })

  it('an edit that loses to a send removes nothing', async () => {
    state.rows.event_emails = [stored()]
    state.missWritesTo = 'event_emails'
    const res = await (await route()).PATCH(req({ attachments: [] }, 'PATCH'), idCtx())
    expect(res.status).toBe(409)
    expect(state.storageRemoved).toEqual([])
  })

  it('a save that fails removes nothing', async () => {
    state.rows.event_emails = [stored()]
    state.failWritesTo = 'event_emails'
    const res = await (await route()).PATCH(req({ attachments: [] }, 'PATCH'), idCtx())
    expect(res.status).toBe(500)
    expect(state.storageRemoved).toEqual([])
  })

  it('a saved edit removes the file it dropped, and writes only while the email can be edited', async () => {
    state.rows.event_emails = [stored()]
    const res = await (await route()).PATCH(req({ attachments: [] }, 'PATCH'), idCtx())
    expect(res.status).toBe(200)
    expect(state.storageRemoved).toEqual([[PATH]])
    const write = queries('event_emails').find((q) => q.op === 'update')
    expect(write?.filters).toEqual([['eq', 'id', ID], ['in', 'status', ['draft', 'scheduled', 'cancelled']]])
    expect(write?.payload).toEqual({ attachments: [] })
  })

  it('a delete writes only while the email can be edited, and takes its files', async () => {
    state.rows.event_emails = [stored()]
    expect((await (await route()).DELETE(req({}, 'DELETE'), idCtx())).status).toBe(200)
    expect(queries('event_emails').find((q) => q.op === 'delete')?.filters).toEqual([['eq', 'id', ID], ['in', 'status', ['draft', 'scheduled', 'cancelled']]])
    expect(state.storageRemoved).toEqual([[PATH]])
  })

  it('a delete that loses to a send answers as today and keeps the files', async () => {
    state.rows.event_emails = [stored()]
    state.missWritesTo = 'event_emails'
    const res = await (await route()).DELETE(req({}, 'DELETE'), idCtx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(state.storageRemoved).toEqual([])
  })
})

// The queries that moved to lib/events/admin-records.ts, the admin-only branches and the
// guards on a write, each named filter by filter: the statement is that these stayed as they were.
describe('the helpers without a tenant filter', () => {
  it("hand out their client in Stellr's scope only, so a route that stops refusing a tenant cannot reach them", async () => {
    const { stellrOnlyDb } = await import('@/lib/events/admin-records')
    const db = {} as never
    expect(stellrOnlyDb({ tenantId: STELLR_TENANT_ID }, db)).toBe(db)
    expect(() => stellrOnlyDb({ tenantId: TENANT }, db)).toThrow()
  })

  it('every one but the email copy takes that client', () => {
    const src = readFileSync('lib/events/admin-records.ts', 'utf8')
    const exported = [...src.matchAll(/export async function (\w+)\(\s*db: (\w+)/g)].map((m) => [m[1], m[2]])
    expect(exported.length).toBeGreaterThan(0)
    for (const [name, type] of exported) expect([name, type]).toEqual([name, name === 'insertEventEmailCopy' ? 'SupabaseClient' : 'StellrOnlyDb'])
  })
})

describe('what moved stayed as it was', () => {
  it('a copy is a fresh draft, with no attachments', async () => {
    state.rows.event_emails = [EMAIL({ status: 'sent', template_key: 't', resend_docusign: true, attachments: [{ path: 'p', filename: 'f', size: 1, contentType: 'x' }] })]
    const { POST } = await import('@/app/api/admin/events/[slug]/emails/route')
    expect((await POST(req({ duplicateOf: ID }), slugCtx())).status).toBe(201)
    expect(queries('event_emails').find((q) => q.op === 'insert')?.payload).toEqual({
      event_slug: SLUG,
      name: 'E (copy)',
      template_key: 't',
      audiences: ['all'],
      subject: 'S',
      body_json: null,
      attachments: [],
      resend_docusign: true,
      schedule_days_before: 3,
      status: 'draft',
      created_by: 'Admin',
    })
  })

  it("a pay link's note names the teacher, and only without one a linked member", async () => {
    const { POST } = await import('@/app/api/admin/events/[slug]/payment-link/route')
    state.rows.registrations = [REGISTRATION({ invoice_requested: false, teacher_member_id: 'teacher' })]
    state.rows.participants = [{ registration_id: ID, member_id: 'linked' }]
    expect((await POST(req({ registrationId: ID }), slugCtx())).status).toBe(200)
    expect(state.logActivity.mock.calls[0][0]).toMatchObject({ memberId: 'teacher' })
    expect(queries('participants')).toEqual([])

    state.logActivity.mockClear()
    state.rows.registrations = [REGISTRATION({ invoice_requested: false })]
    expect((await POST(req({ registrationId: ID }), slugCtx())).status).toBe(200)
    expect(state.logActivity.mock.calls[0][0]).toMatchObject({ memberId: 'linked' })
    const linked = queries('participants')[0]
    expect(linked.filters).toEqual([['eq', 'registration_id', ID], ['not', 'member_id', ['is', null]]])
    expect(linked.limit).toBe(1)
  })

  it('a paid mark is refused on a registration not paid by invoice', async () => {
    state.rows.registrations = [REGISTRATION({ invoice_requested: false })]
    const { POST } = await import('@/app/api/admin/events/[slug]/invoice-paid/route')
    const res = await POST(req({ registrationId: ID, paid: true }), slugCtx())
    expect(res.status).toBe(400)
    expect(queries('registrations').filter((q) => q.op === 'update')).toEqual([])
  })

  describe('a guardian correction', () => {
    const PARTICIPANT = (previous: string | null) => ({
      id: ID,
      tenant_id: STELLR_TENANT_ID,
      member_id: 'm',
      emergency_contact_email: previous,
      event_role: 'student',
      date_of_birth: '2010-01-01',
      registrations: { event_slug: SLUG, school_address_state: 'NV' },
    })
    const run = async () =>
      (await import('@/app/api/admin/events/[slug]/participants/[pid]/guardian/route')).POST(req({ email: 'new@example.invalid' }), { params: Promise.resolve({ slug: SLUG, pid: ID }) })

    it('looks for a live form that really went out', async () => {
      state.rows.participants = [PARTICIPANT('old@example.invalid')]
      state.reissue.mockResolvedValue({ kind: 'reissued', outcome: 'issued' })
      await run()
      expect(queries('agreements')[0].filters).toEqual([
        ['eq', 'participant_id', ID],
        ['in', 'status', ['created', 'sent', 'delivered']],
        ['not', 'envelope_id', ['like', 'failed:%']],
      ])
    })

    it('with no address on file, changes the member record only while that is still empty', async () => {
      state.rows.participants = [PARTICIPANT(null)]
      state.reissue.mockResolvedValue({ kind: 'reissued', outcome: 'issued' })
      await run()
      expect(queries('members').find((q) => q.op === 'update')?.filters).toEqual([['eq', 'id', 'm'], ['is', 'ec_email', null]])
    })

    it('writes nothing more, and sends nothing, when the participant write fails', async () => {
      state.rows.participants = [PARTICIPANT('old@example.invalid')]
      state.failWritesTo = 'participants'
      const res = await run()
      expect(res.status).toBe(500)
      expect(queries('members').filter((q) => q.op === 'update')).toEqual([])
      expect(state.reissue).not.toHaveBeenCalled()
    })
  })

  describe('volunteers', () => {
    const route = () => import('@/app/api/admin/events/[slug]/volunteers/route')

    it('reads the event-level container, and who raised interest or is actively assigned', async () => {
      state.rows.mentoring_cohorts = [{ id: 'container' }]
      await (await route()).GET(req(), slugCtx())
      expect(queries('mentoring_cohorts')[0].filters).toEqual([
        ['eq', 'container_type', 'event_participation'],
        ['is', 'parent_container_id', null],
        ['eq', 'campaign_ref', SLUG],
      ])
      expect(queries('volunteer_event_interest')[0].filters).toEqual([['eq', 'event_slug', SLUG], ['eq', 'status', 'interested']])
      expect(queries('cohort_members')[0].filters).toEqual([['eq', 'cohort_id', 'container'], ['eq', 'relationship', 'volunteer'], ['eq', 'status', 'active']])
    })

    it('an assignment leaves an existing cohort row and history row alone', async () => {
      state.rows.event_participations = [{ id: 'competitor', member_id: ID, event_slug: SLUG, role: 'competitor' }]
      await (await route()).POST(req({ memberId: ID }), slugCtx())
      const upsert = queries('cohort_members').find((q) => q.op === 'upsert')
      expect(upsert?.payload).toEqual({ cohort_id: 'container', member_id: ID, relationship: 'volunteer', status: 'active' })
      expect(upsert?.options).toEqual({ onConflict: 'cohort_id,member_id', ignoreDuplicates: true })
      expect(queries('event_participations').filter((q) => q.op === 'insert')).toEqual([])
    })

    it('an assignment writes the history row when there is none', async () => {
      await (await route()).POST(req({ memberId: ID }), slugCtx())
      expect(queries('event_participations').find((q) => q.op === 'insert')?.payload).toMatchObject({ member_id: ID, event_slug: SLUG, role: 'volunteer', status: 'approved' })
    })

    it("a removal deletes the volunteer's rows and never a competitor's", async () => {
      state.rows.mentoring_cohorts = [{ id: 'container' }]
      await (await route()).DELETE(req({ memberId: ID }, 'DELETE'), slugCtx())
      expect(queries('cohort_members').find((q) => q.op === 'delete')?.filters).toEqual([['eq', 'cohort_id', 'container'], ['eq', 'member_id', ID], ['eq', 'relationship', 'volunteer']])
      expect(queries('event_participations').find((q) => q.op === 'delete')?.filters).toEqual([['eq', 'member_id', ID], ['eq', 'event_slug', SLUG], ['eq', 'role', 'volunteer']])
    })
  })

  describe('PD credentials', () => {
    const route = () => import('@/app/api/admin/events/[slug]/pd-credentials/route')

    it('list only the PD source, and an admin may issue where a manager may not', async () => {
      const { GET } = await route()
      expect((await (await GET(req(), slugCtx())).json()).canIssue).toBe(true)
      expect(queries('credentials')[0].filters).toEqual([['eq', 'event_slug', SLUG], ['eq', 'source', 'pd']])
      asEventManager(SLUG)
      expect((await (await GET(req(), slugCtx())).json()).canIssue).toBe(false)
    })

    it('a manager is refused the issue', async () => {
      asEventManager(SLUG)
      const res = await (await route()).POST(req({ memberId: ID, hours: 2 }), slugCtx())
      expect(res.status).toBe(403)
      expect(state.issueCredential).not.toHaveBeenCalled()
    })

    it("with no Sanity document, the title comes from this event's registrations", async () => {
      state.rows.members = [{ id: ID, first_name: 'A', last_name: 'B', email: 'a@example.invalid', is_active: true }]
      state.rows.registrations = [{ event_slug: SLUG, event_title: 'Stored title' }]
      expect((await (await route()).POST(req({ memberId: ID, hours: 2 }), slugCtx())).status).toBe(200)
      expect(queries('registrations')[0].filters).toEqual([['eq', 'event_slug', SLUG], ['not', 'event_title', ['is', null]]])
    })
  })

  describe('the survey tab', () => {
    const route = () => import('@/app/api/admin/events/[slug]/survey/route')
    const OPEN = { id: ID, status: 'open', definition_id: 'd' }

    it('tells the page whether the caller is an admin', async () => {
      const { GET } = await route()
      expect((await (await GET(req(), slugCtx())).json()).isAdmin).toBe(true)
      asEventManager(SLUG)
      expect((await (await GET(req(), slugCtx())).json()).isAdmin).toBe(false)
    })

    it.each([
      ['open_after_event', { action: 'open_after_event', acceptOlderMinorAgreements: false }],
      ['gate_certificate', { action: 'gate_certificate', on: true }],
      ['minor_agreement_override', { action: 'minor_agreement_override', on: true }],
    ])('a manager is refused %s, and it changes nothing', async (_name, body) => {
      asEventManager(SLUG)
      state.distributionForEvent.mockResolvedValue(OPEN)
      const res = await (await route()).POST(req(body), slugCtx())
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'Admins only.' })
      expect(queries('survey_distributions').filter((q) => q.op !== 'select')).toEqual([])
    })

    it('an admin gates the certificate on that distribution', async () => {
      state.distributionForEvent.mockResolvedValue(OPEN)
      expect((await (await route()).POST(req({ action: 'gate_certificate', on: true }), slugCtx())).status).toBe(200)
      const write = queries('survey_distributions').find((q) => q.op === 'update')
      expect(write?.filters).toEqual([['eq', 'id', ID]])
      expect(write?.payload).toEqual({ gate_certificate: true })
    })
  })

  it('a manager gets the clearance summary whatever they ask for, and an admin what they ask for', async () => {
    const mentor = { participantId: 'p', memberId: 'm', firstName: 'A', lastName: 'B' }
    state.loadEventMentors.mockResolvedValue([mentor] as never)
    const { GET } = await import('@/app/api/admin/events/[slug]/background-reports/route')
    const url = 'https://app.test/x?mode=checkr'
    await GET(new Request(url), slugCtx())
    expect(state.buildMentorReportPdf.mock.calls[0][0]).toMatchObject({ mode: 'checkr' })
    asEventManager(SLUG)
    await GET(new Request(url), slugCtx())
    expect(state.buildMentorReportPdf.mock.calls[1][0]).toMatchObject({ mode: 'summary' })
  })

  it('attaching a file writes only while the email can be edited', async () => {
    state.rows.event_emails = [EMAIL()]
    const { POST } = await import('@/app/api/admin/events/[slug]/emails/[id]/attachments/route')
    expect((await POST(req({ storagePath: `event-email/${SLUG}/1-f`, filename: 'f.pdf' }), idCtx())).status).toBe(200)
    expect(queries('event_emails').find((q) => q.op === 'update')?.filters).toEqual([['eq', 'id', ID], ['in', 'status', ['draft', 'scheduled', 'cancelled']]])
  })
})

describe('audit, behind its flag', () => {
  const remind = async () => (await import('@/app/api/admin/events/[slug]/remind/route')).POST(req({ payment: true }), slugCtx())

  it.each<[string, string, () => Promise<Response>]>([
    ['reading a catch-up', 'event_email.catch_up.read', async () => (await import('@/app/api/admin/events/[slug]/emails/[id]/catch-up/route')).GET(req(), idCtx())],
    ['sending a catch-up', 'event_email.catch_up.send', async () => (await import('@/app/api/admin/events/[slug]/emails/[id]/catch-up/route')).POST(req({}), idCtx())],
  ])('%s is recorded as that action', async (_name, action, run) => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
    state.rows.event_emails = [EMAIL()]
    expect((await run()).status).toBe(200)
    await Promise.all(pending)
    expect(state.audits).toHaveLength(1)
    expect(state.audits[0]).toMatchObject({ action })
  })

  it('writes nothing with the flag off', async () => {
    state.sanityEvent = { title: 'Nevada' }
    expect((await remind()).status).toBe(200)
    await Promise.all(pending)
    expect(state.audits).toEqual([])
  })

  it('on, a mutation writes one event naming the actor, the chain and the event', async () => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
    state.sanityEvent = { title: 'Nevada' }
    expect((await remind()).status).toBe(200)
    await Promise.all(pending)
    expect(state.audits).toHaveLength(1)
    expect(state.audits[0]).toMatchObject({
      tenantId: STELLR_TENANT_ID,
      actor: 'user_admin',
      action: 'event.reminder.send',
      metadata: expect.objectContaining({ event_slug: SLUG, sent: 0, failed: 0, status: 200 }),
    })
  })

  it('on, a refusal writes none', async () => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
    asEventManager('texas')
    expect((await remind()).status).toBe(403)
    await Promise.all(pending)
    expect(state.audits).toEqual([])
  })
})
