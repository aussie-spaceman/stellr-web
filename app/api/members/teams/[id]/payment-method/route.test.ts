// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Who may change how a group pays from the portal: the teacher and the Teacher
// POC. A student manager can see it, and view-as can't write at all.

const h = vi.hoisted(() => ({
  userId: 'user_1' as string | null,
  member: { id: 'm-1', email: 'teacher@example.com' } as { id: string; email: string } | null,
  registration: null as Record<string, unknown> | null,
  impersonating: false,
  change: vi.fn(),
  view: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: h.userId }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: () => null }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => ({}) }))
vi.mock('@/lib/activity-log', () => ({ actorFromAuth: async () => ({ actorType: 'member' }), logActivity: vi.fn() }))
vi.mock('@/lib/audit/route', () => ({ withAudit: (_spec: unknown, handler: unknown) => handler }))
vi.mock('@/lib/impersonation', () => ({
  assertNotImpersonating: async () => (h.impersonating ? new Response('{}', { status: 403 }) : null),
  resolveRequestMember: async () => ({ member: h.member, unauthorised: !h.userId, impersonating: h.impersonating }),
}))
vi.mock('@/lib/group-payment-change', () => ({
  changeGroupPaymentMethod: h.change,
  paymentChangeView: h.view,
  PAYMENT_METHOD_LABEL: { invoice: 'Invoice', card: 'Card', individual: 'Individual' },
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: table === 'members' ? h.member : h.registration, error: null }),
      }
      return chain
    },
  }),
}))

import { GET, POST } from './route'

const ctx = { params: Promise.resolve({ id: 'reg-1' }) }
const REG = { id: 'reg-1', type: 'group', event_slug: 'msu', teacher_member_id: 'm-1', teacher_email: 'teacher@example.com', teacher_poc_email: null, registrant_role: 'teacher' }
const post = (body: unknown = { method: 'individual' }) =>
  POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }) as never, ctx)
const get = () => GET(new Request('http://localhost/x') as never, ctx)

beforeEach(() => {
  vi.clearAllMocks()
  h.userId = 'user_1'
  h.member = { id: 'm-1', email: 'teacher@example.com' }
  h.registration = { ...REG }
  h.impersonating = false
  h.change.mockResolvedValue({ ok: true, method: 'individual', message: 'Done.', payUrl: null })
  h.view.mockResolvedValue({ current: 'invoice', currentLabel: 'Invoice', blockedReason: null, options: [] })
})

describe('POST /api/members/teams/[id]/payment-method', () => {
  it('lets the teacher change it, as an organizer', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(h.change).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'reg-1', 'individual', expect.objectContaining({ by: 'organizer', memberId: 'm-1' }))
  })

  it('lets the Teacher POC change it', async () => {
    h.member = { id: 'm-2', email: 'poc@example.com' }
    h.registration = { ...REG, teacher_member_id: 'm-9', teacher_email: 'sm@example.com', registrant_role: 'student_manager', teacher_poc_email: 'poc@example.com' }
    expect((await post()).status).toBe(200)
  })

  it('refuses a student manager', async () => {
    h.registration = { ...REG, registrant_role: 'student_manager' }
    expect((await post()).status).toBe(403)
    expect(h.change).not.toHaveBeenCalled()
  })

  it('refuses someone who does not manage the group, as if it did not exist', async () => {
    h.member = { id: 'm-3', email: 'student@example.com' }
    expect((await post()).status).toBe(404)
    expect(h.change).not.toHaveBeenCalled()
  })

  it('refuses view-as', async () => {
    h.impersonating = true
    expect((await post()).status).toBe(403)
    expect(h.change).not.toHaveBeenCalled()
  })

  it('refuses a signed-out caller', async () => {
    h.userId = null
    expect((await post()).status).toBe(401)
  })

  it('accepts only the three existing methods', async () => {
    expect((await post({ method: 'purchase_order' })).status).toBe(400)
    expect(h.change).not.toHaveBeenCalled()
  })

  it('passes on a refusal', async () => {
    h.change.mockResolvedValue({ ok: false, status: 409, error: 'This group’s invoice has been paid.' })
    const res = await post()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'This group’s invoice has been paid.' })
  })
})

describe('GET /api/members/teams/[id]/payment-method', () => {
  it('tells the teacher they can change it', async () => {
    expect(await (await get()).json()).toMatchObject({ canChange: true, readOnlyNote: null })
  })

  it('shows a student manager the method, read-only', async () => {
    h.registration = { ...REG, registrant_role: 'student_manager' }
    expect(await (await get()).json()).toMatchObject({ currentLabel: 'Invoice', canChange: false, readOnlyNote: expect.stringContaining('teacher') })
  })

  it('is read-only in view-as', async () => {
    h.impersonating = true
    expect(await (await get()).json()).toMatchObject({ canChange: false, readOnlyNote: expect.stringContaining('viewing as') })
  })

  it('refuses someone who does not manage the group, as if it did not exist', async () => {
    h.member = { id: 'm-3', email: 'student@example.com' }
    expect((await get()).status).toBe(404)
  })
})
