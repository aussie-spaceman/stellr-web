import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AdminModule, AdminSection } from '@/components/admin/community/TrainingManager'
import { CourseBuilder } from './CourseBuilder'

const { uploadDirectToStorage } = vi.hoisted(() => ({ uploadDirectToStorage: vi.fn() }))
vi.mock('@/lib/upload-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/upload-client')>()),
  uploadDirectToStorage,
}))

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/academy/training',
  useSearchParams: () => new URLSearchParams('tab=builder'),
}))

const section = (id: string, title: string, display_order: number): AdminSection => ({
  id,
  title,
  display_order,
  drip_days: 0,
})

const course: AdminModule = {
  id: 'course-1',
  title: 'Orbital mechanics',
  description: null,
  material_kind: 'general',
  course_type: 'self_paced',
  theme: 'space',
  cert_template_path: null,
  credential_title: null,
  credential_description: null,
  credential_criteria: null,
  credential_skills: [],
  start_date: null,
  event_ref: null,
  min_tier_rank: 0,
  is_published: true,
  training_sections: [section('s-a', 'Alpha', 0), section('s-b', 'Beta', 1), section('s-c', 'Gamma', 2)],
  training_items: [],
  course_object_assignments: [],
}

type Call = { url: string; method?: string; body?: unknown }
let calls: Call[] = []

beforeEach(() => {
  calls = []
  refresh.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

const sectionPatches = () =>
  calls.filter((c) => c.url === '/api/admin/community/training/sections' && c.method === 'PATCH').map((c) => c.body)

// Section titles in the order they are on screen.
const sectionOrder = () =>
  screen.getAllByRole('button', { name: /^Move .+ up$/ }).map((b) => b.getAttribute('aria-label')!.replace(/^Move (.+) up$/, '$1'))

describe('CourseBuilder curriculum — reordering without dragging (WCAG 2.5.7)', () => {
  it('gives each section a named Move up / Move down pair, disabled at the ends', () => {
    render(<CourseBuilder courses={[course]} objects={[]} tiers={[]} />)
    expect(screen.getByRole('button', { name: 'Move Alpha up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Alpha down' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Move Beta up' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Move Gamma down' })).toBeDisabled()
  })

  it('moves a section one step, saves the new order and keeps focus on the arrow', async () => {
    render(<CourseBuilder courses={[course]} objects={[]} tiers={[]} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Move Beta down' }))

    expect(sectionOrder()).toEqual(['Alpha', 'Gamma', 'Beta'])
    expect(sectionPatches()).toEqual([
      { id: 's-c', displayOrder: 1 },
      { id: 's-b', displayOrder: 2 },
    ])
    expect(refresh).toHaveBeenCalled()
    // Beta is now last, so its Move down is disabled and focus moves to Move up.
    expect(screen.getByRole('button', { name: 'Move Beta down' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Beta up' })).toHaveFocus()
    expect(screen.getByText('“Beta” moved to position 3 of 3.')).toBeInTheDocument()
  })

  it('saves a quick move back even before the refresh brings new props', async () => {
    render(<CourseBuilder courses={[course]} objects={[]} tiers={[]} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Move Alpha down' }))
    await user.click(screen.getByRole('button', { name: 'Move Alpha up' }))

    expect(sectionOrder()).toEqual(['Alpha', 'Beta', 'Gamma'])
    // Against the stale props the second move looks like "no change"; it must
    // still undo what the first one saved.
    expect(sectionPatches()).toEqual([
      { id: 's-b', displayOrder: 0 },
      { id: 's-a', displayOrder: 1 },
      { id: 's-a', displayOrder: 0 },
      { id: 's-b', displayOrder: 1 },
    ])
  })

  it('keeps the drag handles', () => {
    const { container } = render(<CourseBuilder courses={[course]} objects={[]} tiers={[]} />)
    const draggable = container.querySelectorAll('[draggable="true"]')
    expect(draggable).toHaveLength(3)
    expect(within(draggable[0] as HTMLElement).getByRole('button', { name: 'Move Alpha down' })).toBeInTheDocument()
  })
})

// A refused certificate template used to change nothing on screen: the server's
// reason was dropped, at signing and when the route claimed the stored file.
describe('CourseBuilder certificate template — refusals are shown', () => {
  const STORED = { storagePath: 'training-cert/course-1/1-cert.pdf', fileName: 'cert.pdf', fileType: 'application/pdf', fileSize: 1 }
  const pdf = () => new File(['%PDF-1.7'], 'cert.pdf', { type: 'application/pdf' })

  beforeEach(() => uploadDirectToStorage.mockReset())

  it('shows why signing refused the file', async () => {
    uploadDirectToStorage.mockResolvedValue({ error: 'That file type is not accepted here.' })
    render(<CourseBuilder courses={[course]} objects={[]} tiers={[]} />)
    await userEvent.setup().upload(screen.getByLabelText(/Upload PDF/), pdf())
    expect(await screen.findByRole('alert')).toHaveTextContent('That file type is not accepted here.')
    expect(calls.some((c) => c.url === '/api/admin/community/training/cert-template')).toBe(false)
  })

  it('shows why the route refused the stored file, and can be tried again with the same file', async () => {
    uploadDirectToStorage.mockResolvedValue(STORED)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Template must be a PDF' }), { status: 415 })),
    )
    render(<CourseBuilder courses={[course]} objects={[]} tiers={[]} />)
    const user = userEvent.setup()
    const input = screen.getByLabelText(/Upload PDF/) as HTMLInputElement
    await user.upload(input, pdf())
    expect(await screen.findByRole('alert')).toHaveTextContent('Template must be a PDF')
    expect(refresh).not.toHaveBeenCalled()
    // The picker is cleared, so choosing the same file again uploads it again.
    expect(input.value).toBe('')
    await user.upload(input, pdf())
    expect(uploadDirectToStorage).toHaveBeenCalledTimes(2)
  })

  it('still saves a template the route accepts', async () => {
    uploadDirectToStorage.mockResolvedValue(STORED)
    render(<CourseBuilder courses={[course]} objects={[]} tiers={[]} />)
    await userEvent.setup().upload(screen.getByLabelText(/Upload PDF/), pdf())
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(calls).toContainEqual({
      url: '/api/admin/community/training/cert-template',
      method: 'POST',
      body: { moduleId: 'course-1', storagePath: STORED.storagePath },
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('CourseBuilder lessons — a Resource lesson made of attached resources', () => {
  const lesson = {
    id: 'l-1',
    title: 'How to judge',
    content_kind: 'link' as const,
    status: 'published' as const,
    section_id: 's-a',
    display_order: 0,
    estimated_minutes: 3,
    body: null,
    external_url: 'https://example.com/video',
  }
  const withLesson = { ...course, training_items: [lesson] }

  // The resources panel asks the API what the lesson already has attached.
  const attached = (resources: { id: string; kind: 'file'; title: string; external_url: null }[]) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
        return new Response(JSON.stringify({ resources }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }),
    )
  const itemPatches = () => calls.filter((c) => c.url === '/api/admin/community/training/items' && c.method === 'PATCH').map((c) => c.body)

  const switchToResource = async () => {
    render(<CourseBuilder courses={[withLesson]} objects={[]} tiers={[]} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'How to judge' }))
    await user.click(screen.getByRole('button', { name: 'Resource' }))
    return user
  }

  it('saves without a second upload when a resource is already attached', async () => {
    attached([{ id: 'r-1', kind: 'file', title: 'Judging pack', external_url: null }])
    const user = await switchToResource()
    await screen.findByText('Judging pack')
    await user.click(screen.getByRole('button', { name: 'Save lesson' }))
    await vi.waitFor(() => expect(itemPatches()).toHaveLength(1))
    expect(itemPatches()[0]).toMatchObject({ id: 'l-1', contentKind: 'document' })
    expect(uploadDirectToStorage).not.toHaveBeenCalled()
  })

  it('still asks for a file when there is nothing attached', async () => {
    attached([])
    const user = await switchToResource()
    await screen.findByText('No resources attached.')
    await user.click(screen.getByRole('button', { name: 'Save lesson' }))
    expect(await screen.findByText('Choose a file to upload, or attach a resource below.')).toBeInTheDocument()
    expect(itemPatches()).toEqual([])
  })
})

describe('CourseBuilder sections — deleting one', () => {
  const inAlpha = (id: string, display_order: number) => ({
    id,
    title: `Lesson ${id}`,
    content_kind: 'link' as const,
    status: 'published' as const,
    section_id: 's-a',
    display_order,
    estimated_minutes: null,
    body: null,
  })
  const deletes = () => calls.filter((c) => c.url.includes('/training/sections?id=') && c.method === 'DELETE')
  const deleteAlpha = async () => {
    render(<CourseBuilder courses={[{ ...course, training_items: [inAlpha('1', 0), inAlpha('2', 1)] }]} objects={[]} tiers={[]} />)
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Delete section' })[0])
  }

  it('says its lessons stay visible to members, and does nothing when declined', async () => {
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    await deleteAlpha()
    expect(confirm.mock.calls[0]).toEqual([expect.stringContaining('Its 2 lessons stay in the course under “Not in a section”, and members will still see them.')])
    expect(deletes()).toEqual([])
  })

  it('deletes once confirmed', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    await deleteAlpha()
    await vi.waitFor(() => expect(deletes()).toHaveLength(1))
  })
})

describe('CourseBuilder lessons — a new lesson goes after the last one', () => {
  it('numbers from the highest order in the section, not the count', async () => {
    const lessons = [0, 1, 3].map((display_order) => ({
      id: `l-${display_order}`,
      title: `Lesson ${display_order}`,
      content_kind: 'link' as const,
      status: 'published' as const,
      section_id: 's-a',
      display_order,
      estimated_minutes: null,
      body: null,
    }))
    render(<CourseBuilder courses={[{ ...course, training_items: lessons }]} objects={[]} tiers={[]} />)
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: 'Add lesson' })[0])
    await user.type(screen.getByLabelText('Lesson title'), 'Next')
    await user.click(screen.getAllByRole('button', { name: 'Add lesson' }).at(-1)!)
    await vi.waitFor(() => expect(calls.some((c) => c.url === '/api/admin/community/training/items' && c.method === 'POST')).toBe(true))
    const post = calls.find((c) => c.url === '/api/admin/community/training/items' && c.method === 'POST')!
    expect(post.body).toMatchObject({ displayOrder: '4' })
  })
})
