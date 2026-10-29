import { describe, it, expect, vi } from 'vitest'

// The loader's imports reach for Sanity and the service-role client; the pure
// helpers under test need neither.
vi.mock('@/lib/sanity', () => ({ getEventsBySlugs: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: vi.fn() }))

const { buildPaymentItems, countMetric, digestWindow, personName, windowOf } = await import('./admin-digest')

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
