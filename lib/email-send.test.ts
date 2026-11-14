// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// sendEmail end to end with the network stubbed: it goes through the Resend
// transport unchanged, and it honours the S1 suppression list.

const { db } = vi.hoisted(() => ({ db: { current: null as unknown } }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => db.current }))

let fetchMock: ReturnType<typeof vi.fn>

function setup(suppressions: { email: string; reason: string }[] = [], opts: Parameters<typeof fakeSupabase>[1] = {}): FakeDb {
  const fake = fakeSupabase({
    email_suppressions: suppressions.map((s) => ({ ...s, source: 'test', created_at: '2026-11-01T00:00:00Z' })),
    email_send_quota: [],
  }, opts)
  fake.rpcs.bump_email_quota = () => 1
  db.current = fake.client
  return fake
}

async function load() {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
  vi.stubEnv('APP_ENV', 'prod')
  vi.stubEnv('RESEND_API_KEY', 'test_key')
  return import('./email')
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

const msg = { subject: 'Your registration', html: '<p>x</p>', text: 'x' }
const sentBody = () => JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)

describe('sendEmail', () => {
  it('sends through Resend with the same request as before and counts the send', async () => {
    const fake = setup()
    const bumps = vi.fn(() => 1)
    fake.rpcs.bump_email_quota = bumps
    const { sendEmail, DEFAULT_REPLY_TO } = await load()
    expect(await sendEmail({ to: 'teacher@example.test', ...msg })).toEqual({ id: 're_sent' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toBe('https://api.resend.com/emails')
    expect(sentBody()).toMatchObject({ to: ['teacher@example.test'], cc: [], reply_to: DEFAULT_REPLY_TO, subject: 'Your registration' })
    expect(bumps).toHaveBeenCalledTimes(1)
  })

  it('skips a bounced address for ordinary mail, logs it masked, and spends no budget', async () => {
    const fake = setup([{ email: 'gone@example.test', reason: 'bounce' }])
    const bumps = vi.fn(() => 1)
    fake.rpcs.bump_email_quota = bumps
    const { sendEmail } = await load()
    expect(await sendEmail({ to: 'Gone@Example.test', ...msg })).toEqual({ id: null, suppressed: true })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(bumps).not.toHaveBeenCalled()
    const logged = JSON.stringify((console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls)
    expect(logged).toContain('g***@example.test')
    expect(logged).not.toContain('gone@example.test')
  })

  it('still sends critical mail to a suppressed address', async () => {
    setup([{ email: 'parent@example.test', reason: 'complaint' }])
    const { sendEmail } = await load()
    expect(await sendEmail({ to: 'parent@example.test', critical: true, ...msg })).toEqual({ id: 're_sent' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never suppresses mail to the staff inbox, even when the caller did not mark it critical', async () => {
    vi.stubEnv('REGISTRATION_ALERT_EMAIL', 'alerts@example.test')
    setup([{ email: 'alerts@example.test', reason: 'bounce' }])
    const { sendEmail } = await load()
    expect(await sendEmail({ to: ' Alerts@Example.test ', ...msg })).toEqual({ id: 're_sent' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never suppresses mail to the monitored reply-to mailbox, marketing included', async () => {
    vi.stubEnv('TRANSACTIONAL_REPLY_TO', 'replies@example.test')
    setup([{ email: 'replies@example.test', reason: 'unsubscribe' }])
    const { sendEmail } = await load()
    expect(await sendEmail({ to: 'REPLIES@example.test', kind: 'marketing', ...msg })).toEqual({ id: 're_sent' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still suppresses an ordinary address that only resembles the staff inbox', async () => {
    vi.stubEnv('REGISTRATION_ALERT_EMAIL', 'alerts@example.test')
    setup([{ email: 'alerts@example.test.evil', reason: 'bounce' }])
    const { sendEmail } = await load()
    expect(await sendEmail({ to: 'alerts@example.test.evil', ...msg })).toEqual({ id: null, suppressed: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an unsubscribe stops marketing but not a receipt', async () => {
    setup([{ email: 'quiet@example.test', reason: 'unsubscribe' }])
    const { sendEmail } = await load()
    expect(await sendEmail({ to: 'quiet@example.test', kind: 'marketing', ...msg })).toEqual({ id: null, suppressed: true })
    expect(await sendEmail({ to: 'quiet@example.test', ...msg })).toEqual({ id: 're_sent' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('drops a suppressed cc and keeps the rest', async () => {
    setup([{ email: 'bad@example.test', reason: 'bounce' }])
    const { sendEmail } = await load()
    await sendEmail({ to: 'teacher@example.test', cc: ['bad@example.test', 'head@example.test'], ...msg })
    expect(sentBody().cc).toEqual(['head@example.test'])
  })

  it('sends anyway when the suppression list cannot be read', async () => {
    setup([], { failOn: (t) => (t === 'email_suppressions' ? 'db down' : null) })
    const { sendEmail } = await load()
    expect(await sendEmail({ to: 'teacher@example.test', ...msg })).toEqual({ id: 're_sent' })
  })

  it('re-exports EmailSendError from the transport and throws it on a refusal', async () => {
    setup()
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 422, json: async () => null, text: async () => 'bad from' }))
    const { sendEmail, EmailSendError } = await load()
    const { EmailSendError: TransportError } = await import('./email/transport')
    expect(EmailSendError).toBe(TransportError)
    const err = await sendEmail({ to: 'teacher@example.test', ...msg }).catch((e) => e)
    expect(err).toBeInstanceOf(EmailSendError)
    expect(err.status).toBe(422)
  })
})

// Resend daily quota (9 Nov 2026): a send Resend refuses for a reason that
// passes is parked in the email outbox and returned as queued — never thrown
// away. Only a message Resend calls invalid (400/422) still throws.
describe('sendEmail when Resend refuses', () => {
  const refuse = (status: number, name: string, headers?: Record<string, string>) =>
    async () => ({
      ok: false,
      status,
      headers: new Headers(headers ?? {}),
      json: async () => null,
      text: async () => JSON.stringify({ statusCode: status, name, message: name }),
    })

  it('queues mail refused for the daily quota, with the message as it would have gone', async () => {
    const fake = setup()
    const bumps = vi.fn(() => 1)
    fake.rpcs.bump_email_quota = bumps
    fetchMock.mockImplementationOnce(refuse(429, 'daily_quota_exceeded'))
    const { sendEmail, DEFAULT_REPLY_TO } = await load()
    const out = await sendEmail({ to: 'Parent@Example.test', cc: ['head@example.test'], critical: true, ...msg })
    expect(out).toEqual({ id: null, queued: true })
    expect(bumps).not.toHaveBeenCalled()
    const [row] = fake.table('email_outbox')
    expect(row).toMatchObject({
      status: 'pending',
      kind: 'transactional',
      priority: 0,
      critical: true,
      intended_to: 'Parent@Example.test',
      intended_cc: ['head@example.test'],
      reason: 'daily_quota',
      message: { to: ['Parent@Example.test'], cc: ['head@example.test'], replyTo: DEFAULT_REPLY_TO, subject: 'Your registration', html: '<p>x</p>', text: 'x' },
    })
  })

  it('queues on the monthly quota, an outage, a refused key and a network failure', async () => {
    const fake = setup()
    fetchMock
      .mockImplementationOnce(refuse(429, 'monthly_quota_exceeded'))
      .mockImplementationOnce(refuse(500, 'internal_server_error'))
      .mockImplementationOnce(refuse(403, 'invalid_api_key'))
      .mockImplementationOnce(async () => { throw new TypeError('fetch failed') })
    const { sendEmail } = await load()
    for (let i = 0; i < 4; i++) expect(await sendEmail({ to: `p${i}@example.test`, ...msg })).toEqual({ id: null, queued: true })
    expect(fake.table('email_outbox').map((r) => r.reason)).toEqual(['monthly_quota', 'provider_error', 'provider_error', 'provider_error'])
  })

  it('waits out the per-second rate limit instead of queueing', async () => {
    const fake = setup()
    fetchMock.mockImplementationOnce(refuse(429, 'rate_limit_exceeded', { 'retry-after': '0' }))
    const { sendEmail } = await load()
    expect(await sendEmail({ to: 'teacher@example.test', ...msg })).toEqual({ id: 're_sent' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fake.table('email_outbox')).toHaveLength(0)
  })

  it('queues marketing held back by the transactional reserve instead of throwing', async () => {
    const fake = setup()
    fake.table('email_send_quota').push({ day: new Date().toISOString().slice(0, 10), sent: 80 })
    const { sendEmail } = await load()
    expect(await sendEmail({ to: 'teacher@example.test', kind: 'marketing', ...msg })).toEqual({ id: null, queued: true })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fake.table('email_outbox')[0]).toMatchObject({ kind: 'marketing', priority: 1, reason: 'budget' })
  })

  it('stores each attachment file once however many messages carry it', async () => {
    const fake = setup()
    fetchMock.mockImplementation(refuse(429, 'daily_quota_exceeded'))
    const { sendEmail } = await load()
    const attachments = [{ filename: 'pack.pdf', content: 'UERG', contentType: 'application/pdf' }]
    await sendEmail({ to: 'a@example.test', attachments, ...msg })
    await sendEmail({ to: 'b@example.test', attachments, ...msg })
    expect(fake.table('email_outbox_blobs')).toHaveLength(1)
    const [a, b] = fake.table('email_outbox')
    expect(a.attachment_hashes).toEqual(b.attachment_hashes)
    expect(JSON.stringify(a.message)).not.toContain('UERG')
  })

  it('still throws a message Resend calls invalid — retrying cannot fix it', async () => {
    const fake = setup()
    fetchMock.mockImplementationOnce(refuse(422, 'validation_error'))
    const { sendEmail } = await load()
    const err = await sendEmail({ to: 'not-an-address', ...msg }).catch((e) => e)
    expect(err.status).toBe(422)
    expect(fake.table('email_outbox')).toHaveLength(0)
  })

  it('throws as before when the outbox cannot be written, so the caller still knows', async () => {
    setup([], { failOn: (t, action) => (t === 'email_outbox' && action === 'insert' ? 'db down' : null) })
    fetchMock.mockImplementationOnce(refuse(429, 'daily_quota_exceeded'))
    const { sendEmail } = await load()
    const err = await sendEmail({ to: 'teacher@example.test', ...msg }).catch((e) => e)
    expect(err.isQuota).toBe(true)
  })

  it('throws, without queueing, for a caller with its own durable queue (deferOnFailure: false)', async () => {
    const fake = setup()
    fetchMock.mockImplementationOnce(refuse(429, 'daily_quota_exceeded'))
    const { sendEmail } = await load()
    const err = await sendEmail({ to: 'parent@example.test', deferOnFailure: false, ...msg }).catch((e) => e)
    expect(err.isQuota).toBe(true)
    expect(fake.table('email_outbox')).toHaveLength(0)
  })
})
