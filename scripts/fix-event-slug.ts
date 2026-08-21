/**
 * Repair script — repoints every database row from one event slug to another.
 *
 * Run this whenever an event's slug changes in Sanity. `event_slug` is the join
 * key from Sanity into ~15 event-scoped tables with no foreign key behind it,
 * so a rename in the Studio silently strands every existing row: registrations,
 * refunds, store orders, companies, settings, join tokens. Nothing errors.
 *
 * The update runs inside one transaction over every table carrying an
 * `event_slug` column, discovered from the catalog rather than a list here (see
 * migration 138) — a table added later is covered without editing this script.
 *
 * Dry run by default: it prints what would move and writes nothing.
 *
 * Run:
 *   npm run fix:event-slug -- --from old-slug --to new-slug           # dry run
 *   npm run fix:event-slug -- --from old-slug --to new-slug --apply   # writes
 *
 * Prerequisites (.env.local): NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SANITY_PROJECT_ID
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'

// ESM hoists static imports above this call, so nothing imported above may read
// env at module scope — Sanity is queried over raw fetch for that reason.
const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : {})

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const from = arg('from')
const to = arg('to')
const apply = process.argv.includes('--apply')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production'

if (!from || !to) {
  console.error('Usage: npm run fix:event-slug -- --from <old-slug> --to <new-slug> [--apply]')
  process.exit(1)
}
if (from === to) {
  console.error('❌  --from and --to are the same slug; nothing to do.')
  process.exit(1)
}
if (!supabaseUrl || !serviceKey) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

interface CountRow {
  table_name: string
  row_count: number
}

/** Is `slug` a currently published Sanity event? Guards against a typo'd --to. */
async function existsInSanity(slug: string): Promise<boolean | null> {
  if (!projectId) return null
  const query = `count(*[_type=="event" && slug.current=="${slug}"])`
  const url =
    `https://${projectId}.api.sanity.io/v2024-01-01/data/query/${dataset}` +
    `?query=${encodeURIComponent(query)}`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const body = (await res.json()) as { result?: number }
    return (body.result ?? 0) > 0
  } catch {
    return null
  }
}

async function main() {
  const db = createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false } })

  const { data: before, error: countErr } = await db.rpc('event_slug_row_counts', { p_slug: from })
  if (countErr) throw new Error(`event_slug_row_counts failed: ${countErr.message}`)
  const rows = (before ?? []) as CountRow[]
  const total = rows.reduce((sum, r) => sum + Number(r.row_count), 0)

  console.log(`\n${from}  →  ${to}\n`)
  if (total === 0) {
    console.log(`No rows reference "${from}" — nothing to repoint.\n`)
    return
  }
  for (const r of rows) console.log(`   ${String(r.row_count).padStart(4)}  ${r.table_name}`)
  console.log(`\n   ${total} row(s) total`)

  // A typo in --to would strand the data under a slug nobody serves, which is
  // the exact failure this script exists to undo. Warn, but don't block: the
  // target may legitimately not be published yet.
  const published = await existsInSanity(to!)
  if (published === false) {
    console.log(`\n⚠️   "${to}" is not a published event slug in Sanity — check for a typo.`)
  }

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to perform the rename.\n')
    return
  }

  const { data: after, error: renameErr } = await db.rpc('rename_event_slug', {
    p_old: from,
    p_new: to,
  })
  if (renameErr) throw new Error(`rename_event_slug failed: ${renameErr.message}`)

  const moved = ((after ?? []) as { table_name: string; rows_updated: number }[]).reduce(
    (sum, r) => sum + Number(r.rows_updated),
    0,
  )
  console.log(`\n✅  Repointed ${moved} row(s) to "${to}".`)

  // Confirm the old slug is fully drained rather than trusting the return value.
  const { data: leftover } = await db.rpc('event_slug_row_counts', { p_slug: from })
  const remaining = ((leftover ?? []) as CountRow[]).reduce((s, r) => s + Number(r.row_count), 0)
  if (remaining > 0) {
    console.error(`❌  ${remaining} row(s) still reference "${from}" — investigate before continuing.`)
    process.exitCode = 1
    return
  }
  console.log(`   No rows remain under "${from}".\n`)
}

main().catch((e) => {
  console.error('❌ ', e)
  process.exit(1)
})
