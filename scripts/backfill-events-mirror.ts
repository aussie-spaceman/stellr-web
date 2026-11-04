/**
 * Fill the Postgres events mirror (public.events, multi-tenancy plan S3) from
 * every published Sanity event.
 *
 *   npx tsx scripts/backfill-events-mirror.ts                 # dry run (default): reports, writes nothing
 *   npx tsx scripts/backfill-events-mirror.ts --apply         # writes to the project in .env.local
 *   npx tsx scripts/backfill-events-mirror.ts --apply --production   # owner only: writes to production
 *
 * The event webhook keeps the mirror current from here on
 * (app/api/admin/sanity/event-sync → lib/events/sync.ts); this is the one-off
 * fill for events published before that, and the net for anything a webhook
 * missed. Idempotent: rows are matched on the Sanity _id and only changed rows
 * are written. Never deletes.
 *
 * Every event is Stellr's (tenant #1) in S3. Events that share a slug are held
 * back and listed — the mirror's slug is unique, and Sanity's slug guard
 * should make that impossible; fix the document, then re-run.
 *
 * Prerequisites (.env.local): NEXT_PUBLIC_SANITY_PROJECT_ID,
 * NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY (SANITY_API_TOKEN if the
 * dataset is private). Migrations 20261104100000 and 20261104110000 applied.
 */
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { supabaseServer } from '../lib/supabase'
import { SECRET_KEY_VARS, supabaseSecretKey } from '../lib/supabase-keys'
import { MIRROR_PROJECTION, upsertEventRows, type SanityEventDoc } from '../lib/events/sync'
import { planMirrorBackfill, type ExistingMirrorRow } from '../lib/events/backfill'
import { PRODUCTION_SUPABASE_REF } from './production-guard.mjs'

// Static imports above read no env at module scope (lib/supabase reads it
// lazily; lib/events/sync imports the Sanity client only on demand, and this
// script queries Sanity over plain fetch), so loading .env.local here is safe.
const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : {})

const APPLY = process.argv.includes('--apply')
const PRODUCTION_OK = process.argv.includes('--production')

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production'
const sanityToken = process.env.SANITY_API_TOKEN
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

async function fetchAllEvents(): Promise<SanityEventDoc[]> {
  const query = `*[_type == "event" && defined(slug.current) && !(_id in path("drafts.**"))] ${MIRROR_PROJECTION}`
  const url =
    `https://${projectId}.api.sanity.io/v2024-01-01/data/query/${dataset}` +
    `?query=${encodeURIComponent(query)}&perspective=published`
  const res = await fetch(url, sanityToken ? { headers: { Authorization: `Bearer ${sanityToken}` } } : undefined)
  if (!res.ok) throw new Error(`Sanity query failed: ${res.status}`)
  const body = (await res.json()) as { result?: SanityEventDoc[] }
  return body.result ?? []
}

async function main() {
  const missing = [
    !projectId && 'NEXT_PUBLIC_SANITY_PROJECT_ID',
    !supabaseUrl && 'NEXT_PUBLIC_SUPABASE_URL',
    !supabaseSecretKey() && SECRET_KEY_VARS,
  ].filter(Boolean)
  if (missing.length) {
    console.error(`Missing env: ${missing.join(', ')}`)
    process.exit(1)
  }
  const isProduction = supabaseUrl!.includes(PRODUCTION_SUPABASE_REF)
  if (APPLY && isProduction && !PRODUCTION_OK) {
    console.error('Refusing to write to PRODUCTION without --production (an owner action: docs/TENANCY-S3.md).')
    process.exit(1)
  }
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} against ${isProduction ? 'PRODUCTION' : 'a non-production project'}\n`)

  const docs = await fetchAllEvents()
  const db = supabaseServer()
  const { data, error } = await db
    .from('events')
    .select('sanity_id, slug, tenant_id, title, activity_type, starts_at, ends_at, time_zone, country, currency, grade_system, status, source_updated_at')
  // A read error would look like "the mirror is empty" and plan an insert of
  // every event; stop instead.
  if (error) {
    console.error(`Cannot read public.events — ${error.message}\nApply migrations 20261104100000 and 20261104110000 first.`)
    process.exit(1)
  }

  const plan = planMirrorBackfill(docs, (data ?? []) as ExistingMirrorRow[])
  console.log(`${docs.length} published event document(s) in Sanity`)
  console.log(`  insert     ${plan.insert.length}`)
  console.log(`  update     ${plan.update.length}`)
  console.log(`  unchanged  ${plan.unchanged.length}`)
  console.log(`  invalid    ${plan.invalid.length}${plan.invalid.length ? `  (${plan.invalid.join(', ')})` : ''}`)
  console.log(`  conflicts  ${plan.conflicts.length}`)
  for (const c of plan.conflicts) console.log(`    slug "${c.slug}" is claimed by ${c.sanityIds.join(', ')} — held back`)
  for (const r of plan.insert) console.log(`  + ${r.slug}  (${r.country}, ${r.time_zone}${r.starts_at ? `, ${r.starts_at.slice(0, 10)}` : ''})`)
  for (const r of plan.update) console.log(`  ~ ${r.slug}`)

  if (!APPLY) {
    console.log('\nDry run: nothing written. Re-run with --apply to write.')
    return
  }
  const rows = [...plan.insert, ...plan.update]
  for (let i = 0; i < rows.length; i += 50) {
    const { error: upsertError } = await upsertEventRows(db, rows.slice(i, i + 50))
    if (upsertError) {
      console.error(`Upsert failed at batch ${i / 50 + 1}: ${upsertError}`)
      process.exit(1)
    }
  }
  console.log(`\nWrote ${rows.length} row(s).`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
