// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assertSeedTarget, clerkCreateUserBody, membershipRow, planTwoTenantSeed, PRODUCTION_SUPABASE_REF } from './two-tenant-seed'
import { CANARY_TENANT, HONEYTOKENS } from './honeytokens'
import { STELLR_TENANT_ID } from '../tenancy/constants'
import { PRODUCTION_SUPABASE_REF as GUARD_REF } from '../../scripts/production-guard.mjs'

describe('two-tenant seed plan', () => {
  const plan = planTwoTenantSeed()

  it('has Stellr (US/USD) and Canary Academy (AU/AUD), meeting the tenants CHECKs', () => {
    const [stellr, canary] = plan.tenants
    expect(stellr).toMatchObject({ id: STELLR_TENANT_ID, country: 'US', currency: 'usd', is_platform_owner: true })
    expect(canary).toMatchObject({ id: CANARY_TENANT.id, country: 'AU', payment_region: 'AU', currency: 'aud', is_platform_owner: false })
    expect(canary.min_participant_age).toBeGreaterThanOrEqual(14)
    expect(String(canary.abn)).toMatch(/^[0-9]{11}$/)
    expect(String(canary.slug)).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
  })

  it('maps localhost hosts, one primary per tenant at most', () => {
    expect(plan.tenant_domains.map((d) => d.host)).toEqual([CANARY_TENANT.host, 'stellr.localhost'])
    for (const d of plan.tenant_domains) expect(String(d.host)).toMatch(/\.localhost$/)
  })

  it('gives each tenant one event; the Canary event carries the honeytoken slug and a currency/grade system to match', () => {
    const canary = plan.events.find((e) => e.tenant_id === CANARY_TENANT.id)
    const stellr = plan.events.find((e) => e.tenant_id === STELLR_TENANT_ID)
    expect(canary).toMatchObject({ slug: HONEYTOKENS.eventSlug, currency: 'aud', grade_system: 'au_years', country: 'AU' })
    expect(stellr).toMatchObject({ currency: 'usd', grade_system: 'us_grades', country: 'US' })
    for (const e of plan.events) expect(String(e.sanity_id)).not.toMatch(/^drafts\./)
  })

  it('creates no personal data: test addresses only, no passwords', () => {
    for (const u of plan.users) {
      expect(u.email).toMatch(/\+clerk_test@example\.com$/)
      const body = clerkCreateUserBody(u)
      expect(body).not.toHaveProperty('password')
      expect(body.skip_password_requirement).toBe(true)
    }
    const admin = plan.users.find((u) => u.handle === 'canary-admin')!
    expect(membershipRow(admin, 'user_x')).toEqual({ tenant_id: CANARY_TENANT.id, clerk_user_id: 'user_x', role: 'tenant_admin', source: 'admin' })
    expect(membershipRow(plan.users[0], 'user_y')).toBeNull()
  })
})

describe('assertSeedTarget', () => {
  it('uses the same production ref as the dev-server guard', () => {
    expect(PRODUCTION_SUPABASE_REF).toBe(GUARD_REF)
  })
  it('refuses the production Supabase project, with no override', () => {
    expect(() => assertSeedTarget({ supabaseUrl: `https://${PRODUCTION_SUPABASE_REF}.supabase.co`, useClerk: false })).toThrow(/PRODUCTION/)
    expect(() => assertSeedTarget({ supabaseUrl: '', useClerk: false })).toThrow(/not set/)
  })
  it('refuses a live or missing Clerk key with --clerk, and allows a dev target', () => {
    const url = 'http://127.0.0.1:54321'
    expect(() => assertSeedTarget({ supabaseUrl: url, clerkSecretKey: 'sk_live_x', useClerk: true })).toThrow(/sk_live_/)
    expect(() => assertSeedTarget({ supabaseUrl: url, useClerk: true })).toThrow(/CLERK_SECRET_KEY/)
    expect(() => assertSeedTarget({ supabaseUrl: url, clerkSecretKey: 'whatever', useClerk: true })).toThrow(/sk_test_/)
    expect(() => assertSeedTarget({ supabaseUrl: url, clerkSecretKey: 'sk_test_x', useClerk: true })).not.toThrow()
    expect(() => assertSeedTarget({ supabaseUrl: url, useClerk: false })).not.toThrow()
  })
  it('the script is dry-run by default and guards before importing the client', () => {
    const src = readFileSync('scripts/seed-two-tenants.ts', 'utf8')
    expect(src).toMatch(/const APPLY = process\.argv\.includes\('--apply'\)/)
    expect(src.indexOf('assertSeedTarget(')).toBeLessThan(src.indexOf("await import('../lib/supabase')"))
    expect(src).not.toMatch(/^import .*lib\/supabase'/m)
  })
})
