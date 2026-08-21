/**
 * Audit script — finds event data orphaned by a slug rename.
 *
 * `event_slug` is the join key from Sanity to every event-scoped table, and
 * Postgres has no foreign key to Sanity. Renaming a slug in the Studio is
 * therefore silent data loss: the rows keep existing, they just stop resolving
 * to any event. Nothing errors, so nothing surfaces it — this does.
 *
 * Compares every distinct event_slug in the database against the slugs
 * currently published in Sanity, and reports the ones with no match, table by
 * table. Exits non-zero when any are found, so it can gate a deploy.
 *
 * Read-only. To repair what it reports, use:
 *   npm run fix:event-slug -- --from <old> --to <new>
 *
 * Prerequisites (.env.local): NEXT_PUBLIC_SANITY_PROJECT_ID,
 * NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Run:
 *   npm run audit:event-slugs
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'

// ESM hoists static imports above this call, so nothing imported above may read
// env at module scope — Sanity is queried over raw fetch for that reason.
const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : {})

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production'
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const missing = [
  !projectId && 'NEXT_PUBLIC_SANITY_PROJECT_ID',
  !supabaseUrl && 'NEXT_PUBLIC_SUPABASE_URL',
  !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY',
].filter(Boolean)

if (missing.length) {
  console.error(`❌  Missing env: ${missing.join(', ')}`)
  process.exit(1)
}

interface InventoryRow {
  event_slug: string
  table_name: string
  row_count: number
}

async function sanitySlugs(): Promise<Set<string>> {
  const query = '*[_type=="event" && defined(slug.current)].slug.current'
  const url =
    `https://${projectId}.api.sanity.io/v2024-01-01/data/query/${dataset}` +
    `?query=${encodeURIComponent(query)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Sanity query failed: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { result?: string[] }
  return new Set(body.result ?? [])
}

async function main() {
  const db = createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false } })
  const [live, { data, error }] = await Promise.all([
    sanitySlugs(),
    db.rpc('event_slug_inventory'),
  ])
  if (error) throw new Error(`event_slug_inventory failed: ${error.message}`)

  const rows = (data ?? []) as InventoryRow[]
  const orphaned = new Map<string, InventoryRow[]>()
  for (const row of rows) {
    if (live.has(row.event_slug)) continue
    const list = orphaned.get(row.event_slug) ?? []
    list.push(row)
    orphaned.set(row.event_slug, list)
  }

  const dbSlugs = new Set(rows.map((r) => r.event_slug))
  console.log(
    `\nEvent slugs — ${live.size} published in Sanity, ${dbSlugs.size} referenced in the database (${dataset})\n`,
  )

  if (orphaned.size === 0) {
    console.log('✅  Every slug in the database matches a published event.\n')
    return
  }

  let total = 0
  for (const [slug, list] of [...orphaned].sort()) {
    const n = list.reduce((sum, r) => sum + Number(r.row_count), 0)
    total += n
    console.log(`❌  ${slug} — ${n} row(s) with no matching event in Sanity`)
    for (const r of list.sort((a, b) => a.table_name.localeCompare(b.table_name))) {
      console.log(`      ${String(r.row_count).padStart(4)}  ${r.table_name}`)
    }
  }

  console.log(
    `\n${total} orphaned row(s) across ${orphaned.size} slug(s). If a slug was renamed, repoint the data with:\n` +
      `   npm run fix:event-slug -- --from <old-slug> --to <new-slug>\n`,
  )
  process.exitCode = 1
}

main().catch((e) => {
  console.error('❌ ', e)
  process.exit(1)
})
