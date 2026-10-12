import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review BG-9: verifying a teacher license is itself the clearance decision.
// Between loading the panel and clicking "verify", the member can replace the
// number/expiry or re-upload the image (which bumps updated_at and already clears
// verified_at). The verify now binds to the reviewed version via an atomic
// .eq('updated_at', …) guard, so a stale click 409s instead of certifying unseen
// data. Unverify (the safe direction) stays unguarded.

const { logActivity } = vi.hoisted(() => ({ logActivity: vi.fn(async () => {}) }))

vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ sessionClaims: {} }) }))
vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: () => true }))
vi.mock('@/lib/activity-log', () => ({
  logActivity,
  actorFromAuth: async () => ({ actorMemberId: 'admin1', actorLabel: 'Admin', actorType: 'staff' }),
}))

const CURRENT_VERSION = '2026-10-10T10:00:00Z'

vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => {
      const eqs: Record<string, unknown> = {}
      const chain: Record<string, unknown> = {
        select: () => chain,
        update: () => chain,
        eq: (col: string, val: unknown) => { eqs[col] = val; return chain },
        // License lookup terminates here.
        maybeSingle: async () => ({ data: { id: 'lic1' }, error: null }),
        // The guarded update is awaited after .select('id'): it matches a row only
        // when no version was pinned (unverify) or the pinned version is current.
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
          const matched = eqs.updated_at === undefined || eqs.updated_at === CURRENT_VERSION
          return Promise.resolve({ data: matched ? [{ id: 'lic1' }] : [], error: null }).then(resolve, reject)
        },
      }
      return chain
    },
  }),
}))

const { POST } = await import('./route')
const call = (body: unknown) =>
  POST(new Request('https://app.test/api/admin/members/m1/license', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 'm1' }),
  })

beforeEach(() => vi.clearAllMocks())

describe('POST /api/admin/members/[id]/license (BG-9)', () => {
  it('verifies when the pinned version matches what is on file', async () => {
    const res = await call({ action: 'verify', licenseUpdatedAt: CURRENT_VERSION })
    expect(res.status).toBe(200)
    expect(logActivity).toHaveBeenCalledTimes(1)
  })

  it('409s a verify whose pinned version is stale, and does not record a verification', async () => {
    const res = await call({ action: 'verify', licenseUpdatedAt: '2026-01-01T00:00:00Z' })
    expect(res.status).toBe(409)
    expect(logActivity).not.toHaveBeenCalled()
  })

  it('400s a verify with no version at all (fail closed)', async () => {
    const res = await call({ action: 'verify' })
    expect(res.status).toBe(400)
    expect(logActivity).not.toHaveBeenCalled()
  })

  it('unverify needs no version guard (safe direction)', async () => {
    const res = await call({ action: 'unverify' })
    expect(res.status).toBe(200)
    expect(logActivity).toHaveBeenCalledTimes(1)
  })
})
