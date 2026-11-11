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
// The certificates are made here, per run, from keys generated here (a minimal
// DER writer below): no key material is committed. The server is a stand-in
// that answers postgres.js's SSLRequest with 'S' and then speaks TLS, which is
// all the handshake needs.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'
import { createServer, type AddressInfo, type Socket } from 'node:net'
import { TLSSocket } from 'node:tls'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'
import { parseTenantCaCert, parseTenantDatabaseUrl, tenantTlsOptions, type TenantTlsOptions } from './driver'

// --- a minimal DER writer, enough for an EC P-256 certificate ---------------

function derLength(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n])
  if (n < 0x100) return Buffer.from([0x81, n])
  return Buffer.from([0x82, n >> 8, n & 0xff])
}
function tlv(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts)
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body])
}
const seq = (...parts: Buffer[]) => tlv(0x30, ...parts)
function oid(dotted: string): Buffer {
  const [a, b, ...rest] = dotted.split('.').map(Number)
  const bytes = [40 * a + b]
  for (let n of rest) {
    const arc = [n & 0x7f]
    n = Math.floor(n / 128)
    while (n > 0) {
      arc.unshift((n & 0x7f) | 0x80)
      n = Math.floor(n / 128)
    }
    bytes.push(...arc)
  }
  return tlv(0x06, Buffer.from(bytes))
}
const utcTime = (d: Date) => tlv(0x17, Buffer.from(`${d.toISOString().replace(/[-:T]/g, '').slice(2, 14)}Z`))
const commonName = (cn: string) => seq(tlv(0x31, seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(cn)))))
const extension = (id: string, critical: boolean, value: Buffer) =>
  seq(oid(id), ...(critical ? [tlv(0x01, Buffer.from([0xff]))] : []), tlv(0x04, value))
const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'))

interface Made {
  cn: string
  pem: string
  keyPem: string
  key: KeyObject
  keyId: Buffer
}

/** A CA (self-signed) when `issuer` is absent; otherwise a server certificate for `san`, signed by `issuer`. */
function makeCert(cn: string, opts: { issuer?: Made; san?: { dns: string } | { ip: string } } = {}): Made {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  const keyId = createHash('sha1').update(spki).digest()
  const serial = randomBytes(8)
  serial[0] = (serial[0] & 0x7f) | 0x01
  const now = Date.now()
  const isCa = !opts.issuer
  const extensions = isCa
    ? [
        extension('2.5.29.19', true, seq(tlv(0x01, Buffer.from([0xff])))), // basicConstraints CA:TRUE
        extension('2.5.29.15', true, tlv(0x03, Buffer.from([0x01, 0x06]))), // keyCertSign, cRLSign
        extension('2.5.29.14', false, tlv(0x04, keyId)),
      ]
    : [
        extension('2.5.29.19', true, seq()), // CA:FALSE
        extension('2.5.29.15', true, tlv(0x03, Buffer.from([0x07, 0x80]))), // digitalSignature
        extension(
          '2.5.29.17',
          false,
          seq(
            opts.san && 'dns' in opts.san
              ? tlv(0x82, Buffer.from(opts.san.dns))
              : tlv(0x87, Buffer.from((opts.san as { ip: string }).ip.split('.').map(Number))),
          ),
        ),
        extension('2.5.29.14', false, tlv(0x04, keyId)),
        extension('2.5.29.35', false, seq(tlv(0x80, opts.issuer!.keyId))),
      ]
  const tbs = seq(
    tlv(0xa0, tlv(0x02, Buffer.from([0x02]))), // v3
    tlv(0x02, serial),
    ECDSA_SHA256,
    commonName(opts.issuer ? opts.issuer.cn : cn),
    seq(utcTime(new Date(now - 86_400_000)), utcTime(new Date(now + 86_400_000))),
    commonName(cn),
    spki,
    tlv(0xa3, seq(...extensions)),
  )
  const signature = sign('sha256', tbs, opts.issuer ? opts.issuer.key : privateKey)
  const der = seq(tbs, ECDSA_SHA256, tlv(0x03, Buffer.from([0x00]), signature))
  const pem = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`
  return { cn, pem, keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, key: privateKey, keyId }
}

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
