import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GroupRegistrationForm from './GroupRegistrationForm'
import type { RegistrationPrefill } from '@/lib/registration-prefill'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ isSignedIn: false }), useClerk: () => ({}) }))
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

  // An invoice has no code box of its own (9 Nov 2026), so the form asks for the code.
  it('asks for a discount code when the group pays by invoice, and only then', async () => {
    const user = await reachStep2()
    const payment = screen.getByRole('combobox', { name: 'How will the group pay?' })
    expect(screen.getByLabelText(label('Discount code (optional)'))).toHaveAttribute('autocomplete', 'off')
    await user.selectOptions(payment, 'invoice_some')
    expect(screen.getByLabelText(label('Discount code (optional)'))).toBeInTheDocument()
    for (const method of ['card', 'individual', 'teacher_share']) {
      await user.selectOptions(payment, method)
      expect(screen.queryByLabelText(label('Discount code (optional)'))).toBeNull()
    }
  })

  it('focuses the School Data Terms box when it is the only thing missing', async () => {
    const user = await reachStep2()
    await user.click(screen.getByRole('button', { name: /Submit Registration|Continue to Payment/ }))
    const terms = screen.getByRole('checkbox', { name: /School Data Terms/ })
    await waitFor(() => expect(terms).toHaveFocus())
    expect(terms).toHaveAccessibleDescription(/Accept the School Data Terms/)
  })
})

// Owner decision, 13 Nov 2026: a signed-in organiser's name is their account's. The
// route uses it whatever is sent, so the form shows it read-only, and says how to change
// it (Manage account in the account menu).
describe('GroupRegistrationForm — the organiser’s name', () => {
  // The account's name differs from the latest roster row's, which prefill.first_name prefers.
  const withAccount: RegistrationPrefill = {
    ...teacher,
    first_name: 'Rostered', last_name: 'Elsewhere',
    account_name: { first_name: 'Account', last_name: 'Holder' },
  }

  // The organiser's own name comes first; a Student Manager's form has others below it.
  function expectLocked(value: { first: string; last: string }) {
    const first = screen.getAllByLabelText(label('First Name'))[0]
    const last = screen.getAllByLabelText(label('Last Name'))[0]
    expect(first).toHaveValue(value.first)
    expect(last).toHaveValue(value.last)
    for (const el of [first, last]) {
      expect(el).toHaveAttribute('readonly')
      expect(el).toHaveAttribute('aria-readonly', 'true')
      expect(el).toHaveAccessibleDescription(/This is the name on your Stellr account\. To change it, choose Manage account in your account menu, then reload this page\./)
    }
    // The Account page has no name field; Clerk's Manage account is where a name changes.
    expect(screen.queryByRole('link', { name: /Account page/ })).toBeNull()
  }

  it('signed in: shows the account’s name, read-only, with how to change it', async () => {
    const user = userEvent.setup()
    renderForm(withAccount)
    expectLocked({ first: 'Account', last: 'Holder' })
    await user.type(screen.getByLabelText(label('First Name')), 'X')
    expect(screen.getByLabelText(label('First Name'))).toHaveValue('Account')
  })

  it('signed in as a Student Manager: the same', async () => {
    const user = userEvent.setup()
    renderForm(withAccount)
    await user.click(screen.getByRole('button', { name: /Student Manager/ }))
    expectLocked({ first: 'Account', last: 'Holder' })
  })

  it('signed in: the locked name counts as filled, so Continue goes on', async () => {
    const user = userEvent.setup()
    renderForm(withAccount)
    await user.click(screen.getByRole('button', { name: /Continue — Group Details/ }))
    expect(await screen.findByRole('heading', { name: 'Group Details' })).toBeInTheDocument()
  })

  it('signed in with no full name on the account: the name stays open to type', () => {
    renderForm(teacher)
    const first = screen.getByLabelText(label('First Name'))
    expect(first).toHaveValue('Test')
    expect(first).not.toHaveAttribute('readonly')
    expect(screen.queryByRole('link', { name: /Account page/ })).toBeNull()
  })

  it('signed out: the name is typed, as before', async () => {
    const user = userEvent.setup()
    renderForm()
    const first = screen.getByLabelText(label('First Name'))
    expect(first).not.toHaveAttribute('readonly')
    expect(first).not.toHaveAttribute('aria-readonly')
    await user.type(first, 'Pat')
    expect(first).toHaveValue('Pat')
    expect(screen.queryByText(/name on your Stellr account/)).toBeNull()
  })
})
