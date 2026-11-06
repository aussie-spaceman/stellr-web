// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// A member reports content they can see. The rule itself is tested in
// lib/community-content-visibility.test.ts; these hold the route to it.

const POST_ID = '11111111-1111-4111-8111-111111111111'
const CONTAINER_ID = '22222222-2222-4222-8222-222222222222'

const h = vi.hoisted(() => ({
  member: { id: 'm1' } as { id: string } | null,
  canSee: true,
  existing: null as { id: string } | null,
  inserted: [] as Record<string, unknown>[],
  post: vi.fn(),
  comment: vi.fn(),
  resource: vi.fn(),
}))

vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/onboarded-member', () => ({ getOnboardedMember: async () => h.member }))
vi.mock('@/lib/spaces', () => ({
  memberCanSeePost: (...a: unknown[]) => (h.post(...a), h.canSee),
  memberCanSeeComment: (...a: unknown[]) => (h.comment(...a), h.canSee),
}))
vi.mock('@/lib/resources-catalogue', () => ({
  memberCanSeeResource: (...a: unknown[]) => (h.resource(...a), h.canSee),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => {
    const q = {
      from: () => q,
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: h.existing, error: null }),
      insert: async (row: Record<string, unknown>) => {
        h.inserted.push(row)
        return { error: null }
      },
    }
    return q
  },
}))

import { POST } from './route'

const flag = (body: Record<string, unknown>) =>
  POST(new Request('http://localhost/api/community/flag', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  h.member = { id: 'm1' }
  h.canSee = true
  h.existing = null
  h.inserted = []
})

describe('POST /api/community/flag', () => {
  it('a post the member can see is reported', async () => {
    const res = await flag({ contentType: 'post', contentId: POST_ID, reason: 'Spam' })
    expect(res.status).toBe(200)
    expect(h.post).toHaveBeenCalledWith(h.member, POST_ID)
    expect(h.inserted).toEqual([expect.objectContaining({ content_type: 'post', content_id: POST_ID, flagged_by: 'm1', reason: 'Spam' })])
  })

  it('a comment goes through the comment rule', async () => {
    const res = await flag({ contentType: 'comment', contentId: POST_ID })
    expect(res.status).toBe(200)
    expect(h.comment).toHaveBeenCalledWith(h.member, POST_ID)
    expect(h.post).not.toHaveBeenCalled()
  })

  it('a resource keeps the container it was viewed in', async () => {
    const res = await flag({ contentType: 'resource', contentId: POST_ID, containerRef: CONTAINER_ID, note: 'Wrong file' })
    expect(res.status).toBe(200)
    expect(h.resource).toHaveBeenCalledWith(h.member, POST_ID, CONTAINER_ID)
    expect(h.inserted[0]).toMatchObject({ note: 'Wrong file', viewed_in_container: CONTAINER_ID })
  })

  it.each(['post', 'comment', 'resource'])('a %s the member cannot see: 404, nothing stored', async (contentType) => {
    h.canSee = false
    const res = await flag({ contentType, contentId: POST_ID })
    expect(res.status).toBe(404)
    expect(h.inserted).toEqual([])
  })

  it('a container is only stored on a resource flag, where it was checked', async () => {
    await flag({ contentType: 'post', contentId: POST_ID, containerRef: CONTAINER_ID })
    expect(h.inserted[0]).toMatchObject({ viewed_in_container: null })
  })

  it('a second report of the same content stays a duplicate', async () => {
    h.existing = { id: 'f1' }
    const res = await flag({ contentType: 'post', contentId: POST_ID })
    expect(await res.json()).toEqual({ ok: true, duplicate: true })
    expect(h.inserted).toEqual([])
  })

  it('signed out: 401', async () => {
    h.member = null
    expect((await flag({ contentType: 'post', contentId: POST_ID })).status).toBe(401)
    expect(h.post).not.toHaveBeenCalled()
  })
})
