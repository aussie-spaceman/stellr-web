// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// deep review MEM-12: the generic resource download only gated space-scoped rows,
// so event materials (event_ref set) and container-attached contributions
// (space_id null, but attached to a container) leaked to any signed-in member who
// learned the id — bypassing the participant/tier check and the container check.
const { state, signed } = vi.hoisted(() => ({
  state: { db: null as FakeDb | null },
  signed: vi.fn(async () => 'https://storage.test/signed'),
}))

vi.mock('@/lib/community', () => ({
  getCurrentMember: async () => ({ id: 'm1', isAdmin: false, activeTierIds: [] }),
  signedDownloadUrl: signed,
}))
vi.mock('@/lib/spaces', () => ({ getSpaceAccessById: async () => ({ canAccess: true }) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => state.db!.client }))

const { GET } = await import('./route')

const get = (id: string) => GET(new Request('https://app.test'), { params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  signed.mockResolvedValue('https://storage.test/signed')
})

describe('GET resource download — gate (MEM-12)', () => {
  it('refuses an event-material row (event_ref set) without signing', async () => {
    state.db = fakeSupabase({
      community_resources: [{ id: 'r-evt', storage_path: 'resources/x.pdf', title: 'Event brief', space_id: null, event_ref: 'event_abc' }],
    })
    const res = await get('r-evt')
    expect(res.status).toBe(403)
    expect(signed).not.toHaveBeenCalled()
  })

  it('refuses a container-attached row (space_id null, in container_contents)', async () => {
    state.db = fakeSupabase({
      community_resources: [{ id: 'r-contrib', storage_path: 'resources/y.pdf', title: 'Cohort file', space_id: null, event_ref: null }],
      container_contents: [{ id: 'cc1', container_id: 'co1', content_type: 'resource', content_ref: 'r-contrib' }],
    })
    const res = await get('r-contrib')
    expect(res.status).toBe(403)
    expect(signed).not.toHaveBeenCalled()
  })

  it('still serves a genuinely standalone library file (no space, no event, no container)', async () => {
    state.db = fakeSupabase({
      community_resources: [{ id: 'r-lib', storage_path: 'resources/z.pdf', title: 'Handbook', space_id: null, event_ref: null }],
    })
    const res = await get('r-lib')
    expect(res.status).toBe(200)
    expect(signed).toHaveBeenCalledWith('resources/z.pdf')
  })
})
