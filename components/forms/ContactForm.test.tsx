import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ContactForm } from './ContactForm'

// /contact is a cached page, so the `?type=` deep links (from /donate and
// /why-stellr) are read by the form in the browser, not by the page.
describe('ContactForm inquiry type deep link', () => {
  afterEach(() => window.history.replaceState(null, '', '/'))

  const select = () => screen.getByLabelText(/inquiry type/i) as HTMLSelectElement

  it('picks Volunteer / Mentor for ?type=mentor', () => {
    window.history.replaceState(null, '', '/contact?type=mentor')
    render(<ContactForm />)
    expect(select().value).toBe('Volunteer / Mentor')
  })

  it('picks Sponsorship / Donation for ?type=sponsorship', () => {
    window.history.replaceState(null, '', '/contact?type=sponsorship')
    render(<ContactForm />)
    expect(select().value).toBe('Sponsorship / Donation')
  })

  it('leaves the choice empty without a known type', () => {
    window.history.replaceState(null, '', '/contact?type=other')
    render(<ContactForm />)
    expect(select().value).toBe('')
  })

  it('lets a prefillType prop win over the URL', () => {
    window.history.replaceState(null, '', '/contact?type=mentor')
    render(<ContactForm prefillType="Media" />)
    expect(select().value).toBe('Media')
  })
})
