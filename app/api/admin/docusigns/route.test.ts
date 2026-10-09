// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

// deep review TEST-2: proxy.ts guards /admin *pages*, never /api/admin/*, and the
// server reads with service_role so RLS never applies — the per-route role check
// is the only thing standing between an ordinary member session and this data
// (every participant's DocuSign envelope: signer names, emails, minors' names).
// This pins that a non-admin session is refused 403 and the DB is never queried,
// using the inline `role !== 'admin'` guard style as a representative sample.

const authMock = vi.fn()
const from = vi.fn(() => {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.order = async () => ({ data: [], error: null })
  return chain
})
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock() }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from }) }))

import { GET } from './route'

afterEach(() => {
  authMock.mockReset()
  from.mockClear()
})

describe('GET /api/admin/docusigns', () => {
  it('refuses a member session (403) and never queries the database', async () => {
    authMock.mockResolvedValue({ userId: 'u-member', sessionClaims: { metadata: { role: 'member' } } })
    const res = await GET()
    expect(res.status).toBe(403)
    expect(from).not.toHaveBeenCalled()
  })

  it('refuses an event manager (403): admin-only, not portal-wide', async () => {
    authMock.mockResolvedValue({ userId: 'u-em', sessionClaims: { metadata: { role: 'event_manager' } } })
    expect((await GET()).status).toBe(403)
    expect(from).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated request (403)', async () => {
    authMock.mockResolvedValue({ userId: null, sessionClaims: null })
    expect((await GET()).status).toBe(403)
    expect(from).not.toHaveBeenCalled()
  })

  it('serves a platform admin', async () => {
    authMock.mockResolvedValue({ userId: 'u-admin', sessionClaims: { metadata: { role: 'admin' } } })
    const res = await GET()
    expect(res.status).toBe(200)
    expect(from).toHaveBeenCalledWith('agreements')
  })
})
