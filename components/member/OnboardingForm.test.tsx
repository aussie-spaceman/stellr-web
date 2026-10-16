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
