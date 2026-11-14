// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// S5 wave 6: the membership-expiry cron's tenant guardian-consent step. With
// TENANT_GUARDIAN_CONSENT_ENABLED off (the default) it reads nothing and the run's
// result keys are exactly as before; on, it sweeps and reports.

const h = vi.hoisted(() => ({
  sweep: vi.fn(async (_db: unknown) => ({ scanned: 2, signed: [], expired: ['c-1'], removed: ['c-1'], held: ['c-2'], voided: ['agr-9'], errors: [] as { consentId: string; error: string }[] })),
  finish: vi.fn(async (_r: unknown) => {}),
  fail: vi.fn((_k: string, _e: unknown) => {}),
}))

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({}) }))
vi.mock('@/lib/cron', () => ({ guardCron: () => null }))
vi.mock('@/lib/cron-audit', () => ({ withCronAudit: (_name: string, fn: unknown) => fn }))
vi.mock('@/lib/cron-runs', () => ({ startCronRun: async () => ({ fail: h.fail, finish: h.finish }) }))
vi.mock('@/lib/membership-grants', () => ({ expireLapsedGrants: async () => 0 }))
vi.mock('@/lib/pending-consent', () => ({ purgeUnconsentedAccounts: async () => ({ scanned: 0, purged: [], cleared: [], heldGuardianSigned: [], heldAdultRoute: [], errors: [] }) }))
vi.mock('@/lib/event-manager', () => ({ sweepEventManagers: async () => ({ errors: [] }) }))
vi.mock('@/lib/staff', () => ({ sweepStaffGrants: async () => ({ checked: 0, activated: 0, suspended: 0, expired: 0, reminded: 0, failed: 0 }) }))
vi.mock('@/lib/registration/tenant-guardian-consent', () => ({ sweepTenantGuardianConsents: h.sweep }))

const { GET } = await import('@/app/api/cron/membership-expiry/route')

const run = async () => {
  const res = await (GET as unknown as (req: Request) => Promise<Response>)(new Request('https://app.stellreducation.org/api/cron/membership-expiry'))
  return (await res.json()) as Record<string, unknown>
}

// guardCron is stubbed to let every call through; the route runs its four steps only
// in production (S5 B26a), so these run as production does.
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
})
afterEach(() => vi.unstubAllEnvs())

describe('membership-expiry: tenant guardian consents', () => {
  it('flag off: no sweep, and the result keys are unchanged', async () => {
    const body = await run()
    expect(h.sweep).not.toHaveBeenCalled()
    expect(Object.keys(body).sort()).toEqual(['eventManagers', 'expired', 'pendingConsentPurge', 'staff'])
    expect(Object.keys(h.finish.mock.calls[0][0] as object).sort()).toEqual(['eventManagers', 'expired', 'pendingConsentPurge', 'staff'])
  })

  it('flag on: sweeps and reports counts only', async () => {
    vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', 'true')
    const body = await run()
    expect(h.sweep).toHaveBeenCalledTimes(1)
    expect(body.tenantGuardianConsent).toEqual({ scanned: 2, signed: 0, expired: 1, removed: 1, held: 1, voided: 1, errors: 0 })
  })

  it('flag on: a failed sweep is recorded, and the other steps still report', async () => {
    vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', 'true')
    h.sweep.mockRejectedValueOnce(new Error('down'))
    const body = await run()
    expect(h.fail).toHaveBeenCalledWith('tenant-guardian-consent', expect.any(Error))
    expect(body).toMatchObject({ tenantGuardianConsent: { error: 'down' }, expired: 0 })
  })
})
