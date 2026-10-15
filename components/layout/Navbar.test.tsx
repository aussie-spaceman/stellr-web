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
    // A disclosure: it names the panel it opens. (It used to claim
    // aria-haspopup="menu" without menu semantics, which misleads screen readers.)
    expect(educate).toHaveAttribute('aria-controls')
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

describe('Navbar mobile menu', () => {
  it('opens as a dialog, locks the page, and closes on Escape with focus back on the button', async () => {
    render(
      <>
        <Navbar />
        <main>page</main>
      </>
    )
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: 'Open menu' })
    await user.click(button)

    expect(screen.getByRole('dialog', { name: 'Site menu' })).toBeVisible()
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.querySelector('main')).toHaveAttribute('inert')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Site menu' })).toBeNull()
    expect(document.body.style.overflow).toBe('')
    expect(document.querySelector('main')).not.toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus()
  })

  it('exposes section state and links to section landing pages', async () => {
    render(<Navbar />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    const dialog = screen.getByRole('dialog', { name: 'Site menu' })
    const educate = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.includes('Educate'))!
    expect(educate).toHaveAttribute('aria-expanded', 'false')
    await user.click(educate)
    expect(educate).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'All of Educate →' })).toHaveAttribute('href', '/educate')
  })
})
