// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// deep review MEM-6: a moderated post is status='hidden' (not 'deleted'); the old
// check rendered any non-deleted post in full, so safeguarding-removed content
// stayed readable by direct link to every member in the space (minors included).
const { state } = vi.hoisted(() => ({
  state: { db: null as FakeDb | null, member: { id: 'm1', isAdmin: false } as Record<string, unknown> },
}))

const notFound = vi.fn(() => { throw new Error('NEXT_NOT_FOUND') })
const redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT') })

vi.mock('next/navigation', () => ({ notFound, redirect }))
vi.mock('@/lib/community', () => ({
  getCurrentMember: async () => state.member,
  getSpaceBySlug: async () => ({ id: 'sp1', slug: 'general', name: 'General' }),
  memberCanAccessSpace: async () => true,
}))
vi.mock('@/lib/community-feed', () => ({ markPostRead: async () => {} }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => state.db!.client }))
// Component modules — never rendered in these throw-cases, mocked only so the
// page module imports cleanly in a node test.
vi.mock('@/components/community/PostHeading', () => ({ PostHeading: () => null }))
vi.mock('@/components/community/RichTextContent', () => ({ RichTextContent: () => null }))
vi.mock('@/components/community/ReactionBar', () => ({ ReactionBar: () => null }))
vi.mock('@/components/community/CommentForm', () => ({ CommentForm: () => null }))
vi.mock('@/components/community/Comment', () => ({ Comment: () => null }))
vi.mock('@/components/community/FlagButton', () => ({ FlagButton: () => null }))

const Page = (await import('./page')).default
const POST_ID = '00000000-0000-4000-8000-0000000000bb'

const render = () => Page({ params: Promise.resolve({ spaceSlug: 'general', postId: POST_ID }) })

beforeEach(() => {
  vi.clearAllMocks()
  state.member = { id: 'm1', isAdmin: false }
})

describe('post detail page — status gate (MEM-6)', () => {
  it('404s a HIDDEN post for a normal member', async () => {
    state.db = fakeSupabase({
      community_posts: [{ id: POST_ID, space_id: 'sp1', title: 'T', body_json: null, status: 'hidden', created_at: '2026-01-01', author_member_id: 'm1' }],
    })
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })

  it('404s a DELETED post too', async () => {
    state.db = fakeSupabase({
      community_posts: [{ id: POST_ID, space_id: 'sp1', title: 'T', body_json: null, status: 'deleted', created_at: '2026-01-01', author_member_id: 'm1' }],
    })
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
