import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// The admin account summary's Teams and Billing tabs used to fetch with
// ?memberId=, which let any admin read any member's data with no ticket and
// nothing recorded (S0, Nov 2026). They now render only while the admin holds a
// view-as ticket for THIS member, and otherwise offer to start one.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  ticket: null as { memberId: string; adminMemberId: string; issuedAt: number } | null,
}))

vi.mock('@clerk/nextjs/server', () => ({ clerkClient: async () => ({ users: { getUser: async () => ({}) } }) }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('notFound') } }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db.client }))
vi.mock('@/lib/admin-auth', () => ({ requireAdminPage: async () => {} }))
vi.mock('@/lib/impersonation', () => ({ getImpersonation: async () => h.ticket }))
vi.mock('@/lib/docusign-recipients', () => ({ loadRecipientsByEnvelopeRows: async () => new Map() }))
vi.mock('@/components/member/AccountProfile', () => ({ AccountProfile: () => null }))
vi.mock('@/components/member/MembershipCard', () => ({ MembershipCard: () => null }))
vi.mock('@/components/member/EventHistory', () => ({ EventHistory: () => null }))
vi.mock('@/components/member/DocusignsSection', () => ({ DocusignsSection: () => null }))
vi.mock('@/components/member/MyRegistrations', () => ({ MyRegistrations: () => null }))
vi.mock('@/components/community/DirectoryPrefsForm', () => ({ DirectoryPrefsForm: () => null }))
vi.mock('@/components/admin/ViewAsBanner', () => ({ ViewAsBanner: () => null }))
vi.mock('@/components/member/TeamsTab', () => ({
  TeamsTab: (props: Record<string, unknown>) => <div data-testid="teams">{JSON.stringify(props)}</div>,
}))
vi.mock('@/components/member/BillingHistory', () => ({
  BillingHistory: (props: Record<string, unknown>) => <div data-testid="billing">{JSON.stringify(props)}</div>,
}))
vi.mock('@/components/admin/StartViewAsSession', () => ({
  StartViewAsSession: ({ memberId, what }: { memberId: string; what: string }) => (
    <div data-testid="start">{`${what} for ${memberId}`}</div>
  ),
}))

const { default: ViewAsMemberPage } = await import('./page')

const TEACHER = {
  id: 'teacher-1', first_name: 'Pat', last_name: 'Lee', email: 'pat@school.test',
  event_role: 'teacher', clerk_user_id: null, member_memberships: [], event_participations: [],
}

function page(tab: 'teams' | 'billing') {
  return ViewAsMemberPage({
    params: Promise.resolve({ id: TEACHER.id }),
    searchParams: Promise.resolve({ tab }),
  })
}

beforeEach(() => {
  h.db = fakeSupabase({ members: [TEACHER] })
  h.ticket = null
})

describe('admin account summary, Teams and Billing', () => {
  it.each(['teams', 'billing'] as const)('%s: without a view-as ticket, offers to start one and loads nothing', async (tab) => {
    render(await page(tab))
    expect(screen.getByTestId('start')).toHaveTextContent(`for ${TEACHER.id}`)
    expect(screen.queryByTestId('teams')).toBeNull()
    expect(screen.queryByTestId('billing')).toBeNull()
  })

  it('a ticket for a different member does not count', async () => {
    h.ticket = { memberId: 'someone-else', adminMemberId: 'admin-1', issuedAt: Date.now() }
    render(await page('teams'))
    expect(screen.getByTestId('start')).toBeInTheDocument()
    expect(screen.queryByTestId('teams')).toBeNull()
  })

  it('with a ticket for this member, renders the tabs read only and names no member in the request', async () => {
    h.ticket = { memberId: TEACHER.id, adminMemberId: 'admin-1', issuedAt: Date.now() }
    render(await page('teams'))
    const teams = JSON.parse(screen.getByTestId('teams').textContent ?? '{}')
    expect(teams).toMatchObject({ readOnly: true, memberId: TEACHER.id })
    expect(teams).not.toHaveProperty('impersonateMemberId')

    render(await page('billing'))
    expect(JSON.parse(screen.getByTestId('billing').textContent ?? '{}')).toEqual({ readOnly: true })
  })
})
