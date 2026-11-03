// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Opening a catalogue resource bumps a download counter and puts "Opened
// resource" on the member's own timeline, as the member. S0 (Nov 2026): under
// an admin's view-as the file is still served, but neither is recorded, so the
// admin's click never reads as the member's.

const h = vi.hoisted(() => ({ viewingAs: false }))
const rpc = vi.fn(async () => ({ data: null, error: null }))
const logActivity = vi.fn(async () => {})

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ rpc }) }))
vi.mock('@/lib/community', () => ({
  getCurrentMember: async () => ({ id: 'kid' }),
  signedDownloadUrl: async (path: string) => `https://storage.test/${path}`,
}))
vi.mock('@/lib/resources-catalogue', () => ({
  resolveDownloadableAttachment: async () => ({
    kind: 'file',
    storagePath: 'resources/guide.pdf',
    binaryId: 'bin-1',
    title: 'Launch guide',
  }),
}))
vi.mock('@/lib/activity-log', () => ({ logActivity: (...a: unknown[]) => logActivity(...(a as [])) }))
vi.mock('@/lib/impersonation', () => ({ mayBeViewingAs: async () => h.viewingAs }))

const { GET } = await import('./route')

function open() {
  return GET(new Request('https://app.test/api/community/resources/attachment/att-1/download'), {
    params: Promise.resolve({ id: 'att-1' }),
  })
}

beforeEach(() => {
  h.viewingAs = false
  rpc.mockClear()
  logActivity.mockClear()
})

describe('GET /api/community/resources/attachment/[id]/download', () => {
  it('a member opening a resource: served, counted and logged as theirs', async () => {
    const res = await open()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ url: 'https://storage.test/resources/guide.pdf' })
    expect(rpc).toHaveBeenCalledWith('increment_resource_download', { rid: 'bin-1' })
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'kid', actorType: 'member' }))
  })

  it('an admin viewing as the member: served, but nothing counted or logged', async () => {
    h.viewingAs = true
    const res = await open()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ url: 'https://storage.test/resources/guide.pdf' })
    expect(rpc).not.toHaveBeenCalled()
    expect(logActivity).not.toHaveBeenCalled()
  })
})
