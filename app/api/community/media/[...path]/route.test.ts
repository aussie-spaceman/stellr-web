import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review MEM-1: the proxy must never sign an object outside
// community-media/<memberId>/<file>. getCurrentMember / signedDownloadUrl are
// stubbed so these tests assert only the path-sanitisation, with no DB/storage.
vi.mock('@/lib/community', () => ({
  getCurrentMember: vi.fn(),
  signedDownloadUrl: vi.fn(),
}))

import { GET } from './route'
import { getCurrentMember, signedDownloadUrl } from '@/lib/community'

const member = vi.mocked(getCurrentMember)
const sign = vi.mocked(signedDownloadUrl)

const UUID = '11111111-2222-3333-4444-555555555555'

function call(path: string[]) {
  return GET(new Request('http://x/api/community/media'), { params: Promise.resolve({ path }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  member.mockResolvedValue({ id: UUID } as never)
  sign.mockResolvedValue('https://signed.example/url')
})

describe('/api/community/media path traversal (MEM-1)', () => {
  it('401s an anonymous caller before any path work', async () => {
    member.mockResolvedValue(null)
    const res = await call(['community-media', UUID, 'a.png'])
    expect(res.status).toBe(401)
    expect(sign).not.toHaveBeenCalled()
  })

  it('refuses a segment that smuggles an escape out of community-media', async () => {
    // Next already decoded the catch-all once; `..%2F..%2F…` decodes to a single
    // segment containing slashes — it must never be joined and signed.
    const res = await call(['community-media', '../../signed-agreements/docusign/2026/abc/signed.pdf'])
    expect(res.status).toBe(404)
    expect(sign).not.toHaveBeenCalled()
  })

  it('refuses a literal ".." segment', async () => {
    const res = await call(['community-media', '..', 'signed-agreements', 'x.pdf'])
    expect(res.status).toBe(404)
    expect(sign).not.toHaveBeenCalled()
  })

  it('refuses a once-more-encoded %2F (never decodes a second time)', async () => {
    const res = await call(['community-media', '..%2F..%2Fsigned-agreements%2Fx.pdf'])
    expect(res.status).toBe(404)
    expect(sign).not.toHaveBeenCalled()
  })

  it('refuses a path outside the community-media prefix', async () => {
    const res = await call(['signed-agreements', UUID, 'signed.pdf'])
    expect(res.status).toBe(404)
    expect(sign).not.toHaveBeenCalled()
  })

  it('signs a legitimate community-media object and redirects', async () => {
    const res = await call(['community-media', UUID, '1700000000000-photo.png'])
    expect(sign).toHaveBeenCalledWith(`community-media/${UUID}/1700000000000-photo.png`)
    expect(res.headers.get('location')).toBe('https://signed.example/url')
  })
})
