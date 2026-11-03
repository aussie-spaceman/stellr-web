// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// What lib/impersonation decides per request: whether the caller's view-as
// ticket is honoured, and which member a /api/members/* route acts on.

const h = vi.hoisted(() => ({
  userId: 'clerk-admin' as string | null,
  role: 'admin' as string | undefined,
  cookie: undefined as string | undefined,
  db: null as unknown as FakeDb,
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: h.userId, sessionClaims: h.role ? { metadata: { role: h.role } } : null }),
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (h.cookie ? { value: h.cookie } : undefined) }),
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db.client }))

const saved = process.env.IMPERSONATION_SECRET
afterEach(() => {
  if (saved === undefined) delete process.env.IMPERSONATION_SECRET
  else process.env.IMPERSONATION_SECRET = saved
})

const { encodeTicket, getImpersonation, resolveRequestMember } = await import('@/lib/impersonation')

const ADMIN = { id: 'admin-member', clerk_user_id: 'clerk-admin', email: 'admin@stellr.test', is_active: true }
const OTHER_ADMIN = { id: 'other-admin', clerk_user_id: 'clerk-other-admin', email: 'other@stellr.test', is_active: true }
const KID = { id: 'kid', clerk_user_id: 'clerk-kid', email: 'kid@school.test', is_active: true }
const GONE = { id: 'gone', clerk_user_id: 'clerk-gone', email: 'gone@school.test', is_active: false }

function ticketFor(memberId: string, adminMemberId = ADMIN.id) {
  return encodeTicket({ memberId, adminMemberId, issuedAt: Date.now() })
}

beforeEach(() => {
  process.env.IMPERSONATION_SECRET = 'request-test-secret-of-at-least-32-chars'
  h.userId = 'clerk-admin'
  h.role = 'admin'
  h.cookie = undefined
  h.db = fakeSupabase({ members: [ADMIN, OTHER_ADMIN, KID, GONE] })
})

describe('getImpersonation', () => {
  it('honours a ticket for the admin who started it', async () => {
    h.cookie = ticketFor(KID.id)
    expect(await getImpersonation()).toMatchObject({ memberId: KID.id, adminMemberId: ADMIN.id })
  })

  it('refuses a ticket started by a different admin (a replayed cookie)', async () => {
    h.cookie = ticketFor(KID.id, OTHER_ADMIN.id)
    expect(await getImpersonation()).toBeNull()
  })

  it('refuses when the caller has no member row to bind to', async () => {
    h.cookie = ticketFor(KID.id)
    h.db = fakeSupabase({ members: [KID] })
    expect(await getImpersonation()).toBeNull()
  })

  it('fails closed when the binding lookup errors', async () => {
    h.cookie = ticketFor(KID.id)
    h.db = fakeSupabase({ members: [ADMIN, KID] }, { failOn: (t) => (t === 'members' ? 'boom' : null) })
    expect(await getImpersonation()).toBeNull()
  })

  it('grants nothing to a caller who is no longer an admin', async () => {
    h.cookie = ticketFor(KID.id)
    h.role = 'event_manager'
    expect(await getImpersonation()).toBeNull()
  })

  it('is no session when the deployment has no signing secret', async () => {
    h.cookie = ticketFor(KID.id)
    delete process.env.IMPERSONATION_SECRET
    expect(await getImpersonation()).toBeNull()
  })
})

describe('resolveRequestMember', () => {
  it('signed out is unauthorised', async () => {
    h.userId = null
    expect(await resolveRequestMember(h.db.client, 'id, email')).toEqual({
      member: null,
      unauthorised: true,
      impersonating: false,
    })
  })

  it('an admin with no ticket gets their own row, never someone else’s', async () => {
    const r = await resolveRequestMember<{ id: string }>(h.db.client, 'id, email')
    expect(r.member?.id).toBe(ADMIN.id)
    expect(r.impersonating).toBe(false)
  })

  it('with a ticket, resolves the viewed member and says it is view-as', async () => {
    h.cookie = ticketFor(KID.id)
    const r = await resolveRequestMember<{ id: string }>(h.db.client, 'id, email')
    expect(r.member?.id).toBe(KID.id)
    expect(r.impersonating).toBe(true)
  })

  // The account summary's Billing tab runs on view-as: an admin handling a
  // refund for a family that deleted its account must still see its records.
  it('view-as of a deactivated member still resolves them for the admin', async () => {
    h.cookie = ticketFor(GONE.id)
    const r = await resolveRequestMember<{ id: string }>(h.db.client, 'id, email')
    expect(r.member?.id).toBe(GONE.id)
    expect(r.impersonating).toBe(true)
  })

  it('a deactivated member acting as themselves finds nothing', async () => {
    h.userId = 'clerk-gone'
    h.role = undefined
    const r = await resolveRequestMember<{ id: string }>(h.db.client, 'id, email')
    expect(r.member).toBeNull()
    expect(r.impersonating).toBe(false)
  })

  it('a ticket another admin started is ignored: the caller gets their own row', async () => {
    h.cookie = ticketFor(KID.id, OTHER_ADMIN.id)
    const r = await resolveRequestMember<{ id: string }>(h.db.client, 'id, email')
    expect(r.member?.id).toBe(ADMIN.id)
    expect(r.impersonating).toBe(false)
  })
})

// S0 (Nov 2026): ?memberId= let any admin read any member's billing and teams
// with no ticket and no audit row. Nothing may read it again, and nothing may
// build it.
describe('no ?memberId= override', () => {
  const files = (dir: string, ext: RegExp) =>
    (readdirSync(dir, { recursive: true }) as string[])
      .map((p) => `${dir}/${p.replace(/\\/g, '/')}`)
      .filter((p) => ext.test(p) && !/\.test\.tsx?$/.test(p))

  it('no member API route reads a memberId query parameter', () => {
    const routes = files('app/api/members', /\/route\.ts$/)
    expect(routes.length).toBeGreaterThan(10)
    const offenders = routes.filter((f) => /searchParams\.(get|has)\(\s*['"]memberId['"]/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('no member component appends ?memberId= to a member API call', () => {
    const comps = files('components/member', /\.tsx?$/)
    const offenders = comps.filter((f) => /\?memberId=/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
