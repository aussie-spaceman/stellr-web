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
