import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// A refused upload — at signing, or when the route claims the stored file —
// used to leave the panel exactly as it was, as if nothing had happened. The
// server's reason is shown now. Storage is stubbed; postUpload is real.

const { uploadDirectToStorage } = vi.hoisted(() => ({ uploadDirectToStorage: vi.fn() }))
vi.mock('@/lib/upload-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/upload-client')>()),
  uploadDirectToStorage,
}))

import { LessonResources } from './LessonResources'

const RESOURCES = '/api/admin/community/training/resources'
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let answer: Response
let posts: unknown[]
let lists: number

beforeEach(() => {
  uploadDirectToStorage.mockReset()
  answer = json({ id: 'r1' })
  posts = []
  lists = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)))
        return answer
      }
      if (url.startsWith('/api/admin/community/resources/search')) {
        return json({ results: [{ id: 'cat-1', title: 'Rover handbook', fileType: 'application/pdf', sizeBytes: 10 }] })
      }
      lists++
      return json({ resources: [] })
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

async function openFilePanel() {
  const user = userEvent.setup()
  const { container } = render(<LessonResources itemId="item-1" />)
  await user.click(screen.getByRole('button', { name: 'Add resource' }))
  await user.click(screen.getByRole('button', { name: 'File' }))
  await user.type(screen.getByPlaceholderText('Title'), 'Budget')
  await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, new File(['x'], 'Budget.xlsb'))
  return user
}

describe('LessonResources — refusals are shown', () => {
  it('shows why signing refused the file, and posts nothing', async () => {
    uploadDirectToStorage.mockResolvedValue({ error: '.xlsb files aren’t accepted here.' })
    const user = await openFilePanel()
    await user.click(screen.getByRole('button', { name: 'Add resource' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('.xlsb files aren’t accepted here.')
    expect(posts).toEqual([])
    expect(screen.getByPlaceholderText('Title')).toHaveValue('Budget') // still open, nothing lost
  })

  it('shows why the route refused the stored file', async () => {
    uploadDirectToStorage.mockResolvedValue({
      storagePath: 'training-resources/1-Budget.pdf', fileName: 'Budget.pdf', fileType: 'application/pdf', fileSize: 1,
    })
    answer = json({ error: 'That file’s contents don’t match its .pdf name.' }, 415)
    const user = await openFilePanel()
    await user.click(screen.getByRole('button', { name: 'Add resource' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That file’s contents don’t match its .pdf name.')
    expect(posts).toEqual([
      { itemId: 'item-1', kind: 'file', title: 'Budget', storagePath: 'training-resources/1-Budget.pdf', fileType: 'application/pdf' },
    ])
  })

  it('shows why a link or a catalogue resource was refused', async () => {
    const user = userEvent.setup()
    render(<LessonResources itemId="item-1" />)
    await user.click(screen.getByRole('button', { name: 'Add resource' }))
    await user.type(screen.getByPlaceholderText('Title'), 'Rules')
    await user.type(screen.getByPlaceholderText('https://…'), 'https://example.org/rules')
    answer = json({ error: 'Could not add resource' }, 500)
    await user.click(screen.getByRole('button', { name: 'Add resource' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not add resource')

    await user.click(screen.getByRole('button', { name: 'Existing' }))
    expect(screen.queryByRole('alert')).toBeNull() // a new mode starts clean
    answer = json({ error: 'Resource not found' }, 404)
    await user.click(await screen.findByRole('button', { name: /Rover handbook/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Resource not found')
  })

  it('asks for a file rather than doing nothing when none is chosen', async () => {
    const user = userEvent.setup()
    render(<LessonResources itemId="item-1" />)
    await user.click(screen.getByRole('button', { name: 'Add resource' }))
    await user.click(screen.getByRole('button', { name: 'File' }))
    await user.type(screen.getByPlaceholderText('Title'), 'Budget')
    await user.click(screen.getByRole('button', { name: 'Add resource' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a file to upload.')
    expect(uploadDirectToStorage).not.toHaveBeenCalled()
  })

  it('still adds a file the route accepts, and closes', async () => {
    uploadDirectToStorage.mockResolvedValue({
      storagePath: 'training-resources/1-Budget.pdf', fileName: 'Budget.pdf', fileType: 'application/pdf', fileSize: 1,
    })
    const user = await openFilePanel()
    const listed = lists
    await user.click(screen.getByRole('button', { name: 'Add resource' }))
    expect(await screen.findByText('No resources attached.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(lists).toBeGreaterThan(listed)
  })
})
