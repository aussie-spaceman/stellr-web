/**
 * Issue a test agreement on Stellr signing, on the DEV project only, and print
 * the first signer's link. For trying the signing page end to end.
 *
 *   npx tsx scripts/esign-dev-issue.ts minor     # parent, then student
 *   npx tsx scripts/esign-dev-issue.ts adult
 *   npx tsx scripts/esign-dev-issue.ts mentor
 *   npx tsx scripts/esign-dev-issue.ts membership [--minor]
 *   npx tsx scripts/esign-dev-issue.ts link <recipient row id>   # a fresh link for a signer
 *
 * Everyone in it is invented. Emails go wherever DEV_EMAIL_SAFELIST routes
 * them (lib/email.ts); nothing reaches a real family.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const DEV_PROJECT_REF = 'xvxlhbxtiwxpopoqjygm'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (!url.includes(DEV_PROJECT_REF)) throw new Error(`Refusing: this only runs against the dev project (${DEV_PROJECT_REF})`)
  if (process.env.NEXT_PUBLIC_APP_ENV !== 'dev') throw new Error('Refusing: NEXT_PUBLIC_APP_ENV must be dev')

  const { createClient } = await import('@supabase/supabase-js')
  const { nativeProvider } = await import('../lib/esign/providers/native')
  const { signNowUrlFor } = await import('../lib/esign/outbox')
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY as string, { auth: { persistSession: false } })

  const [kind, arg] = process.argv.slice(2)
  if (kind === 'link') {
    const { data: r } = await db.from('docusign_envelope_recipients').select('id, token_version, token_expires_at').eq('id', arg).single()
    console.log(signNowUrlFor(r as never).replace(/^https?:\/\/[^/]+/, process.env.ESIGN_DEV_BASE ?? 'http://localhost:3100'))
    return
  }

  const stamp = Date.now().toString(36)
  const base = { eventTitle: 'Dev Test Event' }
  const req =
    kind === 'minor'
      ? { type: 'minor' as const, params: { ...base, minorFirstName: 'Tess', minorLastName: `Student-${stamp}`, minorEmail: `student+${stamp}@example.test`, minorDateOfBirth: '2013-04-05', guardianName: 'Morgan Parent', guardianEmail: `parent+${stamp}@example.test`, guardianPhone: '555 0100', relationship: 'Parent', schoolName: 'Example Middle School', schoolState: 'CO' } }
      : kind === 'adult'
        ? { type: 'adult' as const, params: { ...base, firstName: 'Alex', lastName: `Teacher-${stamp}`, email: `teacher+${stamp}@example.test`, phone: '555 0101', schoolName: 'Example High School', schoolState: 'CO' } }
        : kind === 'mentor'
          ? { type: 'mentor' as const, params: { ...base, firstName: 'Riley', lastName: `Mentor-${stamp}`, email: `mentor+${stamp}@example.test`, phone: '555 0102' } }
          : kind === 'membership'
            ? { type: 'membership' as const, params: process.argv.includes('--minor')
                ? { memberId: '00000000-0000-4000-8000-000000000000', firstName: 'Jamie', lastName: `Member-${stamp}`, email: `member+${stamp}@example.test`, dateOfBirth: '2012-08-09', guardianName: 'Casey Guardian', guardianEmail: `guardian+${stamp}@example.test`, relationship: 'Parent' }
                : { memberId: '00000000-0000-4000-8000-000000000000', firstName: 'Sam', lastName: `Member-${stamp}`, email: `member+${stamp}@example.test`, dateOfBirth: '1990-02-03', phone: '555 0103' } }
            : null
  if (!req) throw new Error('Kind: minor | adult | mentor | membership [--minor] | link <recipient id>')

  const created = await nativeProvider.create({ db }, req as never)
  const { data: row, error } = await db.from('docusign_envelopes').insert({
    participant_id: null,
    member_id: null,
    event_slug: 'dev-test',
    event_title: 'Dev Test Event',
    envelope_id: created.externalId,
    provider: 'native',
    envelope_type: kind,
    status: 'sent',
    signer_name: 'Dev test',
    signer_email: 'dev@example.test',
    minor_name: 'Dev test',
    signers_total: created.signerCount,
    signers_completed: 0,
    ...created.rowFields,
  }).select('id').single()
  if (error) throw new Error(error.message)
  await created.afterRecord!(db, row.id as string)

  const { data: recipients } = await db.from('docusign_envelope_recipients').select('id, role_name, status, token_version, token_expires_at').eq('envelope_row', row.id).order('routing_order')
  console.log(`Agreement ${row.id} (${created.externalId})`)
  for (const r of recipients ?? []) {
    const link = r.status === 'sent' ? signNowUrlFor(r as never).replace(/^https?:\/\/[^/]+/, process.env.ESIGN_DEV_BASE ?? 'http://localhost:3100') : '(waits for the earlier signer)'
    console.log(`  ${r.role_name.padEnd(10)} ${r.id}  ${link}`)
  }
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
