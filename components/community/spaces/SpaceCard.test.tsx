import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SpaceCard } from './SpaceCard'
import type { SpaceSummary } from '@/lib/spaces'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

const space: SpaceSummary = {
  id: 'space-1',
  slug: 'scholar-lounge',
  name: 'Scholar Lounge',
  description: 'Award winners only',
  theme: 'space',
  access_type: 'private',
  assignedTierIds: ['id-scholar', 'id-pathfinder'],
  memberCount: 12,
  channelCount: 2,
}

const tierNames = { 'id-pathfinder': 'Pathfinder', 'id-scholar': 'Scholar' }

describe('SpaceCard — restricted (F-02)', () => {
  it('renders a working Upgrade link anchored to the lowest qualifying tier', () => {
    render(<SpaceCard space={space} restricted tierNames={tierNames} />)
    const upgrade = screen.getByRole('link', { name: 'Upgrade' })
    expect(upgrade).toHaveAttribute('href', '/membership#pathfinder')
  })

  it('keeps the whole card routing to the locked screen independently of the Upgrade link', () => {
    render(<SpaceCard space={space} restricted tierNames={tierNames} />)
    const cardLink = screen.getByRole('link', { name: 'Scholar Lounge' })
    expect(cardLink).toHaveAttribute('href', '/community/scholar-lounge')
  })

  it('still names the required tiers', () => {
    render(<SpaceCard space={space} restricted tierNames={tierNames} />)
    expect(screen.getByText(/Requires/)).toHaveTextContent('Pathfinder or Scholar')
  })
})

describe('SpaceCard — joinable (F-01)', () => {
  it('passes the space name through to the Join button flow', () => {
    render(<SpaceCard space={{ ...space, access_type: 'open', assignedTierIds: [] }} joinable />)
    expect(screen.getByRole('button', { name: 'Join' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Scholar Lounge' })).toHaveAttribute(
      'href',
      '/community/scholar-lounge'
    )
  })
})
