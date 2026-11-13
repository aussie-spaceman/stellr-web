// @vitest-environment node
//
// A real TLS handshake through the real postgres.js, with the exact `ssl`
// object the driver builds. driver.test.ts checks that object against a stand-in
// for postgres.js, and CI's tenant-db job runs on 127.0.0.1 without TLS, so
// this file is where the certificate check itself is exercised: the right CA and
// name connect; another CA, another name or another address do not. If a
// postgres.js upgrade stopped passing the object through to Node's TLS (or
// relaxed it), the refusals below would start connecting.
//
// The certificates are made per run, from keys generated per run (a minimal
// DER writer in test/helpers/test-certs.ts): no key material is committed. The
// server is a stand-in that answers postgres.js's SSLRequest with 'S' and then
// speaks TLS, which is all the handshake needs.
import { createServer, type AddressInfo, type Socket } from 'node:net'
import { TLSSocket } from 'node:tls'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'
import { makeCert, type Made } from '../../test/helpers/test-certs'
import { parseTenantCaCert, parseTenantDatabaseUrl, tenantTlsOptions, type TenantTlsOptions } from './driver'

// --- a stand-in server and one connection attempt through real postgres.js ---

interface Attempt {
  /** The server side completed a TLS handshake. */
  secured: boolean
  /** The error code postgres.js reported for the query. */
  code: string | undefined
}

async function attempt(ssl: TenantTlsOptions | 'require', server: Made): Promise<Attempt> {
  let secured = false
  let markSecured!: () => void
  const securedSeen = new Promise<void>((resolve) => (markSecured = resolve))
  const sockets = new Set<Socket>()
  const listener = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('data', () => {
      // postgres.js's 8-byte SSLRequest: say yes, then speak TLS.
      socket.write('S')
      const tls = new TLSSocket(socket, { isServer: true, key: server.keyPem, cert: server.pem })
      tls.on('error', () => {})
      tls.on('secure', () => {
        secured = true
        markSecured()
        tls.destroy()
      })
    })
  })
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve))
  const { port } = listener.address() as AddressInfo
  const sql = postgres({
    host: '127.0.0.1',
    port,
    user: 'tenant_app_login',
    password: 'pw-not-real',
    database: 'postgres',
    ssl,
    max: 1,
    connect_timeout: 3,
    onnotice: () => {},
  })
  let code: string | undefined
  // The attempt is over when either side has its answer: the server saw a
  // completed handshake, or postgres.js reported an error (a refused
  // certificate). After a completed handshake the stand-in hangs up, and how
  // quickly postgres.js notices a hang-up mid-startup differs by platform (on
  // Linux CI it outlasted the test timeout), so this does not wait for it.
  const query = sql`select 1`.then(
    () => undefined,
    (e: unknown) => {
      code = String((e as { code?: unknown }).code ?? e)
    },
  )
  await Promise.race([query, securedSeen])
  for (const s of sockets) s.destroy()
  await Promise.race([sql.end({ timeout: 0 }).catch(() => {}), new Promise((resolve) => setTimeout(resolve, 1000))])
  await new Promise((resolve) => listener.close(resolve))
  return { secured, code }
}

const NAME = 'db.tenant-test.example'
const tlsFor = (host: string, ca: string) =>
  tenantTlsOptions(parseTenantDatabaseUrl(`postgres://tenant_app_login:pw-not-real@${host}:6543/postgres?sslmode=verify-full`), ca)

const CERT_REFUSED = /UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT|SELF_SIGNED|CERT_SIGNATURE_FAILURE/

describe('the tenant driver ssl object, through real postgres.js and Node TLS', () => {
  const root = makeCert('stellr-test-root')
  const otherRoot = makeCert('stellr-other-root')
  const byName = makeCert(NAME, { issuer: root, san: { dns: NAME } })
  const byUrlAddress = makeCert('url-address', { issuer: root, san: { ip: '10.0.0.7' } })
  const byOtherAddress = makeCert('other-address', { issuer: root, san: { ip: '127.0.0.1' } })
  const byLocalhostName = makeCert('localhost', { issuer: root, san: { dns: 'localhost' } })
  const fromOtherRoot = makeCert(NAME, { issuer: otherRoot, san: { dns: NAME } })

  it('the generated root passes the driver CA check (so the cases below use a CA it would accept)', () => {
    expect(parseTenantCaCert(root.pem)).toBe(root.pem)
  })

  it('connects when the certificate chains to the CA and names the host', async () => {
    const r = await attempt(tlsFor(NAME, root.pem), byName)
    expect(r.secured).toBe(true)
    expect(r.code ?? '').not.toMatch(CERT_REFUSED)
  })

  it('refuses a certificate from another CA', async () => {
    const r = await attempt(tlsFor(NAME, root.pem), fromOtherRoot)
    expect(r.secured).toBe(false)
    expect(r.code).toMatch(CERT_REFUSED)
  })

  it('refuses a certificate for another name', async () => {
    const r = await attempt(tlsFor('other.tenant-test.example', root.pem), byName)
    expect(r.secured).toBe(false)
    expect(r.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID')
  })

  it('for an IPv4 host (no server name sent), checks the URL address against the certificate, not "localhost"', async () => {
    // The stand-in listens on 127.0.0.1; the identity check is against the
    // URL's address. postgres.js gives Node a connected socket with no host,
    // so without `host` in the object Node would check "localhost" instead:
    // a certificate for the right address was refused and one for
    // "localhost" accepted, before this was fixed.
    const ssl = tlsFor('10.0.0.7', root.pem)
    expect(ssl).not.toHaveProperty('servername')
    expect((await attempt(ssl, byUrlAddress)).secured).toBe(true)
    for (const wrongCert of [byOtherAddress, byLocalhostName]) {
      const wrong = await attempt(ssl, wrongCert)
      expect(wrong.secured).toBe(false)
      expect(wrong.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID')
    }
  })

  it('control: the old unchecked mode would have connected to the wrong server, so the refusals above are the check at work', async () => {
    expect((await attempt('require', fromOtherRoot)).secured).toBe(true)
  })
})
