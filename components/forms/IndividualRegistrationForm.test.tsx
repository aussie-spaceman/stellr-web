import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IndividualRegistrationForm from './IndividualRegistrationForm'
import type { RegistrationPrefill } from '@/lib/registration-prefill'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
const session = vi.hoisted(() => ({ isSignedIn: false }))
vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ isSignedIn: session.isSignedIn }) }))
vi.mock('@clerk/nextjs/legacy', () => ({ useSignIn: () => ({ signIn: null, setActive: vi.fn(), isLoaded: false }) }))

// A signed-in student whose step-1 details are complete, so Continue reaches step 2.
const completeStep1: RegistrationPrefill = {
  memberId: 'm-test',
  email: 'student@example.test',
  age_bracket: 'high_school',
  first_name: 'Test',
  last_name: 'Student',
  phone: '5550000000',
  date_of_birth: '2010-05-01',
  grade: '10',
  gender: 'Female',
  t_shirt_size: 'M',
  school: { id: 'school-1', name: 'Test High School' },
}

// A required Field shows an asterisk after its label: match with or without it.
const label = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}( \\*)?$`)

const renderForm = (prefill: RegistrationPrefill | null = null) =>
  render(<IndividualRegistrationForm eventSlug="test-event" eventTitle="Test Event" prefill={prefill} />)

describe('IndividualRegistrationForm — labelled fields (WCAG 1.3.1 / 1.3.5)', () => {
  it('ties every step-1 field to its label and gives the registrant’s own fields autocomplete tokens', () => {
    renderForm()
    const tokens: Record<string, string | null> = {
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
    expect(screen.getByLabelText(label('Grade'))).toBeInstanceOf(HTMLSelectElement)
    expect(screen.getByLabelText(label('T-Shirt Size'))).toBeInstanceOf(HTMLSelectElement)
    expect(screen.getByRole('group', { name: /I am registering as/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'College' })).toBeInTheDocument()
  })

  it('keeps form field names for react-hook-form', () => {
    renderForm()
    expect(screen.getByLabelText(label('First Name'))).toHaveAttribute('name', 'first_name')
    expect(screen.getByLabelText(label('Email Address'))).toHaveAttribute('name', 'email')
  })
})

describe('IndividualRegistrationForm — errors', () => {
  it('moves focus to the first invalid field on Continue, with its error tied to it', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    const first = screen.getByLabelText(label('First Name'))
    await waitFor(() => expect(first).toHaveFocus())
    expect(first).toHaveAttribute('aria-invalid', 'true')
    expect(first).toHaveAccessibleDescription('Required')
  })

  it('moves focus to the school search when only the school is missing', async () => {
    const user = userEvent.setup()
    renderForm({ ...completeStep1, school: undefined })
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    const school = screen.getByLabelText(label('School'))
    await waitFor(() => expect(school).toHaveFocus())
    expect(school).toHaveAttribute('aria-invalid', 'true')
    expect(school).toHaveAccessibleDescription(expect.stringContaining('Please select your school'))
  })

  it('on Submit, focuses the first missing emergency-contact field, then the first ethnicity box', async () => {
    const user = userEvent.setup()
    renderForm(completeStep1)
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    const ecGroup = await screen.findByRole('group', { name: 'Emergency Contact' })

    // The emergency contact is someone else: its own autofill section.
    expect(within(ecGroup).getByLabelText(label('First Name'))).toHaveAttribute('autocomplete', 'section-emergency given-name')
    expect(within(ecGroup).getByLabelText(label('Phone'))).toHaveAttribute('autocomplete', 'section-emergency tel')

    await user.click(screen.getByRole('button', { name: 'Submit Registration' }))
    await waitFor(() => expect(within(ecGroup).getByLabelText(label('First Name'))).toHaveFocus())

    await user.type(within(ecGroup).getByLabelText(label('First Name')), 'Pat')
    await user.type(within(ecGroup).getByLabelText(label('Last Name')), 'Parent')
    await user.type(within(ecGroup).getByLabelText(label('Email')), 'parent@example.test')
    await user.type(within(ecGroup).getByLabelText(label('Phone')), '5550000001')
    await user.selectOptions(within(ecGroup).getByLabelText(label('Relationship To Participant')), 'Parent')
    await user.click(screen.getByRole('button', { name: 'Submit Registration' }))

    const ethnicity = screen.getByRole('group', { name: /Ethnicity/ })
    await waitFor(() => expect(within(ethnicity).getAllByRole('checkbox')[0]).toHaveFocus())
    expect(within(ethnicity).getByText('Select at least one')).toBeInTheDocument()
  })
})

describe('IndividualRegistrationForm — an email already on file', () => {
  const complete: RegistrationPrefill = {
    ...completeStep1,
    emergency_contact_first_name: 'Pat',
    emergency_contact_last_name: 'Parent',
    emergency_contact_email: 'parent@example.test',
    emergency_contact_phone: '5550000001',
    emergency_contact_relationship: 'Parent',
    ethnicity: ['Prefer Not To Say'],
    dietary_requirements: ['None'],
  }

  async function submitAndRefuse(prefill: RegistrationPrefill, schoolOnly = false) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ code: 'sign_in_required', error: 'server copy', school_address_only: schoolOnly }),
    })))
    const user = userEvent.setup()
    renderForm(prefill)
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    await user.click(await screen.findByRole('button', { name: 'Submit Registration' }))
    await screen.findByText('This email is already on file with Stellr')
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    session.isSignedIn = false
    window.history.replaceState(null, '', '/')
  })

  it('asks them to sign in, keeping the way back, query included, and shows no error', async () => {
    window.history.replaceState(null, '', '/register/test-event/individual?scholarship=tok')
    await submitAndRefuse(complete)
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute(
      'href',
      `/sign-in?next=${encodeURIComponent('/register/test-event/individual?scholarship=tok')}`,
    )
    expect(screen.getByText(/create your login with it/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'contact us' })).toHaveAttribute('href', '/contact')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a match only on a school address never suggests making a login with it', async () => {
    await submitAndRefuse(complete, true)
    expect(screen.getByRole('link', { name: 'Sign in with your main email address' })).toBeInTheDocument()
    expect(screen.getByText(/not your school one/)).toBeInTheDocument()
    expect(screen.queryByText(/create your login/)).toBeNull()
  })

  it('someone who needs an adult is pointed to us, with no sign-in or login to make', async () => {
    await submitAndRefuse({ ...complete, date_of_birth: `${new Date().getFullYear() - 10}-01-01` })
    expect(screen.getByText(/A parent or guardian needs to help/)).toBeInTheDocument()
    expect(screen.queryByText(/create your login/)).toBeNull()
    expect(screen.queryByRole('link', { name: /sign in/i })).toBeNull()
    expect(screen.getByRole('link', { name: 'contact us' })).toBeInTheDocument()
  })

  it('signed in with no member matched, it offers account setup and the way back, and names no cause', async () => {
    window.history.replaceState(null, '', '/register/test-event/individual')
    session.isSignedIn = true
    await submitAndRefuse(complete)
    expect(screen.getByRole('link', { name: 'Finish setting up your account' })).toHaveAttribute(
      'href',
      `/account/onboarding?next=${encodeURIComponent('/register/test-event/individual')}`,
    )
    expect(screen.queryByRole('link', { name: /sign in/i })).toBeNull()
    expect(screen.queryByText(/address you’re signed in with/)).toBeNull()
  })

  it('says before they sign in that signing in registers the account holder', async () => {
    await submitAndRefuse(complete)
    expect(screen.getByText(/Signing in registers the person the account belongs to/)).toBeInTheDocument()
  })
})
