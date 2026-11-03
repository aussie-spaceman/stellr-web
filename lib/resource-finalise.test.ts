import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FORMAT_SAMPLES } from '@/test/file-fixtures'

// finaliseStoredUpload claims a stored object, watermarks a PDF in place and
// records it. A caller that has already claimed the object (the contribute
// route claims first, to hash the bytes) hands that claim over instead of
// having the same 25MB downloaded and sniffed twice. Storage, the database and
// the stamp are stubbed; claimUpload and the sniffer are real.

const { claimUpload, download, upload, remove, insert, stampPdfBytes } = vi.hoisted(() => ({
  claimUpload: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  insert: vi.fn(),
  stampPdfBytes: vi.fn(),
}))

vi.mock('@/lib/uploads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/uploads')>()
  claimUpload.mockImplementation(actual.claimUpload)
  return { ...actual, claimUpload }
})
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/community', () => ({ RESOURCES_BUCKET: 'community-resources', getCurrentMember: vi.fn() }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/spaces', () => ({ getSpaceForMember: vi.fn() }))
vi.mock('@/lib/campaign-registrations', () => ({ getMemberCampaignRegistration: vi.fn() }))
vi.mock('@/lib/resource-upload', () => ({ memberManagesContainer: vi.fn() }))
vi.mock('@/lib/event-access', () => ({ requireEventAccess: vi.fn() }))
vi.mock('@/lib/watermark/pdf', () => ({
  isPdf: (name: string, mime?: string | null) => mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf'),
  stampPdfBytes,
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    storage: { from: () => ({ download, upload, remove }) },
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        insert(row)
        return { select: () => ({ single: async () => ({ data: { id: 'res-1' }, error: null }) }) }
      },
    }),
  }),
}))

import { finaliseStoredUpload } from './resource-finalise'

const PATH = 'resources/members/m1/1-notes.pdf'
const STAMPED = new Uint8Array([...FORMAT_SAMPLES.pdf, 0x0a])

beforeEach(() => {
  vi.clearAllMocks()
  const copy = Uint8Array.from(FORMAT_SAMPLES.pdf)
  download.mockResolvedValue({ data: { arrayBuffer: async () => copy.buffer, type: 'application/pdf' }, error: null })
  upload.mockResolvedValue({ error: null })
  stampPdfBytes.mockResolvedValue(STAMPED)
})

const finalise = (extra: Partial<Parameters<typeof finaliseStoredUpload>[0]> = {}) =>
  finaliseStoredUpload({
    purpose: 'container-contribution',
    storagePath: PATH,
    title: 'Notes',
    fileType: 'application/pdf',
    uploadedBy: 'm1',
    expectedPrefix: 'resources/members/m1/',
    ...extra,
  })

describe('finaliseStoredUpload', () => {
  it('claims the object itself when it is given no claim', async () => {
    expect(await finalise()).toEqual({ id: 'res-1' })
    expect(claimUpload).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledTimes(1)
    expect(stampPdfBytes).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ storage_path: PATH, file_size_bytes: STAMPED.byteLength }))
  })

  it('takes a claim the caller made, without downloading or sniffing again', async () => {
    const claimed = { bytes: Uint8Array.from(FORMAT_SAMPLES.pdf), bucket: 'community-resources', format: 'pdf' as const }
    expect(await finalise({ claimed })).toEqual({ id: 'res-1' })
    expect(claimUpload).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
    // Stamped once, from the claimed bytes, and written back in place.
    expect(stampPdfBytes).toHaveBeenCalledTimes(1)
    expect(stampPdfBytes).toHaveBeenCalledWith(claimed.bytes)
    expect(upload).toHaveBeenCalledWith(PATH, STAMPED, expect.objectContaining({ contentType: 'application/pdf' }))
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ storage_path: PATH, file_size_bytes: STAMPED.byteLength }))
  })
})
