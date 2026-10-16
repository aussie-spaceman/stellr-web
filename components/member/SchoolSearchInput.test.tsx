import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Field } from '@stellr/web-ui'
import { SchoolSearchInput } from './SchoolSearchInput'

const SCHOOLS = [
  { id: 's1', name: 'Lakeside High', city: 'Reno', state: 'Nevada' },
  { id: 's2', name: 'Lakeview Academy', city: null, state: 'Colorado' },
]

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/schools/search')) {
        return new Response(JSON.stringify({ schools: SCHOOLS }), { headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`unexpected fetch ${url}`)
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function setup(onChange = vi.fn()) {
  const user = userEvent.setup()
  render(
    <Field label="School" error="Choose your school.">
      <SchoolSearchInput onChange={onChange} />
    </Field>,
  )
  return { user, onChange }
}

describe('SchoolSearchInput', () => {
  it('is a combobox named by the Field label, with the error tied to it', () => {
    setup()
    const box = screen.getByRole('combobox', { name: 'School' })
    expect(box).toHaveAttribute('aria-expanded', 'false')
    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(box).toHaveAccessibleDescription('Choose your school.')
    expect(document.getElementById(box.getAttribute('aria-controls')!)).toHaveAttribute('role', 'listbox')
  })

  it('moves through the results with the arrow keys and picks one with Enter', async () => {
    const { user, onChange } = setup()
    const box = screen.getByRole('combobox', { name: 'School' })
    await user.type(box, 'Lake')

    await waitFor(() => expect(box).toHaveAttribute('aria-expanded', 'true'))
    const options = screen.getAllByRole('option')
    // Two schools, then "add as a new school".
    expect(options).toHaveLength(3)

    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(box).toHaveAttribute('aria-activedescendant', options[1].id)
    expect(options[1]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenLastCalledWith({ type: 'existing', id: 's2', name: 'Lakeview Academy', state: 'Colorado' })

    // Focus follows to the chosen school, still named by the label.
    const chosen = screen.getByRole('textbox', { name: 'School' })
    expect(chosen).toHaveValue('Lakeview Academy')
    await waitFor(() => expect(chosen).toHaveFocus())
  })

  it('closes the list on Escape', async () => {
    const { user } = setup()
    const box = screen.getByRole('combobox', { name: 'School' })
    await user.type(box, 'Lake')
    await waitFor(() => expect(box).toHaveAttribute('aria-expanded', 'true'))

    await user.keyboard('{Escape}')
    expect(box).toHaveAttribute('aria-expanded', 'false')
    expect(box).not.toHaveAttribute('aria-activedescendant')
  })

  it('adding a new school labels every address field and keeps the outer label on the name', async () => {
    const { user, onChange } = setup()
    const box = screen.getByRole('combobox', { name: 'School' })
    await user.type(box, 'Brand New')
    await waitFor(() => expect(box).toHaveAttribute('aria-expanded', 'true'))

    await user.keyboard('{ArrowUp}{Enter}')
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'new',
      data: { name: 'Brand New', address_line1: '', address_line2: '', city: '', state: '', postcode: '' },
    })

    const name = screen.getByRole('textbox', { name: /School name/ })
    expect(name).toHaveValue('Brand New')
    await waitFor(() => expect(name).toHaveFocus())
    for (const label of ['Address line 1', 'Address line 2 (optional)', 'City', 'Postcode']) {
      expect(screen.getByRole('textbox', { name: label })).toHaveAttribute('autocomplete', 'off')
    }
    expect(screen.getByRole('combobox', { name: 'State' })).toBeInTheDocument()
  })
})
