// Test certificates made per run from keys generated per run: an EC P-256 root
// CA, or a server certificate for one DNS name or IPv4 address signed by it. No
// key material is committed. Shared by lib/tenancy/driver-tls.test.ts and
// scripts/tenant-db-canary.test.ts (moved here unchanged in S5 wave 7, O3).
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'

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

export interface Made {
  cn: string
  pem: string
  keyPem: string
  key: KeyObject
  keyId: Buffer
}

/** A CA (self-signed) when `issuer` is absent; otherwise a server certificate for `san`, signed by `issuer`. */
export function makeCert(cn: string, opts: { issuer?: Made; san?: { dns: string } | { ip: string } } = {}): Made {
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
