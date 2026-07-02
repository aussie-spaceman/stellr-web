import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SpaceCard } from './SpaceCard'
import { Toaster } from '@/components/ui/Toast'
import type { SpaceSummary } from '@/lib/spaces'

// F-01 integration: render a joinable SpaceCard alongside the real Toaster
// (Toast is NOT mocked here), click Join, and assert the toast action link
// target — the full join→"Go to space →" hand-off end to end.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

const space: SpaceSummary = {
  id: 'space-1',
  slug: 'mission-control',
  name: 'Mission Control',
  description: 'Open to all',
  theme: 'space',
  access_type: 'open',
  assignedTierIds: [],
  memberCount: 8,
  channelCount: 3,
}

describe('Join a space → toast action (F-01 integration)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('clicking Join surfaces a toast whose "Go to space →" action routes to the space', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    render(
      <>
        <SpaceCard space={space} joinable />
        <Toaster />
      </>
    )

    await userEvent.click(screen.getByRole('button', { name: 'Join' }))

    const action = await screen.findByRole('link', { name: 'Go to space →' })
    expect(action).toHaveAttribute('href', '/community/mission-control')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Joined ✓' })).toBeDisabled()
    })
    expect(screen.getByRole('status')).toHaveTextContent("You've joined Mission Control")
  })
})
