import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FORMAT_SAMPLES, HOSTILE_SAMPLES } from '@/test/file-fixtures'

// S0 content safety: an embedded image is signed into a staging prefix and only
// republished — by the server, under a type taken from its bytes — to the prefix
// the media proxy serves. The real claimUpload and sniffer run here; only
// storage, auth and the member lookup are stubbed.

const { getCurrentMember, download, remove, upload } = vi.hoisted(() => ({
  getCurrentMember: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/community', () => ({ RESOURCES_BUCKET: 'community-resources', getCurrentMember, communityWriteBlock: async () => null }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/spaces', () => ({ getSpaceForMember: vi.fn() }))
vi.mock('@/lib/campaign-registrations', () => ({ getMemberCampaignRegistration: vi.fn() }))
vi.mock('@/lib/resource-upload', () => ({ memberManagesContainer: vi.fn() }))
vi.mock('@/lib/event-access', () => ({ requireEventAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({ storage: { from: () => ({ download, remove, upload }) } }),
}))

import { POST } from './route'

const MEMBER = '11111111-2222-3333-4444-555555555555'
const OTHER = '99999999-8888-7777-6666-555555555555'

const post = (body: Record<string, unknown>) =>
  POST(new Request('http://x/api/community/media/upload', { method: 'POST', body: JSON.stringify(body) }))

const stored = (bytes: Uint8Array, type = 'application/octet-stream') => {
  const copy = Uint8Array.from(bytes)
  download.mockResolvedValue({ data: { arrayBuffer: async () => copy.buffer, type }, error: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  getCurrentMember.mockResolvedValue({ id: MEMBER })
  upload.mockResolvedValue({ error: null })
  remove.mockResolvedValue({ error: null })
})

describe('POST /api/community/media/upload', () => {
  it('refuses a path in the served prefix: nothing reaches it without a claim', async () => {
    const res = await post({ storagePath: `community-media/${MEMBER}/1-a.png`, fileType: 'image/png' })
    expect(res.status).toBe(403)
    expect(download).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })

  it("refuses another member's staged upload", async () => {
    const res = await post({ storagePath: `community-media-staging/${OTHER}/1-a.png`, fileType: 'image/png' })
    expect(res.status).toBe(403)
    expect(download).not.toHaveBeenCalled()
  })

  it('republishes a verified image under the type its bytes are, then drops the staged copy', async () => {
    stored(FORMAT_SAMPLES.png)
    // Declared as a GIF; the published copy is typed from the bytes.
    const res = await post({ storagePath: `community-media-staging/${MEMBER}/1-a.png`, fileType: 'image/gif' })
    expect(res.status).toBe(200)
    expect(upload).toHaveBeenCalledWith(`community-media/${MEMBER}/1-a.png`, FORMAT_SAMPLES.png, {
      contentType: 'image/png',
      upsert: false,
    })
    expect(remove).toHaveBeenCalledWith([`community-media-staging/${MEMBER}/1-a.png`])
    expect(await res.json()).toEqual({ src: `/api/community/media/community-media/${MEMBER}/1-a.png` })
  })

  it('never publishes a page staged under an image name', async () => {
    stored(HOSTILE_SAMPLES['an SVG with a script'], 'image/png')
    const res = await post({ storagePath: `community-media-staging/${MEMBER}/1-a.png`, fileType: 'image/png' })
    expect(res.status).toBe(415)
    expect(upload).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith([`community-media-staging/${MEMBER}/1-a.png`])
  })

  it('reports a failed publish and still drops the staged copy', async () => {
    stored(FORMAT_SAMPLES.jpeg)
    upload.mockResolvedValue({ error: { message: 'boom' } })
    const res = await post({ storagePath: `community-media-staging/${MEMBER}/1-a.jpg`, fileType: 'image/jpeg' })
    expect(res.status).toBe(500)
    expect(remove).toHaveBeenCalledWith([`community-media-staging/${MEMBER}/1-a.jpg`])
  })
})
