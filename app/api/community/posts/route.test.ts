// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// deep review MEM-8: the legacy flat-space post branch (channelSlug omitted)
// ignored mute / posting suspension / moderators-only, so a sanctioned member
// could still create a URL-reachable post that also fired mention emails.
// deep review MEM-18: the mention fan-out is registered with runAfterResponse
// (after()) instead of a bare un-awaited promise, so it survives the response
// flush on Vercel.
const { state, space } = vi.hoisted(() => ({
  state: {
    db: null as FakeDb | null,
    mentionIds: [] as string[],
    mentionCalls: 0,
    afterScheduled: 0,
  },
  space: { current: null as Record<string, unknown> | null },
}))

vi.mock('@/lib/community', () => ({ getCurrentMember: async () => ({ id: 'm1', first_name: 'A', last_name: 'B', isAdmin: false }), tiptapToPlainText: () => 'body text' }))
vi.mock('@/lib/spaces', () => ({
  getSpaceForMember: async () => space.current,
  canPostInSpace: (_m: unknown, policy: string, role: string | null) => policy === 'all' || role === 'admin' || role === 'moderator',
}))
vi.mock('@/lib/space-posts', () => ({ getChannelPosts: async () => [] }))
vi.mock('@/lib/mentions', () => ({
  extractMentionIds: () => state.mentionIds,
  notifyMentions: async () => {
    state.mentionCalls += 1
  },
}))
// Record each scheduled task and run it, so the test observes that the fan-out
// goes through runAfterResponse (MEM-18) rather than a dropped bare promise.
vi.mock('@/lib/after-response', () => ({
  runAfterResponse: (_label: string, task: () => Promise<unknown>) => {
    state.afterScheduled += 1
    void task()
  },
}))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => state.db!.client }))

const { POST } = await import('./route')

const legacyPost = () =>
  POST(new Request('https://app.test', { method: 'POST', body: JSON.stringify({ spaceSlug: 'general', title: 'Hello' }) }))

beforeEach(() => {
  vi.clearAllMocks()
  state.db = fakeSupabase({ community_posts: [] })
  state.mentionIds = []
  state.mentionCalls = 0
  state.afterScheduled = 0
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

describe('channel post mention fan-out (MEM-18)', () => {
  it('schedules the mention fan-out through runAfterResponse', async () => {
    state.mentionIds = ['u1']
    space.current = {
      id: 'sp1',
      channels: [{ id: 'ch1', slug: 'c1' }],
      access: { canAccess: true },
      myMuted: false,
      postingPolicy: 'all',
      myRole: 'member',
    }
    const res = await POST(
      new Request('https://app.test', {
        method: 'POST',
        body: JSON.stringify({ spaceSlug: 'general', channelSlug: 'c1', title: 'Hi', bodyJson: {} }),
      })
    )
    expect(res.status).toBe(200)
    expect(state.afterScheduled).toBe(1) // registered with after(), not dropped
    expect(state.mentionCalls).toBe(1)
  })
})
