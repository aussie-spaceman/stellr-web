// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// S0 (Nov 2026): the pd_credential_issued audit row names the admin who issued
// it, even while that admin holds a view-as ticket for someone else.
// getCurrentMember() follows the ticket and returns the VIEWED member;
// getSignedInMember() is the real signed-in admin.

const ADMIN = { id: 'admin-member' }
const VIEWED = { id: 'viewed-kid' }
const TEACHER = {
  id: 'teacher-1',
  first_name: 'Pat',
  last_name: 'Lee',
  email: 'pat@school.test',
  date_of_birth: '1980-01-01',
  is_active: true,
}

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  issueCredential: vi.fn(),
  logActivity: vi.fn(async () => {}),
}))

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db.client }))
vi.mock('@/lib/authz', async () => {
  const { eventRouteFor } = await import('@/test/fixtures/event-route')
  return { requireEventRoute: async (slug: string) => eventRouteFor(slug) }
})
vi.mock('@/lib/sanity', () => ({
  getEventBySlug: async () => ({ title: 'Nevada SDC', type: 'space', date: '2026-11-06', city: 'Reno', state: 'NV' }),
}))
// A view-as ticket is live: the view-as-aware resolver returns the viewed member.
vi.mock('@/lib/community', () => ({
  getCurrentMember: async () => VIEWED,
  getSignedInMember: async () => ADMIN,
}))
// The real refusal class, so the route's instanceof check is the one production runs.
vi.mock('@/lib/credentials', async () => {
  const { CredentialNotIssuedError } = await vi.importActual<typeof import('@/lib/credentials')>('@/lib/credentials')
  return { CREDENTIAL_COLUMNS: '*', issueCredential: h.issueCredential, CredentialNotIssuedError }
})
vi.mock('@/lib/credentials-notify', () => ({ sendCredentialIssuedEmail: async () => true }))
vi.mock('@/lib/activity-log', () => ({ logActivity: h.logActivity }))

const { POST } = await import('./route')
const { CredentialNotIssuedError } = await import('@/lib/credentials')

const issue = () =>
  POST(
    new Request('https://app.stellreducation.org/api/admin/events/nevada-sdc/pd-credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberId: TEACHER.id, hours: 6 }),
    }),
    { params: Promise.resolve({ slug: 'nevada-sdc' }) },
  )

beforeEach(() => {
  vi.clearAllMocks()
  h.db = fakeSupabase({ members: [TEACHER] })
  h.issueCredential.mockResolvedValue({ created: true, row: { id: 'cred-9', number: 'PD-9' } })
})

describe('POST /api/admin/events/[slug]/pd-credentials', () => {
  it('records the signed-in admin as the issuer, not the member they are viewing as', async () => {
    const res = await POST(
      new Request('https://app.stellreducation.org/api/admin/events/nevada-sdc/pd-credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memberId: TEACHER.id, hours: 6 }),
      }),
      { params: Promise.resolve({ slug: 'nevada-sdc' }) },
    )
    expect(res.status).toBe(200)
    expect(h.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: TEACHER.id,
        action: 'pd_credential_issued',
        actorType: 'admin',
        actorMemberId: ADMIN.id,
      }),
    )
  })

  // S5 A10a follow-up (owner-approved 13 Nov 2026): issueCredential refusing another
  // organisation's event is a conflict, answered 409 with the reason, not a 500.
  it('answers 409 with the reason when the event belongs to another tenant', async () => {
    h.issueCredential.mockRejectedValue(new CredentialNotIssuedError('tenant_not_issuer'))
    const res = await issue()
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error?: string; reason?: string; ok?: boolean }
    expect(body.reason).toBe('tenant_not_issuer')
    expect(body.error).toBe(new CredentialNotIssuedError('tenant_not_issuer').message)
    expect(body.ok).toBeUndefined()
    // Nothing was issued, so nothing is logged against the educator.
    expect(h.logActivity).not.toHaveBeenCalled()
  })

  it('still answers 500 for any other failure to issue', async () => {
    h.issueCredential.mockRejectedValue(new Error('insert failed'))
    const res = await issue()
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error?: string }).error).toBe('insert failed')
    expect(h.logActivity).not.toHaveBeenCalled()
  })
})
