import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemberTable, type MemberRow } from './MemberTable'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/admin/members',
}))

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

function renderTable(members: MemberRow[] = [member]) {
  return render(
    <MemberTable
      members={members}
      tiers={[]}
      total={members.length}
      page={1}
      pageSize={50}
      filters={{ q: '', bracket: '', role: '', tier: '' }}
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
