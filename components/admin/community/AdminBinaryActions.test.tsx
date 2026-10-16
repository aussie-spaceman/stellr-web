import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminBinaryActions } from './AdminBinaryActions'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

let deleted: string[] = []

beforeEach(() => {
  deleted = []
  refresh.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') deleted.push(url)
      return new Response('{}', { status: 200 })
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('AdminBinaryActions', () => {
  it('has 44px named icon buttons', () => {
    render(<AdminBinaryActions binaryId="b-1" title="Rover kit.pdf" attachedObjects={[]} />)
    for (const name of ['Rename Rover kit.pdf', 'Delete Rover kit.pdf']) {
      const button = screen.getByRole('button', { name })
      expect(button.className).toContain('min-h-11')
      expect(button.className).toContain('min-w-11')
    }
  })

  it('confirms in an alert dialog that lists every object, then deletes', async () => {
    const user = userEvent.setup()
    render(<AdminBinaryActions binaryId="b-1" title="Rover kit.pdf" attachedObjects={['Mars cohort', 'Propulsion Lounge']} />)
    await user.click(screen.getByRole('button', { name: 'Delete Rover kit.pdf' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Delete this resource?' })
    expect(dialog).toHaveAccessibleDescription(/“Rover kit.pdf” will be permanently deleted/)
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Mars cohort', 'Propulsion Lounge'])

    await user.click(screen.getByRole('button', { name: 'Delete everywhere' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(deleted).toEqual(['/api/admin/community/resources?id=b-1'])
    expect(refresh).toHaveBeenCalled()
  })

  it('backs out with Cancel', async () => {
    const user = userEvent.setup()
    render(<AdminBinaryActions binaryId="b-1" title="Rover kit.pdf" attachedObjects={[]} />)
    await user.click(screen.getByRole('button', { name: 'Delete Rover kit.pdf' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(deleted).toEqual([])
  })
})
