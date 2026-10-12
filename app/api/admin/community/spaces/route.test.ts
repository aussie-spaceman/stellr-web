// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

// deep review DB-4 (safeguarding / data-retention): DELETE /api/admin/community/
// spaces used to issue a raw `.delete()`, cascading away every post, comment,
// chat message and suspension record (no DB backups → irreversible). This pins
// that the handler now REFUSES the delete (409, steer to Archive) when content
// exists and never issues the cascade, while an empty space still deletes.

const authMock = vi.fn()

// A fake Supabase client that records whether community_spaces was deleted and
// returns configurable counts for the guard's content lookups.
const state = {
  counts: {} as Record<string, number>,
  channels: [] as { id: string }[],
  deletedSpace: false,
  countError: null as { message: string } | null,
}

function from(table: string) {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.in = () => chain
  chain.delete = () => ({
    eq: async () => {
      if (table === 'community_spaces') state.deletedSpace = true
      return { error: null }
    },
  })
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
    if (table === 'chat_channels') return Promise.resolve({ data: state.channels, error: null }).then(resolve, reject)
    return Promise.resolve({ count: state.counts[table] ?? 0, error: state.countError }).then(resolve, reject)
  }
  return chain
}

vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock() }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from }) }))
// container-sync / utils are pulled in by other handlers in the module, not DELETE.
vi.mock('@/lib/container-sync', () => ({ ensureSpaceContainer: async () => {} }))

import { DELETE } from './route'

afterEach(() => {
  authMock.mockReset()
  state.counts = {}
  state.channels = []
  state.deletedSpace = false
  state.countError = null
})

function req(id: string) {
  return new Request('http://localhost/api/admin/community/spaces', {
    method: 'DELETE',
    body: JSON.stringify({ id }),
  })
}

describe('DELETE /api/admin/community/spaces — DB-4 archive-before-delete', () => {
  it('refuses a non-admin (403) before touching the database', async () => {
    authMock.mockResolvedValue({ sessionClaims: { metadata: { role: 'member' } } })
    expect((await DELETE(req('s1'))).status).toBe(403)
    expect(state.deletedSpace).toBe(false)
  })

  it('returns 409 and does NOT delete when the space has posts', async () => {
    authMock.mockResolvedValue({ sessionClaims: { metadata: { role: 'admin' } } })
    state.counts.community_posts = 1
    const res = await DELETE(req('s1'))
    expect(res.status).toBe(409)
    expect(state.deletedSpace).toBe(false)
    const body = await res.json()
    expect(body.blockers).toContainEqual(expect.objectContaining({ table: 'community_posts', count: 1 }))
  })

  it('returns 409 and does NOT delete when the space has chat messages', async () => {
    authMock.mockResolvedValue({ sessionClaims: { metadata: { role: 'admin' } } })
    state.channels = [{ id: 'c1' }]
    state.counts.chat_messages = 4
    const res = await DELETE(req('s1'))
    expect(res.status).toBe(409)
    expect(state.deletedSpace).toBe(false)
  })

  it('FAILS CLOSED (500, no delete) when a content count errors', async () => {
    authMock.mockResolvedValue({ sessionClaims: { metadata: { role: 'admin' } } })
    state.countError = { message: 'boom' }
    const res = await DELETE(req('s1'))
    expect(res.status).toBe(500)
    expect(state.deletedSpace).toBe(false)
  })

  it('deletes an empty space (200)', async () => {
    authMock.mockResolvedValue({ sessionClaims: { metadata: { role: 'admin' } } })
    const res = await DELETE(req('s1'))
    expect(res.status).toBe(200)
    expect(state.deletedSpace).toBe(true)
  })
})
