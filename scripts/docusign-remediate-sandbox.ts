/**
 * Phase C of the sandbox → production DocuSign cutover: void every agreement
 * that was executed in the DEMO account and re-issue it for real.
 *
 * WHY: between June and September 2026 production issued real parental consent
 * forms — COPPA consent, photo/media release, risk waiver — from the DocuSign
 * developer sandbox. Every page of those documents is stamped "DEMONSTRATION
 * DOCUMENT ONLY — PROVIDED BY DOCUSIGN ONLINE SIGNING SERVICE", so none of the
 * signatures is binding and all of them have to be collected again.
 *
 * RUN ORDER MATTERS. Do the env cutover FIRST (docs/GO-LIVE-CHECKLIST.md §4a):
 *
 *   1. Point DOCUSIGN_* at the SANDBOX and run:  npx tsx scripts/docusign-remediate-sandbox.ts void --apply
 *   2. Switch DOCUSIGN_* to PRODUCTION.
 *   3. Run:                                      npx tsx scripts/docusign-remediate-sandbox.ts reissue --apply
 *
 * Both modes are a dry run unless --apply is passed.
 *
 * Two traps this script exists to avoid:
 *   • A COMPLETED envelope row makes findValidAgreement() treat the person as
 *     covered for three years, so a re-issue is silently swallowed and replaced
 *     with an "already on file" email. Voiding the row first is mandatory.
 *   • Coverage rows (reused_from) pointing at a voided root would leave other
 *     participants claiming cover from a demonstration document.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { voidEnvelope } from '../lib/docusign'
import { dispatchAgreement } from '../lib/docusign-agreements'

const APPLY = process.argv.includes('--apply')
const MODE = process.argv[2]
const VOID_REASON = 'Re-issued from Stellr production DocuSign account — sandbox envelope is not a binding signature'

const isSandbox = (process.env.DOCUSIGN_BASE_PATH ?? 'https://demo.docusign.net/restapi')
  .includes('demo.docusign.net')

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service-role credentials missing from .env.local')
  return createClient(url, key, { auth: { persistSession: false } })
}

interface EnvelopeRow {
  id: string
  envelope_id: string
  status: string
  envelope_type: string
  event_slug: string
  event_title: string
  minor_name: string
  signer_name: string
  signer_email: string
  participant_id: string | null
  member_id: string | null
  reused_from: string | null
}

async function loadEnvelopes(client: ReturnType<typeof db>): Promise<EnvelopeRow[]> {
  const { data, error } = await client
    .from('docusign_envelopes')
    .select('id, envelope_id, status, envelope_type, event_slug, event_title, minor_name, signer_name, signer_email, participant_id, member_id, reused_from')
    .neq('status', 'voided')
    .order('sent_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as EnvelopeRow[]
}

// ── void ─────────────────────────────────────────────────────────────────────

async function doVoid(client: ReturnType<typeof db>): Promise<void> {
  if (!isSandbox) {
    console.log('❌ DOCUSIGN_BASE_PATH is not the sandbox. Point .env.local at the DEMO account for this step.')
    process.exit(1)
  }

  const envelopes = await loadEnvelopes(client)
  if (envelopes.length === 0) { console.log('Nothing to void.'); return }

  console.log(`${envelopes.length} envelope row(s) to void${APPLY ? '' : ' (DRY RUN)'}\n`)

  for (const env of envelopes) {
    const tag = `${env.minor_name} — ${env.envelope_type} — ${env.event_title} [${env.status}]`

    if (env.reused_from) {
      // Coverage row: nothing exists in DocuSign, but it must not keep pointing
      // at a demonstration document.
      console.log(`${APPLY ? '•' : 'DRY RUN'} ${tag}  (coverage row — mark voided, no DocuSign envelope)`)
      if (APPLY) {
        await client.from('docusign_envelopes')
          .update({ status: 'voided', updated_at: new Date().toISOString() })
          .eq('id', env.id)
      }
      continue
    }

    console.log(`${APPLY ? '•' : 'DRY RUN'} ${tag}  ${env.envelope_id}`)
    if (!APPLY) continue

    try {
      await voidEnvelope(env.envelope_id, VOID_REASON)
    } catch (err) {
      // A completed envelope cannot be voided in DocuSign. The DB row still must
      // be voided, or findValidAgreement() will suppress the re-issue.
      console.log(`   ↳ DocuSign void refused (expected for completed envelopes): ${err instanceof Error ? err.message : err}`)
    }
    const { error } = await client.from('docusign_envelopes')
      .update({ status: 'voided', updated_at: new Date().toISOString() })
      .eq('id', env.id)
    if (error) console.log(`   ↳ DB update failed: ${error.message}`)
  }

  if (!APPLY) console.log('\nRe-run with --apply to perform these actions.')
  else console.log('\nDone. Now switch DOCUSIGN_* to production and run: reissue --apply')
}

// ── reissue ──────────────────────────────────────────────────────────────────

async function doReissue(client: ReturnType<typeof db>): Promise<void> {
  if (isSandbox) {
    console.log('❌ DOCUSIGN_BASE_PATH is still the sandbox. Re-issuing here would recreate the exact problem.')
    process.exit(1)
  }

  // Everyone who has a voided envelope and no live one. dispatchAgreement's own
  // duplicate guards (participant already has an envelope / open envelope for
  // the event / valid agreement on file) then decide whether to actually issue.
  const { data: voided, error } = await client
    .from('docusign_envelopes')
    .select('participant_id')
    .eq('status', 'voided')
    .not('participant_id', 'is', null)
  if (error) throw new Error(error.message)

  const participantIds = [...new Set((voided ?? []).map(v => v.participant_id as string))]
  if (participantIds.length === 0) { console.log('Nothing to re-issue.'); return }

  const { data: participants, error: pErr } = await client
    .from('participants')
    .select(`id, first_name, last_name, email, phone, date_of_birth, event_role, school_name,
             emergency_contact_first_name, emergency_contact_last_name, emergency_contact_email,
             emergency_contact_phone, emergency_contact_relationship,
             registration_id, registrations(event_slug, event_title)`)
    .in('id', participantIds)
  if (pErr) throw new Error(pErr.message)

  console.log(`${(participants ?? []).length} participant(s) to re-issue${APPLY ? '' : ' (DRY RUN)'}\n`)

  for (const p of participants ?? []) {
    const reg = p.registrations as unknown as { event_slug: string; event_title: string } | null
    if (!reg) { console.log(`⚠️  ${p.first_name} ${p.last_name}: no registration row — skipping`); continue }

    console.log(`${APPLY ? '•' : 'DRY RUN'} ${p.first_name} ${p.last_name} <${p.email}> — ${reg.event_title}`)
    if (!APPLY) continue

    const { data: member } = await client
      .from('members').select('id').eq('email', p.email).maybeSingle()

    await dispatchAgreement(client, {
      participantId:     p.id as string,
      memberId:          (member?.id as string | undefined) ?? null,
      eventSlug:         reg.event_slug,
      eventTitle:        reg.event_title,
      firstName:         p.first_name as string,
      lastName:          p.last_name as string,
      email:             p.email as string,
      phone:             p.phone as string | null,
      dateOfBirth:       p.date_of_birth as string | null,
      eventRole:         p.event_role as string | null,
      schoolName:        p.school_name as string | null,
      guardianFirstName: p.emergency_contact_first_name as string | null,
      guardianLastName:  p.emergency_contact_last_name as string | null,
      guardianEmail:     p.emergency_contact_email as string | null,
      guardianPhone:     p.emergency_contact_phone as string | null,
      relationship:      p.emergency_contact_relationship as string | null,
    })
  }

  if (!APPLY) console.log('\nRe-run with --apply to re-issue.')
  else console.log('\nDone. Verify in /admin/docusigns that each row is "Issued" against a PRODUCTION envelope.')
}

async function main() {
  console.log(`DocuSign environment: ${isSandbox ? 'SANDBOX / DEMO' : 'PRODUCTION'}\n`)
  const client = db()

  if (MODE === 'void') await doVoid(client)
  else if (MODE === 'reissue') await doReissue(client)
  else {
    console.log('Usage: npx tsx scripts/docusign-remediate-sandbox.ts <void|reissue> [--apply]')
    console.log('  void     — run against the SANDBOX: voids demo envelopes and their DB rows')
    console.log('  reissue  — run against PRODUCTION: re-issues agreements for those participants')
    console.log('\nEnvelopes signed in the sandbox are NOT binding. Both steps are required.')
    process.exit(1)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
