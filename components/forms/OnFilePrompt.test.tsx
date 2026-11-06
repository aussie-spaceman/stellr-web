import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OnFilePrompt, adoptSessionFromAnotherTab, needsAnAdultToRegister, signedInAsSomeoneElse } from './OnFilePrompt'

const PROPS = {
  schoolAddressOnly: false,
  signInUrl: '/sign-in',
  onboardingUrl: '/account/onboarding',
  signedIn: false,
  needsAnAdult: false,
}

describe('OnFilePrompt on a long form', () => {
  it('opens sign-in in a new tab and says their entries stay', () => {
    render(<OnFilePrompt {...PROPS} keepEntries />)
    const link = screen.getByRole('link', { name: /Sign in/ })
    expect(link).toHaveAttribute('href', '/sign-in')
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getByText(/What you’ve entered here stays/)).toBeInTheDocument()
  })

  it('nothing on it leaves this tab, including the way to contact us', () => {
    render(<OnFilePrompt {...PROPS} keepEntries needsAnAdult />)
    expect(screen.getByRole('link', { name: 'contact us' })).toHaveAttribute('target', '_blank')
  })

  it('opens account setup in a new tab too', () => {
    render(<OnFilePrompt {...PROPS} keepEntries signedIn />)
    expect(screen.getByRole('link', { name: /Finish setting up/ })).toHaveAttribute('target', '_blank')
  })
})

describe('OnFilePrompt on a short form', () => {
  it('stays in the tab, and promises the way back', () => {
    render(<OnFilePrompt {...PROPS} />)
    expect(screen.getByRole('link', { name: /Sign in/ })).not.toHaveAttribute('target')
    expect(screen.getByText(/you’ll come back here to register/)).toBeInTheDocument()
  })
})

describe('needsAnAdultToRegister', () => {
  it.each([
    [10, true],
    [12, true],
    [13, false],
    [40, false],
    [Number.NaN, true],
  ])('age %s: %s', (age, expected) => {
    expect(needsAnAdultToRegister(age)).toBe(expected)
  })
})

describe('adoptSessionFromAnotherTab', () => {
  it('reloads the client first, then makes the session it now holds active', async () => {
    const order: string[] = []
    const client = {
      lastActiveSessionId: null as string | null,
      reload: async () => { order.push('reload'); client.lastActiveSessionId = 'sess_1' },
    }
    const setActive = vi.fn(async () => { order.push('setActive') })
    await adoptSessionFromAnotherTab({ client, setActive })
    expect(order).toEqual(['reload', 'setActive'])
    expect(setActive).toHaveBeenCalledWith({ session: 'sess_1' })
  })

  it('with no session elsewhere it activates nothing', async () => {
    const setActive = vi.fn()
    await adoptSessionFromAnotherTab({ client: { reload: async () => {}, lastActiveSessionId: null }, setActive })
    expect(setActive).not.toHaveBeenCalled()
  })

  it('a failure is logged and does not stop the submit', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(adoptSessionFromAnotherTab({ client: { reload: async () => { throw new Error('down') } } })).resolves.toBeUndefined()
    expect(errors).toHaveBeenCalled()
    errors.mockRestore()
  })
})

describe('signedInAsSomeoneElse', () => {
  it('names both addresses when they differ', () => {
    expect(signedInAsSomeoneElse('me@example.com', 'them@example.com')).toContain('signed in as me@example.com, but this form is for them@example.com')
  })

  it.each([
    ['the same address in another case or spacing', 'Me@Example.com', ' me@example.com '],
    ['no session', null, 'me@example.com'],
    ['nothing typed', 'me@example.com', ''],
  ])('%s is not a mismatch', (_l, session, typed) => {
    expect(signedInAsSomeoneElse(session, typed)).toBeNull()
  })
})
