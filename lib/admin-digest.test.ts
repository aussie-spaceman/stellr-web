import { describe, it, expect, vi } from 'vitest'

// The loader's imports reach for Sanity and the service-role client; the pure
// helpers under test need neither.
vi.mock('@/lib/sanity', () => ({ getEventsBySlugs: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: vi.fn() }))

const { buildPaymentItems, countMetric, digestWindow, personName, windowOf, outboxHealth, loadOutboxHealth, stuckOutboxes, OUTBOX_JOBS } = await import('./admin-digest')
const { fakeSupabase } = await import('@/test/fake-supabase')

const NOW = new Date('2026-10-30T18:00:00Z')

describe('digestWindow', () => {
  it('is the last N days, compared with the N days before', () => {
    expect(digestWindow(7, NOW)).toEqual({
      days: 7,
      prevStart: '2026-10-16T18:00:00.000Z',
      start: '2026-10-23T18:00:00.000Z',
      end: '2026-10-30T18:00:00.000Z',
    })
  })
})

describe('countMetric', () => {
  const w = digestWindow(7, NOW)
  it('puts each row in this window, the previous one, or neither', () => {
    expect(windowOf('2026-10-23T18:00:00.000Z', w)).toBe('current')
    expect(windowOf('2026-10-23T17:59:59.999Z', w)).toBe('previous')
    expect(windowOf('2026-10-10T00:00:00Z', w)).toBeNull()
    expect(windowOf(null, w)).toBeNull()
    const rows = ['2026-10-29T00:00:00Z', '2026-10-25T00:00:00Z', '2026-10-20T00:00:00Z', '2026-01-01T00:00:00Z']
    expect(countMetric(rows, (r) => r, w)).toEqual({ current: 2, previous: 1 })
  })
})

describe('personName', () => {
  it('falls back to the email, then to a placeholder, for members with no name', () => {
    expect(personName({ first_name: 'Ava', last_name: 'Ng' })).toBe('Ava Ng')
    expect(personName({ first_name: '', last_name: null, email: 'teacher@school.org' })).toBe('teacher@school.org')
    expect(personName(null)).toBe('Unnamed member')
  })
})

describe('buildPaymentItems', () => {
  const reg = (over: Record<string, unknown>) => ({
    id: 'r1', event_slug: 'nv', event_title: 'Nevada', type: 'individual', status: 'pending', created_at: '2026-10-01T00:00:00Z',
    amount_due_cents: 5900, invoice_requested: false, invoice_paid_at: null, member_pays_individually: false,
    teacher_first_name: null, teacher_last_name: null, school_name: null, group_name: null,
    participants: [{ id: 'p1', first_name: 'Sam', last_name: 'Lee', date_of_birth: '2010-05-01', individual_payment_status: null }],
    ...over,
  })
  const upcoming = (slug: string) => slug !== 'past'
  const title = (_slug: string, fallback: string | null) => fallback ?? 'Event'
  const build = (regs: ReturnType<typeof reg>[], invoices: Parameters<typeof buildPaymentItems>[1] = []) =>
    buildPaymentItems(regs, invoices, upcoming, title)

  it('lists an unfinished card checkout for an upcoming event, and flags a minor registrant', () => {
    const [item] = build([reg({})])
    expect(item).toMatchObject({ kind: 'checkout', who: 'Sam Lee', minor: true, amountCents: 5900, detail: 'Checkout not completed' })
  })

  it('drops an unfinished checkout once the event is past', () => {
    expect(build([reg({ event_slug: 'past' })])).toEqual([])
  })

  it('keeps an unpaid invoice whatever the event date, using the open Stripe invoice', () => {
    const [item] = build(
      [reg({ event_slug: 'past', type: 'group', invoice_requested: true, teacher_first_name: 'Jo', teacher_last_name: 'Park', school_name: 'Lincoln HS' })],
      [{ registration_id: 'r1', total_cents: 148410, stripe_invoice_number: 'INV-7', created_at: '2026-10-29T00:00:00Z' }],
    )
    expect(item).toMatchObject({ kind: 'invoice', who: 'Jo Park · Lincoln HS', minor: false, amountCents: 148410, detail: 'Invoice INV-7 unpaid' })
  })

  it('skips what registrationPaid() counts as paid, and withdrawn registrations', () => {
    expect(build([
      reg({ status: 'confirmed' }),
      reg({ id: 'r2', invoice_requested: true, invoice_paid_at: '2026-10-02T00:00:00Z' }),
      reg({ id: 'r3', status: 'withdrawn' }),
      reg({ id: 'r4', amount_due_cents: 0 }),
    ])).toEqual([])
  })

  it('counts unpaid seats when members pay individually, ignoring paid and waived ones', () => {
    const [item] = build([reg({
      type: 'group', member_pays_individually: true, teacher_first_name: 'Jo',
      participants: [
        { id: 'a', first_name: 'A', last_name: null, date_of_birth: null, individual_payment_status: 'paid' },
        { id: 'b', first_name: 'B', last_name: null, date_of_birth: null, individual_payment_status: 'waived' },
        { id: 'c', first_name: 'C', last_name: null, date_of_birth: null, individual_payment_status: 'pending' },
      ],
    })])
    expect(item).toMatchObject({ kind: 'seats', amountCents: null, detail: '1 of 3 paying individually hasn’t paid' })
  })

  it('puts the oldest debt first', () => {
    const items = build([
      reg({ id: 'new', created_at: '2026-10-20T00:00:00Z' }),
      reg({ id: 'old', created_at: '2026-09-01T00:00:00Z' }),
    ])
    expect(items.map((i) => i.key)).toEqual(['checkout:old', 'checkout:new'])
  })
})

// ── resend-quota-outbox.5: staff see a stuck outbox ──────────────────────────

describe('outbox health', () => {
  const now = new Date('2026-11-13T15:00:00Z')
  const [EMAIL, SIGNING] = OUTBOX_JOBS
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString()
  const run = (h: number, ok: boolean, over: Record<string, unknown> = {}) => ({
    started_at: hoursAgo(h + 0.01), finished_at: hoursAgo(h), ok, errors: [], result: {}, ...over,
  })

  it('healthy: the latest email-outbox run succeeded inside its window', () => {
    const h = outboxHealth(EMAIL, [run(3, true), run(9, true)], null, now)
    expect(h).toMatchObject({ key: 'email', state: 'ok', lastRunAt: hoursAgo(3), lastSuccessAt: hoursAgo(3), detail: null })
    expect(stuckOutboxes([h!])).toEqual([])
  })

  it('stuck: the latest run failed on stale mail, with the last success time and counts only', () => {
    const latest = run(1, false, {
      errors: [{ where: 'stale', message: '7 email(s) waiting; the oldest for 50h' }],
      result: { waiting: 7, oldestWaitingHours: 50, sent: 0 },
    })
    const h = outboxHealth(EMAIL, [latest, run(7, false), run(13, true)], null, now)!
    expect(h.state).toBe('failed')
    expect(h.lastSuccessAt).toBe(hoursAgo(13))
    expect(h.detail).toBe('Mail has been waiting more than two days. 7 waiting, the oldest for 50 hours')
    expect(stuckOutboxes([h])).toEqual([h])
  })

  it('never shows an error’s own text, which could carry an address', () => {
    const latest = run(1, false, { errors: [{ where: 'drain', message: 'refused for someone@example.org' }] })
    const h = outboxHealth(EMAIL, [latest], null, now)!
    expect(h.detail).toBe('The run stopped with an error')
    expect(JSON.stringify(h)).not.toContain('example.org')
  })

  it('overdue: the latest run did not fail, but nothing has succeeded within the window', () => {
    const h = outboxHealth(EMAIL, [run(20, true)], null, now)!
    expect(h).toMatchObject({ state: 'overdue', lastSuccessAt: hoursAgo(20) })
  })

  it('every recorded run failed: the success found further back is used, or none', () => {
    expect(outboxHealth(EMAIL, [run(1, false)], hoursAgo(100), now)).toMatchObject({ state: 'failed', lastSuccessAt: hoursAgo(100) })
    expect(outboxHealth(EMAIL, [run(1, false)], null, now)).toMatchObject({ state: 'failed', lastSuccessAt: null })
  })

  it('an outbox with no recorded run is left out, not shown as stuck', () => {
    expect(outboxHealth(EMAIL, [], null, now)).toBeNull()
  })

  it('signing: only the maintenance run’s outbox step counts, not its other steps', () => {
    const otherStep = run(2, false, { errors: [{ where: 'archive', message: 'x' }] })
    expect(outboxHealth(SIGNING, [otherStep], null, now)).toMatchObject({ state: 'ok', lastSuccessAt: hoursAgo(2) })
    const outboxStep = run(2, false, { errors: [{ where: 'outbox', message: 'x' }] })
    expect(outboxHealth(SIGNING, [outboxStep, run(26, true)], null, now)).toMatchObject({
      state: 'failed', lastSuccessAt: hoursAgo(26), detail: 'Sending the waiting invitations failed',
    })
    // Daily: 26 hours since the last success is still inside the window.
    expect(outboxHealth(SIGNING, [run(26, true)], null, now)).toMatchObject({ state: 'ok' })
    expect(outboxHealth(SIGNING, [run(31, true)], null, now)).toMatchObject({ state: 'overdue' })
  })

  describe('loadOutboxHealth (the digest and dashboard data)', () => {
    const cron = (job: string, h: number, ok: boolean, over: Record<string, unknown> = {}) => ({ job, ...run(h, ok), ...over })

    it('stuck: reports the failed email outbox with its last success, and a healthy signing outbox', async () => {
      const db = fakeSupabase({
        cron_runs: [
          cron('email-outbox', 1, false, { errors: [{ where: 'rejected', message: '2 email(s) rejected' }], result: { waiting: 0, failed: 2 } }),
          cron('email-outbox', 7, true),
          cron('esign-maintenance', 5, true),
          cron('event-emails', 0.5, false),
          // Still running: not a result yet.
          { job: 'email-outbox', started_at: hoursAgo(0.1), finished_at: null, ok: null, errors: [], result: null },
        ],
      })
      const health = await loadOutboxHealth(db.client as never, now)
      expect(health).toEqual([
        expect.objectContaining({ key: 'email', state: 'failed', lastRunAt: hoursAgo(1), lastSuccessAt: hoursAgo(7), detail: 'Resend rejected some mail as invalid' }),
        expect.objectContaining({ key: 'signing', state: 'ok', lastSuccessAt: hoursAgo(5) }),
      ])
      expect(stuckOutboxes(health).map((o) => o.key)).toEqual(['email'])
    })

    it('healthy: nothing to show', async () => {
      const db = fakeSupabase({ cron_runs: [cron('email-outbox', 2, true), cron('esign-maintenance', 10, true)] })
      expect(stuckOutboxes(await loadOutboxHealth(db.client as never, now))).toEqual([])
    })

    it('no runs recorded (crons skip outside production): no entries', async () => {
      expect(await loadOutboxHealth(fakeSupabase({ cron_runs: [] }).client as never, now)).toEqual([])
    })

    it('looks further back for the last success when every recent run failed', async () => {
      const failures = Array.from({ length: 30 }, (_, i) => cron('email-outbox', 1 + i * 6, false, { errors: [{ where: 'stale' }] }))
      const db = fakeSupabase({ cron_runs: [...failures, cron('email-outbox', 400, true)] })
      const [email] = await loadOutboxHealth(db.client as never, now)
      expect(email).toMatchObject({ state: 'failed', lastSuccessAt: hoursAgo(400) })
    })

    it('a failed read throws, so the digest reports the section instead of hiding it', async () => {
      const db = fakeSupabase({ cron_runs: [] }, { failOn: (t) => (t === 'cron_runs' ? 'cron_runs unreadable' : null) })
      await expect(loadOutboxHealth(db.client as never, now)).rejects.toThrow('cron_runs unreadable')
    })
  })
})
