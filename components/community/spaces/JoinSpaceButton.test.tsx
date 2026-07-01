import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { JoinSpaceButton } from './JoinSpaceButton'
import { toast } from '@/components/ui/Toast'

const refresh = vi.fn()
const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push }),
}))
vi.mock('@/components/ui/Toast', () => ({
  toast: vi.fn(),
}))

describe('JoinSpaceButton (F-01 / F-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('on a 200: fires a success toast with a "Go to space →" action, flips to Joined ✓, refreshes, no navigation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    render(<JoinSpaceButton spaceSlug="mission-control" spaceName="Mission Control" />)

    await userEvent.click(screen.getByRole('button', { name: 'Join' }))

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith("You've joined Mission Control", {
        action: { label: 'Go to space →', href: '/community/mission-control' },
      })
    })
    const btn = screen.getByRole('button', { name: 'Joined ✓' })
    expect(btn).toBeDisabled()
    expect(refresh).toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('on a non-OK response: fires an error toast, re-enables the button, no navigation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    render(<JoinSpaceButton spaceSlug="mission-control" spaceName="Mission Control" />)

    await userEvent.click(screen.getByRole('button', { name: 'Join' }))

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith("Couldn't join — please try again.", { tone: 'error' })
    })
    expect(screen.getByRole('button', { name: 'Join' })).toBeEnabled()
    expect(refresh).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('on a network error (fetch rejects): fires the same error toast and re-enables the button', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<JoinSpaceButton spaceSlug="mission-control" spaceName="Mission Control" />)

    await userEvent.click(screen.getByRole('button', { name: 'Join' }))

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith("Couldn't join — please try again.", { tone: 'error' })
    })
    expect(screen.getByRole('button', { name: 'Join' })).toBeEnabled()
  })
})
