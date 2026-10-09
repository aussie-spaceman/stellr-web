// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import forge from 'node-forge'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { extractSignature } from '@signpdf/utils'
import { loadSealIdentity, parseTimestampResponse, sealPdf, timestampRequest, tsaClient, type SealIdentity } from './seal'

const { asn1 } = forge
const seq = (v: forge.asn1.Asn1[]) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, v)
const set = (v: forge.asn1.Asn1[]) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, v)
const oid = (o: string) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(o).getBytes())
const octets = (b: string) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, b)
const int = (b: string) => asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, b)
const ctx = (tag: number, v: forge.asn1.Asn1[]) => asn1.create(asn1.Class.CONTEXT_SPECIFIC, tag, true, v)
const sha256 = (b: string) => forge.md.sha256.create().update(b).digest().getBytes()

let identity: SealIdentity
let p12b64: string

beforeAll(() => {
  // A throwaway self-signed certificate: fine for structure, refused in production.
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 })
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01ab'
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z')
  cert.validity.notAfter = new Date('2030-01-01T00:00:00Z')
  const name = [{ name: 'commonName', value: 'Stellr Education test seal' }, { name: 'organizationName', value: 'Stellr Education' }]
  cert.setSubject(name)
  cert.setIssuer(name)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  identity = { key: keys.privateKey, chain: [cert] }
  p12b64 = forge.util.encode64(asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'pw', { algorithm: '3des' })).getBytes())
}, 60_000)

afterEach(() => vi.unstubAllEnvs())

async function agreementPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  doc.addPage([612, 792]).drawText('Parental Consent Form — signed', { x: 54, y: 740, size: 14, font })
  return doc.save()
}

/** Checks a sealed PDF the way a reader would: digest of the signed bytes, then the RSA signature. */
// @signpdf/utils extractSignature strips trailing 0x00 padding from the
// /Contents placeholder — but a PKCS#7 DER whose last byte(s) are legitimately
// 0x00 (roughly a third of random test keys) gets trimmed too, leaving
// asn1.fromDer one or more bytes short ("Too few bytes to read ASN.1 value").
// DER is self-delimiting, so re-pad to the length the outer header declares.
// Production is unaffected: real PAdES verifiers parse /Contents by DER length,
// they do not strip trailing zeros.
function derTotalLength(buf: Buffer): number {
  const lenByte = buf[1]
  if (lenByte < 0x80) return 2 + lenByte
  const n = lenByte & 0x7f
  let len = 0
  for (let i = 0; i < n; i++) len = (len << 8) | buf[2 + i]
  return 2 + n + len
}

function verify(sealed: Uint8Array) {
  const { signature: trimmed, signedData } = extractSignature(Buffer.from(sealed))
  const declared = derTotalLength(trimmed)
  const signature =
    declared > trimmed.length ? Buffer.concat([trimmed, Buffer.alloc(declared - trimmed.length)]) : trimmed
  const content = asn1.fromDer(signature.toString('binary'))
  const signedDataAsn = ((content.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0]
  const fields = signedDataAsn.value as forge.asn1.Asn1[]
  const signerInfo = ((fields[4].value as forge.asn1.Asn1[])[0]).value as forge.asn1.Asn1[]
  const signedAttrs = signerInfo[3].value as forge.asn1.Asn1[]
  const attr = (o: string) => signedAttrs.find((a) => asn1.derToOid((a.value as forge.asn1.Asn1[])[0].value as string) === o)
  const digest = ((attr('1.2.840.113549.1.9.4')!.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0].value as string
  const md = forge.md.sha256.create().update(asn1.toDer(set(signedAttrs)).getBytes())
  const valid = (identity.chain[0].publicKey as forge.pki.rsa.PublicKey).verify(md.digest().getBytes(), signerInfo[5].value as string)
  return {
    digestMatches: digest === sha256(signedData.toString('binary')),
    signatureValid: valid,
    hasSigningCertificate: !!attr('1.2.840.113549.1.9.16.2.47'),
    hasSigningTimeAttribute: !!attr('1.2.840.113549.1.9.5'),
    unsignedAttrs: signerInfo.length > 6 ? (signerInfo[6].value as forge.asn1.Asn1[]).map((a) => asn1.derToOid((a.value as forge.asn1.Asn1[])[0].value as string)) : [],
  }
}

/** A minimal granted TimeStampResp for `imprint`, shaped like a real token. */
function tsaResponse(imprint: string, at = new Date('2026-10-02T17:00:00Z')): string {
  const tstInfo = seq([
    int(String.fromCharCode(1)), oid('1.2.3.4'),
    seq([seq([oid('2.16.840.1.101.3.4.2.1')]), octets(imprint)]),
    int(String.fromCharCode(7)),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.GENERALIZEDTIME, false, asn1.dateToGeneralizedTime(at)),
  ])
  const token = seq([oid('1.2.840.113549.1.7.2'), ctx(0, [seq([
    int(String.fromCharCode(3)), set([]),
    seq([oid('1.2.840.113549.1.9.16.1.4'), ctx(0, [octets(asn1.toDer(tstInfo).getBytes())])]),
  ])])])
  return asn1.toDer(seq([seq([int(String.fromCharCode(0))]), token])).getBytes()
}

describe('sealPdf', () => {
  it('signs the agreement so the bytes and the signature both check out', async () => {
    const sealed = await sealPdf(await agreementPdf(), { reason: 'Agreement completed', at: new Date('2026-10-02T17:00:00Z'), identity, tsa: null })
    expect(sealed.kind).toBe('pades')
    expect(Buffer.from(sealed.bytes).toString('latin1')).toContain('/SubFilter /ETSI.CAdES.detached')
    expect(verify(sealed.bytes)).toEqual({
      digestMatches: true, signatureValid: true, hasSigningCertificate: true, hasSigningTimeAttribute: false, unsignedAttrs: [],
    })
    expect(sealed.certificate.subject).toContain('Stellr Education test seal')
    // Still an ordinary PDF.
    expect((await PDFDocument.load(sealed.bytes)).getPageCount()).toBe(1)
  })

  it('detects a single changed byte', async () => {
    const sealed = await sealPdf(await agreementPdf(), { reason: 'r', at: new Date(), identity, tsa: null })
    const tampered = sealed.bytes.slice()
    // A byte inside the first signed range (page text is compressed, so not searchable).
    const { ByteRange } = extractSignature(Buffer.from(tampered))
    const i = Math.floor(ByteRange[1] / 2)
    tampered[i] = tampered[i] ^ 0x01
    expect(verify(sealed.bytes).digestMatches).toBe(true)
    expect(verify(tampered).digestMatches).toBe(false)
  })

  it('adds a trusted timestamp for the signature, sending the service only a hash', async () => {
    const bodies: Buffer[] = []
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = Buffer.from(init?.body as Buffer)
      bodies.push(body)
      const req = asn1.fromDer(body.toString('binary')).value as forge.asn1.Asn1[]
      const imprint = (req[1].value as forge.asn1.Asn1[])[1].value as string
      return new Response(Buffer.from(tsaResponse(imprint), 'binary'), { status: 200 })
    })
    const sealed = await sealPdf(await agreementPdf(), { reason: 'r', at: new Date(), identity, tsa: tsaClient('https://tsa.test', fetcher as never) })
    expect(sealed.kind).toBe('pades-t')
    expect(sealed.timestampedAt).toBe('2026-10-02T17:00:00.000Z')
    expect(verify(sealed.bytes).unsignedAttrs).toEqual(['1.2.840.113549.1.9.16.2.14'])
    expect(bodies[0].length).toBeLessThan(100) // a hash and a nonce, not the document
  })

  it('seals without a timestamp when the service fails or answers for another hash', async () => {
    const down = tsaClient('https://tsa.test', (async () => new Response('', { status: 503 })) as never)
    expect((await sealPdf(await agreementPdf(), { reason: 'r', at: new Date(), identity, tsa: down })).kind).toBe('pades')
    const wrong = tsaClient('https://tsa.test', (async () => new Response(Buffer.from(tsaResponse('x'.repeat(32)), 'binary'))) as never)
    const sealed = await sealPdf(await agreementPdf(), { reason: 'r', at: new Date(), identity, tsa: wrong })
    expect(sealed.kind).toBe('pades')
    expect(verify(sealed.bytes).signatureValid).toBe(true)
  })
})

describe('timestamps', () => {
  it('builds a request and refuses a token for a different hash', () => {
    const imprint = sha256('signature')
    const req = asn1.fromDer(timestampRequest(imprint, '\x41\x02')).value as forge.asn1.Asn1[]
    expect(((req[1].value as forge.asn1.Asn1[])[1]).value).toBe(imprint)
    expect(parseTimestampResponse(tsaResponse(imprint), imprint).genTime.toISOString()).toBe('2026-10-02T17:00:00.000Z')
    expect(() => parseTimestampResponse(tsaResponse(imprint), sha256('other'))).toThrow(/different hash/)
  })
})

describe('loadSealIdentity', () => {
  it('reads the certificate file, and refuses a self-signed one in production', () => {
    vi.stubEnv('ESIGN_SEAL_P12', p12b64)
    vi.stubEnv('ESIGN_SEAL_P12_PASSWORD', 'pw')
    expect(loadSealIdentity().chain[0].subject.getField('CN').value).toBe('Stellr Education test seal')
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.stellreducation.org')
    expect(() => loadSealIdentity()).toThrow(/self-signed/)
  })
})
