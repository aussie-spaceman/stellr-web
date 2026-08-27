/**
 * Reconcile every published Sanity event with its Space.
 *
 * Rule: one Space per event, carrying the event's own name, linked to the event
 * by its Sanity document _id so the pairing survives a slug change.
 *
 * This is both the one-off repair (Spaces were built by hand, under names and
 * slugs that no longer match Sanity, and several were never created at all) and
 * the net that catches anything the webhook missed — a publish that fired while
 * the app was down, or an event that predates the webhook being configured. It
 * shares lib/event-space-sync with the webhook, so a run here and a publish in
 * the Studio converge on exactly the same result.
 *
 * For each event it will:
 *   • repair the slug across every table storing one, if it has moved
 *   • create the Space, or adopt and rename the existing one
 *   • record the _id on the Space and the event container
 *   • (re)link the Space to the event and backfill its roster
 *   • strip tier/role grants — an event Space grants through the event only
 *
 * Read-only by default. Pass --apply to write.
 *
 * Prerequisites (.env.local): NEXT_PUBLIC_SANITY_PROJECT_ID,
 * NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. SANITY_API_TOKEN too if
 * the dataset is private.
 *
 * Run:
 *   npm run sync:event-spaces            # dry run — reports, changes nothing
 *   npm run sync:event-spaces -- --apply
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'

// ESM hoists static imports above this call, so nothing imported above may read
// env at module scope. lib/supabase reads it lazily inside its functions, and
// Sanity is queried over raw fetch below, so both are safe.
const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : {})

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production'
const sanityToken = process.env.SANITY_API_TOKEN
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const missing = [
  !projectId && 'NEXT_PUBLIC_SANITY_PROJECT_ID',
  !supabaseUrl && 'NEXT_PUBLIC_SUPABASE_URL',
  !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY',
].filter(Boolean)
if (missing.length) {
  console.error(`Missing env: ${missing.join(', ')}`)
  process.exit(1)
}

const APPLY = process.argv.includes('--apply')

interface SanityEvent {
  _id: string
  title: string
  slug: string | null
}

async function fetchSanityEvents(): Promise<SanityEvent[]> {
  const query = `*[_type == "event" && defined(slug.current)]{ _id, title, "slug": slug.current }`
  const url =
    `https://${projectId}.api.sanity.io/v2024-01-01/data/query/${dataset}` +
    `?query=${encodeURIComponent(query)}`
  const res = await fetch(url, sanityToken ? { headers: { Authorization: `Bearer ${sanityToken}` } } : undefined)
  if (!res.ok) throw new Error(`Sanity query failed: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { result?: SanityEvent[] }
  return body.result ?? []
}

async function main() {
  const events = await fetchSanityEvents()
  console.log(`${events.length} published event(s) in Sanity\n`)
  if (events.length === 0) return

  const db = createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false } })

  // Preflight. Without migration 144 the sanity_event_id column does not exist,
  // every lookup below errors, and PostgREST hands back an empty result — which
  // reads as "no Space exists for any event" and would have this script create a
  // duplicate of all 12. Fail here instead, loudly, before anything is written.
  const preflight = await db.from('community_spaces').select('id, sanity_event_id').limit(1)
  if (preflight.error) {
    console.error(
      `Cannot read community_spaces.sanity_event_id — ${preflight.error.message}\n` +
      `Apply migration 144_event_space_identity.sql first, then re-run.`,
    )
    process.exit(1)
  }

  const { syncEventSpace } = await import('../lib/event-space-sync')

  if (!APPLY) {
    // Dry run: report what each event currently resolves to, without writing.
    const { data: spaces, error: spacesErr } = await db
      .from('community_spaces')
      .select('id, slug, name, sanity_event_id')
    const { data: links, error: linksErr } = await db
      .from('community_space_sources')
      .select('space_id, object_ref')
      .eq('object_type', 'event')
    // An error here would silently read as "nothing exists" and report every
    // event as needing a new Space.
    if (spacesErr || linksErr) {
      console.error(`Read failed: ${(spacesErr ?? linksErr)!.message}`)
      process.exit(1)
    }

    const byId = new Map((spaces ?? []).map((s) => [s.sanity_event_id, s]))
    const bySlug = new Map((spaces ?? []).map((s) => [s.slug, s]))
    const linkedSlug = new Map(
      (links ?? []).map((l) => [(l as { space_id: string }).space_id, (l as { object_ref: string }).object_ref]),
    )

    let willCreate = 0, willRename = 0, willRepair = 0
    for (const ev of events) {
      const found =
        byId.get(ev._id) ??
        (spaces ?? []).find((s) => linkedSlug.get(s.id) === ev.slug && !s.sanity_event_id) ??
        (bySlug.get(ev.slug!) && !bySlug.get(ev.slug!)!.sanity_event_id ? bySlug.get(ev.slug!) : undefined)

      if (!found) {
        willCreate++
        console.log(`  CREATE   ${ev.slug}\n           → Space "${ev.title}"`)
        continue
      }
      const notes: string[] = []
      if (found.name !== ev.title) { willRename++; notes.push(`rename "${found.name}" → "${ev.title}"`) }
      if (found.slug !== ev.slug) notes.push(`slug "${found.slug}" → "${ev.slug}"`)
      const linked = linkedSlug.get(found.id)
      if (linked && linked !== ev.slug) { willRepair++; notes.push(`REPAIR event slug ${linked} → ${ev.slug} across all tables`) }
      if (!found.sanity_event_id) notes.push('adopt (record _id)')
      console.log(notes.length ? `  UPDATE   ${ev.slug}\n           → ${notes.join('\n           → ')}` : `  ok       ${ev.slug}`)
    }
    console.log(
      `\nDry run — nothing written. ${willCreate} Space(s) to create, ` +
      `${willRename} to rename, ${willRepair} slug repair(s).\nRe-run with --apply to make these changes.`,
    )
    return
  }

  let created = 0, renamed = 0, failed = 0
  for (const ev of events) {
    try {
      const r = await syncEventSpace(db, { sanityId: ev._id, slug: ev.slug!, title: ev.title })
      if (r.created) created++
      if (r.renamedFrom) renamed++
      const label = r.created ? 'CREATED' : 'synced '
      console.log(`  ${label}  ${ev.slug}${r.spaceId ? '' : '  (NO SPACE)'}`)
      for (const note of r.notes) console.log(`           · ${note}`)
      if (!r.spaceId) failed++
    } catch (e) {
      failed++
      console.error(`  FAILED   ${ev.slug}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  console.log(`\n${created} created, ${renamed} slug repair(s), ${failed} failure(s).`)
  if (failed) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
