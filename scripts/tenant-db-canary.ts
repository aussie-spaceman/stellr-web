/**
 * The pooler TLS canary (S5 wave 7, O3; step P6 of the wave 7 plan).
 *
 * The owner runs this on their own machine against the dev pooler, before
 * TENANT_DB_ENABLED is set anywhere. It answers one question: does tenantDb's
 * driver, with sslmode=verify-full and a given root CA, reach the pooler as
 * tenant_app_login, become tenant_app, pin Stellr, and read Stellr's rows?
 * CI cannot show this: its database runs on 127.0.0.1 with no TLS.
 *
 *   read -rs "TENANT_DB_CANARY_URL?Pooler URL: " && export TENANT_DB_CANARY_URL   # zsh; nothing is echoed
 *   npx tsx --conditions=react-server scripts/tenant-db-canary.ts --ca <PEM A file> --label A
 *   npx tsx --conditions=react-server scripts/tenant-db-canary.ts --ca <PEM B file> --label B   # only if A fails
 *   unset TENANT_DB_CANARY_URL
 *
 * The URL is the one TENANT_DATABASE_URL will hold: port 6543, user
 * tenant_app_login.<project-ref>, ending in ?sslmode=verify-full. The canary
 * reads it from TENANT_DB_CANARY_URL, never from the command line (shell
 * history) and never from .env.local. `--conditions=react-server` lets Node load
 * lib/tenancy/driver.ts, which is marked server-only.
 *
 * What it does, in order:
 *   1. Checks the URL and the CA with the driver's own parsers. A local host is
 *      refused: this canary is for the pooler.
 *   2. A diagnostic TLS handshake (this file only): Postgres's SSLRequest, then
 *      TLS against the given CA, then the socket is closed. It sends no user,
 *      password or query. It does not refuse an unverified chain, so that it can
 *      print the chain the pooler presents: each certificate's subject, issuer
 *      and SANs. Its verdict is reported, never acted on.
 *   3. The real check, through the driver and tenantDb exactly as the app runs
 *      them: verify-full (the chain against the CA alone, the name against the
 *      host), SET LOCAL ROLE tenant_app, Stellr pinned. It then reads back
 *      current_user and app_tenant_id(), and counts public.event_companies.
 *
 * PASS needs all of: the connection under verify-full; current_user tenant_app;
 * the tenant read back equal to Stellr's; an event_companies count above 0.
 * Anything else is FAIL with a code. sslmode is never weakened: if no CA
 * verifies, the next step is the owner's decision, not a looser mode.
 *
 * It prints outcome codes, counts and certificate names. It never prints the
 * URL, the password, the host it was given or the PEM. Nothing under lib/ or
 * app/ may import this file (scripts/tenant-db-canary.test.ts).
 *
 * Exit status: 0 PASS, 1 FAIL, 2 a usage error.
 */
import { readFileSync } from 'node:fs'
import { connect as netConnect, type Socket } from 'node:net'
import { checkServerIdentity, connect as tlsConnect, type DetailedPeerCertificate, type PeerCertificate } from 'node:tls'
import { X509Certificate } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { STELLR_TENANT_ID } from '../lib/tenancy/constants'
import type { TenantSqlDriver } from '../lib/tenancy/db'

/** Where the canary reads the pooler URL. Not the app's variable: the owner sets this for one run. */
export const CANARY_URL_VAR = 'TENANT_DB_CANARY_URL'

/** The role tenantDb's transactions must run as. */
const EXPECTED_ROLE = 'tenant_app'

const HANDSHAKE_TIMEOUT_MS = 10_000

/** Postgres's SSLRequest: length 8, then the request code 80877103. */
const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f])

export interface CertSummary {
  subject: string
  issuer: string
  /** The subjectAltName entries, as Node prints them, or '-'. */
  san: string
  sha256: string
}

export interface HandshakeReport {
  /** TLS_VERIFIED, TLS_CHAIN_<reason>, TLS_NAME_MISMATCH, TLS_NOT_OFFERED, TLS_FAILED_<code> or CONNECT_FAILED_<code>. */
  outcome: string
  protocol: string | null
  /** The pooler's certificate first, then each issuer it sent or the CA supplied. */
  chain: CertSummary[]
}

/** Where the diagnostic handshake goes, and the name its certificate is checked against. */
export interface HandshakeTarget {
  host: string
  port: number
  /**
   * The host, when it is a name: sent as SNI, and the name the certificate must
   * carry. Absent for an IPv4 address, which is then checked itself.
   */
  servername?: string
}

/** A driver the canary can close. */
export interface CanaryDriver extends TenantSqlDriver {
  end(): Promise<void>
}

export interface CanaryDeps {
  handshake(target: HandshakeTarget, ca: string): Promise<HandshakeReport>
  /** The driver for the URL and the CA, as the app builds it (createPostgresTenantDriver). */
  driver(url: string, ca: string): Promise<CanaryDriver>
}

export interface CanaryInput {
  url: string | undefined
  /** The PEM file's contents, or null when the file could not be read. */
  ca: string | null
  label: string
}

/** A code safe to print: letters, digits and underscores, upper-cased. Anything else is UNKNOWN. */
export function safeCode(raw: unknown): string {
  if (typeof raw !== 'string') return 'UNKNOWN'
  const code = raw.trim().toUpperCase().replace(/[-.\s]+/g, '_')
  return /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'UNKNOWN'
}

/** The error's code (a SQLSTATE, a Node or postgres.js code), never its message. */
export function codeOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  if (typeof code === 'string') return safeCode(code)
  const name = err instanceof Error ? err.name : ''
  return safeCode(name)
}

/** "CN=…, O=…" from a certificate's subject or issuer, in the order Node gives. */
function names(entity: Record<string, string | string[] | undefined> | undefined): string {
  if (!entity) return '-'
  const parts = Object.entries(entity)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('+') : v}`)
  return parts.length ? parts.join(', ') : '-'
}

/** A peer certificate as the canary prints it. */
export function summarise(cert: PeerCertificate): CertSummary {
  return {
    subject: names(cert.subject as unknown as Record<string, string>),
    issuer: names(cert.issuer as unknown as Record<string, string>),
    san: cert.subjectaltname || '-',
    sha256: cert.fingerprint256 || '-',
  }
}

/** The chain the server sent, leaf first, stopping at a self-signed certificate or a loop. */
export function chainOf(leaf: DetailedPeerCertificate): CertSummary[] {
  const out: CertSummary[] = []
  const seen = new Set<string>()
  let cert: DetailedPeerCertificate | undefined = leaf
  while (cert && Object.keys(cert).length > 0 && !seen.has(cert.fingerprint256)) {
    seen.add(cert.fingerprint256)
    out.push(summarise(cert))
    cert = cert.issuerCertificate
  }
  return out
}

/** "CN=…" lines for each certificate in a PEM bundle, so the owner can see which CA they passed. */
export function caSummaries(pem: string): CertSummary[] {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []
  return blocks.map((block) => {
    const cert = new X509Certificate(block)
    const line = (dn: string) => dn.split('\n').filter(Boolean).join(', ') || '-'
    return { subject: line(cert.subject), issuer: line(cert.issuer), san: cert.subjectAltName || '-', sha256: cert.fingerprint256 }
  })
}

/**
 * The diagnostic handshake: SSLRequest, then TLS against `ca`, then close. No
 * user, password or query is sent. The chain is not refused here, so it can be
 * printed; whether it verified against `ca`, and whether its name matches the
 * host, is the outcome. Never throws.
 */
export function diagnosticHandshake(target: HandshakeTarget, ca: string, timeoutMs = HANDSHAKE_TIMEOUT_MS): Promise<HandshakeReport> {
  return new Promise((resolve) => {
    let done = false
    let raw: Socket | null = null
    const finish = (report: HandshakeReport, ...sockets: (Socket | null)[]) => {
      if (done) return
      done = true
      clearTimeout(timer)
      for (const s of sockets) s?.destroy()
      raw?.destroy()
      resolve(report)
    }
    const timer = setTimeout(() => finish({ outcome: 'CONNECT_FAILED_TIMEOUT', protocol: null, chain: [] }), timeoutMs)
    raw = netConnect({ host: target.host, port: target.port })
    raw.once('error', (err) => finish({ outcome: `CONNECT_FAILED_${codeOf(err)}`, protocol: null, chain: [] }))
    raw.once('connect', () => raw!.write(SSL_REQUEST))
    raw.once('data', (reply) => {
      if (reply[0] !== 0x53 /* 'S' */) {
        finish({ outcome: 'TLS_NOT_OFFERED', protocol: null, chain: [] })
        return
      }
      raw!.removeAllListeners('error')
      const tls = tlsConnect({
        socket: raw!,
        ca,
        ...(target.servername ? { servername: target.servername } : {}),
        minVersion: 'TLSv1.2',
        // Diagnostic only: the verdict below is computed and printed, and the
        // socket is closed. The real connection (step 3) refuses an unverified chain.
        rejectUnauthorized: false,
        checkServerIdentity: () => undefined,
      })
      tls.once('error', (err) => finish({ outcome: `TLS_FAILED_${codeOf(err)}`, protocol: null, chain: [] }, tls))
      tls.once('secureConnect', () => {
        const peer = tls.getPeerCertificate(true)
        const chain = peer && Object.keys(peer).length ? chainOf(peer) : []
        const protocol = tls.getProtocol() ?? null
        let outcome = 'TLS_VERIFIED'
        if (!tls.authorized) {
          const why = tls.authorizationError as unknown
          outcome = `TLS_CHAIN_${safeCode(typeof why === 'string' ? why : (why as { code?: unknown } | null)?.code ?? String(why))}`
        } else if (checkServerIdentity(target.servername ?? target.host, peer)) {
          outcome = 'TLS_NAME_MISMATCH'
        }
        finish({ outcome, protocol, chain }, tls)
      })
    })
  })
}

/** What the canary found; `pass` only when every check holds. */
export interface CanaryResult {
  pass: boolean
  /** PASS, or the first failing check's code. */
  code: string
}

/**
 * The canary. Prints through `print`, never the URL, the password, the host or
 * the PEM. The driver module loads here, so the URL and CA checks are the
 * driver's own.
 */
export async function runCanary(input: CanaryInput, deps: CanaryDeps, print: (line: string) => void): Promise<CanaryResult> {
  const { parseTenantCaCert, parseTenantDatabaseUrl, tenantTlsOptions, TenantDbConfigError } = await import('../lib/tenancy/driver')
  const { tenantDb } = await import('../lib/tenancy/db')
  const reason = (err: unknown) => (err instanceof TenantDbConfigError ? err.reason : 'refused')
  const fail = (code: string): CanaryResult => {
    print(`RESULT       FAIL ${code}`)
    return { pass: false, code }
  }

  print(`tenant-db-canary, CA ${input.label}`)

  // 1. The URL and the CA, by the driver's rules.
  let parsed: ReturnType<typeof parseTenantDatabaseUrl>
  try {
    parsed = parseTenantDatabaseUrl(input.url)
  } catch (err) {
    print(`url          refused (${reason(err)})`)
    return fail('URL_REFUSED')
  }
  if (parsed.local) {
    print('url          refused (a local host: the canary is for the pooler)')
    return fail('URL_LOCAL')
  }
  print(`url          ok (sslmode=${parsed.sslmode})`)
  if (input.ca === null) {
    print('ca           the file could not be read')
    return fail('CA_FILE_UNREADABLE')
  }
  let pem: string
  try {
    pem = parseTenantCaCert(input.ca)
  } catch (err) {
    print(`ca           refused (${reason(err)})`)
    return fail('CA_REFUSED')
  }
  caSummaries(pem).forEach((c, i) => {
    print(`ca[${i}]        subject: ${c.subject}`)
    print(`             sha256:  ${c.sha256}`)
  })
  const tls = tenantTlsOptions(parsed, pem)
  if (!tls || tls.rejectUnauthorized !== true) return fail('TLS_OPTIONS')

  // 2. The diagnostic handshake: what the pooler presents.
  const target: HandshakeTarget = { host: parsed.host, port: parsed.port, ...(tls.servername ? { servername: tls.servername } : {}) }
  const hs = await deps.handshake(target, pem)
  print(`handshake    ${hs.outcome}${hs.protocol ? ` (${hs.protocol})` : ''}`)
  hs.chain.forEach((c, i) => {
    print(`cert[${i}]      subject: ${c.subject}`)
    print(`             issuer:  ${c.issuer}`)
    print(`             SANs:    ${c.san}`)
    print(`             sha256:  ${c.sha256}`)
  })

  // 3. The real thing: the app's driver under verify-full, through tenantDb.
  let driver: CanaryDriver
  try {
    driver = await deps.driver(input.url as string, pem)
  } catch (err) {
    print(`verify-full  refused (${reason(err)})`)
    return fail('DRIVER_REFUSED')
  }
  let found: { role: unknown; tenant: unknown; companies: unknown }
  try {
    found = await tenantDb(STELLR_TENANT_ID, { driver }).transaction(async (q) => {
      const [pin] = await q.sql<{ role: unknown; tenant: unknown }>`SELECT current_user AS role, public.app_tenant_id()::text AS tenant`
      const [count] = await q.sql<{ n: unknown }>`SELECT count(*)::int AS n FROM public.event_companies`
      return { role: pin?.role, tenant: pin?.tenant, companies: count?.n }
    })
  } catch (err) {
    const code = codeOf(err)
    print(`verify-full  failed (${code})`)
    return fail(`CONNECT_${code}`)
  } finally {
    await driver.end().catch(() => {})
  }
  print('verify-full  ok')

  const roleOk = found.role === EXPECTED_ROLE
  print(`role         ${roleOk ? `${EXPECTED_ROLE} (ok)` : 'not tenant_app'}`)
  if (!roleOk) return fail('ROLE_NOT_TENANT_APP')
  const tenantOk = found.tenant === STELLR_TENANT_ID
  print(`tenant       ${tenantOk ? "Stellr's (ok)" : "not Stellr's"}`)
  if (!tenantOk) return fail('TENANT_NOT_STELLR')
  const companies = typeof found.companies === 'number' ? found.companies : Number(found.companies)
  print(`companies    ${Number.isFinite(companies) ? companies : 'unreadable'}${companies > 0 ? ' (ok)' : ''}`)
  if (!(companies > 0)) return fail('NO_EVENT_COMPANIES')

  print('RESULT       PASS')
  return { pass: true, code: 'PASS' }
}

/** The real dependencies: the diagnostic handshake above, and the app's driver with one connection. */
export const realDeps: CanaryDeps = {
  handshake: (target, ca) => diagnosticHandshake(target, ca),
  driver: async (url, ca) => {
    const { createPostgresTenantDriver } = await import('../lib/tenancy/driver')
    return createPostgresTenantDriver(url, { caCert: ca, max: 1 })
  },
}

/** `--ca <file>` and an optional `--label <name>`. Null on a usage error. */
export function parseArgs(argv: readonly string[]): { caPath: string; label: string } | null {
  let caPath: string | null = null
  let label = '-'
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--ca' && argv[i + 1]) caPath = argv[++i]
    else if (arg === '--label' && argv[i + 1] && /^[A-Za-z0-9_-]{1,20}$/.test(argv[i + 1])) label = argv[++i]
    else return null
  }
  return caPath ? { caPath, label } : null
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  if (!args) {
    console.error('Usage: npx tsx --conditions=react-server scripts/tenant-db-canary.ts --ca <PEM file> [--label A]')
    console.error(`The pooler URL is read from ${CANARY_URL_VAR}.`)
    return 2
  }
  let ca: string | null
  try {
    ca = readFileSync(args.caPath, 'utf8')
  } catch {
    ca = null
  }
  try {
    const result = await runCanary({ url: process.env[CANARY_URL_VAR], ca, label: args.label }, realDeps, (line) => console.log(line))
    return result.pass ? 0 : 1
  } catch (err) {
    // The driver is marked server-only; plain Node refuses to load it.
    if (err instanceof Error && /Client Component|server-only/i.test(err.message)) {
      console.error('Run it with: npx tsx --conditions=react-server scripts/tenant-db-canary.ts …')
      return 2
    }
    console.log(`RESULT       FAIL ${codeOf(err)}`)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code))
}
