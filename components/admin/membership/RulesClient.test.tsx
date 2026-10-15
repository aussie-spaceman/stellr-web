import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RulesClient } from './RulesClient'

let posted: unknown[] = []

beforeEach(() => {
  posted = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/admin/membership/rules' && init?.method === 'POST') posted.push(JSON.parse(String(init.body)))
      const body = url === '/api/admin/access/objects' ? { objects: [] } : { rules: [] }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

const tiers = [
  { id: 't-free', name: 'Explorer', is_free: true },
  { id: 't-scholar', name: 'Scholar', is_free: false },
]

describe('RulesClient rule dialog', () => {
  it('opens in the shared dialog with labelled fields and saves once named', async () => {
    const user = userEvent.setup()
    render(<RulesClient initialRules={[]} tiers={tiers} />)
    await user.click(screen.getByRole('button', { name: /Add rule/ }))

    const dialog = screen.getByRole('dialog', { name: 'New grant rule' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const name = screen.getByRole('textbox', { name: 'Rule name' })
    expect(name).toHaveFocus()
    expect(name.className).toContain('text-input')
    expect(screen.getByRole('combobox', { name: 'When (trigger)' })).toBeInTheDocument()

    const create = screen.getByRole('button', { name: 'Create rule' })
    expect(create).toBeDisabled()
    await user.type(name, 'Winners → Scholar')
    expect(create).toBeEnabled()

    // Credits need a quantity before they can be saved.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Grant' }), 'credits')
    expect(create).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Quantity' }), '2')
    expect(create).toBeEnabled()

    await user.click(create)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ name: 'Winners → Scholar', grant_kind: 'credits', grant_quantity: 2 })
  })

  it('closes on Escape without saving', async () => {
    const user = userEvent.setup()
    render(<RulesClient initialRules={[]} tiers={tiers} />)
    await user.click(screen.getByRole('button', { name: /Add rule/ }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(posted).toHaveLength(0)
  })
})
