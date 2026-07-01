import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LockedSpace } from './LockedSpace'

const tierNames = { 'id-pathfinder': 'Pathfinder', 'id-scholar': 'Scholar' }

describe('LockedSpace (F-02)', () => {
  it('renders a primary CTA anchored to the lowest qualifying tier', () => {
    render(
      <LockedSpace
        name="Scholar Lounge"
        theme="space"
        description="A locked space"
        assignedTierIds={['id-scholar', 'id-pathfinder']}
        tierNames={tierNames}
      />
    )
    const cta = screen.getByRole('link', { name: 'See membership options →' })
    expect(cta).toHaveAttribute('href', '/membership#pathfinder')
  })

  it('keeps the explanatory tier copy beneath the CTA', () => {
    render(
      <LockedSpace
        name="Scholar Lounge"
        theme="space"
        description={null}
        assignedTierIds={['id-scholar']}
        tierNames={tierNames}
      />
    )
    expect(screen.getByText(/granted automatically/i)).toBeInTheDocument()
    expect(screen.getByText('Scholar')).toBeInTheDocument()
  })

  it('falls back to the unanchored membership page when tiers cannot be resolved', () => {
    render(
      <LockedSpace
        name="Mystery Space"
        theme="space"
        description={null}
        assignedTierIds={['unknown-id']}
        tierNames={{}}
      />
    )
    const cta = screen.getByRole('link', { name: 'See membership options →' })
    expect(cta).toHaveAttribute('href', '/membership')
  })
})
