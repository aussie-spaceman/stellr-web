import { describe, it, expect, vi, beforeEach } from 'vitest'

const { sendEmail, ensurePayToken } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_opts: unknown) => {}),
  ensurePayToken: vi.fn(async (_db: unknown, _id: string) => 'tok'.padEnd(64, '0')),
}))
vi.mock('@/lib/email', () => ({
  sendEmail,
  registrationPaymentLinkEmail: (a: { eventTitle: string; payUrl: string; amountCents: number; seats?: number }) => ({
    subject: `pay:${a.eventTitle}:${a.amountCents}:${a.seats ?? ''}`,
    html: a.payUrl,
    text: a.payUrl,
  }),
}))
vi.mock('@/lib/registration-checkout', () => ({
  ensurePayToken,
  payPageUrl: (slug: string, token: string) => `https://site/register/${slug}/pay/${token}`,
}))

import { sendPayLinkEmail, PAY_LINK_COOLDOWN_MS } from '@/lib/registration-pay-link'

interface Reg {
  type: 'individual' | 'group' | 'campaign'
  status: 'pending' | 'confirmed' | 'withdrawn'
  invoice_requested?: boolean
  member_pays_individually?: boolean
  amount_due_cents?: number | null
  adult_count?: number | null
  student_count?: number | null
  teacher_first_name?: string | null
  teacher_email?: string | null
  teacher_poc_email?: string | null
  pay_link_sent_at?: string | null
}

function makeDb(registration: Reg | null, participant?: { first_name: string; email: string; emergency_contact_email: string | null } | null) {
  const updates: Record<string, unknown>[] = []
  const db = {
    from(table: string) {
      if (table === 'registrations') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          update: (payload: Record<string, unknown>) => { updates.push(payload); return { eq: async () => ({ error: null }) } },
          maybeSingle: async () => ({
            data: registration
              ? { id: 'reg-1', event_slug: 'colorado', event_title: 'Colorado SDC', amount_due_cents: 7500, ...registration }
              : null,
            error: null,
          }),
        }
        return chain
      }
      const chain = {
        select: () => chain,
        eq: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: participant ?? null, error: null }),
      }
      return chain
    },
  }
  return { db: db as never, updates }
}

const sentTo = () => sendEmail.mock.calls[0][0] as { to: string; cc: string[]; subject: string; html: string }

beforeEach(() => vi.clearAllMocks())

describe('sendPayLinkEmail — individual', () => {
  it('emails the registrant and the emergency contact with the pay page link', async () => {
    const { db, updates } = makeDb(
      { type: 'individual', status: 'pending', amount_due_cents: 7500 },
      { first_name: 'Daniel', email: 'Dan@Example.com', emergency_contact_email: 'glo@example.com' },
    )

    const r = await sendPayLinkEmail(db, 'reg-1', { force: true })

    expect(r).toEqual({ sent: true, recipients: ['dan@example.com', 'glo@example.com'] })
    expect(sentTo()).toMatchObject({
      to: 'dan@example.com',
      cc: ['glo@example.com'],
      subject: 'pay:Colorado SDC:7500:',
      html: `https://site/register/colorado/pay/${'tok'.padEnd(64, '0')}`,
    })
    expect(updates).toEqual([{ pay_link_sent_at: expect.any(String) }])
  })

  it('de-duplicates when the registrant is their own emergency contact', async () => {
    const { db } = makeDb(
      { type: 'individual', status: 'pending' },
      { first_name: 'A', email: 'a@x.org', emergency_contact_email: 'A@x.org' },
    )
    const r = await sendPayLinkEmail(db, 'reg-1', { force: true })
    expect(r.recipients).toEqual(['a@x.org'])
    expect(sentTo().cc).toEqual([])
  })

  it('honours the cooldown unless forced', async () => {
    const recent = new Date(Date.now() - PAY_LINK_COOLDOWN_MS / 2).toISOString()
    const { db } = makeDb(
      { type: 'individual', status: 'pending', pay_link_sent_at: recent },
      { first_name: 'A', email: 'a@x.org', emergency_contact_email: null },
    )

    expect(await sendPayLinkEmail(db, 'reg-1')).toEqual({ sent: false, reason: 'cooldown', recipients: [] })
    expect(sendEmail).not.toHaveBeenCalled()

    expect((await sendPayLinkEmail(db, 'reg-1', { force: true })).sent).toBe(true)
  })

  it('sends again once the cooldown has passed', async () => {
    const old = new Date(Date.now() - PAY_LINK_COOLDOWN_MS * 2).toISOString()
    const { db } = makeDb(
      { type: 'individual', status: 'pending', pay_link_sent_at: old },
      { first_name: 'A', email: 'a@x.org', emergency_contact_email: null },
    )
    expect((await sendPayLinkEmail(db, 'reg-1')).sent).toBe(true)
  })

  it('does not stamp sent_at when the send throws', async () => {
    sendEmail.mockRejectedValueOnce(new Error('resend down'))
    const { db, updates } = makeDb(
      { type: 'individual', status: 'pending' },
      { first_name: 'A', email: 'a@x.org', emergency_contact_email: null },
    )
    await expect(sendPayLinkEmail(db, 'reg-1', { force: true })).rejects.toThrow('resend down')
    expect(updates).toEqual([])
  })
})

describe('sendPayLinkEmail — group', () => {
  it('emails the organiser and teacher POC with the seat count', async () => {
    const { db } = makeDb({
      type: 'group', status: 'pending', amount_due_cents: 37500, adult_count: 1, student_count: 4,
      teacher_first_name: 'Sam', teacher_email: 'sam@school.org', teacher_poc_email: 'poc@school.org',
    })
    const r = await sendPayLinkEmail(db, 'reg-1', { force: true })
    expect(r.recipients).toEqual(['sam@school.org', 'poc@school.org'])
    expect(sentTo().subject).toBe('pay:Colorado SDC:37500:5')
  })

  it('includes admin-supplied extra recipients', async () => {
    const { db } = makeDb({ type: 'group', status: 'pending', teacher_email: 'sam@school.org' })
    const r = await sendPayLinkEmail(db, 'reg-1', { force: true, extraRecipients: ['Parent@Home.com'] })
    expect(r.recipients).toEqual(['sam@school.org', 'parent@home.com'])
  })
})

describe('sendPayLinkEmail — refuses what it cannot pay', () => {
  it.each([
    ['not_pending', null],
    ['not_pending', { type: 'individual', status: 'confirmed' }],
    ['not_card', { type: 'group', status: 'pending', invoice_requested: true, amount_due_cents: 7500 }],
    ['not_card', { type: 'group', status: 'pending', member_pays_individually: true, amount_due_cents: 7500 }],
    ['not_card', { type: 'campaign', status: 'pending', amount_due_cents: 7500 }],
    ['nothing_to_pay', { type: 'individual', status: 'pending', amount_due_cents: 0 }],
    ['nothing_to_pay', { type: 'individual', status: 'pending', amount_due_cents: null }],
  ] as [string, Reg | null][])('%s', async (reason, reg) => {
    const { db } = makeDb(reg)
    expect(await sendPayLinkEmail(db, 'reg-1', { force: true })).toEqual({ sent: false, reason, recipients: [] })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(ensurePayToken).not.toHaveBeenCalled()
  })

  it('no_recipient when nobody has an address', async () => {
    const { db } = makeDb({ type: 'individual', status: 'pending' }, null)
    expect(await sendPayLinkEmail(db, 'reg-1', { force: true })).toEqual({ sent: false, reason: 'no_recipient', recipients: [] })
  })
})
