// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'

// A safeguarding clearance notice is critical mail: it goes even to an address
// on the suppression list (lib/email/suppressions.ts). If sendEmail still
// reports the send as suppressed, the notice must not be recorded as emailed.

const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_opts: { to: string; critical?: boolean }): Promise<{ id: string | null; suppressed?: true }> => ({ id: 'e1' })),
}))

vi.mock('@/lib/email', () => ({ sendEmail }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: vi.fn(async () => null) }))
vi.mock('@/lib/activity-log', () => ({
  logActivity: async (
    input: { memberId: string; action: string; metadata?: Record<string, unknown> },
    db: { from: (t: string) => { insert: (row: unknown) => Promise<unknown> } },
  ) => {
    await db.from('member_activity_log').insert({ member_id: input.memberId, action: input.action, metadata: input.metadata ?? {} })
  },
}))

const { notifyClearanceRequired } = await import('./compliance-notify')

const NOW = new Date('2026-10-28T18:00:00Z')
const seed = () =>
  fakeSupabase({
    members: [{
      id: 'm1', email: 'm1@example.test', first_name: 'Ada', event_role: 'teacher', date_of_birth: '1983-02-10',
      member_teacher_licenses: [], member_background_checks: [],
    }],
  })
const input = { memberId: 'm1', eventSlug: 'utah-sdc', eventTitle: 'Utah SDC', eventDate: '2026-11-11', reason: 'registered' as const }

beforeEach(() => {
  sendEmail.mockReset()
  sendEmail.mockImplementation(async () => ({ id: 'e1' }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('notifyClearanceRequired and the suppression list', () => {
  it('sends the notice as critical mail', async () => {
    const out = await notifyClearanceRequired(seed().client, input, { now: NOW })
    expect(out).toEqual({ sent: true, emailed: true, inApp: true })
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: 'm1@example.test', critical: true })
  })

  it('a suppressed send is not recorded as emailed; the in-app notice still goes', async () => {
    sendEmail.mockResolvedValueOnce({ id: null, suppressed: true })
    const db = seed()
    const out = await notifyClearanceRequired(db.client, input, { now: NOW })
    expect(out).toEqual({ sent: true, emailed: false, inApp: true })
    expect(db.table('community_notifications')).toHaveLength(1)
    const logged = db.table('member_activity_log').find((r) => r.action === 'clearance_notice_sent')
    expect(logged?.metadata).toMatchObject({ emailed: false, inApp: true })
  })
})
