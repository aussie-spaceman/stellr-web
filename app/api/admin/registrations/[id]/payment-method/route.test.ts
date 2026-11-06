// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Staff changing how a group pays: admins, and event managers assigned to that
// event. (The invoice route beside this one lets event managers only read.)

const h = vi.hoisted(() => ({
  access: { ok: true, userId: 'user_1', isAdmin: true, assignedSlugs: null } as Record<string, unknown>,
  covers: true,
  registration: { event_slug: 'msu', type: 'group', teacher_member_id: 'm-t' } as Record<string, unknown> | null,
  change: vi.fn(),
  view: vi.fn(),
  log: vi.fn(),
}))

vi.mock('@/lib/authz', () => ({ requireEventAccess: async () => h.access, accessCoversEvent: async () => h.covers }))
vi.mock('@/lib/audit/route', () => ({ withAudit: (_spec: unknown, handler: unknown) => handler }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => ({}) }))
vi.mock('@/lib/activity-log', () => ({ actorFromAuth: async () => ({ actorType: 'admin', actorMemberId: 'm-admin' }), logActivity: h.log }))
vi.mock('@/lib/group-payment-change', () => ({
  changeGroupPaymentMethod: h.change,
  paymentChangeView: h.view,
  PAYMENT_METHOD_LABEL: { invoice: 'Invoice', card: 'Card', individual: 'Individual' },
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => {
    const chain = { from: () => chain, select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: h.registration, error: null }) }
    return chain
  },
}))

import { GET, POST } from './route'

const ctx = { params: Promise.resolve({ id: 'reg-1' }) }
const post = (body: unknown = { method: 'individual' }) => POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }), ctx)

beforeEach(() => {
  vi.clearAllMocks()
  h.access = { ok: true, userId: 'user_1', isAdmin: true, assignedSlugs: null }
  h.covers = true
  h.registration = { event_slug: 'msu', type: 'group', teacher_member_id: 'm-t' }
  h.change.mockResolvedValue({ ok: true, method: 'individual', message: 'Done.', payUrl: null })
  h.view.mockResolvedValue({ current: 'invoice', currentLabel: 'Invoice', blockedReason: null, options: [] })
})

describe('/api/admin/registrations/[id]/payment-method', () => {
  it('lets an admin change it, and logs it against the organizer', async () => {
    expect((await post()).status).toBe(200)
    expect(h.change).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'reg-1', 'individual', expect.objectContaining({ by: 'staff' }))
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'm-t', action: 'group_payment_method_changed' }), expect.anything())
  })

  it('lets an event manager assigned to the event change it', async () => {
    h.access = { ok: true, userId: 'user_2', isAdmin: false, assignedSlugs: ['msu'] }
    expect((await post()).status).toBe(200)
  })

  it('refuses an event manager on another event, reading or writing', async () => {
    h.access = { ok: true, userId: 'user_2', isAdmin: false, assignedSlugs: ['other'] }
    h.covers = false
    expect((await post()).status).toBe(404)
    expect((await GET(new Request('http://localhost/x'), ctx)).status).toBe(404)
    expect(h.change).not.toHaveBeenCalled()
  })

  it('refuses someone without event access', async () => {
    h.access = { ok: false, status: 403 }
    expect((await post()).status).toBe(403)
  })

  it('is for group registrations only', async () => {
    h.registration = { event_slug: 'msu', type: 'individual', teacher_member_id: null }
    expect((await post()).status).toBe(404)
  })

  it('passes on a refusal without logging', async () => {
    h.change.mockResolvedValue({ ok: false, status: 409, error: 'Paid.' })
    expect((await post()).status).toBe(409)
    expect(h.log).not.toHaveBeenCalled()
  })
})
