import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContactForm } from './ContactForm'
import { __resetMemberPrefillCache } from './useMemberPrefill'

// Mobile review F2/A5: the fields are the shared primitives, so each error sits
// under its field and is read with it, and a failed submit lands on the first
// field that needs fixing rather than leaving focus on the button.
describe('ContactForm validation', () => {
  afterEach(() => __resetMemberPrefillCache())

  it('focuses the first invalid field and ties its error to it', async () => {
    const user = userEvent.setup()
    render(<ContactForm />)
    await user.click(screen.getByRole('button', { name: /send message/i }))

    const name = screen.getByRole('textbox', { name: /^name/i })
    await waitFor(() => expect(name).toHaveFocus())
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveAccessibleDescription('Name must be at least 2 characters')
  })

  it('ties the consent error to the checkbox', async () => {
    const user = userEvent.setup()
    render(<ContactForm />)
    await user.click(screen.getByRole('button', { name: /send message/i }))

    const consent = screen.getByRole('checkbox', { name: /agree to stellr education contacting me/i })
    await waitFor(() => expect(consent).toHaveAttribute('aria-invalid', 'true'))
    expect(consent).toHaveAccessibleDescription('You must agree to be contacted')
  })
})

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
