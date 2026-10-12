import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Navbar } from './Navbar'

// deep review PUB-10 (WCAG 2.1.1): the desktop nav dropdowns opened on hover
// only — the pillar <button> had no onClick/onKeyDown, so a keyboard user could
// never reach the dropdown destinations from the primary nav.
vi.mock('next/navigation', () => ({ usePathname: () => '/' }))

describe('Navbar desktop dropdowns — keyboard operable (PUB-10)', () => {
  it('opens a dropdown with the keyboard and exposes its links', async () => {
    render(<Navbar />)
    const user = userEvent.setup()

    // Closed to begin with.
    expect(screen.queryByRole('link', { name: 'Competitions' })).toBeNull()

    const educate = screen.getByRole('button', { name: /educate/i })
    expect(educate).toHaveAttribute('aria-haspopup')
    educate.focus()
    await user.keyboard('{Enter}')

    expect(educate).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Competitions' })).toBeVisible()
  })

  it('closes the open dropdown on Escape', async () => {
    render(<Navbar />)
    const user = userEvent.setup()

    const educate = screen.getByRole('button', { name: /educate/i })
    educate.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('link', { name: 'Competitions' })).toBeVisible()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('link', { name: 'Competitions' })).toBeNull()
  })
})
