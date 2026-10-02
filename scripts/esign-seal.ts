/**
 * Certificate seals, by hand.
 *
 *   npx tsx scripts/esign-seal.ts verify <file.pdf>
 *     Checks a sealed agreement anyone sends you: that its bytes are exactly
 *     what was sealed, which certificate sealed it, and the trusted timestamp.
 *     Reads the file only; touches no database.
 *
 *   npx tsx scripts/esign-seal.ts apply <agreement row id>     (DEV project only)
 *     Seals one stored Stellr signing agreement now, as the daily run would.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import type forge from 'node-forge'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const DEV_PROJECT_REF = 'xvxlhbxtiwxpopoqjygm'

async function verify(file: string) {
  const forge = (await import('node-forge')).default
  const { extractSignature } = await import('@signpdf/utils')
  const { asn1 } = forge
  const pdf = fs.readFileSync(path.resolve(file))
  // The seal is the last signature in the file; an earlier one would be some
  // other party's (a source document's own signature).
  const count = pdf.toString('latin1').split('/ByteRange [').length - 1
  if (!count) throw new Error('This PDF has no digital signature')
  const { signature, signedData } = extractSignature(pdf, count)
  const signed = (((asn1.fromDer(signature).value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0].value as forge.asn1.Asn1[])
  const certs = (signed[3].value as forge.asn1.Asn1[]).map((c) => forge.pki.certificateFromAsn1(c))
  const signerInfo = ((signed[4].value as forge.asn1.Asn1[])[0]).value as forge.asn1.Asn1[]
  const attrs = signerInfo[3].value as forge.asn1.Asn1[]
  const find = (list: forge.asn1.Asn1[], oid: string) => list.find((a) => asn1.derToOid((a.value as forge.asn1.Asn1[])[0].value as string) === oid)
  const digest = ((find(attrs, '1.2.840.113549.1.9.4')!.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0].value as string
  const actual = forge.md.sha256.create().update(signedData.toString('binary')).digest().getBytes()
  const set = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, attrs)
  const md = forge.md.sha256.create().update(asn1.toDer(set).getBytes())
  const leaf = certs[0]
  const sigOk = (leaf.publicKey as forge.pki.rsa.PublicKey).verify(md.digest().getBytes(), signerInfo[5].value as string)
  let stamp = 'none'
  if (signerInfo[6]) {
    const token = find(signerInfo[6].value as forge.asn1.Asn1[], '1.2.840.113549.1.9.16.2.14')
    if (token) {
      const content = ((token.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0]
      const sd = ((content.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0]
      const encap = (sd.value as forge.asn1.Asn1[])[2]
      const tst = asn1.fromDer((((encap.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0]).value as string).value as forge.asn1.Asn1[]
      const tsaCerts = ((sd.value as forge.asn1.Asn1[]).find((v) => v.tagClass === asn1.Class.CONTEXT_SPECIFIC && v.type === 0)?.value as forge.asn1.Asn1[] | undefined) ?? []
      const tsaName = tsaCerts.length ? forge.pki.certificateFromAsn1(tsaCerts[0]).subject.getField('CN')?.value : 'unknown'
      stamp = `${asn1.generalizedTimeToDate(tst[4].value as string).toISOString()} from ${tsaName}`
    }
  }
  const name = (n: forge.pki.Certificate['subject']) => n.attributes.map((a) => `${a.shortName ?? a.name}=${a.value}`).join(', ')
  console.log(`Bytes unchanged since sealing: ${digest === actual ? 'YES' : 'NO, the file has been altered'}`)
  console.log(`Seal signature valid:          ${sigOk ? 'YES' : 'NO'}`)
  console.log(`Sealed by:                     ${name(leaf.subject)}`)
  console.log(`Certificate issued by:         ${name(leaf.issuer)}${leaf.isIssuer(leaf) ? '  (self-signed: dev only, proves nothing to others)' : ''}`)
  console.log(`Trusted timestamp:             ${stamp}`)
  if (digest !== actual || !sigOk) process.exit(1)
}

async function apply(rowId: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (!url.includes(DEV_PROJECT_REF)) throw new Error(`Refusing: apply runs against the dev project only (${DEV_PROJECT_REF})`)
  const { createClient } = await import('@supabase/supabase-js')
  const { applyCertificateSeal } = await import('../lib/esign/native/certificate-seal')
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY as string, { auth: { persistSession: false } })
  console.log(await applyCertificateSeal(db, rowId))
}

const [cmd, arg] = process.argv.slice(2)
const run = cmd === 'verify' && arg ? verify(arg) : cmd === 'apply' && arg ? apply(arg) : Promise.reject(new Error('Usage: esign-seal.ts verify <file.pdf> | apply <row id>'))
run.catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
