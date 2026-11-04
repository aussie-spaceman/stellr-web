import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OnboardingForm } from './OnboardingForm'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

describe('OnboardingForm', () => {
  it('fills the member’s own details from autofill, by token', async () => {
    const user = userEvent.setup()
    render(<OnboardingForm existingMember={null} />)
    await user.click(screen.getByRole('button', { name: 'Teacher / Educator' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByLabelText('Date of birth')).toHaveAttribute('autocomplete', 'bday')
    expect(screen.getByRole('combobox', { name: 'Gender' })).toHaveAttribute('autocomplete', 'sex')
    expect(screen.getByRole('textbox', { name: 'Phone' })).toHaveAttribute('autocomplete', 'tel')
    expect(screen.getByRole('combobox', { name: 'School / district' })).toBeInTheDocument()
  })

  it('a Continue with gaps says what is missing under each field and focuses the first', async () => {
    const user = userEvent.setup()
    render(<OnboardingForm existingMember={null} />)
    await user.click(screen.getByRole('button', { name: 'Parent / Guardian' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: /Continue|Complete profile/ }))

    const dob = screen.getByLabelText('Date of birth')
    expect(dob).toHaveAttribute('aria-invalid', 'true')
    expect(dob).toHaveAccessibleDescription('Enter your date of birth.')
    await waitFor(() => expect(dob).toHaveFocus())
    expect(screen.getByRole('textbox', { name: 'Phone' })).toHaveAccessibleDescription('Enter your phone number.')

    // Fixing a field clears its message.
    await user.type(screen.getByRole('textbox', { name: 'Phone' }), '555 0100')
    expect(screen.getByRole('textbox', { name: 'Phone' })).not.toHaveAttribute('aria-invalid')
  })

  it('tells an under-18 volunteer at the date field, as soon as the date is in', async () => {
    const user = userEvent.setup()
    render(<OnboardingForm existingMember={null} volunteerFlow />)
    await user.click(screen.getByRole('button', { name: 'College / university student' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    const dob = screen.getByLabelText('Date of birth')
    await user.type(dob, `${new Date().getFullYear() - 15}-01-01`)
    expect(dob).toHaveAccessibleDescription(/volunteers must be 18 or older/)
  })
})

// Decision 24: with minor self-sign-up on, the date of birth is asked first,
// on its own, and the page never names an age.
describe('OnboardingForm — the age screen (MINOR_SELF_SIGNUP_ENABLED)', () => {
  const answer = (band: string) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ band, consented: false }), { status: 200 }))

  it('asks only the date of birth first, without naming any age', async () => {
    render(<OnboardingForm existingMember={null} minorSelfSignup />)
    expect(screen.getByLabelText('Date of birth')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Teacher / Educator' })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\b(13|18)\b|under|over|older|younger/i)
  })

  it('an under-13 is asked only a first name and a parent’s email', async () => {
    const user = userEvent.setup()
    const spy = answer('child')
    render(<OnboardingForm existingMember={null} minorSelfSignup />)
    await user.type(screen.getByLabelText('Date of birth'), '2015-01-01')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('textbox', { name: 'Your first name' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Parent or guardian’s email' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Gender' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Phone' })).not.toBeInTheDocument()
    spy.mockRestore()
  })

  it('an adult goes on to the usual questions, without a second date field', async () => {
    const user = userEvent.setup()
    const spy = answer('adult')
    render(<OnboardingForm existingMember={null} minorSelfSignup />)
    await user.type(screen.getByLabelText('Date of birth'), '1990-01-01')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Teacher / Educator' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('textbox', { name: 'Phone' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Date of birth')).not.toBeInTheDocument()
    spy.mockRestore()
  })
})
