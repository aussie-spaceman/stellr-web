/**
 * Read the opt-out boxes (media, quotes, digital communications, credential
 * sharing) off every completed agreement whose answers are not on file
 * (agreements.form_opt_outs IS NULL), and record them.
 *
 * Why: until 7 Oct 2026 the DocuSign read-back called GET /form_data, which
 * failed on every production envelope, so no parent's answer was ever
 * recorded and the admin Media do-not-use list showed every signed student
 * as "check the signed form". The docusign-form-data cron now does this
 * itself each morning (no age limit, 50 a run); this script is the same code
 * for running it now, or for looking first.
 *
 *   npx tsx scripts/backfill-form-opt-outs.ts                                   # dry run: what each form says
 *   npx tsx scripts/backfill-form-opt-outs.ts --env-file .env.prod.local --apply
 *
 * Dry run by default; it reads DocuSign but writes nothing. Prints the
 * Supabase host and DocuSign base path first: check them before --apply.
 * Prints no names, only row ids, form type, signing date and the answers.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'

const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : undefined
}
const APPLY = process.argv.includes('--apply')
dotenv.config({ path: path.resolve(process.cwd(), arg('--env-file') ?? '.env.local') })

const mediaVerdict = (answers: { MediaOptOut?: boolean }) =>
  answers.MediaOptOut === undefined ? 'media box NOT FOUND' : answers.MediaOptOut ? 'media OPTED OUT' : 'media not opted out'

async function main() {
  // Dynamic imports AFTER dotenv: lib/docusign reads its env at module load.
  const { createClient } = await import('@supabase/supabase-js')
  const { fetchEnvelopeFieldValues } = await import('../lib/esign/operations')
  const { formOptOuts } = await import('../lib/docusign-form-data')
  const { recordCredentialOptOutFromForm, OPT_OUT_ENVELOPE_COLUMNS } = await import('../lib/docusign-optout')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false } })
  console.log(`Supabase: ${new URL(url).host}`)
  console.log(`DocuSign: ${process.env.DOCUSIGN_BASE_PATH ?? '(unset — sandbox default)'}`)
  console.log(APPLY ? 'Mode:     APPLY\n' : 'Mode:     dry run (pass --apply to record)\n')

  const { data, error } = await db
    .from('agreements')
    .select(`${OPT_OUT_ENVELOPE_COLUMNS}, completed_at`)
    .in('envelope_type', ['minor', 'adult', 'mentor', 'volunteer'])
    .eq('status', 'completed')
    .is('reused_from', null)
    .is('form_opt_outs', null)
    .order('completed_at', { ascending: true })
  if (error) throw error

  const tally: Record<string, number> = {}
  for (const row of data ?? []) {
    const env = row as typeof row & { completed_at: string | null }
    const line = `${(env.completed_at ?? '').slice(0, 10)}  ${(env.provider ?? 'docusign').padEnd(8)} ${(env.envelope_type ?? '').padEnd(9)} row ${env.id}`
    if (APPLY) {
      const result = await recordCredentialOptOutFromForm(db, env, { onError: (err) => console.log(`    ${err instanceof Error ? err.message : String(err)}`) })
      const { data: after } = await db.from('agreements').select('form_opt_outs').eq('id', env.id).single()
      const answers = (after?.form_opt_outs ?? null) as Record<string, boolean> | null
      const media = result === 'failed' ? 'READ FAILED' : mediaVerdict(answers ?? {})
      console.log(`${line}  ${media.padEnd(20)} ${JSON.stringify(answers)}`)
      tally[media] = (tally[media] ?? 0) + 1
      continue
    }
    try {
      const answers = formOptOuts(await fetchEnvelopeFieldValues(db, env))
      const media = mediaVerdict(answers)
      console.log(`${line}  ${media.padEnd(20)} ${JSON.stringify(answers)}`)
      tally[media] = (tally[media] ?? 0) + 1
    } catch (err) {
      console.log(`${line}  READ FAILED: ${err instanceof Error ? err.message : String(err)}`)
      tally['read failed'] = (tally['read failed'] ?? 0) + 1
    }
  }
  console.log(`\n${data?.length ?? 0} agreement(s) without answers on file:`, tally)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
