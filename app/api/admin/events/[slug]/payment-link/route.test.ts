import { describe, it, expect, vi, beforeEach } from 'vitest'

const { requireEventAccess, regLookup, sendPayLinkEmail, logActivity } = vi.hoisted(() => ({
  requireEventAccess: vi.fn(async (_slug: string): Promise<{ ok: boolean; status: number }> => ({ ok: true, status: 200 })),
  regLookup: vi.fn(async (): Promise<{ data: unknown; error: null }> => ({ data: null, error: null })),
  sendPayLinkEmail: vi.fn(async (_db: unknown, _id: string, _opts: unknown) => ({
    sent: true,
    recipients: ['dan@example.com', 'glo@example.com'],
  })),
  logActivity: vi.fn(async (_entry: unknown, _db: unknown) => {}),
}))

vi.mock('@/lib/event-access', () => ({ requireEventAccess }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        not: () => chain,
        limit: () => chain,
        maybeSingle: table === 'registrations' ? regLookup : async () => ({ data: { member_id: 'm-1' }, error: null }),
      }
      return chain
    },
  }),
}))
vi.mock('@/lib/registration-pay-link', () => ({ sendPayLinkEmail }))
vi.mock('@/lib/activity-log', () => ({ actorFromAuth: async () => ({ actorMemberId: 'admin-1' }), logActivity }))

const { POST } = await import('./route')

const PENDING = { id: 'reg-1', event_slug: 'colorado', status: 'pending', invoice_requested: false, member_pays_individually: false, teacher_member_id: null }

function post(body: unknown, slug = 'colorado') {
  return POST(
    new Request(`https://www.stellreducation.org/api/admin/events/${slug}/payment-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  requireEventAccess.mockResolvedValue({ ok: true, status: 200 })
  regLookup.mockResolvedValue({ data: PENDING, error: null })
})

describe('POST /api/admin/events/[slug]/payment-link', () => {
  it('403s without event access', async () => {
    requireEventAccess.mockResolvedValue({ ok: false, status: 403 })
    expect((await post({ registrationId: 'reg-1' })).status).toBe(403)
    expect(sendPayLinkEmail).not.toHaveBeenCalled()
  })

  it('404s a registration on a different event', async () => {
    expect((await post({ registrationId: 'reg-1' }, 'texas')).status).toBe(404)
  })

  it.each([
    ['confirmed', { ...PENDING, status: 'confirmed' }],
    ['invoiced', { ...PENDING, invoice_requested: true }],
    ['members pay individually', { ...PENDING, member_pays_individually: true }],
  ])('400s a %s registration', async (_label, reg) => {
    regLookup.mockResolvedValue({ data: reg, error: null })
    expect((await post({ registrationId: 'reg-1' })).status).toBe(400)
    expect(sendPayLinkEmail).not.toHaveBeenCalled()
  })

  it('rejects a malformed extra recipient before sending', async () => {
    const res = await post({ registrationId: 'reg-1', extraRecipients: ['not-an-email'] })
    expect(res.status).toBe(400)
    expect(sendPayLinkEmail).not.toHaveBeenCalled()
  })

  it('sends (forced, with extras), logs, and returns masked recipients', async () => {
    const res = await post({ registrationId: 'reg-1', extraRecipients: [' glo@example.com '] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, recipients: ['d***@example.com', 'g***@example.com'] })
    expect(sendPayLinkEmail).toHaveBeenCalledWith(expect.anything(), 'reg-1', { force: true, extraRecipients: ['glo@example.com'] })
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'm-1', category: 'billing', action: 'payment_link_sent' }),
      expect.anything(),
    )
  })

  it('surfaces a refused send as 400', async () => {
    sendPayLinkEmail.mockResolvedValue({ sent: false, reason: 'no_recipient', recipients: [] } as never)
    const res = await post({ registrationId: 'reg-1' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('no_recipient') })
  })
})
