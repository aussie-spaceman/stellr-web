import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppSidebar } from './AppSidebar'

let pathname = '/home'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

// The phone tab bar used to stop at five links, so Mentoring, Coaching,
// Hosting, Credentials, Surveys, Resources and Teacher tools had no way in
// below lg. "More" lists every section.
describe('AppSidebar on a phone', () => {
  beforeEach(() => {
    pathname = '/home'
  })

  const tabBar = () => screen.getAllByRole('navigation', { name: 'Member sections' }).at(-1)!

  it('reaches every section through More', async () => {
    render(<AppSidebar canHost isTeacher />)
    await userEvent.setup().click(within(tabBar()).getByRole('button', { name: 'More' }))
    const sheet = screen.getByRole('dialog', { name: 'All sections' })
    for (const name of ['Spaces', 'Resources', 'Directory', 'Training', 'Mentoring', 'Coaching', 'Hosting', 'Credentials', 'Surveys', 'Group spaces']) {
      expect(within(sheet).getByRole('link', { name })).toBeInTheDocument()
    }
  })

  it('leaves Hosting out for members who cannot host', async () => {
    render(<AppSidebar />)
    await userEvent.setup().click(within(tabBar()).getByRole('button', { name: 'More' }))
    expect(within(screen.getByRole('dialog')).queryByRole('link', { name: 'Hosting' })).toBeNull()
  })

  it('marks one tab current: an Academy page is not also Community', () => {
    pathname = '/community/mentoring/abc'
    render(<AppSidebar />)
    const current = within(tabBar())
      .getAllByRole('link')
      .filter((a) => a.hasAttribute('aria-current'))
      .map((a) => a.textContent)
    expect(current).toEqual(['Academy'])
  })

  it('marks the exact page as the current page', () => {
    pathname = '/events'
    render(<AppSidebar />)
    expect(within(tabBar()).getByRole('link', { name: 'Competitions' })).toHaveAttribute('aria-current', 'page')
  })
})
