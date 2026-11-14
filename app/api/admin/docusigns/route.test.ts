// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

// deep review TEST-2: proxy.ts guards /admin *pages*, never /api/admin/*, and the
// server reads with service_role so RLS never applies — the per-route role check
// is the only thing standing between an ordinary member session and this data
// (every participant's DocuSign envelope: signer names, emails, minors' names).
// This pins that a non-admin session is refused 403 and the DB is never queried,
// using the inline `role !== 'admin'` guard style as a representative sample.

const authMock = vi.fn()
/** The agreements table, and the `or` filters each read asked for. */
const table = vi.hoisted(() => ({ rows: [] as Array<{ id: string; tenant_id: string | null }>, ors: [] as string[] }))
const from = vi.fn(() => {
  const chain: Record<string, unknown> = {}
  const ors: string[] = []
  chain.select = () => chain
  chain.or = (expr: string) => {
    ors.push(expr)
    table.ors.push(expr)
    return chain
  }
  chain.order = () => chain
  // deep review DS-9: the route now reads with an explicit .range() to defeat
  // PostgREST's 1000-row cap, so that is the awaited step. The `or` filters are
  // applied as PostgREST would for `tenant_id.is.null,tenant_id.eq.<id>`.
  chain.range = async () => ({
    data: table.rows.filter((r) =>
      ors.every((expr) =>
        expr.split(',').some((part) => (part === 'tenant_id.is.null' ? r.tenant_id === null : part === `tenant_id.eq.${r.tenant_id}`)),
      ),
    ),
    error: null,
  })
  return chain
})
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock() }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from }) }))

import { GET } from './route'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { STELLR_OR_NULL } from '@/lib/tenancy/stellr-scope'

const OTHER_TENANT = '11111111-1111-4111-8111-111111111111'

afterEach(() => {
  authMock.mockReset()
  from.mockClear()
  table.rows = []
  table.ors = []
  vi.unstubAllEnvs()
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

// Tracker s5-programme.29 (canary probe P14): the agreements list is a Stellr-only surface.
// It lists Stellr's rows, the backfilled ones and the ones with no tenant yet, and never
// another tenant's (dev-canary's guardian consent agreement, in the canary run), whatever
// LOADSCOPED_MODE says: the filter is not a load-scoped read, so no mode switches it off.
describe("GET /api/admin/docusigns lists Stellr's agreements only", () => {
  it.each(['', 'off', 'shadow', 'enforce'])('LOADSCOPED_MODE=%s', async (mode) => {
    vi.stubEnv('LOADSCOPED_MODE', mode)
    authMock.mockResolvedValue({ userId: 'u-admin', sessionClaims: { metadata: { role: 'admin' } } })
    table.rows = [
      { id: 'stellr-backfilled', tenant_id: STELLR_TENANT_ID },
      { id: 'stellr-unstamped', tenant_id: null },
      { id: 'other-tenant-consent', tenant_id: OTHER_TENANT },
    ]
    const res = await GET()
    expect(res.status).toBe(200)
    const { envelopes } = (await res.json()) as { envelopes: { id: string }[] }
    expect(envelopes.map((e) => e.id)).toEqual(['stellr-backfilled', 'stellr-unstamped'])
    expect(table.ors).toEqual([STELLR_OR_NULL])
  })
})
