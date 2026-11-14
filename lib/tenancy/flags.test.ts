// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importClosure, readRepoFile } from '../../test/import-closure'
import { AUTHZ_SOURCES } from '@/lib/authz/decide'
import { FIELD_CRYPTO_MODES } from '@/lib/field-crypto'
import { MIN_SECRET_LENGTH } from '@/lib/rate-limit-store'
import { LOADSCOPED_MODES } from './load-scoped-mode'
import {
  defaultTenancyReport,
  INVALID_COMBINATIONS,
  RATE_LIMIT_STORE_MODES,
  resolveDerivationMode,
  SWITCHES,
  tenancyReport,
  unrecognisedSwitches,
} from './flags'

// S5 wave 7, O1: the switch registry. It reports what each switch RESOLVED to, through
// the owning module's own parser, and never a raw value. These pin that, and that the
// registry stays off proxy.ts's bundle and away from the tenant database driver.

const FIELD_CRYPTO_KEYS = ['FIELD_CRYPTO_MASTER_KEY', 'FIELD_CRYPTO_KEY_ID', 'FIELD_CRYPTO_PREVIOUS_MASTER_KEY', 'FIELD_CRYPTO_PREVIOUS_KEY_ID']
const ALL = [...Object.values(SWITCHES).map((s) => s.name), ...FIELD_CRYPTO_KEYS]

beforeEach(() => {
  for (const name of ALL) vi.stubEnv(name, undefined)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('the registry', () => {
  it('names every S5 switch the plan flips, once each', () => {
    const names = Object.values(SWITCHES).map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
    expect([...names].sort()).toEqual(
      [
        'AUTHZ_SOURCE',
        'FIELD_CRYPTO_MODE',
        'LOADSCOPED_MODE',
        'PLATFORM_AUDIT_ENABLED',
        'RATE_LIMIT_KEY_SECRET',
        'RATE_LIMIT_STORE',
        'TENANT_DB_AREAS',
        'TENANT_DB_ENABLED',
        'TENANT_EVENT_MAIL_ENABLED',
        'TENANT_GUARDIAN_CONSENT_ENABLED',
        'TENANT_HOST_SUFFIX',
        'TENANT_ROUTING_ENABLED',
      ].sort(),
    )
  })

  it('with every switch unset, each resolves to its default and none is unrecognised', () => {
    for (const spec of Object.values(SWITCHES)) expect(spec.resolve(), spec.name).toEqual(spec.default)
    expect(unrecognisedSwitches()).toEqual([])
  })

  it('every dependency is itself a variable the registry or its owner knows', () => {
    const names = new Set(Object.values(SWITCHES).map((s) => s.name))
    for (const spec of Object.values(SWITCHES)) for (const dep of spec.dependsOn) expect(names.has(dep), `${spec.name} -> ${dep}`).toBe(true)
  })

  it('accepts exactly what the owning parser takes, so an unrecognised value is one that fell back', () => {
    const cases: [keyof typeof SWITCHES, readonly string[], readonly string[]][] = [
      ['authzSource', [...AUTHZ_SOURCES, ' Shadow '], ['shadw', 'on']],
      ['loadScopedMode', [...LOADSCOPED_MODES, 'ENFORCE'], ['enforced', 'true']],
      ['rateLimitStore', [...RATE_LIMIT_STORE_MODES, ' shadow '], ['Shadow', 'redis']],
      ['fieldCryptoMode', [...FIELD_CRYPTO_MODES, 'Shadow'], ['write', 'on']],
      ['platformAudit', ['true', 'false'], ['TRUE', '1', ' true']],
      ['tenantEventMail', ['true', 'false'], ['yes']],
      ['guardianConsent', ['true', 'false'], ['True']],
      ['tenantDbEnabled', ['true', 'false'], ['on']],
      ['routingEnabled', ['true', 'false'], ['1']],
    ]
    // What a switch needs set before a recognised value moves it: guardian consent
    // resolves on only with the readiness guard's preconditions (s5-programme.20).
    const given: Partial<Record<keyof typeof SWITCHES, Record<string, string>>> = {
      guardianConsent: { LOADSCOPED_MODE: 'enforce', TENANT_EVENT_MAIL_ENABLED: 'true' },
    }
    for (const [key, good, bad] of cases) {
      const spec = SWITCHES[key]
      for (const [name, value] of Object.entries(given[key] ?? {})) vi.stubEnv(name, value)
      for (const raw of good) {
        expect(spec.accepts(raw), `${spec.name}=${raw}`).toBe(true)
        vi.stubEnv(spec.name, raw)
        // A recognised value other than the default's own spelling moves the switch.
        if (!['clerk', 'off', 'memory', 'false'].includes(raw.trim().toLowerCase())) expect(spec.resolve(), `${spec.name}=${raw}`).not.toEqual(spec.default)
      }
      for (const raw of bad) {
        expect(spec.accepts(raw), `${spec.name}=${raw}`).toBe(false)
        vi.stubEnv(spec.name, raw)
        expect(spec.resolve(), `${spec.name}=${raw}`).toEqual(spec.default)
        expect(unrecognisedSwitches()).toEqual([spec.name])
      }
      vi.stubEnv(spec.name, undefined)
      for (const name of Object.keys(given[key] ?? {})) vi.stubEnv(name, undefined)
    }
  })

  it('treats a secret as usable from the store’s own minimum length, and reports a short one by name', () => {
    vi.stubEnv('RATE_LIMIT_KEY_SECRET', 'x'.repeat(MIN_SECRET_LENGTH - 1))
    expect(SWITCHES.rateLimitKeySecret.resolve()).toBe(false)
    expect(unrecognisedSwitches()).toEqual(['RATE_LIMIT_KEY_SECRET'])
    vi.stubEnv('RATE_LIMIT_KEY_SECRET', 'x'.repeat(MIN_SECRET_LENGTH))
    expect(SWITCHES.rateLimitKeySecret.resolve()).toBe(true)
    expect(unrecognisedSwitches()).toEqual([])
  })
})

describe('tenancyReport', () => {
  it('with every switch unset, matches the defaults', () => {
    expect(tenancyReport('log')).toEqual(defaultTenancyReport())
    expect(defaultTenancyReport()).toEqual({
      authzSource: { value: 'clerk', unrecognised: false },
      loadScopedMode: 'off',
      rateLimitStore: { mode: 'memory', secretUsable: false },
      platformAudit: false,
      tenantEventMail: false,
      guardianConsent: false,
      fieldCryptoMode: 'off',
      derivationMode: 'log',
      tenantDb: { enabled: false, areas: [], ignoredEntries: 0 },
      routing: { enabled: false, suffixError: null },
      unrecognised: [],
      invalidCombinations: [],
    })
  })

  it('reports each flip the dev sequence makes', () => {
    vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
    // P4 (enforce) comes before P12 (the consent flag), which needs it (W7-14).
    vi.stubEnv('LOADSCOPED_MODE', 'enforce')
    vi.stubEnv('AUTHZ_SOURCE', 'shadow')
    vi.stubEnv('RATE_LIMIT_KEY_SECRET', 'k'.repeat(40))
    vi.stubEnv('RATE_LIMIT_STORE', 'shadow')
    vi.stubEnv('TENANT_DB_ENABLED', 'true')
    vi.stubEnv('TENANT_DB_AREAS', 'events-config:shadow:0.25')
    vi.stubEnv('TENANT_HOST_SUFFIX', '.events.example.org')
    vi.stubEnv('TENANT_ROUTING_ENABLED', 'true')
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
    vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', 'true')
    expect(tenancyReport('log')).toEqual({
      authzSource: { value: 'shadow', unrecognised: false },
      loadScopedMode: 'enforce',
      rateLimitStore: { mode: 'shadow', secretUsable: true },
      platformAudit: true,
      tenantEventMail: true,
      guardianConsent: true,
      fieldCryptoMode: 'off',
      derivationMode: 'log',
      tenantDb: { enabled: true, areas: [{ area: 'events-config', path: 'shadow', sample: 0.25 }], ignoredEntries: 0 },
      routing: { enabled: true, suffixError: null },
      unrecognised: [],
      invalidCombinations: [],
    })
  })

  it('lists the areas only once the flag is on, and counts ignored entries either way', () => {
    vi.stubEnv('TENANT_DB_AREAS', 'events-config:tenant,nope:shadow,events-config:shadow:2')
    const off = tenancyReport('log')
    expect(off.tenantDb).toEqual({ enabled: false, areas: [], ignoredEntries: 2 })
    expect(off.invalidCombinations.map((c) => c.id)).toEqual(['tenant_db_areas_without_flag'])
    expect(off.unrecognised).toEqual(['TENANT_DB_AREAS'])
    vi.stubEnv('TENANT_DB_ENABLED', 'true')
    expect(tenancyReport('log').tenantDb).toEqual({ enabled: true, areas: [{ area: 'events-config', path: 'tenant', sample: 1 }], ignoredEntries: 2 })
  })

  it('names each invalid combination the registry knows about', () => {
    const ids = () => tenancyReport('log').invalidCombinations.map((c) => c.id)
    expect(INVALID_COMBINATIONS.map((c) => c.id)).toEqual([
      'rate_limit_store_without_secret',
      'tenant_db_areas_without_flag',
      'routing_without_usable_suffix',
      'guardian_consent_not_ready',
      'field_crypto_mode_without_key',
    ])

    vi.stubEnv('RATE_LIMIT_STORE', 'shadow')
    expect(ids()).toEqual(['rate_limit_store_without_secret'])
    vi.stubEnv('RATE_LIMIT_KEY_SECRET', 'k'.repeat(MIN_SECRET_LENGTH))
    expect(ids()).toEqual([])

    vi.stubEnv('TENANT_ROUTING_ENABLED', 'true')
    expect(ids()).toEqual(['routing_without_usable_suffix'])
    vi.stubEnv('TENANT_HOST_SUFFIX', '.events.example.org')
    expect(ids()).toEqual([])

    vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', 'true')
    expect(ids()).toEqual(['guardian_consent_not_ready'])
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
    expect(ids()).toEqual(['guardian_consent_not_ready'])
    vi.stubEnv('LOADSCOPED_MODE', 'shadow')
    expect(ids()).toEqual(['guardian_consent_not_ready'])
    vi.stubEnv('LOADSCOPED_MODE', 'enforce')
    expect(ids()).toEqual([])
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'false')
    expect(ids()).toEqual(['guardian_consent_not_ready'])
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')

    vi.stubEnv('FIELD_CRYPTO_MODE', 'shadow')
    expect(ids()).toEqual(['field_crypto_mode_without_key'])
    vi.stubEnv('FIELD_CRYPTO_KEY_ID', 'testkey1')
    vi.stubEnv('FIELD_CRYPTO_MASTER_KEY', randomBytes(32).toString('base64'))
    expect(ids()).toEqual([])
  })

  // s5-programme.20: the readiness guard, as the registry reports it.
  it('reports guardian consent off, and an invalid combination, until every precondition holds', () => {
    const consent = () => {
      const r = tenancyReport('log')
      return { on: r.guardianConsent, invalid: r.invalidCombinations.filter((c) => c.id === 'guardian_consent_not_ready') }
    }
    // Unset, as on production: off, and nothing to report.
    expect(consent()).toEqual({ on: false, invalid: [] })
    vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', 'true')
    for (const [mode, mail] of [['off', 'false'], ['shadow', 'true'], ['enforce', 'false'], ['off', 'true']]) {
      vi.stubEnv('LOADSCOPED_MODE', mode)
      vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', mail)
      const { on, invalid } = consent()
      expect(on).toBe(false)
      expect(invalid).toHaveLength(1)
      expect(invalid[0].switches).toEqual(['TENANT_GUARDIAN_CONSENT_ENABLED', 'LOADSCOPED_MODE', 'TENANT_EVENT_MAIL_ENABLED'])
    }
    vi.stubEnv('LOADSCOPED_MODE', 'enforce')
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
    expect(consent()).toEqual({ on: true, invalid: [] })
    expect(SWITCHES.guardianConsent.dependsOn).toEqual(['LOADSCOPED_MODE', 'TENANT_EVENT_MAIL_ENABLED'])
  })

  // W7-27: the production zone guard, as the registry reports it.
  it('refuses the production tenant zone off production, and every other zone on production', () => {
    vi.stubEnv('TENANT_ROUTING_ENABLED', 'true')

    vi.stubEnv('TENANT_HOST_SUFFIX', '.events.stellreducation.org')
    expect(SWITCHES.hostSuffix.accepts('.events.stellreducation.org')).toBe(false)
    expect(SWITCHES.hostSuffix.accepts('.devzone.stellreducation.org')).toBe(true)
    const offProduction = tenancyReport('log')
    expect(offProduction.routing).toEqual({ enabled: true, suffixError: expect.stringMatching(/refused off production/) })
    expect(offProduction.unrecognised).toEqual(['TENANT_HOST_SUFFIX'])
    expect(offProduction.invalidCombinations.map((c) => c.id)).toEqual(['routing_without_usable_suffix'])

    vi.stubEnv('TENANT_HOST_SUFFIX', '.devzone.stellreducation.org')
    expect(tenancyReport('log').routing).toEqual({ enabled: true, suffixError: null })

    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
    expect(SWITCHES.hostSuffix.accepts('.devzone.stellreducation.org')).toBe(false)
    expect(SWITCHES.hostSuffix.accepts('.events.stellreducation.org')).toBe(true)
    const onProduction = tenancyReport('log')
    expect(onProduction.routing).toEqual({ enabled: true, suffixError: expect.stringMatching(/not the production tenant zone/) })
    expect(onProduction.unrecognised).toEqual(['TENANT_HOST_SUFFIX'])
    expect(onProduction.invalidCombinations.map((c) => c.id)).toEqual(['routing_without_usable_suffix'])
    expect(JSON.stringify(onProduction)).not.toContain('stellreducation')

    vi.stubEnv('TENANT_HOST_SUFFIX', '.events.stellreducation.org')
    const good = tenancyReport('log')
    expect(good.routing).toEqual({ enabled: true, suffixError: null })
    expect(good.unrecognised).toEqual([])
    expect(good.invalidCombinations).toEqual([])
  })

  it('never carries a raw value: secrets, zones, unrecognised strings and key material stay out', () => {
    const masterKey = randomBytes(32).toString('base64')
    const raw: Record<string, string> = {
      AUTHZ_SOURCE: 'sentinel-authz-q7',
      LOADSCOPED_MODE: 'sentinel-loadscoped-q7',
      RATE_LIMIT_STORE: 'sentinel-store-q7',
      RATE_LIMIT_KEY_SECRET: 'sentinel-placeholder-secret-q7-not-a-real-key',
      PLATFORM_AUDIT_ENABLED: 'sentinel-audit-q7',
      TENANT_EVENT_MAIL_ENABLED: 'sentinel-mail-q7',
      TENANT_GUARDIAN_CONSENT_ENABLED: 'sentinel-consent-q7',
      FIELD_CRYPTO_MODE: 'sentinel-crypto-q7',
      FIELD_CRYPTO_KEY_ID: 'sentinelkeyq7',
      FIELD_CRYPTO_MASTER_KEY: masterKey,
      TENANT_DB_ENABLED: 'sentinel-db-q7',
      TENANT_DB_AREAS: 'events-config:shadow:0.5,sentinel-area-q7:tenant',
      TENANT_ROUTING_ENABLED: 'sentinel-routing-q7',
      TENANT_HOST_SUFFIX: '.sentinel-zone-q7.org',
    }
    for (const [k, v] of Object.entries(raw)) vi.stubEnv(k, v)
    const text = JSON.stringify(tenancyReport('enforce'))
    expect(text).not.toMatch(/sentinel/i)
    expect(text).not.toContain(masterKey)
    expect(JSON.parse(text).unrecognised).toEqual([
      'AUTHZ_SOURCE',
      'LOADSCOPED_MODE',
      'RATE_LIMIT_STORE',
      'PLATFORM_AUDIT_ENABLED',
      'TENANT_EVENT_MAIL_ENABLED',
      'TENANT_GUARDIAN_CONSENT_ENABLED',
      'FIELD_CRYPTO_MODE',
      'TENANT_DB_ENABLED',
      'TENANT_DB_AREAS',
      'TENANT_ROUTING_ENABLED',
      'TENANT_HOST_SUFFIX',
    ])
  })
})

describe('resolveDerivationMode', () => {
  it('reports the stored mode, reads no row as log (as the trigger does), and a failure as unavailable', () => {
    expect(resolveDerivationMode({ failed: false, value: 'log' })).toBe('log')
    expect(resolveDerivationMode({ failed: false, value: 'enforce' })).toBe('enforce')
    expect(resolveDerivationMode({ failed: false, value: null })).toBe('log')
    expect(resolveDerivationMode({ failed: false, value: undefined })).toBe('log')
    expect(resolveDerivationMode({ failed: true, value: 'enforce' })).toBe('unavailable')
    expect(resolveDerivationMode({ failed: false, value: 'sentinel-mode-q7' })).toBe('unavailable')
  })
})

describe('where the registry may be reached', () => {
  const FLAGS = 'lib/tenancy/flags.ts'

  it("is not in proxy.ts's import closure, dynamic imports included", { timeout: 30_000 }, () => {
    const closure = importClosure('proxy.ts', readRepoFile)
    expect(closure.has('lib/tenancy/host.ts')).toBe(true)
    expect(closure.has(FLAGS)).toBe(false)
  })

  it('reaches neither the tenant database, its area switch nor its driver, dynamic imports included', { timeout: 30_000 }, () => {
    const closure = importClosure(FLAGS, readRepoFile)
    expect(closure.has('lib/tenancy/tenant-db-config.ts')).toBe(true)
    for (const f of ['lib/tenancy/db.ts', 'lib/tenancy/area-switch.ts', 'lib/tenancy/driver.ts']) expect(closure.has(f), f).toBe(false)
  })

  it('keeps the owner’s review on every file that decides the tenant database path', () => {
    // The TENANT_DB_ENABLED gate and the TENANT_DB_AREAS parser moved out of
    // area-switch.ts into tenant-db-config.ts, so the registry need not reach
    // area-switch.ts. Moving them must not take them out of CODEOWNERS.
    const owned = new Set(
      readFileSync('.github/CODEOWNERS', 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('/') && /\s@\S/.test(l))
        .map((l) => l.split(/\s+/)[0].slice(1)),
    )
    for (const f of [FLAGS, 'lib/tenancy/area-switch.ts', 'lib/tenancy/tenant-db-config.ts', 'lib/tenancy/driver.ts']) {
      expect(owned.has(f), f).toBe(true)
    }
  })

  it('the health route does not load the driver statically', { timeout: 30_000 }, () => {
    const closure = importClosure('app/api/admin/health/integrations/route.ts', readRepoFile, { staticOnly: true })
    expect(closure.has(FLAGS)).toBe(true)
    expect(closure.has('lib/tenancy/driver.ts')).toBe(false)
  })

  it('is imported by the health route alone, so no request path of Stellr’s resolves it', { timeout: 30_000 }, () => {
    const SKIP = new Set(['node_modules', '.next', '.git', 'coverage', 'storybook-static', 'dist', 'out', '.vercel', 'playwright-report', 'test-results', '.stryker-tmp', 'reports', '.claude'])
    const importers: string[] = []
    const walk = (p: string) => {
      const st = statSync(p)
      if (st.isDirectory()) {
        if (SKIP.has(p.split('/').pop() as string)) return
        for (const f of readdirSync(p)) walk(p === '.' ? f : join(p, f))
      } else if (/\.(?:ts|tsx|mts|js|mjs)$/.test(p) && !/\.test\.tsx?$/.test(p) && p !== FLAGS) {
        if (/tenancy\/flags['"]/.test(readFileSync(p, 'utf8'))) importers.push(p)
      }
    }
    walk('.')
    expect(importers).toEqual(['app/api/admin/health/integrations/route.ts'])
  })
})

describe('supabase/tests/s5_watch_only.sql', () => {
  const sql = readFileSync('supabase/tests/s5_watch_only.sql', 'utf8')
  const code = sql.replace(/--[^\n]*/g, '')

  it('has a section for every switch in the registry, and for the derivation mode', () => {
    const headers = sql.split('\n').filter((l) => l.startsWith('-- ── '))
    for (const spec of Object.values(SWITCHES)) expect(headers.some((h) => h.includes(spec.name)), spec.name).toBe(true)
    expect(headers.some((h) => h.includes('derivation_mode'))).toBe(true)
  })

  it('runs in one read-only transaction that is rolled back, and writes nothing', () => {
    const statements = code.replace(/^\s*\\.*$/gm, '').trim()
    expect(statements.startsWith('BEGIN TRANSACTION READ ONLY;')).toBe(true)
    expect(statements.endsWith('ROLLBACK;')).toBe(true)
    expect(code).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE|COMMIT|COPY|CALL|DO)\b/i)
    expect(code).toMatch(/\\if :\{\?flip_at\}/)
  })

  it('filters every table it reads by :flip_at, apart from the live and current-state reads', () => {
    const queries = code.split(';').filter((q) => /\bFROM public\./.test(q))
    const unfiltered = queries.filter((q) => !q.includes(":'flip_at'")).map((q) => q.match(/FROM (public\.\w+)/)?.[1])
    expect(unfiltered.sort()).toEqual(['public.event_companies', 'public.tenancy_settings'])
  })
})
