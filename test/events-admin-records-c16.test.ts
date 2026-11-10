// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { auditHandlers } from '@/lib/security/audit-coverage'
import { ROUTE_MANIFEST } from '@/lib/security/route-manifest'
import { STELLR_ONLY_DISPOSITIONS } from '@/lib/security/stellr-only-dispositions'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// C16 (docs/TENANCY-S5.md): events admin routes that load a record by id.
//
// Who the personas in test/idor/idor-routes.test.ts cannot speak for is who a real request
// comes from under today's settings: a Clerk admin, or an event manager inside their event,
// with LOADSCOPED_MODE unset. So this drives real handlers under real lib/authz, and only
// Clerk and the database are stand-ins. The database records each query, because "off keeps
// today's reads" is a claim about the query and not about the answer.

const OTHER_TENANT = '11111111-1111-4111-8111-111111111111'
const ID = '22222222-2222-4222-8222-222222222222'

type Row = Record<string, unknown>
interface Query {
  table: string
  op: string
  select?: string
  filters: [string, string, unknown][]
}

const state = vi.hoisted(() => ({
  session: {} as Record<string, unknown>,
  assigned: [] as string[],
  rows: {} as Record<string, unknown>,
  queries: [] as unknown[],
  emails: [] as unknown[],
  audits: [] as unknown[],
  failReads: false,
  resolveRefundBasis: vi.fn(async (..._args: unknown[]) => null),
  logActivity: vi.fn(async (..._args: unknown[]) => {}),
  remindEnvelopeRow: vi.fn(async (..._args: unknown[]) => {}),
  applyGuardianOptOut: vi.fn(async (..._args: unknown[]) => 0),
  loadSignedRecord: vi.fn(async (..._args: unknown[]) => ({ kind: 'unavailable', reason: 'test' })),
  previewGroupSetup: vi.fn(async (..._args: unknown[]) => [{ step: 'invoice', needed: true, summary: 's' }]),
}))

function fakeDb() {
  const from = (table: string) => {
    const q: Query = { table, op: 'select', filters: [] }
    state.queries.push(q)
    const passes = (row: Row) =>
      q.filters.every(([kind, col, value]) => {
        if (kind === 'or') return !('tenant_id' in row) || row.tenant_id === STELLR_TENANT_ID || row.tenant_id == null
        if (col === 'id' || col.includes('.')) return true
        return !(col in row) || row[col] === value
      })
    const answer = () => {
      if (table === 'event_manager_assignments') {
        return state.assigned.map((event_slug) => ({ clerk_user_id: state.session.userId, event_slug, tenant_id: null }))
      }
      const row = state.rows[table]
      const list = (Array.isArray(row) ? row : row ? [row] : []) as Row[]
      return list.filter(passes)
    }
    const chain: Record<string, unknown> = {}
    chain.select = (cols?: string) => {
      if (cols) q.select = cols
      return chain
    }
    chain.update = () => {
      q.op = 'update'
      return chain
    }
    chain.delete = () => {
      q.op = 'delete'
      return chain
    }
    chain.upsert = () => {
      q.op = 'upsert'
      return chain
    }
    chain.eq = (col: string, value: unknown) => {
      q.filters.push(['eq', col, value])
      return chain
    }
    chain.in = (col: string, value: unknown) => {
      q.filters.push(['in', col, value])
      return chain
    }
    chain.or = (expr: string, opts?: unknown) => {
      q.filters.push(['or', expr, opts])
      return chain
    }
    for (const m of ['order', 'range', 'not', 'is', 'limit']) chain[m] = () => chain
    const failed = () => state.failReads && q.op === 'select'
    const DOWN = { data: null, error: { code: 'XX000', message: 'down' } }
    chain.maybeSingle = async () => (failed() ? DOWN : { data: answer()[0] ?? null, error: null })
    // As PostgREST does: .single() on no row is an error, where maybeSingle() is not.
    chain.single = async () => {
      if (failed()) return DOWN
      const row = answer()[0]
      return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }
    }
    chain.then = (resolve: (v: unknown) => unknown) => resolve(failed() ? DOWN : { data: answer(), error: null })
    return chain
  }
  return { from, rpc: async () => ({ data: null, error: null }) }
}

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => state.session,
  currentUser: async () => null,
  clerkClient: async () => ({ users: { getUserList: async () => ({ data: [] }) } }),
}))
vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  supabaseServer: () => fakeDb(),
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
vi.mock('@/lib/email', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendEmail: async (m: unknown) => {
    state.emails.push(m)
  },
  campaignBroadcastEmail: () => ({ subject: 's', html: 'h' }),
}))
vi.mock('@/lib/events/repo', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getEventBySlug: async () => null,
}))
vi.mock('@/lib/credentials', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  credentialState: () => 'valid',
}))
vi.mock('@/lib/credentials-notify', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recipientForCredential: async () => ({ email: 'holder@example.invalid' }),
  sendCredentialIssuedEmail: async () => true,
  applyGuardianOptOut: state.applyGuardianOptOut,
}))
vi.mock('@/lib/esign/operations', () => ({ remindEnvelopeRow: state.remindEnvelopeRow }))
vi.mock('@/lib/esign/archive', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadSignedRecord: state.loadSignedRecord,
  logRecordAccess: async () => {},
}))
vi.mock('@/lib/refunds/payment-basis', () => ({ resolveRefundBasis: state.resolveRefundBasis }))
// Only the preview is a stand-in, so a test can see whether the route reached it. Running
// the setup stays the real helper.
vi.mock('@/lib/group-registration-setup', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  previewGroupSetup: state.previewGroupSetup,
}))
vi.mock('@/lib/survey/withdraw', () => ({ withdrawQuote: vi.fn(async () => true) }))

let pending: Promise<unknown>[] = []
const flush = async () => {
  await Promise.all(pending.splice(0))
}

const asAdmin = () => {
  state.session = { userId: 'user_admin', sessionClaims: { metadata: { role: 'admin' } } }
  state.assigned = []
}
const asEventManager = (...slugs: string[]) => {
  state.session = { userId: 'user_em', sessionClaims: { metadata: { role: 'event_manager' } } }
  state.assigned = slugs
}
const asStudent = () => {
  state.session = { userId: 'user_student', sessionClaims: { metadata: { role: 'student' } } }
  state.assigned = []
}
const signedOut = () => {
  state.session = { userId: null, sessionClaims: null }
  state.assigned = []
}

const queries = (table: string) => (state.queries as Query[]).filter((q) => q.table === table)
const req = (body?: unknown, url = 'https://app.test/x') =>
  new Request(url, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const idCtx = { params: Promise.resolve({ id: ID }) }

beforeEach(() => {
  state.rows = {}
  state.queries = []
  state.emails = []
  state.audits = []
  state.failReads = false
  for (const f of [state.resolveRefundBasis, state.logActivity, state.remindEnvelopeRow, state.applyGuardianOptOut, state.loadSignedRecord, state.previewGroupSetup]) f.mockClear()
  pending = []
  vi.stubEnv('LOADSCOPED_MODE', '')
  vi.stubEnv('AUTHZ_SOURCE', '')
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
  asAdmin()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

const GROUP = { event_slug: 'nevada', type: 'group', teacher_member_id: null }

describe('the routes C16 converted', () => {
  const CONVERTED = [
    'agreements/[id]/correct-recipient',
    'campaigns/[slug]/email',
    'credentials/[id]/resend',
    'credentials/[id]/revoke',
    'docusigns/[id]/credential-sharing',
    'docusigns/[id]/download',
    'docusigns/[id]/resend',
    'event-participations/[id]',
    'media/do-not-use',
    'refunds/preview',
    'registrations/[id]/finish-setup',
    'registrations/[id]/invoice',
    'registrations/[id]/participants',
    // The C16 follow-up: it arrived (#573) after C16 converted its siblings.
    'registrations/[id]/payment-method',
    'surveys/responses/[id]/withdraw-quote',
  ].map((r) => `app/api/admin/${r}/route.ts`)

  it('are tenant_staff and have left the disposition register', () => {
    for (const f of CONVERTED) {
      expect(ROUTE_MANIFEST[f], f).toBe('tenant_staff')
      expect(STELLR_ONLY_DISPOSITIONS[f], f).toBeUndefined()
    }
  })

  it('event-managers keeps the Stellr admin guard, as the register says', () => {
    const f = 'app/api/admin/event-managers/route.ts'
    expect(ROUTE_MANIFEST[f]).toBe('stellr_only')
    expect(STELLR_ONLY_DISPOSITIONS[f]).toMatchObject({ disposition: 'tenant_destined', convertedBy: 'C21' })
  })

  it('every handler that writes goes through the audit gate, with a catalogued action', () => {
    for (const f of [...CONVERTED, 'app/api/admin/event-managers/route.ts']) {
      for (const h of auditHandlers(f, readFileSync(f, 'utf8'))) {
        if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(h.method)) expect(h.audited, `${f} ${h.method}`).toBe(true)
      }
    }
    for (const a of ['credential.record.revoke', 'campaign.email.send', 'survey.quote.withdraw']) expect(AUDIT_ACTIONS).toContain(a)
  })
})

describe('with LOADSCOPED_MODE unset, reads are today\'s', () => {
  it('an admin reads a record by id with no tenant filter', async () => {
    state.rows.registrations = GROUP
    const { GET } = await import('@/app/api/admin/registrations/[id]/finish-setup/route')
    const res = await GET(req(), idCtx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [{ step: 'invoice', needed: true, summary: 's' }] })
    const [read] = queries('registrations')
    expect(read.select).toBe('event_slug, type, teacher_member_id')
    expect(read.filters).toEqual([['eq', 'id', ID]])
  })

  it('an event manager in their own event reads with no tenant filter either', async () => {
    asEventManager('nevada')
    state.rows.registrations = GROUP
    const { GET } = await import('@/app/api/admin/registrations/[id]/finish-setup/route')
    expect((await GET(req(), idCtx)).status).toBe(200)
    expect(queries('registrations')[0].filters).toEqual([['eq', 'id', ID]])
  })

  it('the media list is today\'s query', async () => {
    state.rows.participants = []
    const media = await import('@/app/api/admin/media/do-not-use/route')
    expect((await media.GET(req(undefined, 'https://app.test/x?event=nevada'))).status).toBe(200)
    const read = queries('participants')[0]
    expect(read.filters).toEqual([['eq', 'registrations.event_slug', 'nevada']])
    expect(read.select).toContain('registrations!inner(')
  })

  it('the campaign list and the write after a load are today\'s queries', async () => {
    state.rows.registrations = [{ teacher_first_name: 'A', teacher_email: 'a@example.invalid', event_title: 'C', type: 'campaign', event_slug: 'c1' }]
    const email = await import('@/app/api/admin/campaigns/[slug]/email/route')
    const sent = await email.POST(req({ subject: 's', message: 'm' }) as never, { params: Promise.resolve({ slug: 'c1' }) })
    expect(await sent.json()).toEqual({ sent: 1, failed: 0 })
    expect(queries('registrations')[0].filters).toEqual([['eq', 'type', 'campaign'], ['eq', 'event_slug', 'c1']])

    state.queries = []
    state.rows.agreements = { envelope_id: 'env', provider: 'docusign', status: 'sent', reused_from: null }
    const resend = await import('@/app/api/admin/docusigns/[id]/resend/route')
    expect((await resend.POST(req({}) as never, idCtx)).status).toBe(200)
    const update = queries('agreements').find((q) => q.op === 'update')
    expect(update?.filters).toEqual([['eq', 'id', ID]])
  })
})

describe('under LOADSCOPED_MODE=enforce', () => {
  beforeEach(() => {
    vi.stubEnv('LOADSCOPED_MODE', 'enforce')
  })

  it('a read carries the Stellr-or-NULL tenant filter, so a row the backfill missed still loads', async () => {
    state.rows.registrations = { ...GROUP, tenant_id: null }
    const { GET } = await import('@/app/api/admin/registrations/[id]/finish-setup/route')
    expect((await GET(req(), idCtx)).status).toBe(200)
    const [read] = queries('registrations')
    expect(read.filters).toContainEqual(['or', `tenant_id.eq.${STELLR_TENANT_ID},tenant_id.is.null`, undefined])
  })

  it('another tenant\'s row answers exactly as a missing one', async () => {
    state.rows.registrations = { ...GROUP, tenant_id: OTHER_TENANT }
    const { GET } = await import('@/app/api/admin/registrations/[id]/finish-setup/route')
    const foreign = await GET(req(), idCtx)
    state.rows.registrations = null
    const missing = await GET(req(), idCtx)
    const malformed = await GET(req(), { params: Promise.resolve({ id: 'not-a-uuid' }) })
    expect(foreign.status).toBe(404)
    const body = await foreign.text()
    expect(await missing.text()).toBe(body)
    expect(await malformed.text()).toBe(body)
  })

  it('the media list reads only the tenant\'s registrations', async () => {
    state.rows.participants = []
    const media = await import('@/app/api/admin/media/do-not-use/route')
    expect((await media.GET(req(undefined, 'https://app.test/x?event=nevada'))).status).toBe(200)
    expect(queries('participants')[0].filters).toContainEqual(['or', `tenant_id.eq.${STELLR_TENANT_ID},tenant_id.is.null`, { referencedTable: 'registrations' }])
  })

  it('a write carries the tenant filter as well', async () => {
    state.rows.agreements = { envelope_id: 'env', provider: 'docusign', status: 'sent', reused_from: null, tenant_id: STELLR_TENANT_ID }
    const resend = await import('@/app/api/admin/docusigns/[id]/resend/route')
    expect((await resend.POST(req({}) as never, idCtx)).status).toBe(200)
    const update = queries('agreements').find((q) => q.op === 'update')
    expect(update?.filters.map(([k]) => k)).toEqual(['eq', 'or'])
  })
})

describe('event managers keep the events they have', () => {
  it('their own event, on each route they had', async () => {
    asEventManager('nevada')
    state.rows.registrations = GROUP
    state.rows.credentials = { id: ID, event_slug: 'nevada', member_id: null }
    const setup = await import('@/app/api/admin/registrations/[id]/finish-setup/route')
    expect((await setup.GET(req(), idCtx)).status).toBe(200)
    const resend = await import('@/app/api/admin/credentials/[id]/resend/route')
    expect((await resend.POST(req({}), idCtx)).status).toBe(200)
    state.rows.registrations = []
    const email = await import('@/app/api/admin/campaigns/[slug]/email/route')
    expect((await email.POST(req({ subject: 's', message: 'm' }) as never, { params: Promise.resolve({ slug: 'nevada' }) })).status).toBe(200)
  })

  it('another event is refused, with the answer a missing record gets', async () => {
    asEventManager('colorado')
    state.rows.registrations = GROUP
    state.rows.credentials = { id: ID, event_slug: 'nevada', member_id: null }
    const setup = await import('@/app/api/admin/registrations/[id]/finish-setup/route')
    const refused = await setup.GET(req(), idCtx)
    expect(refused.status).toBe(404)
    const resend = await import('@/app/api/admin/credentials/[id]/resend/route')
    const cred = await resend.POST(req({}), idCtx)
    expect(cred.status).toBe(404)
    state.rows.registrations = null
    state.rows.credentials = null
    expect(await refused.text()).toBe(await (await setup.GET(req(), idCtx)).text())
    expect(await cred.text()).toBe(await (await resend.POST(req({}), idCtx)).text())
    const email = await import('@/app/api/admin/campaigns/[slug]/email/route')
    const other = await email.POST(req({ subject: 's', message: 'm' }) as never, { params: Promise.resolve({ slug: 'nevada' }) })
    expect(other.status).toBe(403)
    expect(state.emails).toEqual([])
  })

  it('a course credential, which has no event, stays with admins', async () => {
    asEventManager('nevada')
    state.rows.credentials = { id: ID, event_slug: null, member_id: null }
    const resend = await import('@/app/api/admin/credentials/[id]/resend/route')
    expect((await resend.POST(req({}), idCtx)).status).toBe(404)
    asAdmin()
    expect((await resend.POST(req({}), idCtx)).status).toBe(200)
  })

  it('an assignment with no events reaches nothing', async () => {
    asEventManager()
    state.rows.registrations = GROUP
    const setup = await import('@/app/api/admin/registrations/[id]/finish-setup/route')
    expect((await setup.GET(req(), idCtx)).status).toBe(404)
  })

  it('changing an invoice stays with admins, and they are told so before any read', async () => {
    asEventManager('nevada')
    state.rows.registrations = GROUP
    const invoice = await import('@/app/api/admin/registrations/[id]/invoice/route')
    const res = await invoice.POST(req({ action: 'remove' }), idCtx)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Only admins can change an invoice' })
    expect(queries('registrations')).toEqual([])
  })

  it('the routes that were admin-only stay admin-only', async () => {
    asEventManager('nevada')
    state.rows.agreements = { event_slug: 'nevada', status: 'completed', envelope_id: 'e', provider: 'docusign', reused_from: null }
    state.rows.event_participations = { id: ID, event_slug: 'nevada' }
    state.rows.participants = { id: ID }
    state.rows.survey_responses = { id: ID }
    const download = await import('@/app/api/admin/docusigns/[id]/download/route')
    const docResend = await import('@/app/api/admin/docusigns/[id]/resend/route')
    const sharing = await import('@/app/api/admin/docusigns/[id]/credential-sharing/route')
    const participation = await import('@/app/api/admin/event-participations/[id]/route')
    const preview = await import('@/app/api/admin/refunds/preview/route')
    const media = await import('@/app/api/admin/media/do-not-use/route')
    const quote = await import('@/app/api/admin/surveys/responses/[id]/withdraw-quote/route')
    const answers = [
      await download.GET(req() as never, idCtx),
      await docResend.POST(req({}) as never, idCtx),
      await sharing.POST(req({ optOut: true }) as never, idCtx),
      await participation.PATCH(req({ status: 'approved' }), idCtx),
      await participation.DELETE(req({}), idCtx),
      await preview.GET(req(undefined, `https://app.test/x?participant=${ID}`)),
      await media.GET(req(undefined, 'https://app.test/x?event=nevada')),
      await quote.POST(req({}), idCtx),
    ]
    expect(answers.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403, 403, 403])
    for (const t of ['agreements', 'event_participations', 'participants', 'survey_responses']) expect(queries(t), t).toEqual([])
  })
})

describe('who else is refused, and with what', () => {
  it('signed out: 401 with no read', async () => {
    signedOut()
    state.rows.credentials = { id: ID, event_slug: 'nevada' }
    const resend = await import('@/app/api/admin/credentials/[id]/resend/route')
    expect((await resend.POST(req({}), idCtx)).status).toBe(401)
    expect(queries('credentials')).toEqual([])
  })

  it('a student gets each route\'s own refusal', async () => {
    asStudent()
    const quote = await import('@/app/api/admin/surveys/responses/[id]/withdraw-quote/route')
    const denied = await quote.POST(req({}), idCtx)
    expect(denied.status).toBe(403)
    expect(await denied.json()).toEqual({ error: 'Admins only' })
    const download = await import('@/app/api/admin/docusigns/[id]/download/route')
    expect(await (await download.GET(req() as never, idCtx)).json()).toEqual({ error: 'Unauthorised' })
  })

  it('signed out on the routes that answered 403 to everyone still answers 403', async () => {
    signedOut()
    const download = await import('@/app/api/admin/docusigns/[id]/download/route')
    expect((await download.GET(req() as never, idCtx)).status).toBe(403)
    const participation = await import('@/app/api/admin/event-participations/[id]/route')
    expect((await participation.DELETE(req({}), idCtx)).status).toBe(403)
  })

  it('the refund preview of a participant nobody can reach is the empty preview', async () => {
    const { EMPTY_REFUND_PREVIEW } = await import('@/lib/refunds/preview')
    const preview = await import('@/app/api/admin/refunds/preview/route')
    const res = await preview.GET(req(undefined, `https://app.test/x?participant=${ID}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(EMPTY_REFUND_PREVIEW)
    expect(state.resolveRefundBasis).not.toHaveBeenCalled()
  })

  it('one the caller can reach goes on to the payment, with one read and today\'s query', async () => {
    state.rows.participants = { id: ID }
    const preview = await import('@/app/api/admin/refunds/preview/route')
    expect((await preview.GET(req(undefined, `https://app.test/x?participant=${ID}`))).status).toBe(200)
    expect(state.resolveRefundBasis).toHaveBeenCalledTimes(1)
    expect(queries('participants')).toHaveLength(1)
    expect(queries('participants')[0].filters).toEqual([['eq', 'id', ID]])
  })
})

describe('a record that is not there, as an admin', () => {
  const FOUND = { status: 'completed', envelope_id: 'e', provider: 'docusign', reused_from: null }

  it('a resend answers the route\'s 404 and reminds nobody', async () => {
    const resend = await import('@/app/api/admin/docusigns/[id]/resend/route')
    const res = await resend.POST(req({}) as never, idCtx)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    expect(state.remindEnvelopeRow).not.toHaveBeenCalled()
    expect(queries('agreements').filter((q) => q.op !== 'select')).toEqual([])
  })

  it('a sharing change answers the route\'s 404, changes nothing and tells nobody', async () => {
    const sharing = await import('@/app/api/admin/docusigns/[id]/credential-sharing/route')
    const res = await sharing.POST(req({ optOut: true }) as never, idCtx)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    expect(queries('agreements').filter((q) => q.op !== 'select')).toEqual([])
    expect(state.applyGuardianOptOut).not.toHaveBeenCalled()
    expect(state.logActivity).not.toHaveBeenCalled()
  })

  it('a download answers the route\'s 404 and serves nothing', async () => {
    const download = await import('@/app/api/admin/docusigns/[id]/download/route')
    const res = await download.GET(req() as never, idCtx)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    expect(state.loadSignedRecord).not.toHaveBeenCalled()
    state.rows.agreements = { ...FOUND, status: 'sent' }
    expect((await download.GET(req() as never, idCtx)).status).toBe(400)
    expect(state.loadSignedRecord).not.toHaveBeenCalled()
  })

  it('a coverage row reads its original by id alone, with LOADSCOPED_MODE unset', async () => {
    const ORIGINAL = '44444444-4444-4444-8444-444444444444'
    state.rows.agreements = { ...FOUND, reused_from: ORIGINAL }
    const download = await import('@/app/api/admin/docusigns/[id]/download/route')
    await download.GET(req() as never, idCtx)
    expect(queries('agreements').map((q) => q.filters)).toEqual([[['eq', 'id', ID]], [['eq', 'id', ORIGINAL]]])
    expect(state.loadSignedRecord).toHaveBeenCalledTimes(1)
  })
})

describe('finish setup, on a registration that is not a group', () => {
  const INDIVIDUAL = { event_slug: 'nevada', type: 'individual', teacher_member_id: null }

  it('answers the route\'s 404 before the preview', async () => {
    state.rows.registrations = INDIVIDUAL
    const setup = await import('@/app/api/admin/registrations/[id]/finish-setup/route')
    const res = await setup.GET(req(), idCtx)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Group registration not found' })
    expect(state.previewGroupSetup).not.toHaveBeenCalled()
  })

  it('answers the same running the real setup, which writes nothing', async () => {
    state.rows.registrations = INDIVIDUAL
    const setup = await import('@/app/api/admin/registrations/[id]/finish-setup/route')
    const res = await setup.POST(req({ steps: ['invoice'] }), idCtx)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Group registration not found' })
    expect((state.queries as Query[]).filter((q) => q.op !== 'select')).toEqual([])
    expect(state.logActivity).not.toHaveBeenCalled()
  })
})

describe('an event record, under today\'s settings and under enforce', () => {
  const ROW = { id: ID, member_id: 'm', team_name: 'Team', event_location: null, event_year: 2026 }
  const writes = () => queries('event_participations').filter((q) => q.op !== 'select')

  it('deleting a row that exists logs it against the member', async () => {
    state.rows.event_participations = ROW
    const { DELETE } = await import('@/app/api/admin/event-participations/[id]/route')
    const res = await DELETE(req({}), idCtx)
    expect(await res.json()).toEqual({ success: true })
    expect(writes().map((q) => [q.op, q.filters])).toEqual([['delete', [['eq', 'id', ID]]]])
    expect(state.logActivity).toHaveBeenCalledTimes(1)
  })

  it('deleting a row already gone still answers success, so a second tab is not told it failed', async () => {
    const { DELETE } = await import('@/app/api/admin/event-participations/[id]/route')
    const res = await DELETE(req({}), idCtx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(writes().map((q) => q.op)).toEqual(['delete'])
    expect(state.logActivity).not.toHaveBeenCalled()
  })

  it('a pre-read that fails does not block the delete', async () => {
    state.rows.event_participations = ROW
    state.failReads = true
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { DELETE } = await import('@/app/api/admin/event-participations/[id]/route')
    expect((await DELETE(req({}), idCtx)).status).toBe(200)
    expect(writes().map((q) => q.op)).toEqual(['delete'])
    consoleError.mockRestore()
  })

  it('editing a row already gone answers 500, as the write finds no row', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { PATCH } = await import('@/app/api/admin/event-participations/[id]/route')
    const res = await PATCH(req({ award: 'x' }), idCtx)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to update record' })
    consoleError.mockRestore()
  })

  it('editing a row that exists logs it against the member', async () => {
    state.rows.event_participations = ROW
    const { PATCH } = await import('@/app/api/admin/event-participations/[id]/route')
    expect((await PATCH(req({ status: 'approved' }), idCtx)).status).toBe(200)
    expect(state.logActivity).toHaveBeenCalledTimes(1)
  })

  it('enforced, a missing row answers the 404 and writes nothing, on both', async () => {
    vi.stubEnv('LOADSCOPED_MODE', 'enforce')
    const { PATCH, DELETE } = await import('@/app/api/admin/event-participations/[id]/route')
    for (const res of [await PATCH(req({ award: 'x' }), idCtx), await DELETE(req({}), idCtx)]) {
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Event record not found' })
    }
    expect(writes()).toEqual([])
  })
})

describe('Stellr\'s own activity log and opt-outs keep working', () => {
  const AGREEMENT = { id: ID, envelope_type: 'minor', status: 'completed', reused_from: null, member_id: 'm', participant_id: 'p', minor_name: 'A' }

  it('a sharing change logs against the member and opts the holder out with no tenant named', async () => {
    state.rows.agreements = AGREEMENT
    const sharing = await import('@/app/api/admin/docusigns/[id]/credential-sharing/route')
    expect((await sharing.POST(req({ optOut: true }) as never, idCtx)).status).toBe(200)
    expect(state.logActivity).toHaveBeenCalledTimes(1)
    expect(state.applyGuardianOptOut).toHaveBeenCalledTimes(1)
    expect(state.applyGuardianOptOut.mock.calls[0][1]).toEqual({ memberId: 'm', participantId: 'p', tenant: null })
  })
})

describe('audit', () => {
  it('off, a mutation writes no event', async () => {
    state.rows.credentials = { id: ID, event_slug: 'nevada' }
    const resend = await import('@/app/api/admin/credentials/[id]/resend/route')
    expect((await resend.POST(req({}), idCtx)).status).toBe(200)
    await flush()
    expect(state.audits).toEqual([])
  })

  it('on, a mutation writes one event, naming the caller, the tenant and the record', async () => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
    state.rows.credentials = { id: ID, event_slug: 'nevada' }
    const resend = await import('@/app/api/admin/credentials/[id]/resend/route')
    expect((await resend.POST(req({}), idCtx)).status).toBe(200)
    await flush()
    expect(state.audits).toHaveLength(1)
    expect(state.audits[0]).toMatchObject({
      action: 'credential.email.resend',
      actor: 'user_admin',
      tenantId: STELLR_TENANT_ID,
      target: { table: 'credentials', id: ID },
    })
  })

  it('on, a refusal writes none', async () => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
    asEventManager('colorado')
    state.rows.credentials = { id: ID, event_slug: 'nevada' }
    const resend = await import('@/app/api/admin/credentials/[id]/resend/route')
    expect((await resend.POST(req({}), idCtx)).status).toBe(404)
    await flush()
    expect(state.audits).toEqual([])
  })

  it('the free text a person typed stays out of the event', async () => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
    state.rows.registrations = [{ teacher_email: 'a@example.invalid', type: 'campaign', event_slug: 'c1' }]
    const email = await import('@/app/api/admin/campaigns/[slug]/email/route')
    await email.POST(req({ subject: 'SUBJECT-TEXT', message: 'MESSAGE-TEXT' }) as never, { params: Promise.resolve({ slug: 'c1' }) })
    await flush()
    const written = JSON.stringify(state.audits)
    expect(written).toContain('campaign.email.send')
    expect(written).not.toContain('SUBJECT-TEXT')
    expect(written).not.toContain('MESSAGE-TEXT')
    expect(written).not.toContain('a@example.invalid')
  })
})
