import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { ChannelFeed } from './ChannelFeed'

// The feed's poll fallback (active-cpu-phase-2 handover, "Not verified"): every
// poll is a function call and a proxy pass on metered CPU, so it runs only while
// the tab is in view, and reloads at once when the tab comes back, so content a
// moderator removed is gone before the reader sees the feed again. ChatPanel's
// test covers the same code there; this is ChannelFeed's own.
//
// The interval: ChannelFeed polls every 8 s (the handover: "ChatPanel and
// ChannelFeed stay at 8 s"). It has no named POLL_MS constant to import, so the
// number is pinned here: due at 8000 ms, not a millisecond sooner.
const POLL_INTERVAL_MS = 8000

vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: vi.fn() }),
}))
vi.mock('@/lib/supabase-browser', () => ({
  // No realtime here: the feed falls back to polling alone.
  createBrowserSupabase: () => {
    throw new Error('no realtime in tests')
  },
}))
vi.mock('@/components/ui/Toast', () => ({ toast: vi.fn() }))
vi.mock('@/components/community/RichTextEditor', () => ({
  RichTextEditor: () => <textarea aria-label="Post body" />,
}))

const props = {
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

describe('ChannelFeed polling', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let visibility: ReturnType<typeof vi.spyOn>
  const polls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/community/posts?channelId=ch-1').length
  const setVisibility = (state: DocumentVisibilityState) => {
    visibility.mockReturnValue(state)
    document.dispatchEvent(new Event('visibilitychange'))
  }

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ posts: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  })
  afterEach(() => {
    visibility.mockRestore()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('polls once per interval while in view, and not before', async () => {
    render(<ChannelFeed {...props} />)
    // The server rendered the first page of posts: nothing is fetched on mount.
    expect(polls()).toBe(0)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1)
    expect(polls()).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(polls()).toBe(1)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3)
    expect(polls()).toBe(4)
  })

  it('stops while the tab is hidden and reloads as soon as it is visible again', async () => {
    render(<ChannelFeed {...props} />)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(polls()).toBe(1)

    // Hidden for ten intervals: not one request.
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 10)
    expect(polls()).toBe(1)

    // Back in view: one reload straight away, without waiting for the timer.
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(polls()).toBe(2)

    // And the interval carries on.
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(polls()).toBe(3)
  })

  it('stops polling when the feed is closed', async () => {
    const { unmount } = render(<ChannelFeed {...props} />)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(polls()).toBe(1)
    unmount()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5)
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(polls()).toBe(1)
  })
})
