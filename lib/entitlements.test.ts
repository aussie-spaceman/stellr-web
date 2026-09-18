import { describe, it, expect, vi, afterEach } from 'vitest'

// ensureMemberGrants is best-effort per membership. Until Sept 2026 a failing
// grant was swallowed with .catch(() => {}); this pins that it now logs and
// still continues to the next membership.
const rpc = vi.fn()
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({
            data: [
              { id: 'm-bad', expires_at: null },
              { id: 'm-good', expires_at: null },
            ],
          }),
        }),
      }),
    }),
    schema: () => ({ rpc }),
  }),
}))

import { ensureMemberGrants } from './entitlements'

afterEach(() => vi.restoreAllMocks())

describe('ensureMemberGrants', () => {
  it('logs a failed grant and still grants the next membership', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
      .mockResolvedValueOnce({ data: 2, error: null })

    await ensureMemberGrants('member-1')

    expect(rpc).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenCalledWith(
      '[entitlements] grantTierAllocations failed:',
      expect.objectContaining({ membershipId: 'm-bad', error: 'grantTierAllocations: boom' }),
    )
  })
})
