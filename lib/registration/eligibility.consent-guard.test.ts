import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TENANT_EVENT_MAIL_FLAG, tenantEventMailEnabled } from '@/lib/event-emails/tenant-mail'
import { LOADSCOPED_MODE_ENV } from '@/lib/tenancy/load-scoped-mode'
import { CANARY_TENANT } from '@/lib/testing/honeytokens'
import {
  assertRegistrable,
  CONSENT_TENANT_MAIL_FLAG,
  resetGuardianConsentReadinessLog,
  TENANT_GUARDIAN_CONSENT_PRECONDITIONS,
  tenantGuardianConsentEnabled,
  tenantGuardianConsentMissingPreconditions,
  tenantGuardianConsentReady,
  type TenantEligibilityContext,
} from './eligibility'

// The consent readiness guard (S5 tracker s5-programme.20, owner decision W7-14):
// TENANT_GUARDIAN_CONSENT_ENABLED admits a tenant-event minor consent-pending only
// when LOADSCOPED_MODE=enforce and TENANT_EVENT_MAIL_ENABLED=true hold in the same
// environment. Otherwise every minor is refused as with the flag off, and the
// missing preconditions are logged by name.

const ctx: TenantEligibilityContext = {
  kind: 'tenant',
  isPlatformOwner: false,
  tenantId: CANARY_TENANT.id,
  tenantMinAge: 14,
  eventMinAge: null,
  eventStartsAt: '2026-12-01T13:00:00.000Z',
  eventTimeZone: 'Australia/Sydney',
  activityType: 'live_event',
}
const MINOR = '2010-06-01'

let errors: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-04T18:00:00Z'))
  resetGuardianConsentReadinessLog()
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const ready = (mode: string | undefined, mail: string | undefined) => {
  vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', 'true')
  vi.stubEnv('LOADSCOPED_MODE', mode)
  vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', mail)
}

describe('the consent readiness guard', () => {
  it('flag unset (production today): off, logs nothing, every minor refused', () => {
    vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', undefined)
    vi.stubEnv('LOADSCOPED_MODE', 'enforce')
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
    expect(tenantGuardianConsentReady()).toBe(false)
    expect(tenantGuardianConsentEnabled()).toBe(false)
    expect(assertRegistrable(MINOR, ctx, { guardianConsent: true })).toMatchObject({ ok: false, reason: 'under_minimum_age' })
    expect(errors).not.toHaveBeenCalled()
  })

  it('flag on with every precondition: ready, and a minor is admitted consent-pending', () => {
    ready('enforce', 'true')
    expect(tenantGuardianConsentMissingPreconditions()).toEqual([])
    expect(tenantGuardianConsentReady()).toBe(true)
    expect(assertRegistrable(MINOR, ctx, { guardianConsent: true })).toMatchObject({ ok: true, guardianConsentRequired: true })
    expect(errors).not.toHaveBeenCalled()
  })

  it.each([
    ['off', 'true', ['LOADSCOPED_MODE=enforce']],
    ['shadow', 'true', ['LOADSCOPED_MODE=enforce']],
    [undefined, 'true', ['LOADSCOPED_MODE=enforce']],
    ['enforce', undefined, ['TENANT_EVENT_MAIL_ENABLED=true']],
    ['enforce', 'TRUE', ['TENANT_EVENT_MAIL_ENABLED=true']],
    ['shadow', 'false', ['LOADSCOPED_MODE=enforce', 'TENANT_EVENT_MAIL_ENABLED=true']],
  ])('flag on, LOADSCOPED_MODE=%s, TENANT_EVENT_MAIL_ENABLED=%s: not ready, the minor refused, the missing named', (mode, mail, missing) => {
    ready(mode, mail)
    expect(tenantGuardianConsentMissingPreconditions()).toEqual(missing)
    expect(tenantGuardianConsentReady()).toBe(false)
    expect(assertRegistrable(MINOR, ctx, { guardianConsent: true })).toEqual({
      ok: false,
      reason: 'under_minimum_age',
      error: 'You must be 18 or older to register for this event online. Please contact the event organiser.',
    })
    expect(errors).toHaveBeenCalledWith(expect.stringContaining(`missing preconditions: ${missing.join(', ')}`))
    // The flag alone still reads on: it is the sweep's gate, which settles but never admits.
    expect(tenantGuardianConsentEnabled()).toBe(true)
  })

  it('logs once per change of the missing set, never a value', () => {
    ready('sentinel-mode-g1', 'sentinel-mail-g1')
    tenantGuardianConsentReady()
    tenantGuardianConsentReady()
    expect(errors).toHaveBeenCalledTimes(1)
    const logged = String(errors.mock.calls[0][0])
    expect(logged).not.toContain('sentinel')
    vi.stubEnv('LOADSCOPED_MODE', 'enforce')
    tenantGuardianConsentReady()
    expect(errors).toHaveBeenCalledTimes(2)
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
    expect(tenantGuardianConsentReady()).toBe(true)
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'false')
    tenantGuardianConsentReady()
    expect(errors).toHaveBeenCalledTimes(3)
  })

  it('reads tenant mail exactly as lib/event-emails/tenant-mail.ts does', () => {
    expect(CONSENT_TENANT_MAIL_FLAG).toBe(TENANT_EVENT_MAIL_FLAG)
    const mailPrecondition = TENANT_GUARDIAN_CONSENT_PRECONDITIONS.find((p) => p.name === CONSENT_TENANT_MAIL_FLAG)!
    for (const raw of [undefined, '', 'true', 'TRUE', ' true', 'false', '1']) {
      vi.stubEnv(TENANT_EVENT_MAIL_FLAG, raw)
      expect(mailPrecondition.holds()).toBe(tenantEventMailEnabled())
    }
  })

  it('names exactly the preconditions the owner set (W7-14 and docs/ENV-MATRIX.md)', () => {
    expect(TENANT_GUARDIAN_CONSENT_PRECONDITIONS.map((p) => `${p.name}=${p.needs}`)).toEqual([
      `${LOADSCOPED_MODE_ENV}=enforce`,
      'TENANT_EVENT_MAIL_ENABLED=true',
    ])
  })
})
