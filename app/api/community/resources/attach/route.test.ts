import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FORMAT_SAMPLES } from '@/test/file-fixtures'

// A space attachment is claimed only from the member's own folder in that space.
// Admin space files live in the same space namespace, and a refused claim
// deletes the object it was pointed at, so pinning the claim to the space alone
// let a member delete an admin's file by posting its path back. The real
// claimUpload and sniffer run here; storage, auth and the database are stubbed.

const { getCurrentMember, getSpaceForMember, download, remove, insert } = vi.hoisted(() => ({
  getCurrentMember: vi.fn(),
  getSpaceForMember: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/community', () => ({ RESOURCES_BUCKET: 'community-resources', getCurrentMember }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/spaces', () => ({ getSpaceForMember }))
vi.mock('@/lib/campaign-registrations', () => ({ getMemberCampaignRegistration: vi.fn() }))
vi.mock('@/lib/resource-upload', () => ({ memberManagesContainer: vi.fn() }))
vi.mock('@/lib/event-access', () => ({ requireEventAccess: vi.fn() }))
vi.mock('@/lib/container-sync', () => ({ attachSpaceResource: vi.fn() }))
vi.mock('@/lib/resource-finalise', () => ({ watermarkIfPdf: async (_b: string, _p: string, bytes: Uint8Array) => bytes }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    storage: { from: () => ({ download, remove }) },
    from: (table: string) =>
      table === 'community_posts'
        ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'post-1', space_id: SPACE } }) }) }) }
        : { insert: (row: unknown) => (insert(row), { select: () => ({ single: async () => ({ data: { id: 'res-1' }, error: null }) }) }) },
  }),
}))

import { POST } from './route'

const MEMBER = '11111111-2222-3333-4444-555555555555'
const OTHER = '99999999-8888-7777-6666-555555555555'
const SPACE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

const post = (storagePath: string) =>
  POST(new Request('http://x/api/community/resources/attach', {
    method: 'POST',
    body: JSON.stringify({ spaceSlug: 'rovers', postId: 'post-1', storagePath, fileName: 'file', fileType: '' }),
  }))

const stored = (bytes: Uint8Array) => {
  const copy = Uint8Array.from(bytes)
  download.mockResolvedValue({ data: { arrayBuffer: async () => copy.buffer, type: 'application/octet-stream' }, error: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  getCurrentMember.mockResolvedValue({ id: MEMBER, isAdmin: false })
  getSpaceForMember.mockResolvedValue({ id: SPACE, access: { canAccess: true }, allowMemberUploads: true })
  remove.mockResolvedValue({ error: null })
})

describe('POST /api/community/resources/attach', () => {
  it("refuses an admin's file in the same space without reading or deleting it", async () => {
    stored(FORMAT_SAMPLES.pdf)
    const res = await post(`community-resources/${SPACE}/1730000000000-diagram.svg`)
    expect(res.status).toBe(400)
    expect(download).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it("refuses another member's attachment in the same space", async () => {
    stored(FORMAT_SAMPLES.pdf)
    const res = await post(`community-resources/${SPACE}/members/${OTHER}/1-notes.pdf`)
    expect(res.status).toBe(400)
    expect(download).not.toHaveBeenCalled()
  })

  it("claims the member's own attachment", async () => {
    stored(FORMAT_SAMPLES.pdf)
    const path = `community-resources/${SPACE}/members/${MEMBER}/1-notes.pdf`
    const res = await post(path)
    expect(res.status).toBe(200)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ storage_path: path, space_id: SPACE }))
  })
})
