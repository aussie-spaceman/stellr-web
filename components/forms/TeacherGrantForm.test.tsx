import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TeacherGrantForm from './TeacherGrantForm'

// Mobile review F2/A5: fields are the shared primitives, so labels, hints and
// errors are tied to their controls, and a failed submit lands on the first
// field that needs fixing.
describe('TeacherGrantForm', () => {
  it('focuses the first invalid field on a failed submit', async () => {
    const user = userEvent.setup()
    render(<TeacherGrantForm />)
    await user.click(screen.getByRole('button', { name: /apply for the grant/i }))

    const first = screen.getByRole('textbox', { name: /^first name/i })
    await waitFor(() => expect(first).toHaveFocus())
    expect(first).toHaveAccessibleDescription('Enter your first name')
  })

  it('names the activity choice as a group and ties its error to it', async () => {
    const user = userEvent.setup()
    render(<TeacherGrantForm />)
    await user.click(screen.getByRole('button', { name: /apply for the grant/i }))

    const group = screen.getByRole('group', { name: /, you plan to/i })
    await waitFor(() => expect(group).toHaveAccessibleDescription('Choose what you plan to run'))
    expect(screen.getByRole('radio', { name: /bring a team to a live challenge/i })).toBeInTheDocument()
  })

  it('locks a signed-in applicant to their account email, with the hint read alongside', () => {
    render(
      <TeacherGrantForm prefill={{ memberId: 'm-1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.org' }} />,
    )
    const email = screen.getByRole('textbox', { name: /^email/i })
    expect(email).toHaveAttribute('readonly')
    expect(email).toHaveValue('ada@example.org')
    expect(email).toHaveAccessibleDescription(/signed in/i)
  })
})
