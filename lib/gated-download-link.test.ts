import { describe, it, expect, vi, beforeEach } from 'vitest'

beforeEach(() => {
  vi.stubEnv('ASSET_LINK_SECRET', 'test-asset-link-secret-0123456789abcdef')
})

const { gatedDownloadUrl, verifyGatedDownload, LINK_TTL_SECONDS } = await import('./gated-download-link')

const NOW = new Date('2026-10-14T20:00:00Z')
const params = (url: string) => new URL(url).searchParams

describe('gated download links', () => {
  it('signs a link that verifies for its own asset', () => {
    const url = gatedDownloadUrl('https://www.stellreducation.org/', 'mission-handbook-2026', NOW)!
    expect(url.startsWith('https://www.stellreducation.org/api/asset-request/download?a=mission-handbook-2026&e=')).toBe(true)
    expect(verifyGatedDownload(params(url), NOW)).toEqual({ ok: true, key: 'mission-handbook-2026' })
  })

  it('rejects a link moved to another asset or with a tampered expiry', () => {
    const p = params(gatedDownloadUrl('https://x.test', 'space-rfp-2026', NOW)!)
    const other = new URLSearchParams(p)
    other.set('a', 'white-paper')
    expect(verifyGatedDownload(other, NOW)).toEqual({ ok: false, reason: 'invalid' })
    const later = new URLSearchParams(p)
    later.set('e', String(Number(p.get('e')) + 3600))
    expect(verifyGatedDownload(later, NOW)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('expires after the TTL, which is seven days at most', () => {
    expect(LINK_TTL_SECONDS).toBeLessThanOrEqual(7 * 24 * 60 * 60)
    const p = params(gatedDownloadUrl('https://x.test', 'white-paper', NOW)!)
    const justAfter = new Date(NOW.getTime() + (LINK_TTL_SECONDS + 1) * 1000)
    expect(verifyGatedDownload(p, justAfter)).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects unknown assets, garbage and missing parameters', () => {
    expect(verifyGatedDownload(new URLSearchParams('a=nope&e=1&s=x'), NOW).ok).toBe(false)
    expect(verifyGatedDownload(new URLSearchParams(''), NOW).ok).toBe(false)
  })

  it('issues no link when no secret is configured', () => {
    vi.stubEnv('ASSET_LINK_SECRET', '')
    vi.stubEnv('SURVEY_TOKEN_SECRET', '')
    vi.stubEnv('ESIGN_TOKEN_SECRET', '')
    expect(gatedDownloadUrl('https://x.test', 'white-paper', NOW)).toBeNull()
  })
})
