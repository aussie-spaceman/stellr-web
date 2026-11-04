// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// Decision 24: every community write route asks communityWriteBlock (lib/
// community) straight after resolving the member, and stops on its answer
// before reading the body or touching the database.

const { state } = vi.hoisted(() => ({
  state: { calls: [] as string[], block: true, dbTouched: 0 },
}))

vi.mock('@/lib/community', () => ({
  RESOURCES_BUCKET: 'community-resources',
  getCurrentMember: async () => ({ id: 'm-teen', first_name: 'A', last_name: 'B', isAdmin: false, date_of_birth: '2011-01-01' }),
  tiptapToPlainText: () => 'text',
  communityWriteBlock: async (_m: unknown, action: string) => {
    state.calls.push(action)
    return state.block
      ? NextResponse.json({ code: 'guardian_consent_pending', error: 'pending' }, { status: 403 })
      : null
  },
}))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/spaces', async (orig) => ({
  ...(await orig<typeof import('@/lib/spaces')>()),
  respondToSpaceInvite: async () => { state.dbTouched += 1; return true },
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => {
    state.dbTouched += 1
    throw new Error('the database must not be reached')
  },
}))

const ROUTES: Array<{ name: string; path: string; action: string }> = [
  { name: 'posts', path: './posts/route', action: 'post' },
  { name: 'comments', path: './comments/route', action: 'comment' },
  { name: 'chat', path: './chat/route', action: 'chat' },
  { name: 'reactions', path: './reactions/route', action: 'react' },
  { name: 'media upload', path: './media/upload/route', action: 'upload' },
  { name: 'resource contribution', path: './resources/contribute/route', action: 'contribute' },
  { name: 'space join', path: './spaces/join/route', action: 'join' },
  // Review (3 Nov 2026): the first version left every write below open.
  { name: 'coaching session request', path: './coaching/request/route', action: 'request' },
  { name: 'coaching request', path: './coaching/requests/route', action: 'request' },
  { name: 'coaching top-up', path: './coaching/topup/route', action: 'purchase' },
  { name: 'coaching manage', path: './coaching/manage/route', action: 'host' },
  { name: 'mentoring sign-up', path: './mentoring/register/route', action: 'join' },
  { name: 'mentoring top-up', path: './mentoring/topup/route', action: 'purchase' },
  { name: 'mentoring cohort create', path: './mentoring/cohorts/route', action: 'host' },
  { name: 'mentoring manage', path: './mentoring/manage/route', action: 'host' },
  { name: 'host sessions', path: './host/sessions/route', action: 'host' },
  { name: 'host availability', path: './host/availability/route', action: 'host' },
  { name: 'space attachment', path: './resources/attach/route', action: 'upload' },
  { name: 'teacher nudge', path: './training/group-nudge/route', action: 'message' },
]

const modules: Record<string, { POST: (req: Request) => Promise<Response> }> = {
  './posts/route': await import('./posts/route'),
  './comments/route': await import('./comments/route'),
  './chat/route': await import('./chat/route'),
  './reactions/route': await import('./reactions/route'),
  './media/upload/route': await import('./media/upload/route'),
  './resources/contribute/route': await import('./resources/contribute/route'),
  './spaces/join/route': await import('./spaces/join/route'),
  './coaching/request/route': await import('./coaching/request/route'),
  './coaching/requests/route': await import('./coaching/requests/route'),
  './coaching/topup/route': await import('./coaching/topup/route'),
  './coaching/manage/route': await import('./coaching/manage/route'),
  './mentoring/register/route': await import('./mentoring/register/route'),
  './mentoring/topup/route': await import('./mentoring/topup/route'),
  './mentoring/cohorts/route': await import('./mentoring/cohorts/route'),
  './mentoring/manage/route': await import('./mentoring/manage/route'),
  './host/sessions/route': await import('./host/sessions/route'),
  './host/availability/route': await import('./host/availability/route'),
  './resources/attach/route': await import('./resources/attach/route'),
  './training/group-nudge/route': await import('./training/group-nudge/route'),
}
const cohortRespond = await import('./cohorts/respond/route')
const posts = await import('./posts/route')
const bookRequest = await import('./coaching/requests/[id]/book/route')
const renameAttachment = await import('./resources/attachment/[id]/route')
const inviteRespond = await import('./spaces/invite/respond/route')

beforeEach(() => {
  state.calls = []
  state.block = true
  state.dbTouched = 0
})

describe('community write routes honour memberCommunityTier', () => {
  for (const r of ROUTES) {
    it(`${r.name}: a restricted member gets the 403, before any database work`, async () => {
      const res = await modules[r.path].POST(
        new Request('http://localhost/api/community', { method: 'POST', body: JSON.stringify({ spaceSlug: 's', channelId: 'c', body: 'hi' }) }),
      )
      expect(res.status).toBe(403)
      expect((await res.json()).code).toBe('guardian_consent_pending')
      expect(state.calls).toEqual([r.action])
      expect(state.dbTouched).toBe(0)
    })
  }
})

// Review finding (3 Nov 2026): accepting a Space invite joined the Space while
// /spaces/join refused the same member.
describe('Space invite respond', () => {
  const respond = (action: string) =>
    inviteRespond.POST(new Request('http://localhost/api/community/spaces/invite/respond', {
      method: 'POST', body: JSON.stringify({ spaceId: 'sp-1', action }),
    }))

  it('accepting is a join: a restricted member gets the 403 and nothing is written', async () => {
    const res = await respond('accept')
    expect(res.status).toBe(403)
    expect(state.calls).toEqual(['join'])
    expect(state.dbTouched).toBe(0)
  })

  it('declining stays open to everyone', async () => {
    const res = await respond('decline')
    expect(res.status).toBe(200)
    expect(state.calls).toEqual([])
  })
})

describe('the other community writes (review, 3 Nov 2026)', () => {
  const post = (body: unknown, method = 'POST') =>
    new Request('http://localhost/api/community', { method, body: JSON.stringify(body) })

  it('accepting a cohort invite is a join; declining stays open', async () => {
    const res = await cohortRespond.POST(post({ cohortId: 'c-1', action: 'accept' }))
    expect(res.status).toBe(403)
    expect(state.calls).toEqual(['join'])
    expect(state.dbTouched).toBe(0)

    state.calls = []
    state.block = false
    await cohortRespond.POST(post({ cohortId: 'c-1', action: 'decline' })).catch(() => null)
    expect(state.calls).toEqual([])
  })

  it('pinning an announcement is a moderator write', async () => {
    const res = await posts.PATCH(post({ postId: 'p-1', action: 'toggle-announcement' }, 'PATCH'))
    expect(res.status).toBe(403)
    expect(state.calls).toEqual(['moderate'])
    expect(state.dbTouched).toBe(0)
  })

  it('booking a matched coaching request is a request', async () => {
    const res = await bookRequest.POST(post({ start: '2099-01-01T10:00:00Z' }), { params: Promise.resolve({ id: 'r-1' }) })
    expect(res.status).toBe(403)
    expect(state.calls).toEqual(['request'])
    expect(state.dbTouched).toBe(0)
  })

  it('renaming a space attachment is an upload write', async () => {
    const res = await renameAttachment.PATCH(post({ name: 'x' }, 'PATCH'), { params: Promise.resolve({ id: 'a-1' }) })
    expect(res.status).toBe(403)
    expect(state.calls).toEqual(['upload'])
    expect(state.dbTouched).toBe(0)
  })
})
