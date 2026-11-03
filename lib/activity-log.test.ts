// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'

// logActivity is best-effort by design; logActivityOrThrow is the variant for
// audit rows that are themselves a control (view-as start and end), where the
// caller must be told the write failed.

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: null }), currentUser: async () => null }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => { throw new Error('pass a client') } }))
vi.mock('@/lib/deletion/actor', () => ({ memberIdForClerkUser: async () => null }))

const { logActivity, logActivityOrThrow } = await import('./activity-log')

const entry = {
  memberId: 'm1',
  category: 'account' as const,
  action: 'impersonation_started',
  summary: 'An admin began viewing the portal as this member (read only)',
  actorType: 'admin' as const,
  actorMemberId: 'admin1',
}

describe('logActivityOrThrow', () => {
  it('writes the row', async () => {
    const db = fakeSupabase({ member_activity_log: [] })
    await logActivityOrThrow(entry, db.client)
    expect(db.table('member_activity_log')).toEqual([
      expect.objectContaining({ member_id: 'm1', action: 'impersonation_started', actor_member_id: 'admin1' }),
    ])
  })

  it('throws when the insert fails, where logActivity swallows it', async () => {
    const failing = () =>
      fakeSupabase({ member_activity_log: [] }, { failOn: (t) => (t === 'member_activity_log' ? 'insert failed' : null) })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(logActivity(entry, failing().client)).resolves.toBeUndefined()
    await expect(logActivityOrThrow(entry, failing().client)).rejects.toThrow(/insert failed/)
  })

  it('throws on a missing member rather than skipping silently', async () => {
    const db = fakeSupabase({ member_activity_log: [] })
    await expect(logActivityOrThrow({ ...entry, memberId: '' }, db.client)).rejects.toThrow(/memberId/)
    expect(db.table('member_activity_log')).toEqual([])
  })
})
