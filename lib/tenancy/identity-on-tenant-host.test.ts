// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TENANT_ID_HEADER, TENANT_SLUG_HEADER } from './host'

// A session is the same person on any host. With tenant routing on, an allowed API
// on a tenant host carries the proxy's tenant headers, and the identity helpers must
// still see who is signed in. These run the real lib/community and lib/survey/http:
// the register routes take the session's email from getCurrentMember in preference to
// the submitted one (pinned in their route tests), and the survey routes refuse
// someone else's link from getSignedInMember.

const CANARY = '11111111-1111-4111-8111-111111111111'
const MEMBER = {
  id: 'member-signed-in',
  first_name: 'Sam',
  last_name: 'Session',
  email: 'session@example.test',
  event_role: null,
  age_bracket: null,
  date_of_birth: '1990-01-01',
  gender: 'x',
  member_memberships: [],
}

const h = vi.hoisted(() => ({
  headers: new Headers(),
  userId: 'user_1' as string | null,
  authCalls: 0,
  invitationByToken: vi.fn(),
  loadSession: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: async () => h.headers }))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => {
    h.authCalls += 1
    return { userId: h.userId, sessionClaims: null }
  },
  currentUser: async () => null,
}))
vi.mock('@/lib/impersonation', () => ({
  impersonatedMemberId: async () => null,
  assertNotImpersonating: async () => null,
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: h.userId ? MEMBER : null, error: null }),
    }
    return { from: () => chain }
  },
}))
vi.mock('@/lib/survey/access', async (orig) => ({
  ...(await orig<typeof import('@/lib/survey/access')>()),
  invitationByToken: h.invitationByToken,
  loadSession: h.loadSession,
}))

import { getCurrentMember, getSignedInMember } from '@/lib/community'
import { resolveSession } from '@/lib/survey/http'

const surveyRequest = () => new Request('https://canary-academy.localhost/api/survey/tok_1', {
  headers: { 'x-real-ip': '203.0.113.50' },
})

beforeEach(() => {
  vi.stubEnv('TENANT_ROUTING_ENABLED', 'true')
  h.headers = new Headers({ [TENANT_ID_HEADER]: CANARY, [TENANT_SLUG_HEADER]: 'canary-academy' })
  h.userId = 'user_1'
  h.authCalls = 0
  h.invitationByToken.mockReset()
  h.loadSession.mockReset()
  h.loadSession.mockResolvedValue({ state: 'open' })
})
afterEach(() => vi.unstubAllEnvs())

describe('on a tenant host, with the proxy tenant headers present', () => {
  it.each([
    ['getCurrentMember', getCurrentMember],
    ['getSignedInMember', getSignedInMember],
  ])('%s still resolves the signed-in member', async (_name, helper) => {
    const member = await helper()
    expect(h.authCalls).toBe(1)
    expect(member?.id).toBe(MEMBER.id)
    expect(member?.email).toBe(MEMBER.email)
  })

  it('still answers null for a signed-out visitor', async () => {
    h.userId = null
    expect(await getCurrentMember()).toBeNull()
  })

  it("refuses someone else's survey link", async () => {
    h.invitationByToken.mockResolvedValue({ id: 'inv-1', member_id: 'member-someone-else', participant_id: null })
    const out = await resolveSession(surveyRequest(), { token: 'tok_1' }, { write: false })
    expect('error' in out && out.error.status).toBe(403)
    expect(h.loadSession).not.toHaveBeenCalled()
  })

  it('opens the signed-in member their own survey link', async () => {
    h.invitationByToken.mockResolvedValue({ id: 'inv-1', member_id: MEMBER.id, participant_id: null })
    const out = await resolveSession(surveyRequest(), { token: 'tok_1' }, { write: false })
    expect('error' in out).toBe(false)
    expect(h.loadSession).toHaveBeenCalledOnce()
  })
})
