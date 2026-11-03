import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FORMAT_SAMPLES } from '@/test/file-fixtures'

// A container contribution is claimed only from the member's own folder. The
// admin catalogue lives under resources/ too, and this route deletes the object
// it was pointed at when the claim is refused or the file is a duplicate — so
// pinning the claim to resources/ let a manager delete catalogue files. The
// real claimUpload and sniffer run here; storage and auth are stubbed.

const { getCurrentMember, download, remove, findAccessibleDuplicate, finaliseStoredUpload } = vi.hoisted(() => ({
  getCurrentMember: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  findAccessibleDuplicate: vi.fn(),
  finaliseStoredUpload: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/community', () => ({ RESOURCES_BUCKET: 'community-resources', getCurrentMember }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/spaces', () => ({ getSpaceForMember: vi.fn() }))
vi.mock('@/lib/campaign-registrations', () => ({ getMemberCampaignRegistration: vi.fn() }))
vi.mock('@/lib/event-access', () => ({ requireEventAccess: vi.fn() }))
vi.mock('@/lib/mentoring', () => ({ searchAttachableResources: vi.fn() }))
vi.mock('@/lib/resource-upload', () => ({
  attachBinary: vi.fn(),
  createLinkBinary: vi.fn(),
  findAccessibleDuplicate,
  memberManagesContainer: async () => true,
  normaliseUrl: vi.fn(),
  sha256Hex: () => 'hash',
}))
vi.mock('@/lib/resource-finalise', () => ({
  finaliseStoredUpload,
  watermarkIfPdf: async (_b: string, _p: string, bytes: Uint8Array) => bytes,
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({ storage: { from: () => ({ download, remove }) } }),
}))

import { POST } from './route'

const MEMBER = '11111111-2222-3333-4444-555555555555'

const post = (storagePath: string) =>
  POST(new Request('http://x/api/community/resources/contribute', {
    method: 'POST',
    body: JSON.stringify({ containerId: 'c1', storagePath, fileName: 'notes.pdf', fileType: 'application/pdf' }),
  }))

beforeEach(() => {
  vi.clearAllMocks()
  getCurrentMember.mockResolvedValue({ id: MEMBER, isAdmin: false })
  const copy = Uint8Array.from(FORMAT_SAMPLES.pdf)
  download.mockResolvedValue({ data: { arrayBuffer: async () => copy.buffer, type: 'application/pdf' }, error: null })
  remove.mockResolvedValue({ error: null })
  finaliseStoredUpload.mockResolvedValue({ id: 'bin-1' })
})

describe('POST /api/community/resources/contribute', () => {
  it('refuses an admin catalogue file without reading or deleting it', async () => {
    // The catalogue's own row would match its own hash: a "duplicate" to drop.
    findAccessibleDuplicate.mockResolvedValue({ id: 'bin-admin' })
    const res = await post('resources/1730000000000-handbook.pdf')
    expect(res.status).toBe(400)
    expect(download).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it("claims the member's own contribution, and re-claims it from the same folder", async () => {
    findAccessibleDuplicate.mockResolvedValue(null)
    const path = `resources/members/${MEMBER}/1-notes.pdf`
    const res = await post(path)
    expect(res.status).toBe(200)
    expect(finaliseStoredUpload).toHaveBeenCalledWith(
      expect.objectContaining({ storagePath: path, expectedPrefix: `resources/members/${MEMBER}/` }),
    )
  })
})
