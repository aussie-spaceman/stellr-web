import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FORMAT_SAMPLES } from '@/test/file-fixtures'

// A container contribution is claimed only from the member's own folder. The
// admin catalogue lives under resources/ too, and this route deletes the object
// it was pointed at when the claim is refused or the file is a duplicate — so
// pinning the claim to resources/ let a manager delete catalogue files. The
// real claimUpload, sniffer and finaliseStoredUpload run here; storage, the
// database, the PDF stamp and auth are stubbed.

const { getCurrentMember, download, remove, upload, insert, stampPdfBytes, findAccessibleDuplicate, attachBinary } =
  vi.hoisted(() => ({
    getCurrentMember: vi.fn(),
    download: vi.fn(),
    remove: vi.fn(),
    upload: vi.fn(),
    insert: vi.fn(),
    stampPdfBytes: vi.fn(),
    findAccessibleDuplicate: vi.fn(),
    attachBinary: vi.fn(),
  }))

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/community', () => ({ RESOURCES_BUCKET: 'community-resources', getCurrentMember, communityWriteBlock: async () => null }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/spaces', () => ({ getSpaceForMember: vi.fn() }))
vi.mock('@/lib/campaign-registrations', () => ({ getMemberCampaignRegistration: vi.fn() }))
vi.mock('@/lib/event-access', () => ({ requireEventAccess: vi.fn() }))
vi.mock('@/lib/mentoring', () => ({ searchAttachableResources: vi.fn() }))
vi.mock('@/lib/resource-upload', () => ({
  attachBinary,
  createLinkBinary: vi.fn(),
  findAccessibleDuplicate,
  memberManagesContainer: async () => true,
  normaliseUrl: vi.fn(),
  sha256Hex: () => 'hash',
}))
vi.mock('@/lib/watermark/pdf', () => ({
  isPdf: (name: string, mime?: string | null) => mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf'),
  stampPdfBytes,
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    storage: { from: () => ({ download, remove, upload }) },
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        insert(row)
        return { select: () => ({ single: async () => ({ data: { id: 'bin-1' }, error: null }) }) }
      },
    }),
  }),
}))

import { POST } from './route'

const MEMBER = '11111111-2222-3333-4444-555555555555'
const STAMPED = new Uint8Array([...FORMAT_SAMPLES.pdf, 0x0a])

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
  upload.mockResolvedValue({ error: null })
  stampPdfBytes.mockResolvedValue(STAMPED)
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

  // The route claimed the object to hash it, stamped it, and then finalising
  // claimed it again: two downloads and sniffs of up to 25MB, and a second
  // pass through the PDF stamp, for every contribution.
  it("claims the member's own contribution once, and stamps and records it once", async () => {
    findAccessibleDuplicate.mockResolvedValue(null)
    const path = `resources/members/${MEMBER}/1-notes.pdf`
    const res = await post(path)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, binaryId: 'bin-1' })
    expect(download).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledWith(path)
    expect(stampPdfBytes).toHaveBeenCalledTimes(1)
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload).toHaveBeenCalledWith(path, STAMPED, expect.objectContaining({ contentType: 'application/pdf', upsert: true }))
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ storage_path: path, content_hash: 'hash', file_size_bytes: STAMPED.byteLength, uploaded_by: MEMBER }),
    )
    expect(attachBinary).toHaveBeenCalledWith('c1', 'bin-1', null)
    expect(remove).not.toHaveBeenCalled()
  })

  it('drops a duplicate without stamping or recording it', async () => {
    findAccessibleDuplicate.mockResolvedValue({ id: 'bin-0' })
    const path = `resources/members/${MEMBER}/1-notes.pdf`
    const res = await post(path)
    expect(await res.json()).toEqual({ duplicate: { id: 'bin-0' } })
    expect(remove).toHaveBeenCalledWith([path])
    expect(stampPdfBytes).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })
})
