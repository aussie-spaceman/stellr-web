import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The emailed link for a gated download: a valid signature streams the file
// from private storage; anything else gets nothing.

const download = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ storage: { from: () => ({ download }) } }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: () => null, HOUR_MS: 3_600_000 }))
vi.stubEnv('ASSET_LINK_SECRET', 'test-asset-link-secret-0123456789abcdef')

const { GET } = await import('./route')
const { gatedDownloadUrl } = await import('@/lib/gated-download-link')

const get = (url: string) => GET(new Request(url))

beforeEach(() => {
  download.mockResolvedValue({ data: new Blob(['%PDF-1.7 test'], { type: 'application/pdf' }), error: null })
})
afterEach(() => {
  vi.useRealTimers()
  download.mockReset()
})

describe('GET /api/asset-request/download', () => {
  it('streams the file as an attachment for a valid link', async () => {
    const res = await get(gatedDownloadUrl('https://www.stellreducation.org', 'student-work-examples')!)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename=".+\.pdf"$/)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(download).toHaveBeenCalledWith('gated-downloads/2026-10/student-work-examples-v2-wm.pdf')
  })

  it('refuses a tampered or unsigned link', async () => {
    const url = new URL(gatedDownloadUrl('https://www.stellreducation.org', 'space-rfp-2026')!)
    url.searchParams.set('a', 'mission-handbook-2026')
    expect((await get(url.toString())).status).toBe(403)
    expect((await get('https://www.stellreducation.org/api/asset-request/download')).status).toBe(403)
    expect(download).not.toHaveBeenCalled()
  })

  it('never reveals the storage location when the read fails', async () => {
    download.mockResolvedValueOnce({ data: null, error: { message: 'Object not found' } })
    const res = await get(gatedDownloadUrl('https://www.stellreducation.org', 'space-rfp-2026')!)
    expect(res.status).toBe(503)
    expect(await res.text()).not.toMatch(/gated-downloads|community-resources|not found/i)
  })
})
