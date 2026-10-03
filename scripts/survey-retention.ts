/**
 * survey-retention.ts — the 7-year survey retention purge (lib/survey/retention.ts).
 *
 *   npm run survey:retention                       # report only (the default)
 *   npm run survey:retention -- --as-of 2040-01-01 # report as if it were that day
 *   npm run survey:retention -- --apply            # delete what is due today
 *
 * Deletion is full and cannot be undone (handover §14.3). --as-of is for
 * reports only and is refused with --apply. Targets whatever Supabase project
 * .env.local points at; production is refused unless --prod is passed too,
 * and --apply on production is David's call, never a session's.
 */
import { existsSync } from 'node:fs'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const PROD_PROJECT_REF = 'hwtzpfrnksksxlwwabqz'

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const allowProd = args.includes('--prod')
  const asOfArg = args[args.indexOf('--as-of') + 1]
  const asOf = args.includes('--as-of') ? new Date(`${asOfArg}T00:00:00Z`) : new Date()
  if (Number.isNaN(asOf.getTime())) throw new Error('Usage: npm run survey:retention -- [--as-of YYYY-MM-DD] [--apply] [--prod]')
  if (apply && args.includes('--as-of')) throw new Error('--as-of is for reports only; --apply always uses today.')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const prod = url.includes(PROD_PROJECT_REF)
  if (prod && !allowProd) throw new Error('This points at PRODUCTION. Re-run with --prod if that is intended.')

  const { planSurveyRetention, applySurveyRetention, redactedDue } = await import('../lib/survey/retention')
  const { supabaseServer } = await import('../lib/supabase')
  const db = supabaseServer()

  const plan = await planSurveyRetention(db, asOf)
  console.log(`Survey retention — ${prod ? 'PRODUCTION' : 'dev'} — as of ${plan.asOf.slice(0, 10)}`)
  console.log(`Due: ${plan.totals.subjects} people, ${plan.totals.responses} responses, ${plan.totals.invitations} invitations`)
  for (const s of redactedDue(plan)) console.log(`  ${s.kind.padEnd(11)} ${s.id}  due ${s.dueAt?.slice(0, 10)}  ${s.responses} responses, ${s.invitations} invitations`)
  console.log(`Waiting (clock running): ${plan.waiting.member} members, ${plan.waiting.participant} participants, ${plan.waiting.email} email-only; next due ${plan.waiting.nextDueAt?.slice(0, 10) ?? '—'}`)
  if (plan.inactiveWithoutDate) console.log(`Inactive members with survey data but no deleted_at (no clock): ${plan.inactiveWithoutDate}`)
  if (plan.emailsHeld) console.log(`Email-only recipients held back (address belongs to a member, or a newer survey went to it): ${plan.emailsHeld}`)

  if (!apply) {
    console.log('\nReport only. Nothing was deleted.')
    return
  }
  if (!plan.due.length) {
    console.log('\nNothing due.')
    return
  }
  const r = await applySurveyRetention(db, plan, `retention:${process.env.USER ?? 'script'}`)
  console.log(`\nDeleted for ${r.purged} people: ${r.responses} responses, ${r.invitations} invitations.`)
  for (const f of r.failures) console.error(`  FAILED ${f.kind} ${f.id}: ${f.error}`)
  if (r.failures.length) process.exitCode = 1
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
