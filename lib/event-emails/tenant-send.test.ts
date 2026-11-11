import { describe, it, expect, vi, beforeEach } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// S5 B14: a tenant's event email goes out only with that tenant's sender, never
// as Stellr. Stellr's rows (tenant_id NULL or Stellr's) are untouched by this.

const { sendEmail, resolveAudience } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_o: { to: string; subject: string; from?: string; replyTo?: string }) => ({ id: 'm' })),
  resolveAudience: vi.fn(async (..._a: unknown[]): Promise<{ recipients: unknown[]; docusignParticipantIds: string[] }> => ({ recipients: [], docusignParticipantIds: [] })),
}))

vi.mock('@/lib/community', () => ({ tiptapToPlainText: () => '', RESOURCES_BUCKET: 'community-resources' }))
vi.mock('@/lib/email', () => ({ sendEmail, EmailSendError: class extends Error {} }))
vi.mock('@/lib/docusign-reissue', () => ({ reissueParticipantAgreement: vi.fn() }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: async () => ({ title: 'CO SDC', date: '2099-10-03', venue: 'STEM School' }) }))
vi.mock('./audiences', () => ({ resolveAudience }))

const { sendEventEmail, reclaimStuckSending, TENANT_SENDER_REQUIRED } = await import('./send')
const { sendCatchUp, runCatchUps } = await import('./catch-up')
const { EVENT_EMAIL_FROM, EVENT_EMAIL_REPLY_TO } = await import('./render')
const { markdownToTiptap } = await import('./defaults')

const TENANT = '11111111-1111-4111-8111-111111111111'
const SENDER = { from: '"Rocket Club via Stellr" <no-reply@mail.stellreducation.org>', replyTo: 'events@rocket.example.org' }

const EMAIL = {
  id: 'e1', event_slug: 'co', name: 'Reminder', template_key: null, audiences: ['participants'],
  subject: '{{event_name}} soon', body_json: markdownToTiptap('Hi {{first_name}}'), attachments: [],
  resend_docusign: false, schedule_days_before: 5, status: 'scheduled', created_by: null, sent_at: null,
  tenant_id: null as string | null,
}

const R = (email: string, firstName: string) => ({
  email, firstName, name: firstName, roles: ['participant'], reasons: ['participants'],
  participantNames: [firstName], isParticipant: true, payments: [],
})

/** event_emails with a real claim; event_email_sends recorded in memory. */
function fakeDb(row: typeof EMAIL) {
  const state = { row: { ...row }, writes: [] as Record<string, unknown>[] }
  const chainable = (result: unknown) => {
    const q: Record<string, unknown> = {}
    for (const m of ['eq', 'in', 'neq', 'or', 'lt', 'select']) q[m] = () => q
    q.maybeSingle = async () => result
    q.single = async () => result
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok)
    return q
  }
  const db = {
    state,
    from(table: string) {
      if (table === 'event_emails') {
        return {
          select: () => chainable({ data: { ...state.row } }),
          update: (values: Record<string, unknown>) => {
            state.writes.push(values)
            const q: Record<string, unknown> = {}
            for (const m of ['eq', 'in', 'or', 'lt']) q[m] = () => q
            q.select = async () => {
              state.row = { ...state.row, ...values }
              return { data: [{ id: row.id }] }
            }
            q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok)
            return q
          },
        }
      }
      return {
        select: () => chainable({ data: [], error: null }),
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: 's1' } }) }) }),
        update: () => ({ eq: async () => ({}) }),
      }
    },
  }
  return db
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveAudience.mockResolvedValue({ recipients: [R('a@example.com', 'Al')], docusignParticipantIds: [] })
})

describe('sendEventEmail and a tenant row', () => {
  it('refuses a tenant’s email that comes without its sender, before claiming or sending anything', async () => {
    const db = fakeDb({ ...EMAIL, tenant_id: TENANT })
    for (const trigger of ['schedule', 'manual'] as const) {
      expect(await sendEventEmail(db as never, 'e1', { trigger, spacingMs: 0 })).toEqual({ ok: false, status: 503, error: TENANT_SENDER_REQUIRED })
    }
    expect(await sendEventEmail(db as never, 'e1', { trigger: 'test', testTo: 'staff@example.com', spacingMs: 0 })).toMatchObject({ status: 503 })
    expect(db.state.writes).toEqual([])
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it.each([[null], [STELLR_TENANT_ID]])('sends Stellr’s email (tenant_id %s) from Stellr’s event sender, as before', async (tenantId) => {
    const db = fakeDb({ ...EMAIL, tenant_id: tenantId })
    expect(await sendEventEmail(db as never, 'e1', { trigger: 'schedule', spacingMs: 0 })).toMatchObject({ ok: true, sent: 1 })
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ from: EVENT_EMAIL_FROM, replyTo: EVENT_EMAIL_REPLY_TO })
  })

  it('sends a tenant’s email from the tenant’s sender when it has one', async () => {
    const db = fakeDb({ ...EMAIL, tenant_id: TENANT })
    expect(await sendEventEmail(db as never, 'e1', { trigger: 'schedule', spacingMs: 0, sender: SENDER })).toMatchObject({ ok: true, sent: 1 })
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ from: SENDER.from, replyTo: SENDER.replyTo })
  })

  it('S5 wave 6: a tenant’s email resolves its audience with the tenant, so consent-pending participants are left out; Stellr’s without', async () => {
    await sendEventEmail(fakeDb({ ...EMAIL, tenant_id: TENANT }) as never, 'e1', { trigger: 'schedule', spacingMs: 0, sender: SENDER })
    expect(resolveAudience.mock.calls.at(-1)?.[3]).toMatchObject({ tenantId: TENANT })
    await sendEventEmail(fakeDb({ ...EMAIL, tenant_id: null }) as never, 'e1', { trigger: 'schedule', spacingMs: 0 })
    expect(resolveAudience.mock.calls.at(-1)?.[3]).not.toHaveProperty('tenantId')
  })
})

describe('a tenant send and its cron slice', () => {
  it('stops between recipients once the slice signal fires, and puts the email back for the next run', async () => {
    resolveAudience.mockResolvedValue({ recipients: [R('a@example.com', 'Al'), R('b@example.com', 'Bo'), R('c@example.com', 'Cy')], docusignParticipantIds: [] })
    const controller = new AbortController()
    sendEmail.mockImplementationOnce(async () => {
      controller.abort()
      return { id: 'm' }
    })
    const db = fakeDb({ ...EMAIL, tenant_id: TENANT })
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'schedule', spacingMs: 0, sender: SENDER, signal: controller.signal })
    expect(out).toMatchObject({ ok: true, sent: 1, incomplete: true })
    expect(sendEmail.mock.calls.map((c) => c[0].to)).toEqual(['a@example.com'])
    // Claimed as 'sending', then returned to 'scheduled' rather than marked sent.
    expect(db.state.writes.map((w) => w.status)).toEqual(['sending', 'scheduled'])
  })

  it('a catch-up stops the same way', async () => {
    resolveAudience.mockResolvedValue({ recipients: [R('a@example.com', 'Al'), R('b@example.com', 'Bo')], docusignParticipantIds: [] })
    const controller = new AbortController()
    sendEmail.mockImplementationOnce(async () => {
      controller.abort()
      return { id: 'm' }
    })
    const db = fakeDb({ ...EMAIL, status: 'sent', tenant_id: TENANT })
    expect(await sendCatchUp(db as never, 'e1', { spacingMs: 0, today: '2026-01-01', sender: SENDER, signal: controller.signal })).toMatchObject({ ok: true, sent: 1 })
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })
})

describe('sendCatchUp and a tenant row', () => {
  it('refuses without the tenant’s sender, and sends from it with one', async () => {
    const sent = { ...EMAIL, status: 'sent', tenant_id: TENANT }
    const db = fakeDb(sent)
    expect(await sendCatchUp(db as never, 'e1', { spacingMs: 0, today: '2026-01-01' })).toEqual({ ok: false, status: 503, error: TENANT_SENDER_REQUIRED })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(await sendCatchUp(fakeDb(sent) as never, 'e1', { spacingMs: 0, today: '2026-01-01', sender: SENDER })).toMatchObject({ ok: true, sent: 1 })
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ from: SENDER.from, replyTo: SENDER.replyTo })
    // S5 wave 6: with the tenant, so its consent-pending participants are left out.
    expect(resolveAudience.mock.calls.at(-1)?.[3]).toEqual({ tenantId: TENANT })
  })
})

/** Lists `rows`; every per-row read finds nothing, so each row tried shows up as a 404 error naming it. */
function listingDb(rows: { id: string; event_slug?: string; tenant_id: string | null }[]) {
  const selects: string[] = []
  return {
    selects,
    from: () => ({
      select: (cols: string) => {
        selects.push(cols)
        const q: Record<string, unknown> = {}
        for (const m of ['eq', 'lt', 'contains']) q[m] = () => q
        q.order = async () => ({ data: rows.map((r) => (cols.includes('tenant_id') ? r : { id: r.id, event_slug: r.event_slug })), error: null })
        q.maybeSingle = async () => ({ data: null })
        return q
      },
    }),
  }
}

describe('the cron helpers keep to one tenant when given one', () => {
  const rows = [
    { id: 'stellr-null', event_slug: 'co', tenant_id: null },
    { id: 'stellr', event_slug: 'co', tenant_id: STELLR_TENANT_ID },
    { id: 'tenant', event_slug: 'tx', tenant_id: TENANT },
  ]
  const tried = (errors: { id: string }[]) => errors.map((e) => e.id)

  it('reclaimStuckSending: every row without a scope, as before; only the tenant’s rows with one', async () => {
    const plain = listingDb(rows)
    expect(tried((await reclaimStuckSending(plain as never, () => true)).errors)).toEqual(['stellr-null', 'stellr', 'tenant'])
    expect(plain.selects[0]).toBe('id')
    expect(tried((await reclaimStuckSending(listingDb(rows) as never, () => true, { tenantId: STELLR_TENANT_ID })).errors)).toEqual(['stellr-null', 'stellr'])
    expect(tried((await reclaimStuckSending(listingDb(rows) as never, () => true, { tenantId: TENANT })).errors)).toEqual(['tenant'])
  })

  it('both pass the tenant’s sender on to the send, so its rows get past the sender check', async () => {
    // Each per-row read finds the tenant's row, which then fails the next check
    // after the sender one: the error says whether the sender arrived.
    const tenantRowDb = (row: Record<string, unknown>) => ({
      from: () => ({
        select: () => {
          const q: Record<string, unknown> = {}
          for (const m of ['eq', 'lt', 'contains']) q[m] = () => q
          q.order = async () => ({ data: [{ id: 'tenant', event_slug: 'tx', tenant_id: TENANT }], error: null })
          q.maybeSingle = async () => ({ data: row })
          return q
        },
      }),
    })
    const badToken = { ...EMAIL, tenant_id: TENANT, status: 'sending', subject: '{{nope}}' }
    const without = await reclaimStuckSending(tenantRowDb(badToken) as never, () => true, { tenantId: TENANT })
    expect(without.errors.map((e) => e.error)).toEqual([TENANT_SENDER_REQUIRED])
    const withSender = await reclaimStuckSending(tenantRowDb(badToken) as never, () => true, { tenantId: TENANT, sender: SENDER })
    expect(withSender.errors.map((e) => e.error)).toEqual(['Unknown merge field: {{nope}}'])

    const open = async () => '2099-01-01'
    const draft = { ...EMAIL, tenant_id: TENANT, status: 'draft' }
    const noSender = await runCatchUps(tenantRowDb(draft) as never, open, () => true, '2026-01-01', { tenantId: TENANT })
    expect(noSender.errors.map((e) => e.error)).toEqual([TENANT_SENDER_REQUIRED])
    const sender = await runCatchUps(tenantRowDb(draft) as never, open, () => true, '2026-01-01', { tenantId: TENANT, sender: SENDER })
    expect(sender.errors.map((e) => e.error)).toEqual(['Only a sent email can be caught up'])
  })

  it('runCatchUps: every email without a scope, as before; only the tenant’s with one', async () => {
    const open = async () => '2099-01-01'
    const plain = listingDb(rows)
    expect(tried((await runCatchUps(plain as never, open, () => true, '2026-01-01')).errors)).toEqual(['stellr-null', 'stellr', 'tenant'])
    expect(plain.selects[0]).toBe('id, event_slug')
    expect(tried((await runCatchUps(listingDb(rows) as never, open, () => true, '2026-01-01', { tenantId: STELLR_TENANT_ID })).errors)).toEqual(['stellr-null', 'stellr'])
    expect(tried((await runCatchUps(listingDb(rows) as never, open, () => true, '2026-01-01', { tenantId: TENANT })).errors)).toEqual(['tenant'])
  })
})
