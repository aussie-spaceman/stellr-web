import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// The admin's view-as controls (S0, Nov 2026). Starting and ending a session
// both depend on an audit row being written, so the server can refuse either;
// the controls must show that refusal rather than look like they worked.

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const { ImpersonationBanner } = await import('./ImpersonationBanner')
const { ViewAsBanner } = await import('./ViewAsBanner')
const { StartViewAsSession } = await import('./StartViewAsSession')

let reply: { status: number; body: Record<string, unknown> }
const fetchMock = vi.fn(async () => new Response(JSON.stringify(reply.body), { status: reply.status }))

beforeEach(() => {
  refresh.mockReset()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const STILL_RUNNING = 'Could not record the end of this view-as session, so it is still running. Try again.'

describe('exiting view-as', () => {
  it('the portal banner says so, and stays, when the end cannot be recorded', async () => {
    reply = { status: 503, body: { error: STILL_RUNNING } }
    render(<ImpersonationBanner memberName="Pat Lee" adminName="An Admin" memberId="m1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Exit view-as' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(STILL_RUNNING)
    expect(screen.getByRole('button', { name: 'Exit view-as' })).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/impersonation', { method: 'DELETE' })
  })

  it('the account summary banner ends the session too, and shows a refusal', async () => {
    reply = { status: 503, body: { error: STILL_RUNNING } }
    render(<ViewAsBanner memberId="m1" memberName="Pat Lee" />)
    fireEvent.click(screen.getByRole('button', { name: 'Exit view' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(STILL_RUNNING)
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/impersonation', { method: 'DELETE' })
  })
})

describe('StartViewAsSession', () => {
  it('starts a session for the member, then re-renders the page', async () => {
    reply = { status: 200, body: { ok: true } }
    render(<StartViewAsSession memberId="m1" what="Teams" />)
    fireEvent.click(screen.getByRole('button', { name: /Start view-as session/ }))
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/impersonation', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ memberId: 'm1' }),
    }))
  })

  // Starting one switches the admin's whole member portal to this member, read
  // only, until they exit: their own member-side changes are refused meanwhile.
  it('says the whole member portal switches to this member until Exit view', () => {
    render(<StartViewAsSession memberId="m1" what="Teams" />)
    expect(screen.getByText(/your whole member portal shows this member, read only/)).toBeInTheDocument()
    expect(screen.getByText(/Until you select Exit view, or for 30 minutes/)).toBeInTheDocument()
  })

  it('shows why a session was refused and does not re-render', async () => {
    reply = { status: 403, body: { error: 'Cannot view as a crew member.' } }
    render(<StartViewAsSession memberId="m1" what="Billing details" />)
    fireEvent.click(screen.getByRole('button', { name: /Start view-as session/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot view as a crew member.')
    expect(refresh).not.toHaveBeenCalled()
  })
})
