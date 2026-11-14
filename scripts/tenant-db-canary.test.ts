// @vitest-environment node
//
// The pooler TLS canary (S5 wave 7, O3). The owner runs it by hand against the
// dev pooler (step P6). Here: its verdicts over a stand-in driver, what it
// prints (never the URL, the password, the host or the PEM), the real
// diagnostic handshake against a local TLS stand-in, that its real driver is the
// app's under verify-full, and that nothing the app ships imports it.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createServer, type AddressInfo, type Socket } from 'node:net'
import { TLSSocket } from 'node:tls'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeCert, type Made } from '../test/helpers/test-certs'
import { runtimeImports } from '../test/import-closure'

// postgres.js stood in for, so realDeps.driver can be seen to hand it the
// driver's verify-full options. Nothing here connects through it.
const pg = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }))
vi.mock('postgres', () => ({
  default: (options: Record<string, unknown>) => {
    pg.options.push(options)
    return { begin: async () => undefined, end: async () => undefined }
  },
}))

import {
  CANARY_URL_VAR,
  codeOf,
  diagnosticHandshake,
  parseArgs,
  realDeps,
  runCanary,
  safeCode,
  type CanaryDeps,
  type CanaryDriver,
  type HandshakeReport,
} from './tenant-db-canary'
import { STELLR_TENANT_ID } from '../lib/tenancy/constants'
import { PRODUCTION_SUPABASE_REF } from './production-guard.mjs'

const PASSWORD = 'pw-placeholder-canary'
const REF = 'placeholderref'
const HOST = 'aws-0-placeholder.pooler.example.com'
const URL_VF = `postgres://tenant_app_login.${REF}:${PASSWORD}@${HOST}:6543/postgres?sslmode=verify-full`

const root = makeCert('canary-test-root')
const otherRoot = makeCert('canary-other-root')
const NAME = 'db.canary-test.example'
const leaf = makeCert(NAME, { issuer: root, san: { dns: NAME } })
const fromOtherRoot = makeCert(NAME, { issuer: otherRoot, san: { dns: NAME } })

/** Nothing secret may reach the output: the URL, the password, the project ref, the host or the PEM body. */
function expectNoSecrets(out: string) {
  expect(out).not.toContain(PASSWORD)
  expect(out).not.toContain(REF)
  expect(out).not.toContain(HOST)
  expect(out).not.toContain('postgres://')
  expect(out).not.toMatch(/BEGIN CERTIFICATE|MII[A-Za-z0-9+/]{8}/)
}

const VERIFIED: HandshakeReport = {
  outcome: 'TLS_VERIFIED',
  protocol: 'TLSv1.3',
  chain: [{ subject: `CN=${NAME}`, issuer: 'CN=canary-test-root', san: `DNS:${NAME}`, sha256: 'AA:BB' }],
}

/**
 * A stand-in driver that behaves like Postgres for tenantDb's pin and its
 * read-only check, counts companies, and answers application_name.
 */
function fakeDriver(opts: { role?: string; tenant?: string; companies?: unknown; fail?: unknown; app?: string; readOnly?: string } = {}) {
  const sent: string[] = []
  let ended = false
  const driver: CanaryDriver = {
    async transaction(fn) {
      if (opts.fail) throw opts.fail
      let role = 'tenant_app_login'
      let tenant: string | null = null
      return fn({
        async query(text: string, values: readonly unknown[] = []) {
          sent.push(text)
          if (/^SET LOCAL ROLE /.test(text)) role = opts.role ?? text.slice('SET LOCAL ROLE '.length)
          else if (/set_config/.test(text)) tenant = opts.tenant ?? String(values[0])
          else if (/current_user AS role/.test(text)) return { rows: [{ role, tenant } as never], rowCount: 1 }
          else if (/current_setting\('transaction_read_only'\)/.test(text)) return { rows: [{ read_only: opts.readOnly ?? 'on' } as never], rowCount: 1 }
          else if (/current_setting\('application_name'\) AS app/.test(text)) return { rows: [{ app: opts.app ?? 'stellr-tenantdb' } as never], rowCount: 1 }
          else if (/count\(\*\)::int AS n FROM public\.event_companies/.test(text)) return { rows: [{ n: 'companies' in opts ? opts.companies : 3 } as never], rowCount: 1 }
          return { rows: [], rowCount: 0 }
        },
      })
    },
    async end() {
      ended = true
    },
  }
  return { driver, sent, ended: () => ended }
}

async function run(input: { url?: string; ca?: string | null; production?: boolean }, deps: Partial<CanaryDeps> = {}) {
  const lines: string[] = []
  const handshake = vi.fn(async () => VERIFIED)
  const fake = fakeDriver()
  const driver = vi.fn(async () => fake.driver)
  const result = await runCanary(
    { url: 'url' in input ? input.url : URL_VF, ca: input.ca === undefined ? root.pem : input.ca, label: 'A', ...(input.production ? { production: true } : {}) },
    { handshake, driver, ...deps },
    (line) => lines.push(line),
  )
  return { result, out: lines.join('\n'), handshake, driver, fake }
}

describe('runCanary: the verdict', () => {
  it('passes under verify-full when the role is tenant_app, the tenant is Stellr and event_companies has rows', async () => {
    const { result, out, handshake, driver, fake } = await run({})
    expect(result).toEqual({ pass: true, code: 'PASS' })
    expect(out).toMatch(/^url {10}ok \(sslmode=verify-full\)$/m)
    expect(out).toMatch(/^handshake {4}TLS_VERIFIED \(TLSv1\.3\)$/m)
    expect(out).toMatch(/subject: CN=db\.canary-test\.example/)
    expect(out).toMatch(/issuer: {2}CN=canary-test-root/)
    expect(out).toMatch(/SANs: {4}DNS:db\.canary-test\.example/)
    expect(out).toMatch(/^ca\[0\] {8}subject: CN=canary-test-root$/m)
    expect(out).toMatch(/^role {9}tenant_app \(ok\)$/m)
    expect(out).toMatch(/^tenant {7}Stellr's \(ok\)$/m)
    expect(out).toMatch(/^companies {4}3 \(ok\)$/m)
    expect(out).toMatch(/^application {2}stellr-tenantdb \(ok\)$/m)
    expect(out).toMatch(/^RESULT {7}PASS$/m)
    expectNoSecrets(out)
    // The handshake goes to the URL's host, with its name as SNI; the driver gets the URL and the checked PEM.
    expect(handshake).toHaveBeenCalledWith({ host: HOST, port: 6543, servername: HOST }, root.pem)
    expect(driver).toHaveBeenCalledWith(URL_VF, root.pem)
    // Through tenantDb, read-only: READ ONLY before the pin, the pin and its
    // read-back, the read-only read-back, then the canary's own three reads,
    // each followed by the pin read-back. Nothing it sends can write.
    expect(fake.sent).toEqual([
      'SET TRANSACTION READ ONLY',
      'SET LOCAL ROLE tenant_app',
      "SELECT set_config('stellr.tenant_id', $1, true)",
      'SELECT current_user AS role, public.app_tenant_id()::text AS tenant',
      "SELECT current_setting('transaction_read_only') AS read_only",
      'SELECT current_user AS role, public.app_tenant_id()::text AS tenant',
      'SELECT current_user AS role, public.app_tenant_id()::text AS tenant',
      'SELECT count(*)::int AS n FROM public.event_companies',
      'SELECT current_user AS role, public.app_tenant_id()::text AS tenant',
      "SELECT current_setting('application_name') AS app",
      'SELECT current_user AS role, public.app_tenant_id()::text AS tenant',
    ])
    expect(fake.ended()).toBe(true)
  })

  it('reports the handshake outcome but decides on the verify-full connection alone', async () => {
    const chainFailed: HandshakeReport = { ...VERIFIED, outcome: 'TLS_CHAIN_SELF_SIGNED_CERT_IN_CHAIN' }
    const tlsRefused = Object.assign(new Error(`self-signed certificate in chain for ${HOST}`), { code: 'SELF_SIGNED_CERT_IN_CHAIN' })
    const failing = fakeDriver({ fail: tlsRefused })
    const { result, out } = await run({}, { handshake: async () => chainFailed, driver: async () => failing.driver })
    expect(result).toEqual({ pass: false, code: 'CONNECT_SELF_SIGNED_CERT_IN_CHAIN' })
    expect(out).toMatch(/^handshake {4}TLS_CHAIN_SELF_SIGNED_CERT_IN_CHAIN/m)
    expect(out).toMatch(/^verify-full {2}failed \(SELF_SIGNED_CERT_IN_CHAIN\)$/m)
    expect(out).toMatch(/^RESULT {7}FAIL CONNECT_SELF_SIGNED_CERT_IN_CHAIN$/m)
    expect(out).not.toContain('self-signed certificate in chain')
    expectNoSecrets(out)
    expect(failing.ended()).toBe(true)
  })

  it('fails on a SQLSTATE (the login cannot become tenant_app), printing the code only', async () => {
    const denied = Object.assign(new Error('permission denied to set role "tenant_app"'), { code: '42501' })
    const { result, out } = await run({}, { driver: async () => fakeDriver({ fail: denied }).driver })
    expect(result.code).toBe('CONNECT_42501')
    expect(out).not.toContain('permission denied')
  })

  it('fails when the role or the tenant does not hold (tenantDb refuses the pin)', async () => {
    for (const opts of [{ role: 'postgres' }, { tenant: 'c0ffee00-0000-4000-8000-0000000000b2' }]) {
      const { result, out } = await run({}, { driver: async () => fakeDriver(opts).driver })
      expect(result).toEqual({ pass: false, code: 'CONNECT_TENANTCONTEXTERROR' })
      expect(out).not.toMatch(/^RESULT {7}PASS/m)
    }
  })

  it('fails when the transaction cannot be made read-only (tenantDb refuses it)', async () => {
    const { result, out } = await run({}, { driver: async () => fakeDriver({ readOnly: 'off' }).driver })
    expect(result).toEqual({ pass: false, code: 'CONNECT_TENANTCONTEXTERROR' })
    expect(out).not.toMatch(/^RESULT {7}PASS/m)
  })

  it('reports, without gating on it, a server session that does not see application_name stellr-tenantdb, and never prints the value', async () => {
    const { result, out } = await run({}, { driver: async () => fakeDriver({ app: 'Supavisor-placeholder' }).driver })
    expect(result).toEqual({ pass: true, code: 'PASS' })
    expect(out).toMatch(/^application {2}not stellr-tenantdb$/m)
    expect(out).not.toContain('Supavisor-placeholder')
    expectNoSecrets(out)
  })

  it('fails when event_companies reads no rows for Stellr', async () => {
    for (const companies of [0, '0', null]) {
      const { result, out } = await run({}, { driver: async () => fakeDriver({ companies }).driver })
      expect(result).toEqual({ pass: false, code: 'NO_EVENT_COMPANIES' })
      expect(out).toMatch(/^RESULT {7}FAIL NO_EVENT_COMPANIES$/m)
    }
  })

  it.each([
    ['unset', undefined, 'URL_REFUSED', 'missing'],
    ['no sslmode', URL_VF.replace('?sslmode=verify-full', ''), 'URL_REFUSED', 'not-verify-full'],
    ['sslmode=require', URL_VF.replace('verify-full', 'require'), 'URL_REFUSED', 'not-verify-full'],
    ['sslmode=verify-ca', URL_VF.replace('verify-full', 'verify-ca'), 'URL_REFUSED', 'not-verify-full'],
    ['the owner login', URL_VF.replace(`tenant_app_login.${REF}`, 'postgres'), 'URL_REFUSED', 'wrong-login'],
    ['a local host', `postgres://tenant_app_login:${PASSWORD}@127.0.0.1:54322/postgres`, 'URL_LOCAL', null],
  ])('refuses a URL that is %s before any connection: sslmode is never weakened', async (_label, url, code, why) => {
    const { result, out, handshake, driver } = await run({ url })
    expect(result).toEqual({ pass: false, code })
    if (why) expect(out).toContain(`url          refused (${why})`)
    expect(handshake).not.toHaveBeenCalled()
    expect(driver).not.toHaveBeenCalled()
    expectNoSecrets(out)
  })

  it.each([
    ['in its login user', URL_VF.replace(`tenant_app_login.${REF}`, `tenant_app_login.${PRODUCTION_SUPABASE_REF}`)],
    ['in its host', `postgres://tenant_app_login:${PASSWORD}@db.${PRODUCTION_SUPABASE_REF}.supabase.co:5432/postgres?sslmode=verify-full`],
  ])('refuses the production project (named %s) without --production, and never prints its ref', async (_label, url) => {
    const { result, out, handshake, driver } = await run({ url })
    expect(result).toEqual({ pass: false, code: 'URL_PRODUCTION' })
    expect(out).toContain('url          refused (the production project: pass --production to check it on purpose)')
    expect(out).not.toContain(PRODUCTION_SUPABASE_REF)
    expect(handshake).not.toHaveBeenCalled()
    expect(driver).not.toHaveBeenCalled()
    expectNoSecrets(out)
  })

  it('checks the production project only with an explicit --production, still read-only, and never prints its ref', async () => {
    const url = URL_VF.replace(`tenant_app_login.${REF}`, `tenant_app_login.${PRODUCTION_SUPABASE_REF}`)
    const { result, out, driver, fake } = await run({ url, production: true })
    expect(result).toEqual({ pass: true, code: 'PASS' })
    expect(out).toMatch(/^url {10}ok \(sslmode=verify-full; the production project, by --production\)$/m)
    expect(out).not.toContain(PRODUCTION_SUPABASE_REF)
    expect(driver).toHaveBeenCalledWith(url, root.pem)
    expect(fake.sent[0]).toBe('SET TRANSACTION READ ONLY')
  })

  it.each([
    ['unreadable as a file', null, 'CA_FILE_UNREADABLE'],
    ['not a PEM', 'not a certificate', 'CA_REFUSED'],
    ['a server certificate', leaf.pem, 'CA_REFUSED'],
  ])('refuses a CA that is %s before any connection', async (_label, ca, code) => {
    const { result, out, handshake, driver } = await run({ ca })
    expect(result).toEqual({ pass: false, code })
    expect(handshake).not.toHaveBeenCalled()
    expect(driver).not.toHaveBeenCalled()
    expectNoSecrets(out)
  })

  it('reads the URL from its own variable, not the app’s', () => {
    expect(CANARY_URL_VAR).toBe('TENANT_DB_CANARY_URL')
  })
})

describe('realDeps.driver: the app’s driver, under verify-full, one connection', () => {
  beforeEach(() => {
    pg.options.length = 0
  })

  it('hands postgres.js the checked parts, the CA alone, rejectUnauthorized, the host name and application_name', async () => {
    const driver = await realDeps.driver(URL_VF, root.pem)
    await driver.end()
    expect(pg.options).toHaveLength(1)
    expect(pg.options[0]).toMatchObject({
      host: HOST,
      port: 6543,
      max: 1,
      ssl: { ca: root.pem, rejectUnauthorized: true, servername: HOST, minVersion: 'TLSv1.2' },
      connection: { application_name: 'stellr-tenantdb' },
    })
  })

  it('refuses a URL that is not verify-full, whatever the caller passes', async () => {
    await expect(realDeps.driver(URL_VF.replace('verify-full', 'require'), root.pem)).rejects.toThrow(/sslmode=verify-full/)
    expect(pg.options).toEqual([])
  })
})

// A local stand-in for the pooler: answers the SSLRequest, then speaks TLS with `cert`.
interface StandIn {
  port: number
  /** The bytes received before TLS, and whether any application data arrived after it. */
  preTls: Buffer[]
  appData: boolean
  close(): Promise<void>
}

async function standIn(cert: Made | 'refuse-tls'): Promise<StandIn> {
  const sockets = new Set<Socket>()
  const state = { preTls: [] as Buffer[], appData: false }
  const listener = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('data', (chunk) => {
      state.preTls.push(chunk)
      if (cert === 'refuse-tls') {
        socket.write('N')
        return
      }
      socket.write('S')
      const tls = new TLSSocket(socket, { isServer: true, key: cert.keyPem, cert: cert.pem })
      tls.on('error', () => {})
      tls.on('data', () => (state.appData = true))
    })
  })
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve))
  const { port } = listener.address() as AddressInfo
  return {
    port,
    get preTls() {
      return state.preTls
    },
    get appData() {
      return state.appData
    },
    close: async () => {
      for (const s of sockets) s.destroy()
      await new Promise((resolve) => listener.close(resolve))
    },
  }
}

describe('diagnosticHandshake: a real handshake against a local stand-in', () => {
  let server: StandIn | null = null
  afterEach(async () => {
    await server?.close()
    server = null
  })

  it('verifies a chain to the CA with the right name, and prints the chain', async () => {
    server = await standIn(leaf)
    const report = await diagnosticHandshake({ host: '127.0.0.1', port: server.port, servername: NAME }, root.pem)
    expect(report.outcome).toBe('TLS_VERIFIED')
    expect(report.protocol).toMatch(/^TLSv1\.[23]$/)
    expect(report.chain[0]).toMatchObject({ subject: `CN=${NAME}`, issuer: 'CN=canary-test-root', san: `DNS:${NAME}` })
    expect(report.chain[0].sha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
    // It sent Postgres's SSLRequest and nothing else: no startup message, no user, no password.
    await new Promise((r) => setTimeout(r, 50))
    expect(Buffer.concat(server.preTls)).toEqual(Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f]))
    expect(server.appData).toBe(false)
  })

  it('reports a chain that does not reach the CA, and still prints what was presented', async () => {
    server = await standIn(fromOtherRoot)
    const report = await diagnosticHandshake({ host: '127.0.0.1', port: server.port, servername: NAME }, root.pem)
    expect(report.outcome).toMatch(/^TLS_CHAIN_(UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|CERT_SIGNATURE_FAILURE)$/)
    expect(report.chain[0]).toMatchObject({ subject: `CN=${NAME}`, issuer: 'CN=canary-other-root' })
    expect(server.appData).toBe(false)
  })

  it('reports a certificate for another name', async () => {
    server = await standIn(leaf)
    const report = await diagnosticHandshake({ host: '127.0.0.1', port: server.port, servername: 'other.canary-test.example' }, root.pem)
    expect(report.outcome).toBe('TLS_NAME_MISMATCH')
  })

  it('reports a server that will not speak TLS', async () => {
    server = await standIn('refuse-tls')
    const report = await diagnosticHandshake({ host: '127.0.0.1', port: server.port, servername: NAME }, root.pem)
    expect(report).toEqual({ outcome: 'TLS_NOT_OFFERED', protocol: null, chain: [] })
  })

  it('reports a refused connection by its code', async () => {
    const closed = await standIn(leaf)
    const port = closed.port
    await closed.close()
    const report = await diagnosticHandshake({ host: '127.0.0.1', port, servername: NAME }, root.pem)
    expect(report.outcome).toBe('CONNECT_FAILED_ECONNREFUSED')
  })
})

describe('small parts', () => {
  it('safeCode and codeOf keep codes and drop anything else', () => {
    expect(safeCode('ERR_TLS_CERT_ALTNAME_INVALID')).toBe('ERR_TLS_CERT_ALTNAME_INVALID')
    expect(safeCode('connect ECONNREFUSED 10.0.0.1:6543')).toBe('UNKNOWN')
    expect(codeOf(Object.assign(new Error('x'), { code: '28P01' }))).toBe('28P01')
    expect(codeOf(new TypeError('a message with a host in it'))).toBe('TYPEERROR')
    expect(codeOf('a string')).toBe('UNKNOWN')
  })

  it('parseArgs takes --ca, an optional --label and an optional --production, and nothing else (no URL on the command line)', () => {
    expect(parseArgs(['--ca', 'a.pem'])).toEqual({ caPath: 'a.pem', label: '-', production: false })
    expect(parseArgs(['--ca', 'a.pem', '--label', 'B'])).toEqual({ caPath: 'a.pem', label: 'B', production: false })
    expect(parseArgs(['--ca', 'a.pem', '--production'])).toEqual({ caPath: 'a.pem', label: '-', production: true })
    expect(parseArgs(['--production'])).toBeNull()
    expect(parseArgs([])).toBeNull()
    expect(parseArgs(['--label', 'A'])).toBeNull()
    expect(parseArgs(['--ca', 'a.pem', '--url', URL_VF])).toBeNull()
    expect(parseArgs(['--ca', 'a.pem', URL_VF])).toBeNull()
  })

  it('pins Stellr as the tenant it checks', () => {
    expect(STELLR_TENANT_ID).toBe('00000000-0000-4000-8000-000000000001')
  })
})

describe('the canary stays a script', () => {
  const SKIP = new Set(['node_modules', '.next', '.git', 'coverage', 'storybook-static', 'dist', 'out', '.vercel', 'playwright-report', 'test-results', '.stryker-tmp', 'reports', '.claude'])

  function sources(dir: string): string[] {
    const out: string[] = []
    const walk = (p: string) => {
      const st = statSync(p)
      if (st.isDirectory()) {
        if (SKIP.has(p.split('/').pop() as string)) return
        for (const f of readdirSync(p)) walk(join(p, f))
      } else if (/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(p)) out.push(p)
    }
    walk(dir)
    return out
  }

  it('nothing under lib/, app/, components/ or packages/, nor proxy.ts, imports it', { timeout: 30_000 }, () => {
    const shipped = [...sources('lib'), ...sources('app'), ...sources('components'), ...sources('packages'), 'proxy.ts']
    expect(shipped.length).toBeGreaterThan(300)
    const importers = shipped.filter((p) => {
      const src = readFileSync(p, 'utf8')
      return src.includes('tenant-db-canary') && runtimeImports(p, src).some((s) => /tenant-db-canary/.test(s))
    })
    expect(importers).toEqual([])
  })

  it('its diagnostic handshake (the only unverified TLS in the repo) lives in this script alone', { timeout: 30_000 }, () => {
    const all = [...sources('lib'), ...sources('app'), ...sources('components'), ...sources('packages'), ...sources('scripts'), 'proxy.ts']
    const loose = all.filter((p) => !/\.test\.tsx?$/.test(p) && /rejectUnauthorized:\s*false/.test(readFileSync(p, 'utf8')))
    expect(loose).toEqual(['scripts/tenant-db-canary.ts'])
  })
})
