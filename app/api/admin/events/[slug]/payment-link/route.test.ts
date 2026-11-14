import { describe, it, expect, vi, beforeEach } from 'vitest'
import { eventRouteFor, eventRouteRefused } from '@/test/fixtures/event-route'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

const OTHER_TENANT = '11111111-1111-4111-8111-111111111111'

const { requireEventRoute, regLookup, eventLookup, reads, sendPayLinkEmail, logActivity } = vi.hoisted(() => ({
  requireEventRoute: vi.fn(),
  regLookup: vi.fn(async (): Promise<{ data: unknown; error: null }> => ({ data: null, error: null })),
  // The events mirror's owner read (refuseUnlessStellrEvent). No row reads as Stellr's.
  eventLookup: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: null, error: null })),
  reads: [] as string[],
  sendPayLinkEmail: vi.fn(async (_db: unknown, _id: string, _opts: unknown) => ({
    sent: true,
    recipients: ['dan@example.com', 'glo@example.com'],
  })),
  logActivity: vi.fn(async (_entry: unknown, _db: unknown) => {}),
}))

vi.mock('@/lib/authz', () => ({ requireEventRoute }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      reads.push(table)
      const chain = {
        select: () => chain,
        eq: () => chain,
        not: () => chain,
        limit: () => chain,
        maybeSingle:
          table === 'registrations' ? regLookup : table === 'events' ? eventLookup : async () => ({ data: { member_id: 'm-1' }, error: null }),
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
  requireEventRoute.mockImplementation(async (slug: string) => eventRouteFor(slug))
  regLookup.mockResolvedValue({ data: PENDING, error: null })
  eventLookup.mockResolvedValue({ data: null, error: null })
  reads.length = 0
})

describe('POST /api/admin/events/[slug]/payment-link', () => {
  it('403s without event access', async () => {
    requireEventRoute.mockResolvedValue(eventRouteRefused(403))
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

  it('a Stellr event in the mirror goes on as before, after one owner read', async () => {
    eventLookup.mockResolvedValue({ data: { tenant_id: STELLR_TENANT_ID }, error: null })
    const res = await post({ registrationId: 'reg-1' })
    expect(res.status).toBe(200)
    expect(sendPayLinkEmail).toHaveBeenCalledTimes(1)
    expect(reads.filter((t) => t === 'events')).toHaveLength(1)
  })

  it('404s another tenant\'s event for a Stellr admin, before the registration is read or anyone is emailed', async () => {
    eventLookup.mockResolvedValue({ data: { tenant_id: OTHER_TENANT }, error: null })
    const res = await post({ registrationId: 'reg-1' })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    expect(regLookup).not.toHaveBeenCalled()
    expect(sendPayLinkEmail).not.toHaveBeenCalled()
    expect(logActivity).not.toHaveBeenCalled()
  })

  it('a failed read of the event\'s owner is a retryable 503, never Stellr\'s', async () => {
    eventLookup.mockResolvedValue({ data: null, error: { code: '57014', message: 'statement timeout' } })
    const res = await post({ registrationId: 'reg-1' })
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('5')
    expect(regLookup).not.toHaveBeenCalled()
    expect(sendPayLinkEmail).not.toHaveBeenCalled()
  })

  it('the staff check comes first: a refused caller causes no owner read', async () => {
    requireEventRoute.mockResolvedValue(eventRouteRefused(403))
    eventLookup.mockResolvedValue({ data: { tenant_id: OTHER_TENANT }, error: null })
    expect((await post({ registrationId: 'reg-1' })).status).toBe(403)
    expect(reads).toEqual([])
  })

  it('surfaces a refused send as 400', async () => {
    sendPayLinkEmail.mockResolvedValue({ sent: false, reason: 'no_recipient', recipients: [] } as never)
    const res = await post({ registrationId: 'reg-1' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('no_recipient') })
  })
})
