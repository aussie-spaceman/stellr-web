// The S5 switch registry (wave 7, O1): every tenancy switch in one place, with its
// default, the parser the code already uses, and what it needs before it does
// anything. GET /api/admin/health/integrations reports what each one RESOLVED to,
// so a flip on dev can be seen to have taken effect: a clean shadow and a switch
// that never took effect look the same from the logs alone.
//
// Rules:
//   * Each `resolve` calls the module that owns the switch. Nothing here reads a
//     switch a second way, so the report cannot disagree with the code it reports
//     on. `accepts` only says whether a set value is one that parser takes as
//     written, so a typo that fell back to the default is visible.
//   * The report holds resolved values only: modes, booleans, counts, fixed
//     labels. Never a raw value, a secret, a URL or a zone. An unrecognised value
//     is named by its variable, never echoed.
//   * Server-only, and off proxy.ts's bundle (lib/tenancy/flags.test.ts): proxy
//     runs on every request and reads its own switch in lib/tenancy/host.ts.
//   * It reaches neither lib/tenancy/db.ts nor lib/tenancy/area-switch.ts. The
//     tenant database variables come from ./tenant-db-config, which both of those
//     read too. The tenant database URL and CA belong to its driver alone (O3
//     reports on them).
//
// derivationMode is the one switch held in the database
// (tenancy_settings.derivation_mode). The health route reads it once with the
// service role and passes it in; this module makes no read of its own.

import 'server-only'
import { authzSource, isUnrecognisedAuthzSource, type AuthzSource } from '@/lib/authz/decide'
import { AUDIT_FLAG, auditEnabled } from '@/lib/audit/platform'
import { TENANT_EVENT_MAIL_FLAG, tenantEventMailEnabled } from '@/lib/event-emails/tenant-mail'
import { FIELD_CRYPTO_MODES, fieldCryptoActive, fieldCryptoMode, type FieldCryptoMode } from '@/lib/field-crypto'
import { MIN_SECRET_LENGTH, rateLimitStoreMode, type RateLimitStoreMode } from '@/lib/rate-limit-store'
import {
  TENANT_GUARDIAN_CONSENT_FLAG,
  tenantGuardianConsentEnabled,
  tenantGuardianConsentMissingPreconditions,
  tenantGuardianConsentReady,
} from '@/lib/registration/eligibility'
import { DERIVATION_MODES, type DerivationMode } from './constants'
import { TENANT_HOST_SUFFIX_VAR, TENANT_ROUTING_FLAG, tenantRoutingConfig } from './host'
import { LOADSCOPED_MODE_ENV, LOADSCOPED_MODES, loadScopedMode, type LoadScopedMode } from './load-scoped-mode'
import { isTenantDbEnabled, parseAreas, TENANT_DB_AREAS_ENV, TENANT_DB_FLAG, type DataPath } from './tenant-db-config'

// ── The registry ────────────────────────────────────────────────────────────

export interface SwitchSpec<T> {
  /** The environment variable. */
  readonly name: string
  /** What the code does with the variable unset. */
  readonly default: T
  /** The owning module's own reading, per call. */
  readonly resolve: () => T
  /** Whether a set value is one the parser takes as written. Unset or blank is never unrecognised. */
  readonly accepts: (raw: string) => boolean
  /** The variables it needs before it does anything (see INVALID_COMBINATIONS). */
  readonly dependsOn: readonly string[]
}

/** The values lib/rate-limit-store.ts rateLimitStoreMode() takes. It trims, and does not fold case. */
export const RATE_LIMIT_STORE_MODES: readonly RateLimitStoreMode[] = ['memory', 'shadow', 'postgres']
export const RATE_LIMIT_STORE_ENV = 'RATE_LIMIT_STORE'
export const RATE_LIMIT_KEY_SECRET_ENV = 'RATE_LIMIT_KEY_SECRET'
export const FIELD_CRYPTO_MODE_ENV = 'FIELD_CRYPTO_MODE'

const exactBoolean = (raw: string) => raw === 'true' || raw === 'false'
const foldedIn = (list: readonly string[]) => (raw: string) => list.includes(raw.trim().toLowerCase())

/** Whether RATE_LIMIT_KEY_SECRET is one takeFromStore will use: set, and long enough. Never the value. */
function rateLimitSecretUsable(): boolean {
  const secret = process.env[RATE_LIMIT_KEY_SECRET_ENV]
  return !!secret && secret.length >= MIN_SECRET_LENGTH
}

/** Areas TENANT_DB_AREAS sets, before the TENANT_DB_ENABLED gate (lib/tenancy/area-switch.ts). */
function configuredAreas() {
  return parseAreas(process.env[TENANT_DB_AREAS_ENV] ?? '')
}

export const SWITCHES = {
  authzSource: {
    name: 'AUTHZ_SOURCE',
    default: 'clerk',
    resolve: () => authzSource(process.env.AUTHZ_SOURCE),
    accepts: (raw) => !isUnrecognisedAuthzSource(raw),
    dependsOn: [],
  } satisfies SwitchSpec<AuthzSource>,
  loadScopedMode: {
    name: LOADSCOPED_MODE_ENV,
    default: 'off',
    resolve: () => loadScopedMode(),
    accepts: foldedIn(LOADSCOPED_MODES),
    dependsOn: [],
  } satisfies SwitchSpec<LoadScopedMode>,
  rateLimitStore: {
    name: RATE_LIMIT_STORE_ENV,
    default: 'memory',
    resolve: () => rateLimitStoreMode(),
    accepts: (raw) => (RATE_LIMIT_STORE_MODES as readonly string[]).includes(raw.trim()),
    dependsOn: [RATE_LIMIT_KEY_SECRET_ENV],
  } satisfies SwitchSpec<RateLimitStoreMode>,
  rateLimitKeySecret: {
    name: RATE_LIMIT_KEY_SECRET_ENV,
    default: false,
    resolve: rateLimitSecretUsable,
    accepts: (raw) => raw.length >= MIN_SECRET_LENGTH,
    dependsOn: [],
  } satisfies SwitchSpec<boolean>,
  platformAudit: {
    name: AUDIT_FLAG,
    default: false,
    resolve: () => auditEnabled(),
    accepts: exactBoolean,
    dependsOn: [],
  } satisfies SwitchSpec<boolean>,
  tenantEventMail: {
    name: TENANT_EVENT_MAIL_FLAG,
    default: false,
    resolve: () => tenantEventMailEnabled(),
    accepts: exactBoolean,
    dependsOn: [],
  } satisfies SwitchSpec<boolean>,
  guardianConsent: {
    name: TENANT_GUARDIAN_CONSENT_FLAG,
    default: false,
    /** Whether a tenant-event minor can be admitted: the flag and every precondition (the readiness guard). */
    resolve: () => tenantGuardianConsentReady(),
    accepts: exactBoolean,
    // The readiness guard's preconditions (lib/registration/eligibility.ts
    // TENANT_GUARDIAN_CONSENT_PRECONDITIONS, owner decision W7-14).
    dependsOn: [LOADSCOPED_MODE_ENV, TENANT_EVENT_MAIL_FLAG],
  } satisfies SwitchSpec<boolean>,
  fieldCryptoMode: {
    name: FIELD_CRYPTO_MODE_ENV,
    default: 'off',
    resolve: () => fieldCryptoMode(),
    accepts: foldedIn(FIELD_CRYPTO_MODES),
    // And a well-formed master key (lib/field-crypto.ts fieldCryptoActive).
    dependsOn: [],
  } satisfies SwitchSpec<FieldCryptoMode>,
  tenantDbEnabled: {
    name: TENANT_DB_FLAG,
    default: false,
    resolve: () => isTenantDbEnabled(),
    accepts: exactBoolean,
    // And the driver's own URL and CA, which only the driver reads (O3 reports them).
    dependsOn: [],
  } satisfies SwitchSpec<boolean>,
  tenantDbAreas: {
    name: TENANT_DB_AREAS_ENV,
    default: 0,
    /** How many areas the list sets, before the TENANT_DB_ENABLED gate. */
    resolve: () => configuredAreas().areas.size,
    accepts: (raw) => parseAreas(raw).ignored === 0,
    dependsOn: [TENANT_DB_FLAG],
  } satisfies SwitchSpec<number>,
  routingEnabled: {
    name: TENANT_ROUTING_FLAG,
    default: false,
    resolve: () => tenantRoutingConfig().enabled,
    accepts: exactBoolean,
    dependsOn: [TENANT_HOST_SUFFIX_VAR],
  } satisfies SwitchSpec<boolean>,
  hostSuffix: {
    name: TENANT_HOST_SUFFIX_VAR,
    default: null,
    /** The fixed-text reason the zone is unusable, or null. Never the zone. */
    resolve: () => tenantRoutingConfig().suffixError,
    accepts: (raw) => tenantRoutingConfig({ [TENANT_HOST_SUFFIX_VAR]: raw }).suffixError === null,
    dependsOn: [],
  } satisfies SwitchSpec<string | null>,
} as const

export type SwitchKey = keyof typeof SWITCHES

/** The database switch, read by the caller: tenancy_settings.derivation_mode. */
export const DERIVATION_MODE_DEFAULT: DerivationMode = 'log'
export type DerivationModeReport = DerivationMode | 'unavailable'

/**
 * The derivation mode from one tenancy_settings read. A failed read is
 * 'unavailable', never a guess. No row reads as 'log', as the derivation trigger
 * reads it (COALESCE(mode, 'log')). A value outside the CHECK's list cannot be
 * stored; if one ever were, it is 'unavailable' and is not echoed.
 */
export function resolveDerivationMode(read: { failed: boolean; value: unknown }): DerivationModeReport {
  if (read.failed) return 'unavailable'
  if (read.value === null || read.value === undefined) return DERIVATION_MODE_DEFAULT
  return (DERIVATION_MODES as readonly unknown[]).includes(read.value) ? (read.value as DerivationMode) : 'unavailable'
}

// ── Invalid combinations ────────────────────────────────────────────────────

export interface InvalidCombination {
  id: string
  /** Variable names only. */
  switches: readonly string[]
  /** What the code does instead. Fixed text. */
  effect: string
}

interface CombinationRule extends InvalidCombination {
  holds: () => boolean
}

/** The combinations where a switch is set but cannot do what it says. */
export const INVALID_COMBINATIONS: readonly CombinationRule[] = [
  {
    id: 'rate_limit_store_without_secret',
    switches: [RATE_LIMIT_STORE_ENV, RATE_LIMIT_KEY_SECRET_ENV],
    effect: 'The store is skipped and the in-memory limiter decides; each skip leaves a RATELIMIT row.',
    holds: () => SWITCHES.rateLimitStore.resolve() !== 'memory' && !rateLimitSecretUsable(),
  },
  {
    id: 'tenant_db_areas_without_flag',
    switches: [TENANT_DB_AREAS_ENV, TENANT_DB_FLAG],
    effect: 'Every area reads through the service path.',
    holds: () => configuredAreas().areas.size > 0 && !isTenantDbEnabled(),
  },
  {
    id: 'routing_without_usable_suffix',
    switches: [TENANT_ROUTING_FLAG, TENANT_HOST_SUFFIX_VAR],
    effect: 'Known Stellr hosts keep working and every other host answers unavailable.',
    holds: () => {
      const routing = tenantRoutingConfig()
      return routing.enabled && routing.suffixError !== null
    },
  },
  {
    // The readiness guard (tracker s5-programme.20): the flag is on, but a
    // precondition is not, so nothing is admitted consent-pending.
    id: 'guardian_consent_not_ready',
    switches: [TENANT_GUARDIAN_CONSENT_FLAG, LOADSCOPED_MODE_ENV, TENANT_EVENT_MAIL_FLAG],
    effect:
      "Every minor at another tenant's event is refused, as with the flag off: guardian consent needs LOADSCOPED_MODE=enforce and TENANT_EVENT_MAIL_ENABLED=true. The sweep still settles existing consents.",
    holds: () => tenantGuardianConsentEnabled() && tenantGuardianConsentMissingPreconditions().length > 0,
  },
  {
    id: 'field_crypto_mode_without_key',
    switches: [FIELD_CRYPTO_MODE_ENV],
    effect: 'Field encryption stays inert: the master key is unset or malformed.',
    holds: () => fieldCryptoMode() !== 'off' && !fieldCryptoActive(),
  },
]

// ── The report ──────────────────────────────────────────────────────────────

export interface TenancyReport {
  authzSource: { value: AuthzSource; unrecognised: boolean }
  loadScopedMode: LoadScopedMode
  rateLimitStore: { mode: RateLimitStoreMode; secretUsable: boolean }
  platformAudit: boolean
  tenantEventMail: boolean
  guardianConsent: boolean
  fieldCryptoMode: FieldCryptoMode
  derivationMode: DerivationModeReport
  tenantDb: {
    enabled: boolean
    /** The areas off the service path: empty unless TENANT_DB_ENABLED is on. */
    areas: { area: string; path: Exclude<DataPath, 'service'>; sample: number }[]
    ignoredEntries: number
  }
  routing: { enabled: boolean; suffixError: string | null }
  /** Variables set to a value their parser does not take, so it used the default. Names only. */
  unrecognised: string[]
  invalidCombinations: InvalidCombination[]
}

const isBlank = (raw: string | undefined) => raw === undefined || raw.trim() === ''

/** The variables set to something their parser does not take. Names only, in registry order. */
export function unrecognisedSwitches(): string[] {
  const out: string[] = []
  for (const spec of Object.values(SWITCHES) as SwitchSpec<unknown>[]) {
    const raw = process.env[spec.name]
    if (!isBlank(raw) && !spec.accepts(raw as string)) out.push(spec.name)
  }
  return out
}

/** Every switch as it resolves now. Reads process.env only; the derivation mode is passed in. */
export function tenancyReport(derivationMode: DerivationModeReport): TenancyReport {
  const tenantDbEnabled = SWITCHES.tenantDbEnabled.resolve()
  const configured = configuredAreas()
  const routing = tenantRoutingConfig()
  return {
    authzSource: { value: SWITCHES.authzSource.resolve(), unrecognised: isUnrecognisedAuthzSource(process.env.AUTHZ_SOURCE) },
    loadScopedMode: SWITCHES.loadScopedMode.resolve(),
    rateLimitStore: { mode: SWITCHES.rateLimitStore.resolve(), secretUsable: SWITCHES.rateLimitKeySecret.resolve() },
    platformAudit: SWITCHES.platformAudit.resolve(),
    tenantEventMail: SWITCHES.tenantEventMail.resolve(),
    guardianConsent: SWITCHES.guardianConsent.resolve(),
    fieldCryptoMode: SWITCHES.fieldCryptoMode.resolve(),
    derivationMode,
    tenantDb: {
      enabled: tenantDbEnabled,
      areas: tenantDbEnabled ? [...configured.areas].map(([area, s]) => ({ area, path: s.path, sample: s.sample })) : [],
      ignoredEntries: configured.ignored,
    },
    routing: { enabled: routing.enabled, suffixError: routing.suffixError },
    unrecognised: unrecognisedSwitches(),
    invalidCombinations: INVALID_COMBINATIONS.filter((rule) => rule.holds()).map(({ id, switches, effect }) => ({ id, switches, effect })),
  }
}

/** What the report says with every switch unset and the derivation mode at its default. */
export function defaultTenancyReport(): TenancyReport {
  return {
    authzSource: { value: SWITCHES.authzSource.default, unrecognised: false },
    loadScopedMode: SWITCHES.loadScopedMode.default,
    rateLimitStore: { mode: SWITCHES.rateLimitStore.default, secretUsable: SWITCHES.rateLimitKeySecret.default },
    platformAudit: SWITCHES.platformAudit.default,
    tenantEventMail: SWITCHES.tenantEventMail.default,
    guardianConsent: SWITCHES.guardianConsent.default,
    fieldCryptoMode: SWITCHES.fieldCryptoMode.default,
    derivationMode: DERIVATION_MODE_DEFAULT,
    tenantDb: { enabled: SWITCHES.tenantDbEnabled.default, areas: [], ignoredEntries: 0 },
    routing: { enabled: SWITCHES.routingEnabled.default, suffixError: SWITCHES.hostSuffix.default },
    unrecognised: [],
    invalidCombinations: [],
  }
}
