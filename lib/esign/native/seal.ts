import forge from 'node-forge'
import { PDFDocument } from 'pdf-lib'
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib'
import signpdf, { Signer } from '@signpdf/signpdf'
import { SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils'
import { isRealProductionApp } from '@/lib/env-guards'

// The certificate seal (PAdES): Stellr's own digital signature on the finished
// agreement, so any PDF reader can show that the file has not changed since it
// was sealed, and by whom. A trusted timestamp (RFC 3161) proves when. Only a
// hash of the signature leaves Stellr for the timestamp: the timestamp service
// never sees the document.
//
// It adds to the day-one seal (the SHA-256 hash and certificate page), it does
// not replace it: the audit trail and stored hash still stand on their own.
//
// Configuration (Production scope only for the real certificate):
//   ESIGN_SEAL_P12            base64 PKCS#12 holding the seal key and its chain
//   ESIGN_SEAL_P12_PASSWORD   its password
//   ESIGN_TSA_URL             RFC 3161 timestamp service (default DigiCert's; "off" for none)

const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  timeStampToken: '1.2.840.113549.1.9.16.2.14',
  sha256: '2.16.840.1.101.3.4.2.1',
  rsaEncryption: '1.2.840.113549.1.1.1',
}

const DEFAULT_TSA = 'http://timestamp.digicert.com'
/** Room for the signature: our chain plus the timestamp service's token and chain. */
const SIGNATURE_LENGTH = 20_000

const { asn1 } = forge
const seq = (v: forge.asn1.Asn1[]) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, v)
const set = (v: forge.asn1.Asn1[]) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, v)
const oid = (o: string) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(o).getBytes())
const octets = (bytes: string) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, bytes)
const int = (bytes: string) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, bytes)
const nul = () => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, '')
const ctx = (tag: number, v: forge.asn1.Asn1[]) => asn1.create(asn1.Class.CONTEXT_SPECIFIC, tag, true, v)
const sha256 = (bytes: string) => forge.md.sha256.create().update(bytes).digest().getBytes()
const attribute = (type: string, value: forge.asn1.Asn1) => seq([oid(type), set([value])])

export interface SealIdentity {
  key: forge.pki.rsa.PrivateKey
  /** The seal certificate first, then its issuers. */
  chain: forge.pki.Certificate[]
}

export function sealConfigured(): boolean {
  return !!process.env.ESIGN_SEAL_P12
}

/** Reads the seal certificate. Refuses a self-signed one in production: it would prove nothing to anyone else. */
export function loadSealIdentity(): SealIdentity {
  const p12b64 = process.env.ESIGN_SEAL_P12
  if (!p12b64) throw new Error('ESIGN_SEAL_P12 is not set')
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1.fromDer(forge.util.decode64(p12b64)), process.env.ESIGN_SEAL_P12_PASSWORD ?? '')
  const keyBag = (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [])[0]
    ?? (p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? [])[0]
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).map((b) => b.cert).filter(Boolean) as forge.pki.Certificate[]
  if (!keyBag?.key || !certs.length) throw new Error('The seal certificate file has no key or certificate')
  const key = keyBag.key as forge.pki.rsa.PrivateKey
  // The seal certificate is the one whose public key matches the private key.
  const leaf = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n.equals(key.n)) ?? certs[0]
  const chain = [leaf, ...certs.filter((c) => c !== leaf)]
  if (isRealProductionApp() && leaf.isIssuer(leaf)) {
    throw new Error('The seal certificate is self-signed; production needs one issued by a certificate authority')
  }
  return { key, chain }
}

/**
 * A detached CMS signature over `content` (the PDF's signed byte ranges), in
 * the form PAdES baseline signatures use: content type, message digest and the
 * signing certificate as signed attributes, no signing-time attribute (the
 * time is in the PDF), and a timestamp token, when one is had, unsigned.
 */
export async function cmsSign(
  content: string,
  id: SealIdentity,
  timestamp: ((imprint: string) => Promise<forge.asn1.Asn1 | null>) | null,
): Promise<string> {
  const [leaf] = id.chain
  const signedAttrs = [
    attribute(OID.contentType, oid(OID.data)),
    attribute(OID.messageDigest, octets(sha256(content))),
    // ESSCertIDv2 with the default SHA-256: just the certificate's hash.
    attribute(OID.signingCertificateV2, seq([seq([seq([octets(sha256(asn1.toDer(forge.pki.certificateToAsn1(leaf)).getBytes()))])])])),
  ]
  // The signature covers the attributes encoded as a SET (RFC 5652 §5.4).
  const md = forge.md.sha256.create().update(asn1.toDer(set(signedAttrs)).getBytes())
  const signature = id.key.sign(md)

  const signerInfo = [
    int(String.fromCharCode(1)),
    seq([forge.pki.distinguishedNameToAsn1(leaf.issuer), int(forge.util.hexToBytes(leaf.serialNumber))]),
    seq([oid(OID.sha256), nul()]),
    ctx(0, signedAttrs),
    seq([oid(OID.rsaEncryption), nul()]),
    octets(signature),
  ]
  const token = timestamp ? await timestamp(sha256(signature)) : null
  if (token) signerInfo.push(ctx(1, [attribute(OID.timeStampToken, token)]))

  const signedData = seq([
    int(String.fromCharCode(1)),
    set([seq([oid(OID.sha256), nul()])]),
    seq([oid(OID.data)]),
    ctx(0, id.chain.map((c) => forge.pki.certificateToAsn1(c))),
    set([seq(signerInfo)]),
  ])
  return asn1.toDer(seq([oid(OID.signedData), ctx(0, [signedData])])).getBytes()
}

// ── Timestamp (RFC 3161) ─────────────────────────────────────────────────────

export function timestampRequest(imprint: string, nonce: string): string {
  return asn1.toDer(seq([
    int(String.fromCharCode(1)),
    seq([seq([oid(OID.sha256), nul()]), octets(imprint)]),
    int(nonce),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.BOOLEAN, false, String.fromCharCode(0xff)),
  ])).getBytes()
}

export interface TimestampToken {
  token: forge.asn1.Asn1
  /** The time the service vouches for. */
  genTime: Date
}

/**
 * Reads a TimeStampResp: granted, its token, and the token's time. Checks the
 * token is for the hash we sent; anything else is refused.
 */
export function parseTimestampResponse(der: string, imprint: string): TimestampToken {
  const resp = asn1.fromDer(der)
  const parts = resp.value as forge.asn1.Asn1[]
  const statusInfo = parts[0].value as forge.asn1.Asn1[]
  const status = (statusInfo[0].value as string).charCodeAt((statusInfo[0].value as string).length - 1)
  if (status !== 0 && status !== 1) throw new Error(`Timestamp refused (status ${status})`)
  const token = parts[1]
  if (!token) throw new Error('Timestamp response has no token')
  // ContentInfo → [0] SignedData → encapContentInfo → [0] eContent (OCTET STRING of TSTInfo)
  const signedData = ((token.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0]
  const encap = (signedData.value as forge.asn1.Asn1[])[2]
  const eContent = ((encap.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0]
  const tstInfo = asn1.fromDer(eContent.value as string).value as forge.asn1.Asn1[]
  const messageImprint = tstInfo[2].value as forge.asn1.Asn1[]
  if ((messageImprint[1].value as string) !== imprint) throw new Error('Timestamp is for a different hash')
  const genTime = asn1.generalizedTimeToDate(tstInfo[4].value as string)
  return { token, genTime }
}

/** 8 random bytes as a positive, minimally encoded DER INTEGER. */
function positiveNonce(): string {
  const n = forge.random.getBytesSync(8)
  return String.fromCharCode((n.charCodeAt(0) & 0x7f) | 0x40) + n.slice(1)
}

/** Asks the timestamp service to vouch for a hash. Null when it cannot be had: the seal still stands without it. */
export function tsaClient(url = process.env.ESIGN_TSA_URL || DEFAULT_TSA, fetcher: typeof fetch = fetch) {
  let last: TimestampToken | null = null
  const request = async (imprint: string): Promise<forge.asn1.Asn1 | null> => {
    try {
      const res = await fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/timestamp-query' },
        body: Buffer.from(timestampRequest(imprint, positiveNonce()), 'binary'),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      last = parseTimestampResponse(Buffer.from(await res.arrayBuffer()).toString('binary'), imprint)
      return last.token
    } catch (err) {
      console.error('[esign-seal] timestamp unavailable, sealing without one:', err instanceof Error ? err.message : err)
      last = null
      return null
    }
  }
  return { request, last: () => last }
}

// ── Sealing a PDF ────────────────────────────────────────────────────────────

class StellrSigner extends Signer {
  constructor(private id: SealIdentity, private stamp: ((imprint: string) => Promise<forge.asn1.Asn1 | null>) | null) { super() }
  async sign(content: Buffer): Promise<Buffer> {
    return Buffer.from(await cmsSign(content.toString('binary'), this.id, this.stamp), 'binary')
  }
}

export interface SealResult {
  bytes: Uint8Array
  /** 'pades-t' with a trusted timestamp, 'pades' without one. */
  kind: 'pades' | 'pades-t'
  timestampedAt: string | null
  certificate: { subject: string; issuer: string; serial: string; sha256: string }
}

export async function sealPdf(
  pdfBytes: Uint8Array,
  opts: { reason: string; at: Date; identity?: SealIdentity; tsa?: ReturnType<typeof tsaClient> | null },
): Promise<SealResult> {
  const identity = opts.identity ?? loadSealIdentity()
  // ESIGN_TSA_URL=off seals without a timestamp (tests, or a service outage).
  const tsa = opts.tsa === undefined ? (process.env.ESIGN_TSA_URL === 'off' ? null : tsaClient()) : opts.tsa
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false })
  pdflibAddPlaceholder({
    pdfDoc: doc,
    reason: opts.reason,
    name: 'Stellr Education',
    contactInfo: 'privacy@stellreducation.org',
    location: 'Stellr signing',
    signingTime: opts.at,
    signatureLength: SIGNATURE_LENGTH,
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
    appName: 'Stellr signing',
  })
  const prepared = Buffer.from(await doc.save({ useObjectStreams: false }))
  const sealed = await signpdf.sign(prepared, new StellrSigner(identity, tsa ? tsa.request : null), opts.at)
  const stamp = tsa?.last() ?? null
  const leaf = identity.chain[0]
  const cn = (n: forge.pki.Certificate['subject']) => n.attributes.map((a) => `${a.shortName ?? a.name}=${a.value}`).join(', ')
  return {
    bytes: new Uint8Array(sealed),
    kind: stamp ? 'pades-t' : 'pades',
    timestampedAt: stamp?.genTime.toISOString() ?? null,
    certificate: {
      subject: cn(leaf.subject),
      issuer: cn(leaf.issuer),
      serial: leaf.serialNumber,
      sha256: forge.util.bytesToHex(sha256(asn1.toDer(forge.pki.certificateToAsn1(leaf)).getBytes())),
    },
  }
}
