import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeleteEntityButton } from './DeleteEntityButton'

const refresh = vi.fn()
const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push }) }))

type Reply = { status?: number; body: unknown }
let preflight: Reply
let deletion: Reply | (() => Promise<Reply>)
let deleteBodies: unknown[] = []

const json = ({ status = 200, body }: Reply) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  refresh.mockClear()
  push.mockClear()
  deleteBodies = []
  preflight = { body: { blockers: [] } }
  deletion = { body: { ok: true } }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/admin/deletion/preflight')) return json(preflight)
      if (url === '/api/admin/deletion' && init?.method === 'DELETE') {
        deleteBodies.push(JSON.parse(String(init.body)))
        return json(typeof deletion === 'function' ? await deletion() : deletion)
      }
      throw new Error(`unexpected fetch ${url}`)
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

async function open(props: Partial<React.ComponentProps<typeof DeleteEntityButton>> = {}) {
  const user = userEvent.setup()
  render(<DeleteEntityButton entity="school" id="sch-1" name="Lakeside High" {...props} />)
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Delete Lakeside High?' })
  await screen.findByRole('radio', { name: /Soft-delete/ })
  return { user, dialog }
}

describe('DeleteEntityButton', () => {
  it('opens as a named alert dialog with soft-delete chosen', async () => {
    const { dialog } = await open()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('radio', { name: /Soft-delete/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Soft-delete' })).toBeEnabled()
  })

  it('asks for DELETE before a permanent delete, then sends it', async () => {
    const { user } = await open()
    await user.click(screen.getByRole('radio', { name: /Permanently delete/ }))
    const confirm = screen.getByRole('button', { name: 'Permanently delete' })
    expect(confirm).toBeDisabled()

    const field = screen.getByRole('textbox', { name: 'Type DELETE to confirm' })
    expect(field.className).toContain('text-input')
    await user.type(field, 'delete')
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(deleteBodies).toEqual([{ entity: 'school', id: 'sch-1', mode: 'hard' }])
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('lists blockers instead of offering a delete', async () => {
    preflight = { body: { blockers: [{ table: 'teams', label: 'Teams', count: 2, adminHref: '/admin/teams' }] } }
    const user = userEvent.setup()
    render(<DeleteEntityButton entity="school" id="sch-1" name="Lakeside High" />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await screen.findByText('Teams')
    expect(screen.queryByRole('button', { name: 'Soft-delete' })).toBeNull()
    // The footer Close and the header close (×) both dismiss it.
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(2)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('cannot be dismissed while the delete is in flight', async () => {
    let release!: (r: Reply) => void
    deletion = () => new Promise<Reply>((r) => (release = r))
    const { user } = await open()
    await user.click(screen.getByRole('button', { name: 'Soft-delete' }))

    expect(await screen.findByRole('button', { name: 'Deleting…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    release({ body: { ok: true } })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('refreshes when a delete that went through with issues is closed', async () => {
    deletion = { body: { externalResults: [{ ok: false, detail: 'HubSpot timed out' }] } }
    const { user } = await open()
    await user.click(screen.getByRole('button', { name: 'Soft-delete' }))
    await screen.findByText(/Deleted, but external cleanup had issues/)
    expect(refresh).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(refresh).toHaveBeenCalled()
  })
})
