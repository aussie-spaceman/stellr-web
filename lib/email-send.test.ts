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
