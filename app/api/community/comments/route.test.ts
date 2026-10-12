// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// deep review MEM-6: a moderated post is status='hidden' (not 'deleted'). The
// comment-create path blocked only 'deleted', so a member could keep commenting
// on a hidden post reached by a direct link from an older notification email.
const { state } = vi.hoisted(() => ({ state: { db: null as FakeDb | null } }))

vi.mock('@/lib/community', () => ({
  getCurrentMember: async () => ({ id: 'm1', first_name: 'A', last_name: 'B' }),
  tiptapToPlainText: () => 'hello there',
}))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/spaces', () => ({ getSpaceAccessById: async () => ({ canAccess: true }), isMemberMutedInSpace: async () => false }))
vi.mock('@/lib/email', () => ({ sendEmail: async () => ({}), communityReplyEmail: () => ({ subject: '', html: '', text: '' }) }))
vi.mock('@/lib/mentions', () => ({ extractMentionIds: () => [], notifyMentions: async () => {} }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => state.db!.client }))

const { POST } = await import('./route')

const POST_ID = '00000000-0000-4000-8000-0000000000aa'

const post = () =>
  POST(new Request('https://app.test', { method: 'POST', body: JSON.stringify({ postId: POST_ID }) }))

beforeEach(() => vi.clearAllMocks())

describe('POST comment — post status gate (MEM-6)', () => {
  it('404s a comment on a HIDDEN (moderated) post and inserts nothing', async () => {
    state.db = fakeSupabase({
      community_posts: [{ id: POST_ID, status: 'hidden', space_id: null, author_member_id: 'm1' }],
    })
    const res = await post()
    expect(res.status).toBe(404)
    expect(state.db.table('community_comments')).toHaveLength(0)
  })

  it('404s a comment on a DELETED post', async () => {
    state.db = fakeSupabase({
      community_posts: [{ id: POST_ID, status: 'deleted', space_id: null, author_member_id: 'm1' }],
    })
    expect((await post()).status).toBe(404)
    expect(state.db.table('community_comments')).toHaveLength(0)
  })

  it('accepts a comment on a PUBLISHED post', async () => {
    state.db = fakeSupabase({
      community_posts: [{ id: POST_ID, status: 'published', space_id: null, author_member_id: 'm1' }],
    })
    const res = await post()
    expect(res.status).toBe(200)
    expect(state.db.table('community_comments')).toHaveLength(1)
  })
})
