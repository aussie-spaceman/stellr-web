import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminAddMember } from './AdminAddMember'

// S0 (2 Nov 2026): the account invite goes through the COPPA guard, so "Add
// member" with the invite ticked can create the member and hold the invite
// back (no date of birth for a student; a child under 13). The admin is told,
// instead of being moved on to the member page as if the email had gone.

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))

let reply: { member: { id: string }; invite: unknown }

beforeEach(() => {
  push.mockClear()
  reply = { member: { id: 'm-1' }, invite: { sent: true } }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/admin/members') {
      return new Response(JSON.stringify(reply), { status: 201, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
})
afterEach(() => vi.unstubAllGlobals())

async function create() {
  const user = userEvent.setup()
  render(<AdminAddMember tiers={[]} />)
  await user.type(screen.getAllByLabelText(/First name/)[0], 'Sam')
  await user.type(screen.getAllByLabelText(/Last name/)[0], 'Lee')
  await user.type(screen.getAllByLabelText(/Email/)[0], 'sam@example.com')
  await user.click(screen.getByRole('button', { name: 'Create member' }))
}

describe('AdminAddMember — invite outcome', () => {
  it('goes to the new member when the invite went out', async () => {
    await create()
    expect(push).toHaveBeenCalledWith('/admin/members/m-1')
  })

  it.each([
    ['age_unknown', /add their date of birth/],
    ['awaiting_consent', /under 13/],
  ])('says so, and stays put, when the invite was held back (%s)', async (reason, says) => {
    reply = { member: { id: 'm-1' }, invite: { sent: false, reason } }
    await create()
    expect(await screen.findByRole('status')).toHaveTextContent(says)
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/admin/members/m-1')
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Create member' })).toBeDisabled()
  })
})
