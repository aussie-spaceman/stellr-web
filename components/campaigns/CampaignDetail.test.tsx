import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CampaignDetail } from './CampaignDetail'
import type { StellarEvent } from '@/lib/sanity'

// deep review TEST-4: the fixture below is a Fall 2027 campaign, whose term runs
// Aug 15 – Dec 15 2026 (campaignYear is the SCHOOL year). campaignStatus() reads
// the real clock via todayInAppZone(), so once that window closes (~16 Dec 2026)
// the "open" cases would report Closed and the suite would fail on every run date
// after it — breaking the required `verify` CI check. Pin the clock to a fixed
// instant INSIDE the window so the test asserts the toggle logic, not the
// calendar: 2026-10-01 12:00 America/Denver sits inside both the term and the
// registration window (Aug 1 – Nov 30 2026). Only `Date` is faked, so React
// Testing Library's timers/microtasks are left real.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T18:00:00Z'))
})
afterAll(() => {
  vi.useRealTimers()
})

// A campaign in its Fall 2027 window, so only the registrationOpen toggle decides
// Open vs Closed (the window itself is held open by the pinned clock above).
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
