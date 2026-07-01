import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChannelFeed } from './ChannelFeed'

vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: vi.fn() }),
}))
vi.mock('@/lib/supabase-browser', () => ({
  // Realtime is optional — the component catches and falls back to polling.
  createBrowserSupabase: () => {
    throw new Error('no realtime in tests')
  },
}))
vi.mock('@/components/ui/Toast', () => ({ toast: vi.fn() }))
// The tiptap editor doesn't run under jsdom — stand in with a textarea that
// reports (doc, plainText) like the real editor.
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
  initialPosts: [],
}

function mockFetch() {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'post-1' }) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ posts: [] }) })
  })
}

describe('ChannelFeed composer (F-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('submits rich-text body with the title when one is provided', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<ChannelFeed {...baseProps} />)

    await userEvent.type(screen.getByLabelText('Post title (optional)'), 'Launch update')
    await userEvent.type(screen.getByPlaceholderText(/Start a post/), 'We are go for launch')
    await userEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')
      expect(post).toBeTruthy()
      const body = JSON.parse((post![1] as RequestInit).body as string)
      expect(body).toMatchObject({ spaceSlug: 'mission-control', channelSlug: 'general', title: 'Launch update' })
      expect(body.bodyJson).toBeTruthy()
    })
  })

  it('omits the title field entirely when left blank', async () => {
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<ChannelFeed {...baseProps} />)

    await userEvent.type(screen.getByPlaceholderText(/Start a post/), 'No title needed')
    await userEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')
      expect(post).toBeTruthy()
      const body = JSON.parse((post![1] as RequestInit).body as string)
      expect('title' in body).toBe(false)
      expect(body.bodyJson).toBeTruthy()
    })
  })

  it('disables Post until there is a title or body', () => {
    vi.stubGlobal('fetch', mockFetch())
    render(<ChannelFeed {...baseProps} />)
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
  })

  it('clears the composer after a successful post', async () => {
    vi.stubGlobal('fetch', mockFetch())
    render(<ChannelFeed {...baseProps} />)

    const titleInput = screen.getByLabelText<HTMLInputElement>('Post title (optional)')
    await userEvent.type(titleInput, 'Launch update')
    await userEvent.type(screen.getByPlaceholderText(/Start a post/), 'Body text')
    await userEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      expect(titleInput.value).toBe('')
      expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    })
  })
})
