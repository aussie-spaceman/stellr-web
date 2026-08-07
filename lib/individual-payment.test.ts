import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories are hoisted above the file body, so the spies they close
// over must be created inside vi.hoisted().
const { sendEmail, checkoutCreate, getEventBySlug, notifyCommunityAdmins } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_opts: unknown) => {}),
  checkoutCreate: vi.fn(async (_opts: unknown) => ({ url: 'https://checkout.stripe.test/session' })),
  getEventBySlug: vi.fn(async (_slug: string) => ({ stripePriceId: 'price_abc' } as { stripePriceId?: string })),
  notifyCommunityAdmins: vi.fn(async (_input: unknown) => {}),
}))

vi.mock('@/lib/email', () => ({
  sendEmail,
  groupMemberIndividualPaymentEmail: (a: { eventTitle: string }) =>
    ({ subject: `pay:${a.eventTitle}`, html: '', text: '' }),
  groupRegisteredNoPaymentEmail: (a: { eventTitle: string }) =>
    ({ subject: `free:${a.eventTitle}`, html: '', text: '' }),
}))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: (slug: string) => getEventBySlug(slug) }))
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins }))
vi.mock('stripe', () => ({
  default: class {
    checkout = { sessions: { create: checkoutCreate } }
  },
}))

import { ensureIndividualPayments } from '@/lib/individual-payment'

interface Reg { member_pays_individually: boolean }
interface Part { id: string; individual_payment_link_sent_at: string | null }

// Supabase stub covering just the three shapes the helper uses: the single
// registration lookup, the `.in()` participant lookup, and per-participant
// updates (recorded so we can assert exactly what was written).
function makeDb(registration: Reg | null, participants: Part[]) {
  const updates: Record<string, unknown>[] = []
  const db = {
    from(table: string) {
      if (table === 'registrations') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({
            data: registration
              ? { id: 'reg-1', event_slug: 'nevada-2027', event_title: 'Nevada 2027', ...registration }
              : null,
            error: null,
          }),
        }
        return chain
      }
      const chain = {
        select: () => chain,
        in: async () => ({ data: participants, error: null }),
        update: (payload: Record<string, unknown>) => {
          updates.push(payload)
          return { eq: async () => ({ error: null }) }
        },
      }
      return chain
    },
  }
  return { db: db as never, updates }
}

const PEOPLE = [
  { participantId: 'p1', email: 'a@example.com', firstName: 'Ada', lastName: 'Lovelace' },
  { participantId: 'p2', email: 'b@example.com', firstName: 'Bo', lastName: 'Nguyen' },
]

beforeEach(() => {
  vi.clearAllMocks()
  process.env.STRIPE_SECRET_KEY = 'sk_test'
  getEventBySlug.mockResolvedValue({ stripePriceId: 'price_abc' })
  checkoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.test/session' })
})

describe('ensureIndividualPayments', () => {
  it('sends a payment link to each unnotified participant on a paid event', async () => {
    const { db, updates } = makeDb(
      { member_pays_individually: true },
      [
        { id: 'p1', individual_payment_link_sent_at: null },
        { id: 'p2', individual_payment_link_sent_at: null },
      ],
    )

    const result = await ensureIndividualPayments(db, 'reg-1', PEOPLE)

    expect(result).toEqual({ charged: 2, waived: 0, skipped: 0 })
    expect(checkoutCreate).toHaveBeenCalledTimes(2)
    expect(sendEmail).toHaveBeenCalledTimes(2)
    expect(sendEmail.mock.calls.every(([a]) => (a as { subject: string }).subject.startsWith('pay:'))).toBe(true)
    // 'pending' so the webhook's "has the whole group paid?" check sees them.
    expect(updates.filter(u => u.individual_payment_status === 'pending')).toHaveLength(2)
    expect(updates.filter(u => u.individual_payment_link_sent_at != null)).toHaveLength(2)
  })

  it('waives and sends the no-payment-required notice when the event has no price', async () => {
    getEventBySlug.mockResolvedValue({} as { stripePriceId: string })
    const { db, updates } = makeDb(
      { member_pays_individually: true },
      [{ id: 'p1', individual_payment_link_sent_at: null }],
    )

    const result = await ensureIndividualPayments(db, 'reg-1', [PEOPLE[0]])

    expect(result).toEqual({ charged: 0, waived: 1, skipped: 0 })
    expect(checkoutCreate).not.toHaveBeenCalled()
    expect((sendEmail.mock.calls[0][0] as { subject: string }).subject).toBe('free:Nevada 2027')
    expect(updates.some(u => u.individual_payment_status === 'waived')).toBe(true)
    // Free and misconfigured are indistinguishable here, so staff get one alert.
    expect(notifyCommunityAdmins).toHaveBeenCalledTimes(1)
  })

  it('is idempotent — already-notified participants are skipped, not re-emailed', async () => {
    const { db } = makeDb(
      { member_pays_individually: true },
      [
        { id: 'p1', individual_payment_link_sent_at: '2026-08-01T00:00:00Z' },
        { id: 'p2', individual_payment_link_sent_at: '2026-08-01T00:00:00Z' },
      ],
    )

    const result = await ensureIndividualPayments(db, 'reg-1', PEOPLE)

    expect(result).toEqual({ charged: 0, waived: 0, skipped: 2 })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(notifyCommunityAdmins).not.toHaveBeenCalled()
  })

  it('re-sends only the participant whose earlier send failed', async () => {
    const { db } = makeDb(
      { member_pays_individually: true },
      [
        { id: 'p1', individual_payment_link_sent_at: '2026-08-01T00:00:00Z' },
        { id: 'p2', individual_payment_link_sent_at: null },
      ],
    )

    const result = await ensureIndividualPayments(db, 'reg-1', PEOPLE)

    expect(result).toEqual({ charged: 1, waived: 0, skipped: 1 })
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the group does not pay individually', async () => {
    const { db, updates } = makeDb(
      { member_pays_individually: false },
      [{ id: 'p1', individual_payment_link_sent_at: null }],
    )

    const result = await ensureIndividualPayments(db, 'reg-1', PEOPLE)

    expect(result).toEqual({ charged: 0, waived: 0, skipped: 0 })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it('leaves sent_at unstamped when the email fails, so the next sync retries', async () => {
    sendEmail.mockRejectedValueOnce(new Error('resend down'))
    const { db, updates } = makeDb(
      { member_pays_individually: true },
      [{ id: 'p1', individual_payment_link_sent_at: null }],
    )

    const result = await ensureIndividualPayments(db, 'reg-1', [PEOPLE[0]])

    expect(result.charged).toBe(0)
    expect(updates.some(u => u.individual_payment_link_sent_at != null)).toBe(false)
    // The status still landed, so the participant is visibly outstanding.
    expect(updates.some(u => u.individual_payment_status === 'pending')).toBe(true)
  })
})
