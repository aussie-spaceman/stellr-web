/**
 * Reconcile HubSpot's event option lists with the live events in Sanity.
 *
 *   npm run hubspot:sync-event-options            # dry run — prints the diff
 *   npm run hubspot:sync-event-options -- --apply # writes it
 *
 * The same sync runs from the Sanity publish webhook and a daily cron in
 * production (lib/hubspot-event-options.ts has the rules). This is for the
 * first run, for audits, and for applying a change without waiting.
 *
 * There is ONE HubSpot portal and no sandbox: `--apply` from a laptop writes
 * the live CRM's dropdowns, which is why it is not the default.
 *
 * Env: HUBSPOT_ACCESS_TOKEN (crm.schemas.contacts.write, crm.schemas.deals.write,
 * forms), the Sanity read vars, and HUBSPOT_FORM_EVENT_NOTIFY for the form.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
else dotenv.config()

const APPLY = process.argv.includes('--apply')

async function main() {
  // Dynamic import: lib/hubspot and lib/sanity read their credentials at module
  // scope, and a static import would evaluate them before dotenv has run (see
  // scripts/notify-event-waitlist.ts).
  const { syncEventOptions } = await import('../lib/hubspot-event-options')

  console.log(APPLY ? 'Applying to the live HubSpot portal…\n' : 'Dry run — nothing is written. Pass --apply to write.\n')
  const result = await syncEventOptions({ apply: APPLY })

  if (result.refused) {
    console.error(`Refused: ${result.refused}`)
    process.exit(1)
  }

  console.log(`Live events (${result.liveEvents.length}): ${result.liveEvents.join(', ')}`)
  if (result.unmapped.length) console.log(`Unmapped: ${result.unmapped.join('; ')}`)
  console.log('')

  for (const p of result.properties) {
    console.log(`${p.object}.${p.property}: ${p.status}${p.error ? ` — ${p.error}` : ''}`)
    const c = p.changes
    if (!c) continue
    if (c.added.length) console.log(`  + add       ${c.added.join(' | ')}`)
    if (c.unhidden.length) console.log(`  ↑ unhide    ${c.unhidden.join(' | ')}`)
    if (c.hidden.length) console.log(`  − hide      ${c.hidden.join(' | ')}`)
    if (c.dropped.length) console.log(`  × drop      ${c.dropped.join(' | ')}  (stale value, 0 records)`)
    if (c.relabelled.length) console.log(`  ~ legacy    ${c.relabelled.join(' | ')}  (stale value still in use)`)
    if (c.reordered) console.log('  ↕ reorder')
  }

  console.log('')
  console.log(
    `Event Notify form: ${result.form.status}` +
      (result.form.fields?.length ? ` — ${result.form.fields.join(', ')}` : '') +
      (result.form.error ? ` — ${result.form.error}` : ''),
  )

  if (!result.ok) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
