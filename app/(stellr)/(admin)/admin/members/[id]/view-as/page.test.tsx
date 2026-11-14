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
  clerkUser: {} as Record<string, unknown> | Error,
  viewer: { userId: 'clerk-admin', role: 'admin' } as { userId: string | null; role: string | null },
  errorRows: [] as string[],
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: h.viewer.userId, sessionClaims: h.viewer.role ? { metadata: { role: h.viewer.role } } : null }),
  clerkClient: async () => ({
    users: {
      getUser: async () => {
        if (h.clerkUser instanceof Error) throw h.clerkUser
        return h.clerkUser
      },
    },
  }),
}))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('notFound') },
  redirect: (to: string) => { throw new Error(`redirect ${to}`) },
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db.client }))
vi.mock('@/lib/app-errors', () => ({
  routeLabel: (_a: string, route: string) => route,
  errorDigest: () => 'digest',
  recordBuiltAppError: async (_route: string, message: string) => {
    h.errorRows.push(message)
    return true
  },
}))
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
  h.clerkUser = {}
  h.viewer = { userId: 'clerk-admin', role: 'admin' }
  h.errorRows = []
})

describe('who reaches the page', () => {
  it('signed out goes to sign-in', async () => {
    h.viewer = { userId: null, role: null }
    await expect(page('teams')).rejects.toThrow('redirect /sign-in')
  })

  it.each(['student', 'member', null])('a signed-in %s gets a 404', async (role) => {
    h.viewer = { userId: 'clerk-other', role }
    await expect(page('teams')).rejects.toThrow('notFound')
  })

  // proxy.ts is what keeps an event manager out of /admin/members. This page guard has
  // always let them through, and moving it on is a decision about who may see the page.
  it.each(['admin', 'event_manager'])('a %s passes the page guard', async (role) => {
    h.viewer = { userId: 'clerk-staff', role }
    render(await page('teams'))
    expect(screen.getByTestId('start')).toBeInTheDocument()
  })
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

// View-as refuses staff targets. For a teacher who is also an event manager,
// the tabs say so instead of offering a session the server will refuse.
describe('admin account summary for a staff member', () => {
  it.each(['admin', 'event_manager'])('Clerk role %s: explains why, offers no session', async (role) => {
    h.db = fakeSupabase({ members: [{ ...TEACHER, clerk_user_id: 'clerk-teacher' }] })
    h.clerkUser = { publicMetadata: { role } }
    render(await page('teams'))
    expect(screen.getByText(/View-as isn’t available for crew accounts \(admins and event managers\), so Teams can’t be shown here/)).toBeInTheDocument()
    expect(screen.queryByTestId('start')).toBeNull()
  })

  it('an admin_duties row: explains why on Billing too', async () => {
    h.db = fakeSupabase({ members: [TEACHER], admin_duties: [{ member_id: TEACHER.id, scopes: ['events'] }] })
    render(await page('billing'))
    expect(screen.getByText(/so Billing details can’t be shown here/)).toBeInTheDocument()
    expect(screen.queryByTestId('start')).toBeNull()
  })

  it('when Clerk cannot be asked, still offers the session: the start route makes the call', async () => {
    h.db = fakeSupabase({ members: [{ ...TEACHER, clerk_user_id: 'clerk-teacher' }] })
    h.clerkUser = new Error('Clerk is down')
    render(await page('teams'))
    expect(screen.getByTestId('start')).toBeInTheDocument()
  })

  it('when the admin_duties read fails, still offers the session: only a positive answer counts here', async () => {
    h.db = fakeSupabase({ members: [TEACHER] }, { failOn: (t) => (t === 'admin_duties' ? 'boom' : null) })
    render(await page('teams'))
    expect(screen.getByTestId('start')).toBeInTheDocument()
  })

  it('under postgres, when a role table cannot be read, still offers the session: only a positive answer counts here', async () => {
    vi.stubEnv('AUTHZ_SOURCE', 'postgres')
    try {
      // The first read is the viewer's own, for the page guard. The next is the target's.
      let reads = 0
      h.db = fakeSupabase(
        { members: [{ ...TEACHER, clerk_user_id: 'clerk-teacher' }], platform_admins: [{ clerk_user_id: 'clerk-admin' }] },
        { failOn: (t) => (t === 'platform_admins' && ++reads > 1 ? 'boom' : null) },
      )
      h.clerkUser = { publicMetadata: { role: 'student' } }
      render(await page('teams'))
      expect(reads).toBeGreaterThan(1)
      expect(screen.getByTestId('start')).toBeInTheDocument()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('under shadow, when Clerk cannot be asked, leaves no role-mismatch row for a member who has not drifted', async () => {
    vi.stubEnv('AUTHZ_SOURCE', 'shadow')
    try {
      h.db = fakeSupabase({
        members: [{ ...TEACHER, clerk_user_id: 'clerk-teacher' }],
        platform_admins: [{ clerk_user_id: 'clerk-admin' }],
        tenant_memberships: [{ tenant_id: 'tenant', role: 'event_manager', member_id: TEACHER.id }],
      })
      h.clerkUser = new Error('Clerk is down')
      render(await page('teams'))
      expect(screen.getByTestId('start')).toBeInTheDocument()
      expect(h.errorRows.filter((m) => m.includes('crew_target'))).toEqual([])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('under shadow, with the Clerk answer in hand, a real difference is still reported', async () => {
    vi.stubEnv('AUTHZ_SOURCE', 'shadow')
    try {
      h.db = fakeSupabase({
        members: [{ ...TEACHER, clerk_user_id: 'clerk-teacher' }],
        platform_admins: [{ clerk_user_id: 'clerk-admin' }],
        tenant_memberships: [{ tenant_id: 'tenant', role: 'event_manager', member_id: TEACHER.id }],
      })
      h.clerkUser = { publicMetadata: { role: 'student' } }
      render(await page('teams'))
      expect(h.errorRows.filter((m) => m.includes('crew_target'))).toHaveLength(1)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('a student role on the Clerk record is not staff', async () => {
    h.db = fakeSupabase({ members: [{ ...TEACHER, clerk_user_id: 'clerk-teacher' }] })
    h.clerkUser = { publicMetadata: { role: 'student' } }
    render(await page('teams'))
    expect(screen.getByTestId('start')).toBeInTheDocument()
  })
})
