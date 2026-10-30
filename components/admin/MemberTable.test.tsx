import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemberTable, type MemberRow } from './MemberTable'
import { EMPTY_MEMBER_FILTERS, type MemberFilters } from '@/lib/admin-member-filters'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/admin/members',
}))

beforeEach(() => push.mockClear())

const member: MemberRow = {
  id: 'm-1',
  member_code: 'STL-0001',
  first_name: 'Avery',
  last_name: 'Test',
  email: 'avery@example.com',
  phone: null,
  age_bracket: 'adult',
  event_role: 'mentor',
  grade: null,
  is_active: true,
  created_at: '2026-09-01T00:00:00Z',
  member_memberships: [],
  member_schools: [],
}

function renderTable(members: MemberRow[] = [member], filters: Partial<MemberFilters> = {}) {
  return render(
    <MemberTable
      members={members}
      tiers={[{ id: '11111111-1111-4111-8111-111111111111', name: 'Pathfinder' }]}
      total={members.length}
      page={1}
      pageSize={50}
      filters={{ ...EMPTY_MEMBER_FILTERS, ...filters }}
    />,
  )
}

// Mobile review N3: at 375px the table was clipped, and the only way into a
// member was a "View" link in the last column, off the edge of the screen.
describe('MemberTable on a narrow screen', () => {
  it('scrolls sideways in a keyboard-focusable region instead of clipping', () => {
    renderTable()
    const region = screen.getByRole('region', { name: 'Members' })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(region).toHaveClass('overflow-x-auto')
    expect(region).not.toHaveClass('overflow-hidden')
  })

  it('makes the name, in the column that stays on screen, the link to the member', () => {
    renderTable()
    const link = screen.getByRole('link', { name: 'Avery Test STL-0001' })
    expect(link).toHaveAttribute('href', '/admin/members/m-1')
    expect(link.closest('td')).toHaveClass('sticky', 'left-0')
  })

  it('still shows the empty state across every column', () => {
    renderTable([])
    expect(screen.getByText('No members found.').closest('td')).toHaveAttribute('colspan', '7')
  })
})

// 29 Oct 2026: filter and sort on the columns themselves.
describe('MemberTable column filters', () => {
  it('applies a text filter on Enter, back on page 1', () => {
    renderTable()
    const input = screen.getByRole('searchbox', { name: 'Filter by name' })
    fireEvent.change(input, { target: { value: 'ava' } })
    expect(push).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(push).toHaveBeenCalledWith('/admin/members?name=ava')
  })

  it('applies a text filter when focus leaves it, but not when nothing changed', () => {
    renderTable([member], { email: 'example' })
    const input = screen.getByRole('searchbox', { name: 'Filter by email' })
    fireEvent.blur(input)
    expect(push).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'stellr' } })
    fireEvent.blur(input)
    expect(push).toHaveBeenCalledWith('/admin/members?email=stellr')
  })

  it('filters by membership, including members with none', () => {
    renderTable()
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by membership' }), { target: { value: 'none' } })
    expect(push).toHaveBeenCalledWith('/admin/members?tier=none')
  })

  it('keeps the other filters when one changes', () => {
    renderTable([member], { role: 'mentor' })
    fireEvent.change(screen.getByLabelText('Joined on or after'), { target: { value: '2026-10-01' } })
    expect(push).toHaveBeenCalledWith('/admin/members?role=mentor&joinedFrom=2026-10-01')
  })

  it('clears every filter at once and says how many there were', () => {
    renderTable([], { role: 'mentor', school: 'Lincoln' })
    expect(screen.getByText('No members match these filters.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear 2 filters' }))
    expect(push).toHaveBeenCalledWith('/admin/members')
  })
})

describe('MemberTable sorting', () => {
  it('marks the sorted column for assistive tech', () => {
    renderTable()
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByRole('columnheader', { name: /Joined/ })).toHaveAttribute('aria-sort', 'none')
  })

  it('sorts a new column newest first for dates, and flips on a second click', () => {
    const { unmount } = renderTable()
    fireEvent.click(screen.getByRole('button', { name: 'Joined' }))
    expect(push).toHaveBeenLastCalledWith('/admin/members?sort=joined&dir=desc')
    unmount()
    renderTable([member], { sort: 'joined', dir: 'desc' })
    fireEvent.click(screen.getByRole('button', { name: 'Joined' }))
    expect(push).toHaveBeenLastCalledWith('/admin/members?sort=joined&dir=asc')
  })
})
