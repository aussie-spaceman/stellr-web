// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// A new reaction needs a target the member can see. The rule itself is tested in
// lib/community-content-visibility.test.ts; these hold the route to it.

const TARGET_ID = '11111111-1111-4111-8111-111111111111'

const h = vi.hoisted(() => ({
  canSee: true,
  existing: null as { id: string } | null,
  inserted: [] as Record<string, unknown>[],
  deleted: 0,
  post: vi.fn(),
  comment: vi.fn(),
}))

vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/onboarded-member', () => ({ getOnboardedMember: async () => ({ id: 'm1' }) }))
vi.mock('@/lib/community', () => ({ communityWriteBlock: async () => null }))
vi.mock('@/lib/spaces', () => ({
  memberCanSeePost: (...a: unknown[]) => (h.post(...a), h.canSee),
  memberCanSeeComment: (...a: unknown[]) => (h.comment(...a), h.canSee),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => {
    const q = {
      from: () => q,
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: h.existing, error: null }),
      delete: () => {
        h.deleted += 1
        return q
      },
      insert: async (row: Record<string, unknown>) => {
        h.inserted.push(row)
        return { error: null }
      },
    }
    return q
  },
}))

import { POST } from './route'

const react = (targetType: string) =>
  POST(new Request('http://localhost/api/community/reactions', {
    method: 'POST',
    body: JSON.stringify({ targetType, targetId: TARGET_ID, emoji: '🎉' }),
  }))

beforeEach(() => {
  vi.clearAllMocks()
  h.canSee = true
  h.existing = null
  h.inserted = []
  h.deleted = 0
})

describe('POST /api/community/reactions', () => {
  it('reacts to a post the member can see', async () => {
    const res = await react('post')
    expect(await res.json()).toEqual({ reacted: true })
    expect(h.post).toHaveBeenCalledWith({ id: 'm1' }, TARGET_ID)
    expect(h.inserted).toEqual([{ target_type: 'post', target_id: TARGET_ID, author_member_id: 'm1', emoji: '🎉' }])
  })

  it('reacts to a comment through the comment rule', async () => {
    const res = await react('comment')
    expect(await res.json()).toEqual({ reacted: true })
    expect(h.comment).toHaveBeenCalledWith({ id: 'm1' }, TARGET_ID)
    expect(h.post).not.toHaveBeenCalled()
  })

  it.each(['post', 'comment'])('a %s the member cannot see: 404, nothing stored', async (targetType) => {
    h.canSee = false
    const res = await react(targetType)
    expect(res.status).toBe(404)
    expect(h.inserted).toEqual([])
  })

  it('the member can always take back their own reaction, seen or not', async () => {
    h.canSee = false
    h.existing = { id: 'r1' }
    const res = await react('post')
    expect(await res.json()).toEqual({ reacted: false })
    expect(h.deleted).toBe(1)
    expect(h.inserted).toEqual([])
  })
})
