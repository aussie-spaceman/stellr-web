// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// S0 key migration: the owner checks here which key format the deployment
// actually holds. `vercel env pull`
// redacts secrets, so only the deployment can say. Kinds, roles and variable
// names only: a key value must never appear in the response.

const authMock = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({ auth: () => authMock() }))

// The one service-role read (tenancy_settings.derivation_mode, S5 wave 7 O1).
const db = vi.hoisted(() => ({
  reads: [] as { table: string; columns: string }[],
  result: { data: { derivation_mode: 'log' } as unknown, error: null as unknown } as { data: unknown; error: unknown },
  throws: false,
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => {
    if (db.throws) throw new Error('supabase is not configured')
    return {
      from: (table: string) => {
        const read = { table, columns: '' }
        db.reads.push(read)
        const builder = {
          select: (columns: string) => ((read.columns = columns), builder),
          eq: () => builder,
          abortSignal: () => builder,
          maybeSingle: async () => db.result,
        }
        return builder
      },
    }
  },
}))

// The tenant database driver (S5 wave 7, O3): the real module, counted each time
// it is loaded (vi.doMock below), so a test can see the route load it only with
// TENANT_DB_ENABLED on.
const driverLoads = vi.hoisted(() => ({ count: 0 }))

import { defaultTenancyReport, SWITCHES } from '@/lib/tenancy/flags'
import { GET } from './route'

const PUBLISHABLE = 'sb_publishable_TESTONLY'
const SECRET = 'sb_secret_TESTONLY'
// Fake legacy keys, built at run time so no JWT-shaped literal sits in the repo.
const b64url = (s: string) => Buffer.from(s).toString('base64url')
const fakeLegacyKey = (role: string) =>
  `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ iss: 'supabase', role }))}.TESTONLY`
const LEGACY_ANON = fakeLegacyKey('anon')
const LEGACY_SERVICE = fakeLegacyKey('service_role')

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', undefined)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', undefined)
  vi.stubEnv('SUPABASE_SECRET_KEY', undefined)
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', undefined)
})
afterEach(() => {
  vi.unstubAllEnvs()
  authMock.mockReset()
  db.reads.length = 0
  db.result = { data: { derivation_mode: 'log' }, error: null }
  db.throws = false
})

describe('GET /api/admin/health/integrations — supabaseKeys', () => {
  it('reports each slot as kind + role + variable, never the value', async () => {
    authMock.mockResolvedValue({ userId: 'u-admin', sessionClaims: { metadata: { role: 'admin' } } })
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', PUBLISHABLE)
    vi.stubEnv('SUPABASE_SECRET_KEY', SECRET)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', LEGACY_SERVICE)

    const res = await GET()
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(JSON.parse(text).supabaseKeys).toEqual({
      public: { variable: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', kind: 'publishable', role: 'anon' },
      secret: { variable: 'SUPABASE_SECRET_KEY', kind: 'secret', role: 'service_role' },
    })
    for (const value of [PUBLISHABLE, SECRET, LEGACY_SERVICE]) expect(text).not.toContain(value)
  })

  // Since runbook step 11 (3 Nov 2026) the legacy names are not read, so a
  // deployment that only has them shows both slots unconfigured.
  it('shows a legacy-only deployment as unconfigured, never echoing the values', async () => {
    authMock.mockResolvedValue({ userId: 'u-admin', sessionClaims: { metadata: { role: 'admin' } } })
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', LEGACY_ANON)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', LEGACY_SERVICE)

    const text = await (await GET()).text()
    expect(JSON.parse(text).supabaseKeys).toEqual({
      public: { variable: null, kind: 'unconfigured', role: null },
      secret: { variable: null, kind: 'unconfigured', role: null },
    })
    for (const value of [LEGACY_ANON, LEGACY_SERVICE]) expect(text).not.toContain(value)
  })

  it('reports the tenant routing flag and suffix error, never the zone', async () => {
    authMock.mockResolvedValue({ userId: 'u-admin', sessionClaims: { metadata: { role: 'admin' } } })

    vi.stubEnv('TENANT_ROUTING_ENABLED', undefined)
    vi.stubEnv('TENANT_HOST_SUFFIX', undefined)
    expect((await (await GET()).json()).tenantRouting).toEqual({ enabled: false, suffixError: null })

    vi.stubEnv('TENANT_ROUTING_ENABLED', 'true')
    const unset = (await (await GET()).json()).tenantRouting
    expect(unset.enabled).toBe(true)
    expect(unset.suffixError).toMatch(/TENANT_HOST_SUFFIX is not set/)

    vi.stubEnv('TENANT_HOST_SUFFIX', '.stellreducation.org')
    const refused = await (await GET()).text()
    expect(JSON.parse(refused).tenantRouting.suffixError).toMatch(/not a safe tenant zone suffix/)
    expect(refused).not.toContain('.stellreducation.org')

    // W7-27: off production the production zone is refused, and a dev zone is good.
    vi.stubEnv('TENANT_HOST_SUFFIX', '.events.stellreducation.org')
    const refusedOffProduction = await (await GET()).text()
    expect(JSON.parse(refusedOffProduction).tenantRouting).toEqual({
      enabled: true,
      suffixError: expect.stringMatching(/is the production tenant zone, which is refused off production/),
    })
    expect(refusedOffProduction).not.toContain('events.stellreducation.org')

    vi.stubEnv('TENANT_HOST_SUFFIX', '.devzone.stellreducation.org')
    const devZone = await (await GET()).text()
    expect(JSON.parse(devZone).tenantRouting).toEqual({ enabled: true, suffixError: null })
    expect(devZone).not.toContain('devzone.stellreducation.org')

    // On the real production app only the production zone is good.
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
    const notTheProductionZone = await (await GET()).text()
    expect(JSON.parse(notTheProductionZone).tenantRouting.suffixError).toMatch(/is not the production tenant zone/)
    expect(notTheProductionZone).not.toContain('devzone.stellreducation.org')

    vi.stubEnv('TENANT_HOST_SUFFIX', '.events.stellreducation.org')
    const good = await (await GET()).text()
    expect(JSON.parse(good).tenantRouting).toEqual({ enabled: true, suffixError: null })
    expect(good).not.toContain('.events.stellreducation.org')
  })

  it('stays admin-only (403 for a member), and a refused caller costs no read', async () => {
    authMock.mockResolvedValue({ userId: 'u-member', sessionClaims: { metadata: { role: 'member' } } })
    expect((await GET()).status).toBe(403)
    expect(db.reads).toEqual([])
  })
})

// S5 wave 7, O1: every switch as it resolved, so each dev flip can be seen to have
// taken effect. Resolved values only: never a raw value, secret, URL or zone.
describe('GET /api/admin/health/integrations — tenancy', () => {
  const FIELD_CRYPTO_KEYS = ['FIELD_CRYPTO_MASTER_KEY', 'FIELD_CRYPTO_KEY_ID', 'FIELD_CRYPTO_PREVIOUS_MASTER_KEY', 'FIELD_CRYPTO_PREVIOUS_KEY_ID']
  const asAdmin = () => authMock.mockResolvedValue({ userId: 'u-admin', sessionClaims: { metadata: { role: 'admin' } } })

  const TENANT_DB_SECRETS = ['TENANT_DATABASE_URL', 'TENANT_DATABASE_CA_CERT']

  beforeEach(() => {
    for (const name of [...Object.values(SWITCHES).map((s) => s.name), ...FIELD_CRYPTO_KEYS, ...TENANT_DB_SECRETS]) vi.stubEnv(name, undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    asAdmin()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('with every switch unset, matches the defaults, and leaves `ok` alone', async () => {
    const body = await (await GET()).json()
    expect(body.tenancy).toEqual(defaultTenancyReport())
    expect(body.tenancy).toEqual({
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
    expect(body.ok).toBe(true)
  })

  it('makes exactly one read, of tenancy_settings.derivation_mode', async () => {
    db.result = { data: { derivation_mode: 'enforce' }, error: null }
    expect((await (await GET()).json()).tenancy.derivationMode).toBe('enforce')
    expect(db.reads).toEqual([{ table: 'tenancy_settings', columns: 'derivation_mode' }])
  })

  it('reports a failed or unconfigured read as unavailable, never a guess', async () => {
    db.result = { data: null, error: { message: 'permission denied for table tenancy_settings' } }
    const failed = await (await GET()).text()
    expect(JSON.parse(failed).tenancy.derivationMode).toBe('unavailable')
    expect(failed).not.toContain('permission denied')

    db.throws = true
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).tenancy.derivationMode).toBe('unavailable')
  })

  it('shows a flip and an unrecognised AUTHZ_SOURCE by name, never echoing a raw value', async () => {
    vi.stubEnv('AUTHZ_SOURCE', 'shadow')
    vi.stubEnv('RATE_LIMIT_STORE', 'shadow')
    const flipped = (await (await GET()).json()).tenancy
    expect(flipped.authzSource).toEqual({ value: 'shadow', unrecognised: false })
    expect(flipped.rateLimitStore).toEqual({ mode: 'shadow', secretUsable: false })
    expect(flipped.invalidCombinations.map((c: { id: string }) => c.id)).toEqual(['rate_limit_store_without_secret'])

    const secret = 'sentinel-placeholder-secret-h4-not-a-real-key'
    const masterKey = Buffer.alloc(32, 7).toString('base64')
    const raw: Record<string, string> = {
      AUTHZ_SOURCE: 'sentinel-authz-h4',
      LOADSCOPED_MODE: 'sentinel-loadscoped-h4',
      RATE_LIMIT_STORE: 'sentinel-store-h4',
      RATE_LIMIT_KEY_SECRET: secret,
      PLATFORM_AUDIT_ENABLED: 'sentinel-audit-h4',
      TENANT_EVENT_MAIL_ENABLED: 'sentinel-mail-h4',
      TENANT_GUARDIAN_CONSENT_ENABLED: 'sentinel-consent-h4',
      FIELD_CRYPTO_MODE: 'shadow',
      FIELD_CRYPTO_KEY_ID: 'sentinelkeyh4',
      FIELD_CRYPTO_MASTER_KEY: masterKey,
      TENANT_DB_ENABLED: 'true',
      TENANT_DB_AREAS: 'events-config:shadow:0.25,sentinel-area-h4:tenant',
      TENANT_ROUTING_ENABLED: 'true',
      TENANT_HOST_SUFFIX: '.sentinel-zone-h4.example.org',
    }
    for (const [k, v] of Object.entries(raw)) vi.stubEnv(k, v)
    const text = await (await GET()).text()
    expect(text).not.toMatch(/sentinel/i)
    expect(text).not.toContain(masterKey)
    expect(text).not.toContain('example.org')
    const tenancy = JSON.parse(text).tenancy
    expect(tenancy.authzSource).toEqual({ value: 'clerk', unrecognised: true })
    expect(tenancy.rateLimitStore).toEqual({ mode: 'memory', secretUsable: true })
    expect(tenancy.fieldCryptoMode).toBe('shadow')
    expect(tenancy.tenantDb).toEqual({
      enabled: true,
      areas: [{ area: 'events-config', path: 'shadow', sample: 0.25 }],
      ignoredEntries: 1,
      config: { url: 'missing', ca: 'missing' },
    })
    expect(tenancy.routing).toEqual({ enabled: true, suffixError: null })
    expect(tenancy.unrecognised).toEqual([
      'AUTHZ_SOURCE',
      'LOADSCOPED_MODE',
      'RATE_LIMIT_STORE',
      'PLATFORM_AUDIT_ENABLED',
      'TENANT_EVENT_MAIL_ENABLED',
      'TENANT_GUARDIAN_CONSENT_ENABLED',
      'TENANT_DB_AREAS',
    ])
    expect(tenancy.invalidCombinations).toEqual([])
  })

  // O3: the URL and CA checks, only with the flag on, as 'ok' or a fixed reason.
  describe('tenancy.tenantDb.config (O3)', () => {
    // Placeholders built at run time: a pooler-shaped URL and a self-signed root
    // whose key was discarded (the driver tests' TEST_CA).
    const POOLER_URL = ['postgres://tenant_app_login.placeholderref:', 'pw-placeholder-o3', '@db.placeholder-o3.example.com:6543/postgres'].join('')
    const CA = [
      '-----BEGIN CERTIFICATE-----',
      'MIIBgjCCASigAwIBAgIUALfgo5LYX5L0C3UWJPyP7b0uS08wCgYIKoZIzj0EAwIw',
      'HjEcMBoGA1UEAwwTc3RlbGxyLXRlc3Qtcm9vdC1jYTAgFw0yNjExMTAxNTM1NTNa',
      'GA8yMTI2MTAxNzE1MzU1M1owHjEcMBoGA1UEAwwTc3RlbGxyLXRlc3Qtcm9vdC1j',
      'YTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABA0xyYAYw+X/pdt8y4KvJM30LISZ',
      'bj1pDUsSG+WBai7YkxDcO34BUY248lJFBy770jim37+3IdyaClHH/2wI8mWjQjBA',
      'MB0GA1UdDgQWBBTNi5qtSkN1FNswBXKqpxSSXht35zAPBgNVHRMBAf8EBTADAQH/',
      'MA4GA1UdDwEB/wQEAwIBBjAKBggqhkjOPQQDAgNIADBFAiBJ1s59a959QUA5MjTt',
      'Nc9/XyTikoqN6z/yEPa9ipIQZwIhALMguIhzXmmwVL4G1MGd3fv2kqAVQw9tDRxr',
      'qwTU41My',
      '-----END CERTIFICATE-----',
    ].join('\n')

    /** A fresh copy of the route, so the driver's load count starts from nothing. */
    async function freshGet() {
      vi.resetModules()
      vi.doMock('@/lib/tenancy/driver', async (importOriginal) => {
        driverLoads.count++
        return importOriginal()
      })
      const before = driverLoads.count
      const { GET: fresh } = await import('./route')
      const text = await (await fresh()).text()
      return { text, body: JSON.parse(text), loads: driverLoads.count - before }
    }

    it('with TENANT_DB_ENABLED unset or not exactly true, loads no driver and adds nothing, even with the URL set', async () => {
      vi.stubEnv('TENANT_DATABASE_URL', 'not a url')
      for (const flag of [undefined, 'TRUE', '1']) {
        vi.stubEnv('TENANT_DB_ENABLED', flag)
        const { body, loads } = await freshGet()
        expect(loads).toBe(0)
        expect(body.tenancy.tenantDb).toEqual({ enabled: false, areas: [], ignoredEntries: 0 })
      }
    })

    it('with the flag on, reports each check as ok or a fixed reason, never the URL, the password or the PEM', async () => {
      vi.stubEnv('TENANT_DB_ENABLED', 'true')
      const cases: [string | undefined, string | undefined, { url: string; ca: string }][] = [
        [undefined, undefined, { url: 'missing', ca: 'missing' }],
        [`${POOLER_URL}?sslmode=verify-full`, CA, { url: 'ok', ca: 'ok' }],
        [`${POOLER_URL}?sslmode=require`, CA, { url: 'not-verify-full', ca: 'ok' }],
        [`${POOLER_URL}?sslmode=verify-full`, 'not a certificate', { url: 'ok', ca: 'unreadable' }],
        ['postgres://tenant_app_login:pw-placeholder-o3@127.0.0.1:54322/postgres', undefined, { url: 'ok', ca: 'not-needed' }],
      ]
      for (const [url, ca, want] of cases) {
        vi.stubEnv('TENANT_DATABASE_URL', url)
        vi.stubEnv('TENANT_DATABASE_CA_CERT', ca)
        const { text, body, loads } = await freshGet()
        expect(loads).toBe(1)
        expect(body.tenancy.tenantDb.config).toEqual(want)
        expect(text).not.toMatch(/pw-placeholder-o3|placeholder-o3\.example|placeholderref|BEGIN CERTIFICATE|MIIB|not a certificate/)
        expect(body.ok).toBe(true)
      }
    })
  })
})
