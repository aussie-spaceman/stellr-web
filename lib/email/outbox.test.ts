// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'
import { drainEmailOutbox, enqueueEmail, deferReason } from './outbox'
import { EmailSendError, type EmailTransport, type OutgoingEmail } from './transport'

// The email outbox: mail Resend refused for its quota (or an outage) is sent
// later, in order, and never twice. The promise this file pins: delayed, never
// dropped.

const OUTBOX_COLUMNS = [
  'id', 'status', 'kind', 'priority', 'critical', 'intended_to', 'intended_cc', 'message', 'attachment_hashes',
  'reason', 'attempts', 'last_error', 'next_attempt_at', 'claimed_at', 'sent_at', 'finished_at', 'provider_id', 'created_at',
] as const

const T0 = new Date('2026-11-10T00:05:00Z')
const today = T0.toISOString().slice(0, 10)

function setup(rows: Record<string, unknown>[] = [], extra: Record<string, object[]> = {}): FakeDb {
  const fake = fakeSupabase(
    { email_outbox: rows, email_outbox_blobs: [], email_suppressions: [], email_send_quota: [], ...extra },
    { schema: { email_outbox: OUTBOX_COLUMNS } },
  )
  fake.rpcs.bump_email_quota = () => 1
  fake.rpcs.prune_email_outbox_blobs = () => 0
  return fake
}

let seq = 0
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  seq++
  const to = (over.intended_to as string) ?? `p${seq}@example.test`
  return {
    id: `row-${seq}`,
    status: 'pending',
    kind: 'transactional',
    priority: 0,
    critical: false,
    intended_to: to,
    intended_cc: [],
    message: { from: 'Stellr <no-reply@mail.example.test>', to: [to], cc: [], replyTo: 'hello@example.test', subject: `Mail ${seq}`, html: '<p>x</p>', text: 'x' },
    attachment_hashes: [],
    reason: 'daily_quota',
    attempts: 0,
    last_error: null,
    next_attempt_at: '2026-11-09T22:00:00Z',
    claimed_at: null,
    sent_at: null,
    finished_at: null,
    provider_id: null,
    created_at: `2026-11-09T22:${String(seq).padStart(2, '0')}:00Z`,
    ...over,
  }
}

/** A transport that accepts `accept` messages, then refuses with `then`. */
function transport(accept = Infinity, then: () => Error = () => new EmailSendError('quota', 429, 'daily_quota_exceeded')) {
  const sent: { message: OutgoingEmail; key?: string }[] = []
  const t: EmailTransport = {
    name: 'test',
    send: vi.fn(async (message: OutgoingEmail, opts?: { idempotencyKey?: string }) => {
      if (sent.length >= accept) throw then()
      sent.push({ message, key: opts?.idempotencyKey })
      return { id: `re_${sent.length}` }
    }),
  }
  return { t, sent }
}

const drain = (fake: FakeDb, t: EmailTransport, now = T0) => drainEmailOutbox(fake.client, { transport: t, now: () => now })

beforeEach(() => {
  seq = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('drainEmailOutbox', () => {
  it('sends transactional mail before marketing, oldest first, each with its row id as the idempotency key', async () => {
    const fake = setup([
      row({ kind: 'marketing', priority: 1, created_at: '2026-11-09T01:00:00Z' }),
      row({ created_at: '2026-11-09T03:00:00Z' }),
      row({ created_at: '2026-11-09T02:00:00Z' }),
    ])
    const bumps = vi.fn(() => 1)
    fake.rpcs.bump_email_quota = bumps
    const { t, sent } = transport()
    const out = await drain(fake, t)
    expect(sent.map((s) => s.message.subject)).toEqual(['Mail 3', 'Mail 2', 'Mail 1'])
    expect(sent.map((s) => s.key)).toEqual(['email-outbox/row-3', 'email-outbox/row-2', 'email-outbox/row-1'])
    expect(out).toMatchObject({ sent: 3, failed: 0, waiting: 0, stoppedFor: null })
    expect(fake.table('email_outbox').every((r) => r.status === 'sent' && r.provider_id && r.sent_at)).toBe(true)
    expect(bumps).toHaveBeenCalledTimes(3)
  })

  it('stops when Resend refuses again and sends the rest on a later run — nothing is lost', async () => {
    const fake = setup([row(), row(), row()])
    const day1 = transport(1)
    const first = await drain(fake, day1.t)
    expect(first).toMatchObject({ sent: 1, waiting: 2, stoppedFor: 'daily_quota' })
    expect(day1.t.send).toHaveBeenCalledTimes(2) // one accepted, one refused, then it stopped
    const refused = fake.table('email_outbox').find((r) => r.id === 'row-2')!
    expect(refused).toMatchObject({ status: 'pending', claimed_at: null, reason: 'daily_quota', attempts: 1 })

    const day2 = transport()
    const second = await drain(fake, day2.t, new Date('2026-11-11T00:05:00Z'))
    expect(second).toMatchObject({ sent: 2, waiting: 0 })
    expect(day2.sent.map((s) => s.message.subject)).toEqual(['Mail 2', 'Mail 3'])
    expect(fake.table('email_outbox').map((r) => r.status)).toEqual(['sent', 'sent', 'sent'])
  })

  it('keeps retrying through the monthly quota until it lifts', async () => {
    const fake = setup([row()])
    const refused = transport(0, () => new EmailSendError('monthly', 429, 'monthly_quota_exceeded'))
    expect(await drain(fake, refused.t)).toMatchObject({ sent: 0, waiting: 1, stoppedFor: 'monthly_quota' })
    expect(fake.table('email_outbox')[0]).toMatchObject({ status: 'pending', reason: 'monthly_quota' })
    expect(await drain(fake, transport().t, new Date('2026-12-01T00:05:00Z'))).toMatchObject({ sent: 1, waiting: 0 })
  })

  it('backs off an outage instead of hammering it, and still sends afterwards', async () => {
    const fake = setup([row(), row()])
    const down = transport(0, () => new EmailSendError('boom', 503))
    expect(await drain(fake, down.t)).toMatchObject({ sent: 0, waiting: 2, stoppedFor: 'provider_error' })
    expect(down.t.send).toHaveBeenCalledTimes(1)
    const r = fake.table('email_outbox')[0]
    expect(r.status).toBe('pending')
    expect(new Date(r.next_attempt_at as string).getTime()).toBe(T0.getTime() + 30 * 60_000)
    const later = transport()
    await drain(fake, later.t, new Date(T0.getTime() + 31 * 60_000))
    expect(later.sent).toHaveLength(2)
  })

  it('marks only a message Resend calls invalid as failed, and carries on with the rest', async () => {
    const fake = setup([row(), row()])
    let n = 0
    const t: EmailTransport = {
      name: 'test',
      send: vi.fn(async () => {
        if (n++ === 0) throw new EmailSendError('bad address', 422, 'validation_error')
        return { id: 're_ok' }
      }),
    }
    expect(await drain(fake, t)).toMatchObject({ sent: 1, failed: 1, waiting: 0 })
    expect(fake.table('email_outbox')[0]).toMatchObject({ status: 'failed', last_error: 'bad address' })
  })

  it('holds marketing behind the transactional reserve, and sends it once the day allows', async () => {
    const fake = setup([row({ kind: 'marketing', priority: 1 }), row()], { email_send_quota: [{ day: today, sent: 80 }] })
    const { t, sent } = transport()
    expect(await drain(fake, t)).toMatchObject({ sent: 1, waiting: 1, stoppedFor: 'budget' })
    expect(sent.map((s) => s.message.subject)).toEqual(['Mail 2'])
    expect(fake.table('email_outbox')[0].status).toBe('pending')
    const tomorrow = transport()
    await drain(fake, tomorrow.t, new Date('2026-11-11T00:05:00Z'))
    expect(tomorrow.sent.map((s) => s.message.subject)).toEqual(['Mail 1'])
  })

  it('applies the suppression list as it stands at send time', async () => {
    const fake = setup(
      [
        row({ intended_to: 'gone@example.test' }),
        row({ intended_to: 'parent@example.test', critical: true }),
        row({ intended_to: 'teacher@example.test', intended_cc: ['Bad@example.test'], message: { ...row().message as object, to: ['teacher@example.test'], cc: ['Bad@example.test'] } }),
      ],
      {
        email_suppressions: [
          { email: 'gone@example.test', reason: 'bounce' },
          { email: 'parent@example.test', reason: 'complaint' },
          { email: 'bad@example.test', reason: 'bounce' },
        ],
      },
    )
    const { t, sent } = transport()
    expect(await drain(fake, t)).toMatchObject({ sent: 2, suppressed: 1 })
    expect(fake.table('email_outbox')[0]).toMatchObject({ status: 'suppressed' })
    expect(sent.map((s) => s.message.to[0])).toEqual(['parent@example.test', 'teacher@example.test'])
    expect(sent[1].message.cc).toEqual([])
  })

  it('takes back a claim a killed run left behind, under the same idempotency key', async () => {
    const fake = setup([
      row({ status: 'sending', claimed_at: new Date(T0.getTime() - 11 * 60_000).toISOString(), attempts: 1 }),
      row({ status: 'sending', claimed_at: new Date(T0.getTime() - 60_000).toISOString(), attempts: 1 }),
    ])
    const { t, sent } = transport()
    const out = await drain(fake, t)
    expect(sent.map((s) => s.key)).toEqual(['email-outbox/row-1'])
    expect(out.waiting).toBe(1) // the fresh claim belongs to a run still going
  })

  it('does not send a row another run has already claimed', async () => {
    const fake = setup([row()])
    const t: EmailTransport = { name: 'test', send: vi.fn(async () => ({ id: 're' })) }
    // The race: another run claims the row after this run read it, just before
    // this run's own claim lands.
    const client = fake.client as unknown as { from: (n: string) => { update: (p: Record<string, unknown>) => unknown } }
    const realFrom = client.from
    client.from = (name: string) => {
      const b = realFrom(name)
      if (name === 'email_outbox') {
        const update = b.update.bind(b)
        b.update = (p: Record<string, unknown>) => {
          if (p.status === 'sending') Object.assign(fake.table('email_outbox')[0], { status: 'sending', claimed_at: T0.toISOString() })
          return update(p)
        }
      }
      return b
    }
    await drain(fake, t)
    expect(t.send).not.toHaveBeenCalled()
  })
})

describe('sendEmail → outbox → Resend, end to end', () => {
  it('delivers exactly the message that was refused, attachments included', async () => {
    const fake = setup()
    const message: OutgoingEmail = {
      from: 'Stellr <no-reply@mail.example.test>',
      to: ['parent@example.test'],
      cc: ['head@example.test'],
      replyTo: 'hello@example.test',
      subject: 'Your certificate',
      html: '<p>Attached</p>',
      text: 'Attached',
      headers: { 'X-Test': '1' },
      attachments: [{ filename: 'cert.pdf', content: 'JVBERi0x', contentType: 'application/pdf' }],
    }
    const id = await enqueueEmail(fake.client, {
      message, kind: 'transactional', critical: false, intendedTo: 'parent@example.test', intendedCc: ['head@example.test'], reason: 'daily_quota',
    })
    expect(id).toBeTruthy()
    const { t, sent } = transport()
    await drainEmailOutbox(fake.client, { transport: t })
    expect(sent).toHaveLength(1)
    expect(sent[0].message).toEqual(message)
    expect(sent[0].key).toBe(`email-outbox/${id}`)
  })
})

describe('deferReason', () => {
  it('waits on everything except a message Resend calls invalid', () => {
    expect(deferReason(new EmailSendError('', 429, 'daily_quota_exceeded'))).toBe('daily_quota')
    expect(deferReason(new EmailSendError('', 429, null))).toBe('daily_quota')
    expect(deferReason(new EmailSendError('', 429, 'monthly_quota_exceeded'))).toBe('monthly_quota')
    expect(deferReason(new EmailSendError('', 429, 'rate_limit_exceeded'))).toBe('rate_limit')
    for (const s of [401, 403, 404, 409, 500, 502, 503]) expect(deferReason(new EmailSendError('', s))).toBe('provider_error')
    expect(deferReason(new TypeError('fetch failed'))).toBe('provider_error')
    expect(deferReason(new EmailSendError('', 400))).toBeNull()
    expect(deferReason(new EmailSendError('', 422))).toBeNull()
  })
})
