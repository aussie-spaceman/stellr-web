/**
 * Manual Apollo → HubSpot reconciliation, with a dry run.
 *
 * Shares its logic with the daily cron (`app/api/cron/apollo-reconcile`) via
 * `lib/apollo-reconcile.ts`, so a record repaired by hand and one repaired
 * automatically are produced by exactly the same code.
 *
 * Use this when you want to see the gap before closing it — the cron applies
 * unconditionally, this does not.
 *
 * Safe to re-run: an existing open deal is a no-op.
 *
 * Prerequisites (.env.local):
 *   APOLLO_API_KEY            emailer_messages_search enabled (or Master key)
 *   HUBSPOT_ACCESS_TOKEN      contacts + deals + companies read/write
 *
 * Run:
 *   npm run backfill:apollo                 # dry run — writes nothing
 *   npm run backfill:apollo -- --apply      # write to HubSpot
 *   npm run backfill:apollo -- --limit 25
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

// ESM hoists every static import above this call, so lib/apollo-reconcile is
// imported dynamically below — it and its dependencies read env at module scope.
const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : {})

const APPLY = process.argv.includes('--apply')
const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : undefined

async function main() {
  const key = process.env.APOLLO_API_KEY
  if (!key) {
    console.error('✗ APOLLO_API_KEY is not set in .env.local. Run `npm run probe:apollo` first.')
    process.exit(1)
  }

  const { fetchEngagedProspects, reconcileProspects } = await import('../lib/apollo-reconcile')

  console.log(APPLY ? '*** APPLY — writing to HubSpot ***' : 'DRY RUN — nothing will be written')

  console.log('\nFetching engagement from Apollo…')
  const prospects = await fetchEngagedProspects(key)
  const clicked = prospects.filter((p) => p.engagement === 'clicked').length
  const replied = prospects.filter((p) => p.engagement === 'replied').length
  console.log(
    `${prospects.length} distinct contacts ` +
      `(${clicked} clicked → Initial Interest, ${replied} replied → Initial Engagement)`,
  )

  const r = await reconcileProspects(prospects, {
    apply: APPLY,
    limit: LIMIT,
    onLog: (line) => console.log('  ' + line),
  })

  console.log(
    `\n${APPLY ? 'Applied' : 'Would apply'}: ${r.created} created, ${r.advanced} advanced, ` +
      `${r.skipped} skipped, ${r.companiesCreated} companies created, ${r.failed} failed`,
  )
  if (!APPLY) console.log('\nRe-run with --apply to write. Safe to re-run: repeats are no-ops.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
