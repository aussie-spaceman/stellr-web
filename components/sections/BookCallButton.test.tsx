import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BookCallButton } from './BookCallButton'
import { INTRO_CALL_URL } from '@/lib/booking'

beforeEach(() => {
  window.dataLayer = []
})

describe('BookCallButton', () => {
  it('opens the Motion booking page in a new tab, and says so', () => {
    render(<BookCallButton location="contact_sidebar" />)
    // jsdom's name computation drops the space a browser keeps; the text has it.
    const link = screen.getByRole('link', { name: /Book a 15-min call\s*\(opens in a new tab\)/ })
    expect(link.textContent).toBe('Book a 15-min call (opens in a new tab)')
    expect(link).toHaveAttribute('href', INTRO_CALL_URL)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('reports which button was used, with no personal data', async () => {
    render(<BookCallButton location="events_hero" />)
    const link = screen.getByRole('link')
    link.addEventListener('click', (e) => e.preventDefault())
    await userEvent.click(link)
    expect(window.dataLayer).toContainEqual({ event: 'booking_click', location: 'events_hero' })
  })
})
