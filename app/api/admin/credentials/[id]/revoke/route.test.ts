// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// S0 (Nov 2026): the acting admin is recorded as the person who revoked, even
// while that admin holds a view-as ticket for someone else. getCurrentMember()
// follows the ticket and returns the VIEWED member, so it must not be the actor
// lookup here; getSignedInMember() is the real signed-in admin.

const ADMIN = { id: 'admin-member' }
const VIEWED = { id: 'viewed-kid' }

const h = vi.hoisted(() => ({
  revokeCredential: vi.fn(),
  logActivity: vi.fn(async () => {}),
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: 'user_clerkadmin', sessionClaims: { metadata: { role: 'admin' } } }),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: 'cred-1', event_slug: 'nevada-sdc', member_id: 'holder-1', title: 'Finalist', number: 'S-1' },
            error: null,
          }),
        }),
      }),
    }),
  }),
}))
// A view-as ticket is live: the view-as-aware resolver returns the viewed member.
vi.mock('@/lib/community', () => ({
  getCurrentMember: async () => VIEWED,
  getSignedInMember: async () => ADMIN,
}))
vi.mock('@/lib/credentials', () => ({
  CREDENTIAL_COLUMNS: '*',
  revokeCredential: h.revokeCredential,
  holderIsMinor: async () => false,
}))
vi.mock('@/lib/activity-log', () => ({ crewActorType: async () => 'admin', logActivity: h.logActivity }))
vi.mock('@/lib/email', () => ({ sendEmail: async () => {}, credentialRevokedEmail: () => ({}) }))
vi.mock('@/lib/credentials-notify', () => ({ recipientForCredential: async () => null }))

const { POST } = await import('./route')

function revoke() {
  return POST(
    new Request('https://app.stellreducation.org/api/admin/credentials/cred-1/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Issued in error' }),
    }),
    { params: Promise.resolve({ id: 'cred-1' }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.revokeCredential.mockResolvedValue({ id: 'cred-1', member_id: 'holder-1', title: 'Finalist', number: 'S-1' })
})

describe('POST /api/admin/credentials/[id]/revoke', () => {
  it('records the signed-in admin as the revoker, not the member they are viewing as', async () => {
    const res = await revoke()
    expect(res.status).toBe(200)
    expect(h.revokeCredential).toHaveBeenCalledWith(expect.anything(), 'cred-1', 'Issued in error', ADMIN.id)
    expect(h.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'holder-1', actorType: 'admin', actorMemberId: ADMIN.id }),
    )
  })
})
