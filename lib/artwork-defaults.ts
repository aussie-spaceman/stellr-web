import type { SupabaseClient } from '@supabase/supabase-js'
import { getEventBySlug } from '@/lib/sanity'
import { artworkTheme, type ArtworkTheme } from '@/lib/artwork-theme'

// ── Default artwork: what an event falls back to ─────────────────────────────
// Every certificate, badge and PD page has a default per theme
// (default_certificate_templates, default_badge_templates, and the files at
// pd-certificate/<theme>/…), and an event's own upload overrides it. Admins set
// the defaults on Competitions → Default artwork (30 Oct 2026); the first set
// is the Colorado Space Design Challenge's artwork.
//
// Replacing a default must not change a certificate someone already holds: a
// member can download theirs again at any time. So before a default's artwork
// changes, every event that has issued on it gets its own copy (the pin* helpers
// in lib/event-certificates.ts and lib/pd-certificate-store.ts). Badges are
// printed before the event and never downloaded later, so they are not pinned.

/**
 * The theme an event's artwork comes from: its Sanity type, as the credential
 * routes use. Without Sanity (CI, or a deleted event) the slug decides, which
 * names the theme for every event so far.
 */
export async function eventArtworkTheme(slug: string): Promise<ArtworkTheme> {
  const event = (await getEventBySlug(slug).catch(() => null)) as { type?: string } | null
  return artworkTheme(event?.type ?? slug)
}

/**
 * Every event that has issued a credential of this kind and theme. Revoked
 * credentials count: an award can be reinstated, and pinning an extra event
 * costs nothing.
 */
export async function eventsIssuedOn(
  db: SupabaseClient,
  q: { source: 'event' | 'pd'; theme: ArtworkTheme; awardType?: string },
): Promise<string[]> {
  const slugs = new Set<string>()
  const PAGE = 1000 // PostgREST's row cap
  for (let from = 0; ; from += PAGE) {
    let query = db
      .from('credentials')
      .select('event_slug')
      .eq('source', q.source)
      .eq('theme', q.theme)
      .is('tombstoned_at', null)
      .not('event_slug', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1)
    if (q.awardType) query = query.eq('award_type', q.awardType)
    const { data, error } = await query
    if (error) throw new Error(`[artwork-defaults] issued events: ${error.message}`)
    for (const r of (data ?? []) as { event_slug: string }[]) slugs.add(r.event_slug)
    if ((data ?? []).length < PAGE) break
  }
  return [...slugs].sort()
}
