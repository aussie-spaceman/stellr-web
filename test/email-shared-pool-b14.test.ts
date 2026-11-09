// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// S5 B14, the tenant email share (owner decision, 9 Nov 2026): ONE SHARED POOL.
// A tenant's mail is counted on the same daily row as Stellr's and held to the
// same caps, with no allowance of its own. Runs the real sendEmail, budget and
// tenant sender, with only the network and the database stubbed.

const { db } = vi.hoisted(() => ({ db: { current: null as unknown } }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => db.current }))

const TENANT = '11111111-1111-4111-8111-111111111111'
const DAY = new Date().toISOString().slice(0, 10)

let fetchMock: ReturnType<typeof vi.fn>

function setup(sent: number): FakeDb {
  const fake = fakeSupabase({
    email_suppressions: [],
    email_send_quota: [{ day: DAY, sent }],
    tenants: [{ id: TENANT, display_name: 'Rocket Club', branding: { reply_to: 'events@rocket.example.org' } }],
  })
  // bump_email_quota keeps one row per UTC day, whoever sent: no tenant argument.
  fake.rpcs.bump_email_quota = (args) => {
    const row = fake.tables.email_send_quota.find((r) => r.day === args.p_day)
    if (row) row.sent = (row.sent as number) + 1
    else fake.tables.email_send_quota.push({ day: args.p_day, sent: 1 })
    return null
  }
  db.current = fake.client
  return fake
}

async function load() {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
  vi.stubEnv('APP_ENV', 'prod')
  vi.stubEnv('RESEND_API_KEY', 'test_key')
  vi.stubEnv('EMAIL_DAILY_CAP', '10')
  vi.stubEnv('EMAIL_TRANSACTIONAL_RESERVE', '2')
  vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
  return { email: await import('@/lib/email'), tenantMail: await import('@/lib/event-emails/tenant-mail') }
}

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 're_sent' }), text: async () => '' }))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
})

const msg = { subject: 'Event update', html: '<p>x</p>', text: 'x' }
const fromOf = (i: number) => JSON.parse((fetchMock.mock.calls[i] as unknown as [string, RequestInit])[1].body as string).from as string

describe('one shared pool for Stellr and tenants', () => {
  it('counts a tenant send on the same daily row as a Stellr send', async () => {
    const fake = setup(0)
    const { email, tenantMail } = await load()
    await email.sendEmail({ to: 'a@example.org', ...msg, kind: 'marketing' })
    const out = await tenantMail.sendTenantConfirmation(fake.client, { tenantId: TENANT, to: 'b@example.org', ...msg })
    expect(out).toEqual({ ok: true, id: 're_sent' })
    expect(fake.tables.email_send_quota).toEqual([{ day: DAY, sent: 2 }])
    expect(fromOf(1)).toBe('"Rocket Club via Stellr" <no-reply@mail.stellreducation.org>')
  })

  it('stops a tenant blast at the same marketing cap Stellr’s already reached, and still sends its transactional mail', async () => {
    // marketingCap = 10 - 2 = 8. Stellr's blast takes the 8th slot.
    const fake = setup(7)
    const { email, tenantMail } = await load()
    const sender = tenantMail.tenantEventSender({ display_name: 'Rocket Club', branding: { reply_to: 'events@rocket.example.org' } })!
    await email.sendEmail({ to: 'a@example.org', ...msg, kind: 'marketing' })
    await expect(
      email.sendEmail({ to: 'b@example.org', ...msg, kind: 'marketing', from: sender.from, replyTo: sender.replyTo }),
    ).rejects.toMatchObject({ isQuota: true })
    // Transactional mail is never refused by the counter, for a tenant as for Stellr.
    expect(await tenantMail.sendTenantConfirmation(fake.client, { tenantId: TENANT, to: 'c@example.org', ...msg })).toMatchObject({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fake.tables.email_send_quota).toEqual([{ day: DAY, sent: 9 }])
  })

  it('gives a tenant no allowance of its own: a tenant blast is refused once Stellr has used the pool', async () => {
    const fake = setup(8)
    const { email, tenantMail } = await load()
    const sender = tenantMail.tenantEventSender({ display_name: 'Rocket Club', branding: { reply_to: 'events@rocket.example.org' } })!
    await expect(
      email.sendEmail({ to: 'b@example.org', ...msg, kind: 'marketing', from: sender.from, replyTo: sender.replyTo }),
    ).rejects.toMatchObject({ isQuota: true })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fake.tables.email_send_quota).toEqual([{ day: DAY, sent: 8 }])
  })
})
