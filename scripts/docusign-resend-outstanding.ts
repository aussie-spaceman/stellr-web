/**
 * Re-send every unsigned DocuSign envelope for one event — the retrospective
 * catch-up for families who were never chased because the reminder cron did
 * nothing between 4 and 28 Sept 2026.
 *
 * Only LIVE envelopes (created/sent/delivered, no bounced address) are touched,
 * and only through lib/docusign-reissue.ts, so this never issues a new envelope
 * and never spends the 40-per-month quota. Anything needing a new envelope is
 * listed for the roster's "Reissue DocuSign" button instead.
 *
 *   npx tsx scripts/docusign-resend-outstanding.ts --event colorado-space-design-challenge
 *   npx tsx scripts/docusign-resend-outstanding.ts --event <slug> --sent-before 2026-09-26
 *   npx tsx scripts/docusign-resend-outstanding.ts --event <slug> --env-file .env.prod --apply
 *
 * Dry run by default. Prints the Supabase host and DocuSign base path first:
 * check them before --apply. Afterwards, confirm in DocuSign itself — never
 * trust this script's own output (HANDOVER-docusign-2026-09-09 §3).
 */

import * as dotenv from 'dotenv'
import * as path from 'path'

const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : undefined
}
const APPLY = process.argv.includes('--apply')
const EVENT = arg('--event')
const SENT_BEFORE = arg('--sent-before')
// dotenv never overrides variables already set, so prod values prefixed on the
// command line win over .env.local.
dotenv.config({ path: path.resolve(process.cwd(), arg('--env-file') ?? '.env.local') })

async function main() {
  if (!EVENT) throw new Error('--event <slug> is required')
  if (SENT_BEFORE && !/^\d{4}-\d{2}-\d{2}$/.test(SENT_BEFORE)) throw new Error('--sent-before must be YYYY-MM-DD')

  // Dynamic imports AFTER dotenv: lib/docusign reads its env at module load, and
  // a hoisted static import once captured an empty private key (9 Sept 2026).
  const { createClient } = await import('@supabase/supabase-js')
  const { reissueParticipantAgreement } = await import('../lib/docusign-reissue')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false } })
  console.log(`Supabase: ${new URL(url).host}`)
  console.log(`DocuSign: ${process.env.DOCUSIGN_BASE_PATH ?? '(unset — sandbox default)'}`)
  console.log(`Event:    ${EVENT}${SENT_BEFORE ? `, envelopes sent before ${SENT_BEFORE}` : ''}`)
  console.log(APPLY ? 'Mode:     APPLY\n' : 'Mode:     dry run (pass --apply to send)\n')

  let q = db
    .from('docusign_envelopes')
    .select('id, participant_id, status, sent_at, signers_total, signers_completed')
    .eq('event_slug', EVENT)
    .in('status', ['created', 'sent', 'delivered'])
    .is('reused_from', null)
    .not('participant_id', 'is', null)
    .order('sent_at', { ascending: true })
  if (SENT_BEFORE) q = q.lt('sent_at', `${SENT_BEFORE}T00:00:00Z`)
  const { data: envelopes, error } = await q
  if (error) throw error

  // A participant can carry an older dead row beside the live one; one per person.
  const seen = new Set<string>()
  let resent = 0, needsNew = 0, failed = 0
  for (const env of envelopes ?? []) {
    const pid = env.participant_id as string
    if (seen.has(pid)) continue
    seen.add(pid)
    const line = `${((env.sent_at as string | null) ?? "(unsent)   ").slice(0, 10)}  ${env.signers_completed ?? 0}/${env.signers_total ?? '?'} signed  row ${env.id}`
    if (!APPLY) {
      console.log(`would resend  ${line}`)
      continue
    }
    try {
      const r = await reissueParticipantAgreement(db, pid, { eventSlug: EVENT, allowNewEnvelope: false })
      if (r.kind === 'resent') {
        resent++
        console.log(`resent (${r.recipients})  ${line}`)
      } else {
        needsNew++
        console.log(`SKIPPED ${r.kind}${'reason' in r ? `/${r.reason}` : ''}  ${line}`)
      }
    } catch (err) {
      failed++
      console.error(`FAILED  ${line}:`, err instanceof Error ? err.message : err)
    }
  }

  console.log(`\n${seen.size} participant(s) with a live envelope.`)
  if (APPLY) console.log(`Resent ${resent}, skipped ${needsNew} (use the roster button), failed ${failed}.`)
  if (failed > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
