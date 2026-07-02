import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import HomePage from './page'

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string }
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />
  },
}))
vi.mock('@/lib/community', () => ({
  getCurrentMember: vi.fn().mockResolvedValue({ id: 'm1', first_name: 'Ada', event_role: null }),
}))
vi.mock('@/lib/event-portal', () => ({
  getMemberEvents: vi.fn().mockResolvedValue([]),
  getMemberEventCatalog: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/training', () => ({
  getAssignedModules: vi.fn().mockResolvedValue([]),
  listModules: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/sessions', () => ({
  listMemberSessions: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/community-feed', () => ({
  getHomeFeed: vi.fn().mockResolvedValue([]),
}))

import { getMemberEvents, getMemberEventCatalog } from '@/lib/event-portal'

function futureIso(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString()
}

function eventOf(activityType: 'competition' | 'campaign') {
  return {
    eventId: 'e1',
    slug: 'big-event',
    title: 'Big Event',
    date: futureIso(10),
    activityType,
  }
}

async function renderHome() {
  return render(await HomePage())
}

function heroClasses(container: HTMLElement) {
  const hero = Array.from(container.querySelectorAll<HTMLElement>('div[class]')).find((el) =>
    el.className.includes('linear-gradient')
  )
  return hero?.className ?? ''
}

describe('Home page (F-05 · F-06 · F-07)', () => {
  beforeEach(() => {
    vi.mocked(getMemberEvents).mockResolvedValue([])
    vi.mocked(getMemberEventCatalog).mockResolvedValue([])
    localStorage.clear()
  })

  it('F-05: community links describe browsing and keep their /community targets', async () => {
    await renderHome()
    expect(screen.getByRole('link', { name: 'All spaces →' })).toHaveAttribute('href', '/community')
    expect(screen.getByRole('link', { name: 'Browse spaces →' })).toHaveAttribute('href', '/community')
    expect(screen.queryByText(/Start a discussion/)).toBeNull()
    expect(screen.queryByText(/View all/)).toBeNull()
  })

  it('F-06: a competition hero uses the primary-blue gradient tokens', async () => {
    vi.mocked(getMemberEvents).mockResolvedValue([eventOf('competition')] as never)
    const { container } = await renderHome()
    expect(screen.getByText('View event hub →')).toBeInTheDocument()
    const classes = heroClasses(container)
    expect(classes).toContain('var(--color-primary)')
    expect(classes).not.toContain('pathway-amber')
  })

  it('F-06: a campaign hero uses the pathway-amber gradient tokens', async () => {
    vi.mocked(getMemberEvents).mockResolvedValue([eventOf('campaign')] as never)
    const { container } = await renderHome()
    const classes = heroClasses(container)
    expect(classes).toContain('var(--color-pathway-amber)')
    expect(classes).not.toContain('var(--color-primary)')
  })

  it('F-07: no emoji in the dashboard header or the caught-up line', async () => {
    const { container } = await renderHome()
    expect(container.textContent).not.toContain('👋')
    expect(container.textContent).not.toContain('🎉')
    // The sanctioned star flourish replaces the wave.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ada ✦')
    expect(screen.getByText(/all caught up on training/)).toBeInTheDocument()
  })
})
