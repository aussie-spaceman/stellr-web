// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// deep review MEM-8: the legacy flat-space post branch (channelSlug omitted)
// ignored mute / posting suspension / moderators-only, so a sanctioned member
// could still create a URL-reachable post that also fired mention emails.
const { state, space } = vi.hoisted(() => ({
  state: { db: null as FakeDb | null },
  space: { current: null as Record<string, unknown> | null },
}))

vi.mock('@/lib/community', () => ({ getCurrentMember: async () => ({ id: 'm1', first_name: 'A', last_name: 'B', isAdmin: false }), tiptapToPlainText: () => 'body text' }))
vi.mock('@/lib/spaces', () => ({
  getSpaceForMember: async () => space.current,
  canPostInSpace: (_m: unknown, policy: string, role: string | null) => policy === 'all' || role === 'admin' || role === 'moderator',
}))
vi.mock('@/lib/space-posts', () => ({ getChannelPosts: async () => [] }))
vi.mock('@/lib/mentions', () => ({ extractMentionIds: () => [], notifyMentions: async () => {} }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => state.db!.client }))

const { POST } = await import('./route')

const legacyPost = () =>
  POST(new Request('https://app.test', { method: 'POST', body: JSON.stringify({ spaceSlug: 'general', title: 'Hello' }) }))

beforeEach(() => {
  vi.clearAllMocks()
  state.db = fakeSupabase({ community_posts: [] })
})

describe('POST legacy flat-space post — posting sanctions (MEM-8)', () => {
  it('403s a muted member and writes no post', async () => {
    space.current = { id: 'sp1', access: { canAccess: true }, myMuted: true, postingPolicy: 'all', myRole: 'member' }
    const res = await legacyPost()
    expect(res.status).toBe(403)
    expect(state.db!.table('community_posts')).toHaveLength(0)
  })

  it('403s a non-moderator when the space is moderators-only', async () => {
    space.current = { id: 'sp1', access: { canAccess: true }, myMuted: false, postingPolicy: 'moderators', myRole: 'member' }
    expect((await legacyPost()).status).toBe(403)
    expect(state.db!.table('community_posts')).toHaveLength(0)
  })

  it('creates the post for an unsanctioned member', async () => {
    space.current = { id: 'sp1', access: { canAccess: true }, myMuted: false, postingPolicy: 'all', myRole: 'member' }
    const res = await legacyPost()
    expect(res.status).toBe(200)
    expect(state.db!.table('community_posts')).toHaveLength(1)
  })
})
