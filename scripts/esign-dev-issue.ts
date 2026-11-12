/**
 * Issue a test agreement on Stellr signing, on the DEV project only, and print
 * the first signer's link. For trying the signing page end to end.
 *
 *   npx tsx scripts/esign-dev-issue.ts minor     # parent, then student
 *   npx tsx scripts/esign-dev-issue.ts adult
 *   npx tsx scripts/esign-dev-issue.ts mentor
 *   npx tsx scripts/esign-dev-issue.ts membership [--minor]
 *   npx tsx scripts/esign-dev-issue.ts tenant_guardian_consent --version <n>
 *   npx tsx scripts/esign-dev-issue.ts link <recipient row id>   # a fresh link for a signer
 *
 * tenant_guardian_consent (S5 wave 7, K0) signs the published DEV PLACEHOLDER
 * version <n> of the guardian-consent document, approved or not: the envelope
 * names that version and the signing page reads it by id, so K0 runs before
 * K7b approves it. It refuses any version that is not the whole placeholder
 * (title and every page), and any target but the dev project. The envelope
 * names no tenant and no participant, so its signature settles no registration.
 * Publish the placeholder first: scripts/esign-template.ts, step 5.
 *
 * Everyone in it is invented. Emails go wherever DEV_EMAIL_SAFELIST routes
 * them (lib/email.ts; the role inbox when it is unset); nothing reaches a real
 * family.
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
  const { supabaseFetch, supabaseSecretKey } = await import('../lib/supabase-keys')
  const db = createClient(url, supabaseSecretKey() as string, { auth: { persistSession: false }, global: { fetch: supabaseFetch } })

  const [kind, arg] = process.argv.slice(2)
  if (kind === 'link') {
    const { data: r } = await db.from('agreement_recipients').select('id, token_version, token_expires_at').eq('id', arg).single()
    console.log(signNowUrlFor(r as never).replace(/^https?:\/\/[^/]+/, process.env.ESIGN_DEV_BASE ?? 'http://localhost:3100'))
    return
  }

  const stamp = Date.now().toString(36)
  if (kind === 'tenant_guardian_consent') {
    const issued = await issueDevPlaceholderConsent(db, url, stamp)
    return printRecipients(db, issued.rowId, issued.envelopeId, signNowUrlFor)
  }
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
  if (!req) throw new Error('Kind: minor | adult | mentor | membership [--minor] | tenant_guardian_consent --version <n> | link <recipient id>')

  const created = await nativeProvider.create({ db }, req as never)
  const { data: row, error } = await db.from('agreements').insert({
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

  await printRecipients(db, row.id as string, created.externalId, signNowUrlFor)
}

type Db = import('@supabase/supabase-js').SupabaseClient
type SignNowUrlFor = typeof import('../lib/esign/outbox').signNowUrlFor

async function printRecipients(db: Db, rowId: string, envelopeId: string, signNowUrlFor: SignNowUrlFor) {
  const { data: recipients } = await db.from('agreement_recipients').select('id, role_name, status, token_version, token_expires_at').eq('envelope_row', rowId).order('routing_order')
  console.log(`Agreement ${rowId} (${envelopeId})`)
  for (const r of recipients ?? []) {
    const link = r.status === 'sent' ? signNowUrlFor(r as never).replace(/^https?:\/\/[^/]+/, process.env.ESIGN_DEV_BASE ?? 'http://localhost:3100') : '(waits for the earlier signer)'
    console.log(`  ${r.role_name.padEnd(10)} ${r.id}  ${link}`)
  }
}

/**
 * K0: records a guardian-consent envelope on the published dev placeholder
 * version given by --version, with invented people, and emails its link.
 */
async function issueDevPlaceholderConsent(db: Db, url: string, stamp: string): Promise<{ rowId: string; envelopeId: string }> {
  const { randomUUID } = await import('crypto')
  const {
    devPlaceholderConsentInput,
    devPlaceholderTargetRefusal,
    isDevPlaceholderTitle,
    isWholeDevPlaceholder,
    pdfPlaceholderStatus,
  } = await import('../lib/esign/native/dev-placeholder')
  const {
    planTenantGuardianConsent,
    TENANT_GUARDIAN_CONSENT_ENVELOPE_TYPE,
    TENANT_GUARDIAN_CONSENT_TEMPLATE,
    TENANT_GUARDIAN_CONSENT_VERSION,
  } = await import('../lib/esign/tenant-guardian-consent')
  const { loadTemplateById, loadTemplatePdf } = await import('../lib/esign/native/templates-store')
  const { insertSigners } = await import('../lib/esign/native/flow')
  const { sendInvites } = await import('../lib/esign/outbox')
  const { signingConfigured } = await import('../lib/esign/native/tokens')

  const refusal = devPlaceholderTargetRefusal({ supabaseUrl: url, appEnv: process.env.NEXT_PUBLIC_APP_ENV })
  if (refusal) throw new Error(`Refusing: ${refusal}`)
  if (!signingConfigured()) throw new Error('Stellr signing is not configured (ESIGN_TOKEN_SECRET)')
  const i = process.argv.indexOf('--version')
  const version = i > -1 ? Number(process.argv[i + 1]) : NaN
  if (!Number.isInteger(version) || version < 1) throw new Error('Pass --version <n>: the published dev placeholder version to sign')

  const { data: found } = await db.from('esign_templates').select('id, title').eq('key', TENANT_GUARDIAN_CONSENT_TEMPLATE).eq('version', version).maybeSingle()
  if (!found) throw new Error(`${TENANT_GUARDIAN_CONSENT_TEMPLATE} v${version} does not exist. Publish the placeholder first (scripts/esign-template.ts, step 5).`)
  if (!isDevPlaceholderTitle(found.title as string)) throw new Error(`Refusing: ${TENANT_GUARDIAN_CONSENT_TEMPLATE} v${version} ("${found.title}") is not the dev placeholder. Only the placeholder is signed here.`)
  const template = await loadTemplateById(db, found.id as string)
  const status = await pdfPlaceholderStatus(await loadTemplatePdf(db, template)) // verifies the stored hash
  if (!isWholeDevPlaceholder(status)) throw new Error(`Refusing: not every page of ${TENANT_GUARDIAN_CONSENT_TEMPLATE} v${version} carries the placeholder title.`)

  const input = devPlaceholderConsentInput(stamp)
  const plan = planTenantGuardianConsent(input)
  const guardian = plan.signers[0]
  const envelopeId = `native-${randomUUID()}`
  const { data: row, error } = await db.from('agreements').insert({
    participant_id: null,
    member_id: null,
    event_slug: input.eventSlug,
    event_title: input.eventTitle,
    envelope_id: envelopeId,
    provider: 'native',
    envelope_type: TENANT_GUARDIAN_CONSENT_ENVELOPE_TYPE,
    status: 'sent',
    signer_name: guardian.name,
    signer_email: guardian.email,
    minor_name: plan.prefill.MinorName,
    signers_total: 1,
    signers_completed: 0,
    agreement_version: TENANT_GUARDIAN_CONSENT_VERSION,
    template_id: template.id,
    prefill: plan.subjectBirthYear ? { ...plan.prefill, SubjectBirthYear: plan.subjectBirthYear } : plan.prefill,
  }).select('id').single()
  if (error || !row) throw new Error(error?.message ?? 'Recording the envelope failed')
  const active = await insertSigners(db, row.id as string, plan, template)
  await sendInvites(db, active)
  console.log(`${TENANT_GUARDIAN_CONSENT_TEMPLATE} v${version} (approved: ${template.approvedAt ? 'yes' : 'no'}). The child's birth year to confirm: ${plan.subjectBirthYear}.`)
  return { rowId: row.id as string, envelopeId }
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
