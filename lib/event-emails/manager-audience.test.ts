// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// S5 B17: an event email's manager recipients come from lib/authz/audiences (not
// mocked), for the tenant that owns the event, on seeded rows where every filter
// runs. Clerk is the only stand-in: it answers the users it is asked for.

const { getUserList } = vi.hoisted(() => ({
  getUserList: vi.fn(async ({ userId }: { userId: string[] }) => ({
    data: userId.map((id) => ({ primaryEmailAddress: { emailAddress: `${id}@example.test` }, firstName: id, lastName: 'M' })),
  })),
}))
vi.mock('@clerk/nextjs/server', () => ({ clerkClient: async () => ({ users: { getUserList } }) }))
vi.mock('@/lib/event-admin', () => ({ getEventRoster: vi.fn() }))
vi.mock('@/lib/registration-checkout', () => ({ ensurePayToken: vi.fn(), payPageUrl: vi.fn() }))

const { loadMentorContacts } = await import('./audiences')
const { fakeSupabase } = await import('@/test/fake-supabase')
const { STELLR_TENANT_ID } = await import('@/lib/tenancy/constants')

const CANARY = '11111111-1111-4111-8111-111111111111'

const seed = () => ({
  events: [
    { slug: 'colorado', tenant_id: STELLR_TENANT_ID },
    { slug: 'canary-day', tenant_id: CANARY },
  ],
  event_manager_assignments: [
    { clerk_user_id: 'c-stellr-1', event_slug: 'colorado', tenant_id: STELLR_TENANT_ID },
    { clerk_user_id: 'c-stellr-2', event_slug: 'colorado', tenant_id: null },
    { clerk_user_id: 'c-stellr-3', event_slug: 'unmirrored', tenant_id: null },
    // A Stellr manager assigned to the Canary event, with no Canary membership.
    { clerk_user_id: 'c-stellr-1', event_slug: 'canary-day', tenant_id: CANARY },
    { clerk_user_id: 'c-canary', event_slug: 'canary-day', tenant_id: CANARY },
  ],
  tenant_memberships: [
    { tenant_id: STELLR_TENANT_ID, clerk_user_id: 'c-stellr-1', member_id: null, role: 'event_manager' },
    { tenant_id: CANARY, clerk_user_id: 'c-canary', member_id: null, role: 'event_manager' },
  ],
})

function seeded(fail?: string) {
  return fakeSupabase(seed(), { failOn: (t) => (t === fail ? 'boom' : null) })
}

const managerEmails = async (db: unknown, slug: string) =>
  (await loadMentorContacts(db as SupabaseClient, slug)).filter((c) => c.role === 'event_manager').map((c) => c.email).sort()

/** The assignment query loadMentorContacts ran before B17, on the same rows. */
async function before(db: SupabaseClient, slug: string): Promise<string[]> {
  const { data } = await db.from('event_manager_assignments').select('clerk_user_id').eq('event_slug', slug)
  return [...new Set(((data ?? []) as { clerk_user_id: string }[]).map((m) => `${m.clerk_user_id}@example.test`))].sort()
}

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  getUserList.mockClear()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  errorSpy.mockRestore()
  vi.unstubAllEnvs()
})

describe('event email manager audience (S5 B17)', () => {
  it.each(['colorado', 'unmirrored'])('a Stellr event (%s) reaches the same managers as before, under the default AUTHZ_SOURCE', async (slug) => {
    vi.stubEnv('AUTHZ_SOURCE', '')
    const fake = seeded()
    const expected = await before(fake.client as unknown as SupabaseClient, slug)
    expect(expected.length).toBeGreaterThan(0)
    expect(await managerEmails(fake.client, slug)).toEqual(expected)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it("a Canary event never emails Stellr's event managers", async () => {
    expect(await managerEmails(seeded().client, 'canary-day')).toEqual(['c-canary@example.test'])
  })

  it("an unreadable events mirror keeps a Stellr event's managers and leaves the Canary event's stamped ones out", async () => {
    expect(await managerEmails(seeded('events').client, 'colorado')).toEqual(['c-stellr-1@example.test', 'c-stellr-2@example.test'])
    expect(await managerEmails(seeded('events').client, 'canary-day')).toEqual([])
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('event tenant lookup failed'), expect.any(Error))
  })

  it('an unreadable assignments table leaves managers out and says so', async () => {
    expect(await managerEmails(seeded('event_manager_assignments').client, 'colorado')).toEqual([])
    expect(getUserList).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('leaves event managers out'), expect.any(Error))
  })
})
