import { afterEach, describe, expect, it, vi } from 'vitest'
import { canSend, dailyCap, marketingCap, recordSend, transactionalReserve, utcDay } from '@/lib/email-budget'

// deep review INT-2 / PUB-4: the shared daily Resend budget and its
// transactional reserve. A db stub stands in for the one `email_send_quota`
// row; we drive the stored count and the read outcome per test.

type ReadResult = { data: { sent: number } | null; error: { message: string } | null }

function quotaDb(read: ReadResult, rpc?: (name: string, args: unknown) => Promise<{ error: unknown }>) {
  return {
    from() {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => read }) }),
      }
    },
    rpc: rpc ?? (async () => ({ error: null })),
  }
}

const stored = (sent: number): ReadResult => ({ data: { sent }, error: null })
const readError = (): ReadResult => ({ data: null, error: { message: 'connection reset' } })

afterEach(() => {
  delete process.env.EMAIL_DAILY_CAP
  delete process.env.EMAIL_TRANSACTIONAL_RESERVE
  vi.restoreAllMocks()
})

describe('budget configuration', () => {
  it('defaults to 100/day with a 20 reserve (marketing cap 80)', () => {
    expect(dailyCap()).toBe(100)
    expect(transactionalReserve()).toBe(20)
    expect(marketingCap()).toBe(80)
  })

  it('is overridable from the environment', () => {
    process.env.EMAIL_DAILY_CAP = '50'
    process.env.EMAIL_TRANSACTIONAL_RESERVE = '10'
    expect(dailyCap()).toBe(50)
    expect(marketingCap()).toBe(40)
  })

  it('clamps the reserve below the cap so marketing always keeps a slot', () => {
    process.env.EMAIL_DAILY_CAP = '100'
    process.env.EMAIL_TRANSACTIONAL_RESERVE = '500'
    expect(transactionalReserve()).toBe(99)
    expect(marketingCap()).toBe(1)
  })

  it('keys the counter by UTC day', () => {
    expect(utcDay(new Date('2026-10-10T23:30:00Z'))).toBe('2026-10-10')
  })
})

describe('canSend — transactional is never blocked (fail-safe)', () => {
  it('allows transactional mail even when the day is at the hard cap', async () => {
    const db = quotaDb(stored(100))
    expect(await canSend('transactional', db as never)).toBe(true)
  })

  it('allows transactional mail even when the counter read fails', async () => {
    const db = quotaDb(readError())
    expect(await canSend('transactional', db as never)).toBe(true)
  })
})

describe('canSend — marketing is held back to protect the reserve', () => {
  it('allows marketing while the non-reserved budget remains', async () => {
    expect(await canSend('marketing', quotaDb(stored(79)) as never)).toBe(true)
  })

  it('refuses marketing once the non-reserved budget is spent, leaving the reserve', async () => {
    // 80 sent of a 100 cap / 20 reserve: marketing is done, 20 remain for
    // transactional only.
    expect(await canSend('marketing', quotaDb(stored(80)) as never)).toBe(false)
  })

  it('fails CLOSED for marketing when the counter read fails', async () => {
    expect(await canSend('marketing', quotaDb(readError()) as never)).toBe(false)
  })
})

describe('recordSend', () => {
  it('atomically bumps the day counter via the RPC, best-effort', async () => {
    const rpc = vi.fn(async () => ({ error: null }))
    await recordSend(quotaDb(stored(1), rpc) as never, new Date('2026-10-10T12:00:00Z'))
    expect(rpc).toHaveBeenCalledWith('bump_email_quota', { p_day: '2026-10-10' })
  })

  it('never throws when the increment errors (the mail already went out)', async () => {
    const rpc = vi.fn(async () => ({ error: { message: 'db down' } }))
    await expect(recordSend(quotaDb(stored(1), rpc) as never)).resolves.toBeUndefined()
  })
})
