import { NextResponse } from 'next/server'
import { client } from '@/lib/sanity'
import { supabaseServer } from '@/lib/supabase'
import { currentUserHasScope } from '@/lib/admin-auth'

// Guard behind the Sanity Studio's slug field.
//
// `event_slug` is the join key from Sanity into ~15 event-scoped tables and
// Postgres has no foreign key to Sanity, so renaming a published event's slug
// silently strands every row that referenced the old one — no error, no
// warning, the data just stops resolving. It happened on 21 Aug 2026: three
// slug edits orphaned 30 rows across five tables.
//
// Studio validation calls this before allowing a slug change. It answers one
// question: would changing THIS document's slug to `slug` leave rows behind?
//
// GET ?id=<sanity doc id, drafts. prefix stripped>&slug=<proposed slug>
//   → { blocked: boolean, currentSlug, total, counts[], message? }

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!(await currentUserHasScope('events'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const id = (url.searchParams.get('id') ?? '').replace(/^drafts\./, '')
  const proposed = url.searchParams.get('slug') ?? ''
  if (!id || !proposed) {
    return NextResponse.json({ error: 'id and slug are required' }, { status: 400 })
  }

  // The PUBLISHED slug is the one the database rows were written against; the
  // draft already holds the editor's proposed value, so it can't be compared.
  // No Sanity client configured = nothing to compare against; fail open.
  const currentSlug: string | null = client
    ? await client
        .fetch<string | null>('*[_id == $id][0].slug.current', { id })
        .catch(() => null)
    : null

  // Never published, or the slug isn't changing — nothing can be orphaned.
  if (!currentSlug || currentSlug === proposed) {
    return NextResponse.json({ blocked: false, currentSlug, total: 0, counts: [] })
  }

  const db = supabaseServer()
  const { data, error } = await db.rpc('event_slug_row_counts', { p_slug: currentSlug })
  if (error) {
    // Fail open: a guard that can't reach the database must not make the Studio
    // unusable. The audit script is the backstop that catches what slips past.
    console.error('[slug-guard] event_slug_row_counts failed', error)
    return NextResponse.json({ blocked: false, currentSlug, total: 0, counts: [] })
  }

  const counts = (data ?? []) as { table_name: string; row_count: number }[]
  const total = counts.reduce((sum, r) => sum + Number(r.row_count), 0)
  if (total === 0) {
    return NextResponse.json({ blocked: false, currentSlug, total, counts })
  }

  const breakdown = counts
    .map((r) => `${r.row_count} ${r.table_name}`)
    .join(', ')

  return NextResponse.json({
    blocked: true,
    currentSlug,
    total,
    counts,
    message:
      `Renaming this slug would orphan ${total} database row(s) still filed under "${currentSlug}" ` +
      `(${breakdown}). Registrations, refunds and orders are keyed by slug, so they would stop ` +
      `resolving to this event. Publish the rename only together with: ` +
      `npm run fix:event-slug -- --from ${currentSlug} --to ${proposed} --apply`,
  })
}
