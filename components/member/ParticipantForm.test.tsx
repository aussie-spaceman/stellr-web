import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ParticipantForm } from './ParticipantForm'

let posted: unknown[] = []

beforeEach(() => {
  posted = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/members/teams/reg-1/participants' && init?.method === 'POST') {
        posted.push(JSON.parse(String(init.body)))
        return new Response('{}', { status: 200 })
      }
      throw new Error(`unexpected fetch ${url}`)
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function setup() {
  const user = userEvent.setup()
  const onSaved = vi.fn()
  render(<ParticipantForm registrationId="reg-1" onSaved={onSaved} onCancel={vi.fn()} />)
  const dialog = screen.getByRole('dialog')
  return { user, onSaved, dialog }
}

describe('ParticipantForm', () => {
  it('names every field by its label and keeps the adult’s own details out of autofill', () => {
    const { dialog } = setup()
    for (const name of ['First name', 'Last name', 'Email', 'Phone', 'Date of birth']) {
      const fields = within(dialog).getAllByLabelText(new RegExp(`^${name}`))
      for (const f of fields) expect(f).toHaveAttribute('autocomplete', 'off')
    }
    expect(within(dialog).getByRole('group', { name: 'Ethnicity' })).toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: 'Halal' })).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: 'Adult' })).toBeInTheDocument()
  })

  it('on an empty save, says what is missing under each field and focuses the first', async () => {
    const { user, dialog } = setup()
    await user.click(screen.getByRole('button', { name: 'Add participant' }))

    const first = within(dialog).getAllByRole('textbox', { name: /^First name/ })[0]
    expect(first).toHaveAttribute('aria-invalid', 'true')
    expect(first).toHaveAccessibleDescription('Enter a first name.')
    await waitFor(() => expect(first).toHaveFocus())
    // Students need an emergency contact (their agreement's guardian signer).
    expect(within(dialog).getByText('Choose how they are related.')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('clears a field’s message as it is fixed, and saves once everything is there', async () => {
    const { user, dialog, onSaved } = setup()
    await user.click(within(dialog).getByRole('radio', { name: 'Adult' }))
    await user.click(screen.getByRole('button', { name: 'Add participant' }))
    expect(within(dialog).queryByText('Choose how they are related.')).not.toBeInTheDocument()

    const [first, last] = [/^First name/, /^Last name/].map((n) => within(dialog).getAllByRole('textbox', { name: n })[0])
    await user.type(first, 'Ada')
    expect(first).not.toHaveAttribute('aria-invalid')
    await user.type(last, 'Lovelace')
    await user.type(within(dialog).getByRole('textbox', { name: /^Email/ }), 'ada@example.org')
    await user.click(screen.getByRole('button', { name: 'Add participant' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(posted[0]).toMatchObject({ first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.org', event_role: 'adult' })
  })
})
