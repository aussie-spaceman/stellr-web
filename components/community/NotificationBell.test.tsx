import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotificationBell } from './NotificationBell'

function mockFetch(unread: number) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    if (url.includes('unread=1')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ count: unread }) })
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          notifications: [
            {
              id: 'n1',
              type: 'reply',
              reference_type: 'post',
              reference_id: 'p1',
              body: null,
              is_read: false,
              created_at: new Date().toISOString(),
              actor: { first_name: 'Ada', last_name: 'Lovelace' },
            },
          ],
        }),
    })
  })
}

describe('NotificationBell', () => {
  beforeEach(() => vi.stubGlobal('fetch', mockFetch(3)))
  afterEach(() => vi.unstubAllGlobals())

  it('names the unread count in the button, not only in the drawn badge', async () => {
    render(<NotificationBell />)
    expect(await screen.findByRole('button', { name: 'Notifications, 3 unread' })).toBeInTheDocument()
  })

  it('is plain "Notifications" with nothing unread', async () => {
    vi.stubGlobal('fetch', mockFetch(0))
    render(<NotificationBell />)
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('opens a panel it names, and Escape closes it with focus back on the bell', async () => {
    render(<NotificationBell />)
    const user = userEvent.setup()
    const bell = await screen.findByRole('button', { name: 'Notifications, 3 unread' })
    await user.click(bell)

    const panel = screen.getByRole('region', { name: 'Notifications' })
    expect(bell).toHaveAttribute('aria-expanded', 'true')
    expect(bell).toHaveAttribute('aria-controls', panel.id)
    expect(await screen.findByText('Ada Lovelace replied to your post')).toBeInTheDocument()
    // Phone: a full-width sheet; the anchored popover only from sm.
    expect(panel.className).toContain('fixed inset-x-0')
    expect(panel.className).toContain('sm:absolute')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull()
    expect(bell).toHaveFocus()
  })
})
