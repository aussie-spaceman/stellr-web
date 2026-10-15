import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AdminModule, AdminSection } from '@/components/admin/community/TrainingManager'
import { CourseBuilder } from './CourseBuilder'

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
