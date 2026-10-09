// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review MEM-3: onboarding is a POST anyone signed in can re-run. It must
// refuse to revive an admin-deactivated (banned) account, and must refuse a
// minor who re-submits an adult date of birth to escape the high-school bracket.
const { state } = vi.hoisted(() => ({
  state: {
    userId: 'clerk-1' as string | null,
    clerkUser: null as Record<string, unknown> | null,
    byClerk: null as Record<string, unknown> | null,
    byEmail: null as Record<string, unknown> | null,
    updates: 0,
  },
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: state.userId }),
  currentUser: async () => state.clerkUser,
}))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from(table: string) {
      if (table !== 'members') throw new Error(`unexpected table ${table}`)
      return {
        select: () => ({
          eq: (col: string) => ({
            maybeSingle: async () => ({
              data: col === 'clerk_user_id' ? state.byClerk : state.byEmail,
              error: null,
            }),
          }),
        }),
        update: () => ({
          eq: async () => {
            state.updates += 1
            return { error: null }
          },
        }),
      }
    },
  }),
}))
// Side-effect collaborators — not reached on the 403 paths, but the imports must
// resolve. No-op them so the module loads hermetically.
vi.mock('@/lib/email-campaigns', () => ({ fireCampaignEvent: async () => {} }))
vi.mock('@/lib/membership-grants', () => ({ applyGrantTrigger: async () => {} }))
vi.mock('@/lib/activity-log', () => ({ logActivity: async () => {} }))
vi.mock('@/lib/volunteer', () => ({
  grantVolunteerRole: async () => {},
  dispatchVolunteerAgreement: async () => {},
  VOLUNTEER_MEMBER_COLUMNS: 'id',
}))
vi.mock('@/lib/member-roles', () => ({ syncMemberClassificationRole: async () => {} }))
vi.mock('@/lib/registration-notify', () => ({
  sendAccountConfirmation: async () => {},
  notifyStaffOfRegistration: async () => {},
}))
vi.mock('@/lib/membership-agreement', () => ({ dispatchMembershipAgreement: async () => ({ signNowUrl: null }) }))

const { POST } = await import('./route')

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/members/onboarding', { method: 'POST', body: JSON.stringify(body) }))

const ADULT_BODY = {
  event_role: 'parent',
  age_bracket: 'adult',
  date_of_birth: '1990-01-01',
  gender: 'female',
  phone: '555-1234',
}

beforeEach(() => {
  state.userId = 'clerk-1'
  state.clerkUser = {
    emailAddresses: [{ id: 'e1', emailAddress: 'person@test' }],
    primaryEmailAddressId: 'e1',
    firstName: 'A',
    lastName: 'B',
  }
  state.byClerk = null
  state.byEmail = null
  state.updates = 0
})

describe('POST /api/members/onboarding — re-entry guards (MEM-3)', () => {
  it('refuses to revive an admin-deactivated (banned) account matched by email', async () => {
    state.byEmail = { id: 'm-ban', is_active: false, date_of_birth: '1990-01-01' }
    const res = await post(ADULT_BODY)
    expect(res.status).toBe(403)
    expect(state.updates).toBe(0) // nothing revived/written
  })

  it('refuses a minor on file who re-submits an adult date of birth', async () => {
    state.byClerk = { id: 'm-kid', is_active: true, date_of_birth: '2011-01-01' }
    const res = await post(ADULT_BODY) // adult DOB in the payload
    expect(res.status).toBe(403)
    expect(state.updates).toBe(0)
  })
})
