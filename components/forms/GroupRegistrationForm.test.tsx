import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GroupRegistrationForm from './GroupRegistrationForm'
import type { RegistrationPrefill } from '@/lib/registration-prefill'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ isSignedIn: false }) }))
vi.mock('@clerk/nextjs/legacy', () => ({ useSignIn: () => ({ signIn: null, setActive: vi.fn(), isLoaded: false }) }))

// A signed-in teacher whose own details are complete, so Continue reaches step 2.
const teacher: RegistrationPrefill = {
  memberId: 'm-test',
  email: 'teacher@example.test',
  first_name: 'Test',
  last_name: 'Teacher',
  phone: '5550000000',
  date_of_birth: '1985-05-01',
  gender: 'Female',
  t_shirt_size: 'M',
  ethnicity: ['Prefer Not To Say'],
  dietary_requirements: ['None'],
  school: { id: 'school-1', name: 'Test High School' },
}

// A required Field shows an asterisk after its label: match with or without it.
const label = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}( \\*)?$`)

const renderForm = (prefill: RegistrationPrefill | null = null) =>
  render(<GroupRegistrationForm eventSlug="test-event" eventTitle="Test Event" prefill={prefill} />)

describe('GroupRegistrationForm — step 1, the organiser', () => {
  it('ties each of the teacher’s fields to its label, with autocomplete tokens for their own details', () => {
    renderForm()
    const tokens: Record<string, string> = {
      'First Name': 'given-name',
      'Last Name': 'family-name',
      'Preferred Name / Nickname': 'nickname',
      'Email Address': 'email',
      'Phone Number': 'tel',
      'Date of Birth': 'bday',
      Gender: 'sex',
    }
    for (const [name, token] of Object.entries(tokens)) {
      expect(screen.getByLabelText(label(name))).toHaveAttribute('autocomplete', token)
    }
    expect(screen.getByLabelText(label('First Name'))).toHaveAttribute('name', 'first_name')
    expect(screen.getByLabelText(label('School Name'))).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /Ethnicity/ })).toBeInTheDocument()
  })

  it('moves focus to the first invalid field on Continue', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(screen.getByRole('button', { name: /Continue — Group Details/ }))
    const first = screen.getByLabelText(label('First Name'))
    await waitFor(() => expect(first).toHaveFocus())
    expect(first).toHaveAccessibleDescription('Required')
  })

  it('puts the Student Manager’s emergency contact and teacher in their own autofill sections', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(screen.getByRole('button', { name: /Student Manager/ }))
    const ec = screen.getByRole('group', { name: 'Emergency Contact' })
    expect(within(ec).getByLabelText(label('First Name'))).toHaveAttribute('autocomplete', 'section-emergency given-name')
    expect(within(ec).getByLabelText(label('Email'))).toHaveAttribute('autocomplete', 'section-emergency email')
    const poc = screen.getByRole('group', { name: 'Teacher Point of Contact' })
    expect(within(poc).getByLabelText(label('Teacher Email'))).toHaveAttribute('autocomplete', 'section-teacher email')
  })
})

describe('GroupRegistrationForm — step 2, the participants', () => {
  async function reachStep2() {
    const user = userEvent.setup()
    renderForm(teacher)
    await user.click(screen.getByRole('button', { name: /Continue — Group Details/ }))
    await screen.findByRole('heading', { name: 'Group Details' })
    return user
  }

  it('never autofills a student’s fields from the organiser’s profile', async () => {
    await reachStep2()
    const student = screen.getByRole('group', { name: 'Student 1' })
    for (const name of ['First Name', 'Last Name', 'Email', 'Phone', 'Date of Birth']) {
      for (const el of within(student).getAllByLabelText(label(name))) {
        expect(el).toHaveAttribute('autocomplete', 'off')
      }
    }
  })

  it('on Submit, opens a part-filled student and focuses their first missing field', async () => {
    const user = await reachStep2()
    // Start Student 2, then move on to Student 1 so Student 2's card closes.
    await user.click(screen.getByRole('button', { name: /Student 2/ }))
    await user.type(within(screen.getByRole('group', { name: 'Student 2' })).getAllByLabelText(label('First Name'))[0], 'Sam')
    await user.click(screen.getByRole('button', { name: /^Student 1/ }))
    expect(screen.queryByRole('group', { name: /Student 2|Sam/ })).toBeNull()

    await user.click(screen.getByRole('checkbox', { name: /School Data Terms/ }))
    await user.click(screen.getByRole('button', { name: /Submit Registration|Continue to Payment/ }))

    expect(screen.getByRole('alert')).toHaveTextContent('Student 2 is partly filled')
    const card = await screen.findByRole('group', { name: 'Student 2' })
    const lastName = within(card).getAllByLabelText(label('Last Name'))[0]
    await waitFor(() => expect(lastName).toHaveFocus())
    expect(lastName).toHaveAttribute('aria-invalid', 'true')
    expect(lastName).toHaveAccessibleDescription('Required')
  })

  it('focuses the School Data Terms box when it is the only thing missing', async () => {
    const user = await reachStep2()
    await user.click(screen.getByRole('button', { name: /Submit Registration|Continue to Payment/ }))
    const terms = screen.getByRole('checkbox', { name: /School Data Terms/ })
    await waitFor(() => expect(terms).toHaveFocus())
    expect(terms).toHaveAccessibleDescription(/Accept the School Data Terms/)
  })
})
