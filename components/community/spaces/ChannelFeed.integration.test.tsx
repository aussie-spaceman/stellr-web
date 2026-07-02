import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChannelFeed } from './ChannelFeed'
import type { FeedPost } from '@/lib/space-posts'

// F-03 integration: create a post from the feed composer and assert it appears
// in the feed. The POST returns an id; the follow-up refetch (load()) returns
// the created post, which the feed then renders — the real submit→reload cycle.
// tiptap can't run under jsdom, so RichTextEditor is stood in with a textarea
// that reports (doc, plainText) exactly like the real editor.
vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }))
vi.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabase: () => {
    throw new Error('no realtime in tests')
  },
}))
vi.mock('@/components/ui/Toast', () => ({ toast: vi.fn() }))
vi.mock('@/components/community/RichTextEditor', () => ({
  RichTextEditor: ({
    onChange,
    placeholder,
  }: {
    onChange: (doc: object, text: string) => void
    placeholder?: string
  }) => (
    <textarea
      placeholder={placeholder}
      onChange={(e) =>
        onChange(
          { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: e.target.value }] }] },
          e.target.value
        )
      }
    />
  ),
}))

const baseProps = {
  spaceSlug: 'mission-control',
  channelId: 'ch-1',
  channelSlug: 'general',
  channelName: 'General',
  selfId: 'me',
  canPost: true,
  canModerate: false,
  allowUploads: false,
  initialPosts: [] as FeedPost[],
}

function postRow(overrides: Partial<FeedPost>): FeedPost {
  return {
    id: 'post-1',
    authorId: 'me',
    authorName: 'Ada Lovelace',
    tierName: null,
    role: 'member',
    title: null,
    bodyText: '',
    createdAt: new Date(0).toISOString(),
    isPinned: false,
    isAnnouncement: false,
    attachment: null,
    reactions: [],
    replies: [],
    ...overrides,
  }
}

// fetch mock: POST returns { id }; the next GET returns the created post so the
// feed's load() renders it.
function fetchReturning(created: FeedPost) {
  return vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: created.id }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ posts: [created] }) })
  })
}

describe('Create a post from the feed (F-03 integration)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('a post with a title appears in the feed after submit', async () => {
    const created = postRow({ title: 'Launch update', bodyText: 'We are go' })
    vi.stubGlobal('fetch', fetchReturning(created))
    render(<ChannelFeed {...baseProps} />)

    await userEvent.type(screen.getByLabelText('Post title (optional)'), 'Launch update')
    await userEvent.type(screen.getByPlaceholderText(/Start a post/), 'We are go')
    await userEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Launch update' })).toBeInTheDocument()
    })
    expect(screen.getByText('We are go')).toBeInTheDocument()
  })

  it('a titleless post appears in the feed rendering its body only (no empty heading)', async () => {
    const created = postRow({ title: null, bodyText: 'No title needed' })
    vi.stubGlobal('fetch', fetchReturning(created))
    const { container } = render(<ChannelFeed {...baseProps} />)

    await userEvent.type(screen.getByPlaceholderText(/Start a post/), 'No title needed')
    await userEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      expect(screen.getByText('No title needed')).toBeInTheDocument()
    })
    // The rendered post card carries no heading element for a titleless post.
    const article = container.querySelector('article')
    expect(article?.querySelector('h3')).toBeNull()
  })
})
