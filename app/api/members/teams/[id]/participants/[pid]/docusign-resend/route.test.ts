// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

const { remind, state } = vi.hoisted(() => ({
  remind: vi.fn(async () => 1),
  state: { db: null as FakeDb | null },
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: 'clerk-teacher' }) }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/esign/operations', () => ({ remindEnvelopeRow: remind }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => state.db!.client }))

const { POST } = await import('./route')

const DAY = 24 * 60 * 60 * 1000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

function seed(envelopes: Record<string, unknown>[]) {
  state.db = fakeSupabase({
    members: [{ id: 'teacher', email: 't@school.test', clerk_user_id: 'clerk-teacher', is_active: true }],
    registrations: [
      { id: 'reg-mine', teacher_member_id: 'teacher', teacher_email: 't@school.test', teacher_poc_email: null },
      { id: 'reg-other', teacher_member_id: 'someone-else', teacher_email: 'x@other.test', teacher_poc_email: null },
    ],
    participants: [
      { id: 'p-mine', registration_id: 'reg-mine' },
      { id: 'p-other', registration_id: 'reg-other' },
    ],
    docusign_envelopes: envelopes,
  })
}

const post = (reg: string, pid: string) =>
  POST(new NextRequest(`https://app.test/api/members/teams/${reg}/participants/${pid}/docusign-resend`, { method: 'POST' }), {
    params: Promise.resolve({ id: reg, pid }),
  })

beforeEach(() => vi.clearAllMocks())

describe('POST team docusign-resend', () => {
  it('refuses a participant from another group, even to that group’s own URL shape', async () => {
    seed([{ id: 'e1', participant_id: 'p-other', envelope_id: 'env', status: 'sent', sent_at: ago(10), created_at: ago(10) }])
    // The organiser owns reg-mine; p-other belongs to reg-other.
    const res = await post('reg-mine', 'p-other')
    expect(res.status).toBe(404)
    expect(remind).not.toHaveBeenCalled()
  })

  it('re-sends the newest agreement after a void and reissue', async () => {
    seed([
      { id: 'old', participant_id: 'p-mine', envelope_id: 'env-old', status: 'voided', sent_at: ago(20), created_at: ago(20) },
      { id: 'new', participant_id: 'p-mine', envelope_id: 'env-new', provider: 'docusign', status: 'sent', sent_at: ago(8), created_at: ago(8) },
    ])
    const res = await post('reg-mine', 'p-mine')
    expect(res.status).toBe(200)
    expect(remind).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ envelope_id: 'env-new' }))
  })

  it('will not re-send a cancelled agreement', async () => {
    seed([{ id: 'e1', participant_id: 'p-mine', envelope_id: 'env', status: 'voided', sent_at: ago(10), created_at: ago(10) }])
    expect((await post('reg-mine', 'p-mine')).status).toBe(400)
    expect(remind).not.toHaveBeenCalled()
  })

  it('holds the first reminder for 7 days, then allows one a day', async () => {
    seed([{ id: 'e1', participant_id: 'p-mine', envelope_id: 'env', status: 'sent', sent_at: ago(3), created_at: ago(3) }])
    expect((await post('reg-mine', 'p-mine')).status).toBe(429)

    seed([{ id: 'e1', participant_id: 'p-mine', envelope_id: 'env', status: 'sent', sent_at: ago(10), created_at: ago(10), last_manual_resend_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() }])
    expect((await post('reg-mine', 'p-mine')).status).toBe(429)

    seed([{ id: 'e1', participant_id: 'p-mine', envelope_id: 'env', status: 'sent', sent_at: ago(10), created_at: ago(10), last_manual_resend_at: ago(2) }])
    expect((await post('reg-mine', 'p-mine')).status).toBe(200)
    expect(state.db!.table('docusign_envelopes')[0].last_manual_resend_at).not.toBe(ago(2))
  })

  it('403s a member who does not own the group', async () => {
    seed([])
    expect((await post('reg-other', 'p-other')).status).toBe(403)
  })
})
