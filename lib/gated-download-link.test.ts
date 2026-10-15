import { describe, it, expect, vi, beforeEach } from 'vitest'

beforeEach(() => {
  vi.stubEnv('ASSET_LINK_SECRET', 'test-asset-link-secret-0123456789abcdef')
})

const { gatedDownloadUrl, verifyGatedDownload } = await import('./gated-download-link')

const params = (url: string) => new URL(url).searchParams

describe('gated download links', () => {
  it('signs a link that verifies for its own asset', () => {
    const url = gatedDownloadUrl('https://www.stellreducation.org/', 'mission-handbook-2026')!
    expect(url.startsWith('https://www.stellreducation.org/api/asset-request/download?a=mission-handbook-2026&s=')).toBe(true)
    expect(verifyGatedDownload(params(url))).toEqual({ ok: true, key: 'mission-handbook-2026' })
  })

  it('does not expire', () => {
    const url = gatedDownloadUrl('https://x.test', 'white-paper')!
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2036-01-01T00:00:00Z'))
    expect(verifyGatedDownload(params(url))).toEqual({ ok: true, key: 'white-paper' })
    vi.useRealTimers()
  })

  it('rejects a link moved to another asset', () => {
    const other = new URLSearchParams(params(gatedDownloadUrl('https://x.test', 'space-rfp-2026')!))
    other.set('a', 'white-paper')
    expect(verifyGatedDownload(other)).toEqual({ ok: false })
  })

  it('rejects a link signed with a different secret', () => {
    const url = gatedDownloadUrl('https://x.test', 'white-paper')!
    vi.stubEnv('ASSET_LINK_SECRET', 'a-different-asset-link-secret-0123456789')
    expect(verifyGatedDownload(params(url))).toEqual({ ok: false })
  })

  it('rejects unknown assets, garbage and missing parameters', () => {
    expect(verifyGatedDownload(new URLSearchParams('a=nope&s=x')).ok).toBe(false)
    expect(verifyGatedDownload(new URLSearchParams('')).ok).toBe(false)
  })

  it('issues no link when no secret is configured', () => {
    vi.stubEnv('ASSET_LINK_SECRET', '')
    vi.stubEnv('SURVEY_TOKEN_SECRET', '')
    vi.stubEnv('ESIGN_TOKEN_SECRET', '')
    expect(gatedDownloadUrl('https://x.test', 'white-paper')).toBeNull()
  })
})
