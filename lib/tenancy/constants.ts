// Tenancy constants (multi-tenancy plan S3). Dependency-free: imported by
// scripts that Node runs directly as well as by the app.

/**
 * Stellr Education's tenant id — tenant #1 and the platform owner. Seeded by
 * supabase/migrations/20261104100000_tenancy_core.sql and hard-coded, with the
 * same value, in the derivation trigger (20261104120000) and the backfill
 * (20261104140000). Never change it: rows across 32 tables point at it.
 */
export const STELLR_TENANT_ID = '00000000-0000-4000-8000-000000000001'

/** Stellr's tenant slug. */
export const STELLR_TENANT_SLUG = 'stellr'

/** The youngest participant a tenant other than the platform owner may admit. */
export const TENANT_MIN_PARTICIPANT_AGE = 14

/** The first migration of S3. Tables created at or after it must meet the full registry rules. */
export const S3_FIRST_MIGRATION = '20261104100000'

/** tenancy_settings.derivation_mode values. */
export const DERIVATION_MODES = ['log', 'enforce'] as const
export type DerivationMode = (typeof DERIVATION_MODES)[number]

/** tenancy_derivation_log.reason values. All but 'no_key' count as orphans. */
export const DERIVATION_REASONS = ['no_key', 'no_event', 'mismatch', 'error'] as const
export type DerivationReason = (typeof DERIVATION_REASONS)[number]
export const ORPHAN_REASONS: readonly DerivationReason[] = ['no_event', 'mismatch', 'error']
