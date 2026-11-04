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
]

const modules: Record<string, { POST: (req: Request) => Promise<Response> }> = {
  './posts/route': await import('./posts/route'),
  './comments/route': await import('./comments/route'),
  './chat/route': await import('./chat/route'),
  './reactions/route': await import('./reactions/route'),
  './media/upload/route': await import('./media/upload/route'),
  './resources/contribute/route': await import('./resources/contribute/route'),
  './spaces/join/route': await import('./spaces/join/route'),
}
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
