/**
 * Correct one signer's email on a live agreement, from the command line: the
 * same code path as the admin "Correct email" action
 * (lib/agreement-correction.ts). For an urgent fix when the app is not to hand.
 *
 * It changes the address on the SAME envelope (DocuSign's "Correct", through the
 * API), keeping signatures already given and using no envelope from the monthly
 * allowance, then updates our recipient rows and the participant record.
 *
 *   npx tsx scripts/agreement-correct-recipient.ts <agreementId|envelopeId>             # list signers
 *   npx tsx scripts/agreement-correct-recipient.ts <id> <recipientId> <newEmail> --apply
 *   npx tsx scripts/agreement-correct-recipient.ts ... --env-file .env.prod             # another environment
 *
 * Without --apply it only lists the signers and says what it would do.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'

const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : undefined
}
const APPLY = process.argv.includes('--apply')
// Before any lib import: lib/docusign reads its env when the module loads.
dotenv.config({ path: path.resolve(process.cwd(), arg('--env-file') ?? '.env.local') })

const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--env-file')
const [idArg, recipientId, newEmail] = positional

async function main() {
  if (!idArg) {
    console.error('Usage: npx tsx scripts/agreement-correct-recipient.ts <agreementId|envelopeId> [recipientId newEmail --apply]')
    process.exit(1)
  }
  const { supabaseServer } = await import('../lib/supabase')
  const { fetchEnvelopeRecipients } = await import('../lib/esign/operations')
  const { correctAgreementRecipient } = await import('../lib/agreement-correction')
  const db = supabaseServer()

  const uuid = /^[0-9a-f-]{36}$/i.test(idArg)
  const { data: rows } = await db
    .from('agreements')
    .select('id, envelope_id, provider, status, event_slug, minor_name, signer_name')
    .or(uuid ? `id.eq.${idArg},envelope_id.eq.${idArg}` : `envelope_id.eq.${idArg}`)
  const row = rows?.[0]
  if (!row) {
    console.error(`No agreement with id or envelope id ${idArg}`)
    process.exit(1)
  }
  console.log(`Agreement ${row.id} (${row.provider ?? 'docusign'} ${row.envelope_id}), ${row.status}, ${row.event_slug ?? 'no event'}: ${row.minor_name ?? row.signer_name ?? ''}`)
  const signers = await fetchEnvelopeRecipients(db, row)
  for (const s of signers) console.log(`  ${s.recipientId}  ${(s.roleName ?? '').padEnd(20)} ${s.status.padEnd(14)} ${s.email}  (${s.name})`)

  if (!recipientId || !newEmail) return
  const target = signers.find((s) => s.recipientId === recipientId)
  console.log(`\n${APPLY ? 'Correcting' : 'Would correct'} recipient ${recipientId}: ${target?.email ?? '(not found)'} -> ${newEmail}`)
  if (!APPLY) {
    console.log('Dry run. Add --apply to make the change.')
    return
  }
  const result = await correctAgreementRecipient(db, { agreementId: row.id as string, recipientId, email: newEmail })
  console.log(JSON.stringify(result, null, 2))
  if (result.kind !== 'corrected') process.exit(1)
  if (result.memberId) {
    const { logActivity } = await import('../lib/activity-log')
    await logActivity({
      memberId: result.memberId,
      actorType: 'system',
      actorLabel: 'scripts/agreement-correct-recipient',
      category: 'docusign',
      action: 'docusign_corrected',
      summary: `Signer email corrected by script: ${result.previousEmail} -> ${result.recipient.email}`,
      metadata: { agreementId: row.id, envelopeId: result.envelopeId, provider: result.provider, recipientId, from: result.previousEmail, to: result.recipient.email, participantField: result.participantField },
    }, db)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
