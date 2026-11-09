import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import GroupJoinClient from './GroupJoinClient'

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ isSignedIn: false }) }))
vi.mock('@clerk/nextjs/legacy', () => ({ useSignIn: () => ({ signIn: null, setActive: vi.fn(), isLoaded: false }) }))

const BACK = '/sign-in?next=%2Fregister%2Fcolorado%2Fjoin%2Ftok'

const PROPS = {
  token: 'tok',
  eventTitle: 'Colorado',
  eventSlug: 'colorado',
  organiserName: 'Terry Teacher',
  organiserRole: 'Teacher',
  schoolName: 'Denver High',
  schoolState: 'CO',
  memberPaysIndividually: false,
  isAuthenticated: false,
}

function fillIn(dateOfBirth = '1985-04-01') {
  const by = (name: RegExp) => screen.getAllByLabelText(name)[0]
  fireEvent.change(by(/^First name/), { target: { value: 'Pat' } })
  fireEvent.change(by(/^Last name/), { target: { value: 'Lee' } })
  fireEvent.change(by(/^Date of birth/), { target: { value: dateOfBirth } })
  fireEvent.change(by(/email/i), { target: { value: 'pat@example.com' } })
  fireEvent.click(screen.getByLabelText('Adult'))
}

/** Answers the join with a refusal, and the blur lookup with "no login". */
function answerOnFile(schoolOnly = false) {
  return vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/members/exists')) {
      return { status: 200, ok: true, json: async () => ({ hasAccount: false }) }
    }
    return {
      status: 409,
      ok: false,
      json: async () => ({ code: 'sign_in_required', error: 'server copy', school_address_only: schoolOnly }),
    }
  })
}

const prompt = () => screen.queryByText('This email is already on file with Stellr')

beforeEach(() => {
  vi.stubGlobal('fetch', answerOnFile())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('GroupJoinClient, signed out', () => {
  it('the way to sign in carries the way back to this link', () => {
    render(<GroupJoinClient {...PROPS} />)
    expect(screen.getByRole('link', { name: /Log in to register/ }).getAttribute('href')).toBe(BACK)
  })

  describe('when the server says the email is on file', () => {
    async function refused() {
      render(<GroupJoinClient {...PROPS} />)
      fillIn()
      fireEvent.click(screen.getByRole('button', { name: /Join Group/ }))
      await waitFor(() => expect(prompt()).not.toBeNull())
    }

    it('asks them to sign in, with the way back and another way in, and shows no error', async () => {
      await refused()
      expect(screen.getByRole('link', { name: /Sign in to join/ }).getAttribute('href')).toBe(BACK)
      expect(screen.getByText(/ask your group organiser to add you/)).toBeTruthy()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('the lookup on leaving the email field does not clear it', async () => {
      await refused()
      fireEvent.blur(screen.getAllByLabelText(/email/i)[0])
      await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/members/exists')))
      expect(prompt()).not.toBeNull()
    })

    it('a match only on a school address never suggests making a login with it', async () => {
      vi.stubGlobal('fetch', answerOnFile(true))
      await refused()
      expect(screen.getByText(/your main email address, not your school one/)).toBeTruthy()
      expect(screen.queryByText(/create your login/)).toBeNull()
    })

    it('someone who needs an adult is pointed to the organiser, with no sign-in or login to make', async () => {
      const childYear = new Date().getFullYear() - 10
      render(<GroupJoinClient {...PROPS} />)
      fillIn(`${childYear}-01-01`)
      fireEvent.change(screen.getAllByLabelText(/^First name/)[1], { target: { value: 'Sam' } })
      fireEvent.change(screen.getAllByLabelText(/^Last name/)[1], { target: { value: 'Lee' } })
      fireEvent.change(screen.getAllByLabelText(/^Email/)[screen.getAllByLabelText(/^Email/).length - 1], { target: { value: 'sam@example.com' } })
      fireEvent.change(screen.getAllByLabelText(/^Phone/)[1], { target: { value: '5551234' } })
      fireEvent.change(screen.getByLabelText(/^Relationship/), { target: { value: 'Parent' } })
      fireEvent.click(screen.getByRole('button', { name: /Join Group/ }))
      await waitFor(() => expect(prompt()).not.toBeNull())
      expect(screen.getByText(/A parent or guardian needs to help/)).toBeTruthy()
      expect(screen.queryByText(/create your login/)).toBeNull()
      expect(screen.queryByRole('link', { name: /Sign in to join/ })).toBeNull()
    })

    it('editing the email clears it, so they can try another address', async () => {
      await refused()
      fireEvent.change(screen.getAllByLabelText(/email/i)[0], { target: { value: 'new@example.com' } })
      expect(prompt()).toBeNull()
      expect(screen.getByRole('button', { name: /Join Group/ })).toBeTruthy()
    })
  })
})
