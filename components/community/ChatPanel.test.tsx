import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatPanel } from './ChatPanel'

vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: vi.fn() }),
}))
vi.mock('@/lib/supabase-browser', () => ({
  // Realtime is optional — the panel catches this and falls back to polling.
  createBrowserSupabase: () => {
    throw new Error('no realtime in tests')
  },
}))

const messages = [
  { id: 'm1', body: 'Hello all', author_member_id: 'other', author_name: 'Grace Hopper', created_at: '2026-10-15T10:00:00Z', flagged: false },
]

function mockFetch() {
  return vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ messages }) })
  })
}

describe('ChatPanel', () => {
  let fetchMock: ReturnType<typeof mockFetch>
  beforeEach(() => {
    fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('asks before deleting a message, and deletes only on confirm', async () => {
    render(<ChatPanel channelId="c1" selfMemberId="me" title="Cohort chat" canModerate />)
    const user = userEvent.setup()
    await screen.findByText('Hello all')

    await user.click(screen.getByRole('button', { name: 'Delete message' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this message?' })
    expect(dialog).toBeInTheDocument()
    const deleteCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/community/chat/delete')
    expect(deleteCalls()).toHaveLength(0)

    // Backing out deletes nothing.
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(deleteCalls()).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Delete message' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteCalls()).toHaveLength(1))
    expect(JSON.parse(deleteCalls()[0][1].body)).toEqual({ messageId: 'm1' })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('shows flag and delete on touch screens, hiding them for hover only under a mouse', async () => {
    render(<ChatPanel channelId="c1" selfMemberId="me" title="Cohort chat" canModerate />)
    await screen.findByText('Hello all')
    for (const name of ['Flag message', 'Delete message']) {
      const button = screen.getByRole('button', { name })
      expect(button.className).not.toMatch(/(^|\s)opacity-0/)
      expect(button.className).toContain('mouse:opacity-0')
      expect(button.className).toContain('mouse:group-hover:opacity-100')
      expect(button.className).toContain('min-h-11')
    }
  })

  it('scrolls the message list itself, not the page', async () => {
    const original = Element.prototype.scrollIntoView
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      render(<ChatPanel channelId="c1" selfMemberId="me" title="Cohort chat" />)
      await screen.findByText('Hello all')
      expect(scrollIntoView).not.toHaveBeenCalled()
      expect(screen.getByRole('log', { name: 'Cohort chat messages' })).toBeInTheDocument()
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })
})
