import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CampaignDetail } from './CampaignDetail'
import type { StellarEvent } from '@/lib/sanity'

// A campaign in its Fall 2027 window (which runs Aug–Dec 2026 — campaignYear is
// the SCHOOL year), so only the registrationOpen toggle decides Open vs Closed.
function campaign(overrides: Partial<StellarEvent> = {}): StellarEvent {
  return {
    _id: 'c1',
    title: 'Space Design Campaign - Fall',
    slug: { current: 'space-design-campaign-fall' },
    activityType: 'campaign',
    season: 'fall',
    campaignYear: 2027,
    gradeLevel: 'High School',
    type: 'Space Design Challenge',
    deadline: '2026-12-11',
    deliverable: '40-page written proposal',
    registrationOpen: true,
    ...overrides,
  } as StellarEvent
}

describe('CampaignDetail', () => {
  it('offers registration while the campaign is open', () => {
    render(<CampaignDetail campaign={campaign()} />)
    expect(screen.getAllByText('Compete Now →').length).toBeGreaterThan(0)
    expect(screen.getByText('Registration Open')).toBeInTheDocument()
  })

  // The CMS toggle gated the registration API but never this page, so a campaign
  // switched off still advertised a live "Compete Now" and only failed once the
  // visitor reached the API.
  it('withdraws the CTA when the toggle is off, instead of linking to a 403', () => {
    render(<CampaignDetail campaign={campaign({ registrationOpen: false })} />)
    expect(screen.queryByText('Compete Now →')).not.toBeInTheDocument()
    expect(screen.getAllByText(/Registration is closed for this campaign/).length).toBeGreaterThan(0)
    expect(screen.getByText('Registration Closed')).toBeInTheDocument()
  })

  it('treats an unset toggle as closed, matching registrationIsOpen()', () => {
    render(<CampaignDetail campaign={campaign({ registrationOpen: undefined })} />)
    expect(screen.queryByText('Compete Now →')).not.toBeInTheDocument()
  })

  // An existing member keeps their way back in regardless of the window.
  it('still links a registered member to the campaign, even when closed', () => {
    render(<CampaignDetail campaign={campaign({ registrationOpen: false })} registered />)
    expect(screen.getAllByText('Access Campaign →').length).toBeGreaterThan(0)
  })

  it('states the freemium cost, group-only entry, and the included tier', () => {
    render(<CampaignDetail campaign={campaign()} />)
    expect(screen.getByText('Free with membership')).toBeInTheDocument()
    expect(screen.getByText(/a teacher, mentor or student manager registers the group/)).toBeInTheDocument()
    expect(screen.getByText(/Annual Stellr Educator membership/)).toBeInTheDocument()
  })
})
