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
}))
// The stamp runs in the sandbox (lib/pdf-sandbox.ts, tested on its own).
vi.mock('@/lib/pdf-sandbox', () => ({
  stampPdfSandboxed: async (bytes: Uint8Array) => {
    const out = await stampPdfBytes(bytes)
    return out && typeof out === 'object' && 'reason' in out ? out : { ok: true, value: out }
  },
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

import { finaliseStoredUpload, watermarkIfPdf } from './resource-finalise'
import { PDF_BUSY, PDF_UNPROCESSABLE } from './pdf-page-count'

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

describe('watermarkIfPdf', () => {
  // The type and the name are the browser's word. pdf-lib reads anything with
  // a `%PDF-` inside as a PDF, so bytes that didn't sniff as one never reach it
  // — they skipped the page count claimUpload gives a member's PDF.
  it('stamps only bytes that are a PDF, whatever the type says', async () => {
    const text = new Uint8Array(Buffer.from(`notes\n${'x'.repeat(2000)}\n%PDF-1.7\n<< /Type /Page >>\n%%EOF\n`))
    expect(await watermarkIfPdf('community-resources', PATH, text, 'application/pdf')).toBe(text)
    expect(stampPdfBytes).not.toHaveBeenCalled()

    const pdf = Uint8Array.from(FORMAT_SAMPLES.pdf)
    expect(await watermarkIfPdf('community-resources', PATH, pdf, 'application/pdf')).toEqual(STAMPED)
    expect(stampPdfBytes).toHaveBeenCalledWith(pdf)
  })

  // The sandbox stopped pdf-lib: past the timeout, out of heap, or the worker
  // died. The upload is refused and the object discarded — never thrown.
  for (const reason of ['timeout', 'memory', 'crash', 'refused'] as const) {
    it(`refuses and discards a PDF the sandbox stopped (${reason})`, async () => {
      stampPdfBytes.mockResolvedValue({ ok: false, reason, detail: 'stopped' })
      const pdf = Uint8Array.from(FORMAT_SAMPLES.pdf)
      expect(await watermarkIfPdf('community-resources', PATH, pdf, 'application/pdf')).toEqual({
        error: PDF_UNPROCESSABLE,
        status: 422,
      })
      expect(remove).toHaveBeenCalledWith([PATH])
      expect(upload).not.toHaveBeenCalled()
    })
  }

  // No worker came free in time: the file wasn't judged. Discarded (stored, it
  // would be served unstamped) with a 503 asking for it again.
  it('refuses and discards a PDF no worker came free for, as busy', async () => {
    stampPdfBytes.mockResolvedValue({ ok: false, reason: 'busy', detail: 'no free PDF worker in 10000 ms' })
    const pdf = Uint8Array.from(FORMAT_SAMPLES.pdf)
    expect(await watermarkIfPdf('community-resources', PATH, pdf, 'application/pdf')).toEqual({
      error: PDF_BUSY,
      status: 503,
    })
    expect(remove).toHaveBeenCalledWith([PATH])
    expect(upload).not.toHaveBeenCalled()
  })

  it('keeps the original when pdf-lib only threw on it', async () => {
    stampPdfBytes.mockResolvedValue({ ok: false, reason: 'invalid', detail: 'parse error' })
    const pdf = Uint8Array.from(FORMAT_SAMPLES.pdf)
    expect(await watermarkIfPdf('community-resources', PATH, pdf, 'application/pdf')).toBe(pdf)
    expect(remove).not.toHaveBeenCalled()
  })

  it('finaliseStoredUpload passes the refusal on and records nothing', async () => {
    stampPdfBytes.mockResolvedValue({ ok: false, reason: 'timeout', detail: 'stopped' })
    expect(await finalise()).toEqual({ error: PDF_UNPROCESSABLE, status: 422 })
    expect(insert).not.toHaveBeenCalled()
  })
})
