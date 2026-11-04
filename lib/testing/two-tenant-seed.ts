// The two-tenant fixture (multi-tenant plan S2 "Two-tenant seed", S4): Stellr
// (tenant #1, US/USD) and Canary Academy (tenant B, AU/AUD), written into the
// S3 tables. Pure: scripts/seed-two-tenants.ts does the I/O, and
// lib/testing/two-tenant-seed.test.ts checks the plan and the guards.
//
// Every Canary value comes from lib/testing/honeytokens.ts, so a row this seed
// writes is recognisable anywhere it turns up. Nothing here is personal data:
// test emails use Clerk's `+clerk_test` convention on example.com.
import { CANARY_TENANT, HONEYTOKENS } from './honeytokens'
import { STELLR_TENANT_ID, STELLR_TENANT_SLUG } from '../tenancy/constants'

/** The production Supabase project ref (same value as scripts/production-guard.mjs). */
export const PRODUCTION_SUPABASE_REF = 'hwtzpfrnksksxlwwabqz'

/** The Stellr-side event the fixture adds to the mirror. Never a real event slug. */
export const STELLR_FIXTURE_EVENT = {
  slug: 'seed-two-tenant-stellr-event',
  sanity_id: 'seed-two-tenant-stellr-event',
} as const

export interface SeedUser {
  /** Stable handle used in logs and by tests. */
  handle: 'stellr-participant' | 'canary-admin' | 'canary-participant'
  tenantId: string
  email: string
  firstName: string
  lastName: string
  /** Set for a tenant staff user: the tenant_memberships role. */
  tenantRole?: 'tenant_admin' | 'event_manager' | 'staff'
}

export interface SeedPlan {
  tenants: Record<string, unknown>[]
  tenant_domains: Record<string, unknown>[]
  events: Record<string, unknown>[]
  users: SeedUser[]
}

export function planTwoTenantSeed(): SeedPlan {
  return {
    // Stellr's row is seeded by migration 20261104100000; it is listed so the
    // script can confirm it exists, and is never rewritten (ON CONFLICT DO NOTHING).
    tenants: [
      {
        id: STELLR_TENANT_ID,
        slug: STELLR_TENANT_SLUG,
        legal_name: 'Stellr Education',
        display_name: 'Stellr Education',
        country: 'US',
        payment_region: 'US',
        currency: 'usd',
        time_zone: 'America/Denver',
        is_platform_owner: true,
        min_participant_age: 0,
        status: 'active',
      },
      {
        id: CANARY_TENANT.id,
        slug: CANARY_TENANT.slug,
        legal_name: CANARY_TENANT.legal_name,
        display_name: CANARY_TENANT.display_name,
        country: CANARY_TENANT.country,
        payment_region: CANARY_TENANT.payment_region,
        currency: CANARY_TENANT.currency,
        abn: CANARY_TENANT.abn,
        gst_registered: false,
        time_zone: CANARY_TENANT.time_zone,
        is_platform_owner: false,
        min_participant_age: CANARY_TENANT.min_participant_age,
        status: 'active',
        branding: { note: 'two-tenant test fixture' },
      },
    ],
    // `*.localhost` hosts for Playwright (S5 routes by host). Stellr needs no
    // mapping in production (no host = Stellr); the localhost entry is for tests.
    tenant_domains: [
      { host: CANARY_TENANT.host, tenant_id: CANARY_TENANT.id, is_primary: true },
      { host: 'stellr.localhost', tenant_id: STELLR_TENANT_ID, is_primary: false },
    ],
    events: [
      {
        tenant_id: CANARY_TENANT.id,
        slug: HONEYTOKENS.eventSlug,
        sanity_id: HONEYTOKENS.sanityId,
        title: 'Canary Academy Honeytoken Event',
        activity_type: 'live_event',
        starts_at: '2027-03-12T13:00:00.000Z',
        ends_at: '2027-03-14T13:00:00.000Z',
        time_zone: CANARY_TENANT.time_zone,
        country: 'AU',
        currency: 'aud',
        grade_system: 'au_years',
        min_participant_age: 14,
        status: 'fixture',
        raw: { fixture: 'two-tenant', note: HONEYTOKENS.text },
      },
      {
        tenant_id: STELLR_TENANT_ID,
        slug: STELLR_FIXTURE_EVENT.slug,
        sanity_id: STELLR_FIXTURE_EVENT.sanity_id,
        title: 'Two-tenant fixture event (Stellr)',
        activity_type: 'live_event',
        starts_at: '2027-03-12T07:00:00.000Z',
        ends_at: '2027-03-14T07:00:00.000Z',
        time_zone: 'America/Denver',
        country: 'US',
        currency: 'usd',
        grade_system: 'us_grades',
        min_participant_age: null,
        status: 'fixture',
        raw: { fixture: 'two-tenant' },
      },
    ],
    users: [
      { handle: 'stellr-participant', tenantId: STELLR_TENANT_ID, email: 'stellr-participant+clerk_test@example.com', firstName: 'Fixture', lastName: 'StellrParticipant' },
      { handle: 'canary-admin', tenantId: CANARY_TENANT.id, email: 'canary-admin+clerk_test@example.com', firstName: 'Honeytoken', lastName: 'CanaryAdmin', tenantRole: 'tenant_admin' },
      { handle: 'canary-participant', tenantId: CANARY_TENANT.id, email: 'canary-participant+clerk_test@example.com', firstName: 'Honeytoken', lastName: 'CanaryParticipant' },
    ],
  }
}

/**
 * Refuses a target the seed must never touch. Throws with the reason; there is
 * deliberately no override flag. The fixture belongs on a local, CI or dev
 * project, never on production.
 */
export function assertSeedTarget(env: { supabaseUrl?: string; clerkSecretKey?: string; useClerk: boolean }): void {
  const url = env.supabaseUrl ?? ''
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (url.includes(PRODUCTION_SUPABASE_REF)) {
    throw new Error(`refusing: NEXT_PUBLIC_SUPABASE_URL names the PRODUCTION Supabase project (${PRODUCTION_SUPABASE_REF})`)
  }
  if (env.useClerk) {
    const key = env.clerkSecretKey ?? ''
    if (!key) throw new Error('--clerk needs CLERK_SECRET_KEY')
    if (key.startsWith('sk_live_')) throw new Error('refusing: CLERK_SECRET_KEY is a production (sk_live_) key')
    if (!key.startsWith('sk_test_')) throw new Error('refusing: CLERK_SECRET_KEY is not a development (sk_test_) key')
  }
}

/** The tenant_memberships row for a staff seed user, once Clerk has given it an id. */
export function membershipRow(user: SeedUser, clerkUserId: string): Record<string, unknown> | null {
  if (!user.tenantRole) return null
  return { tenant_id: user.tenantId, clerk_user_id: clerkUserId, role: user.tenantRole, source: 'admin' }
}

/** The Clerk Backend API body for a seed user (POST /v1/users). No password: sign in with a testing token. */
export function clerkCreateUserBody(user: SeedUser): Record<string, unknown> {
  return {
    email_address: [user.email],
    first_name: user.firstName,
    last_name: user.lastName,
    skip_password_requirement: true,
    public_metadata: { fixture: 'two-tenant', tenant_id: user.tenantId },
  }
}
