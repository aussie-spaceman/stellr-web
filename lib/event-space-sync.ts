import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureEventContainer } from '@/lib/container-sync'
import { reconcileEventSpaceRoster } from '@/lib/space-inheritance'

// Sanity event → its Space, kept in step automatically.
//
// THE RULE: every event published in Sanity has exactly one Space, carrying the
// event's own name, and the pairing survives the event's slug changing.
//
// WHY THE _id MATTERS. Everything joining Postgres to Sanity is a bare text
// slug — community_space_sources.object_ref, mentoring_cohorts.campaign_ref,
// registrations.event_slug — with no foreign key behind any of it. Renaming a
// slug in the Studio therefore used to fork the world in two: the old rows kept
// the old slug and stopped resolving, and this sync (keyed on slug, with
// ignoreDuplicates) quietly created a SECOND Space for what is one event. The
// Sanity document _id never changes, so it is what we match on; the slug is
// treated as mutable data that gets repaired when it moves.
//
// Recorded on the Space as community_spaces.sanity_event_id (migration 144).
//
// Shared by the Sanity webhook (app/api/admin/sanity/event-sync) and the
// backfill (`npm run sync:event-spaces`), so a one-off repair and the steady
// state can never disagree about what "in sync" means.

export interface SanityEventRef {
  /** Sanity document _id — the durable identity. */
  sanityId: string
  slug: string
  title: string
}

export interface EventSpaceSyncResult {
  spaceId: string | null
  containerId: string | null
  /** A Space was created rather than found. */
  created: boolean
  /** The event's slug had moved; this is what it used to be. */
  renamedFrom: string | null
  /** Space slug left alone because the event slug was taken by another Space. */
  slugCollision: boolean
  /** Tier/role grants stripped because this Space now belongs to an event. */
  grantsCleared: number
  notes: string[]
}

interface SpaceRow {
  id: string
  slug: string
  name: string
  sanity_event_id: string | null
}

/**
 * Find this event's Space, tolerating rows written before sanity_event_id
 * existed. In order of trust:
 *   1. the _id  — set by this function, always correct
 *   2. the event source link — how every Space created before 144 was joined
 *   3. the Space slug matching the event slug — the original convention
 */
async function findSpace(db: SupabaseClient, ev: SanityEventRef): Promise<SpaceRow | null> {
  const cols = 'id, slug, name, sanity_event_id'

  const byId = await db.from('community_spaces').select(cols).eq('sanity_event_id', ev.sanityId).maybeSingle()
  if (byId.data) return byId.data as SpaceRow

  const { data: links } = await db
    .from('community_space_sources')
    .select('space_id')
    .eq('object_type', 'event')
    .eq('object_ref', ev.slug)
  const linkedIds = ((links ?? []) as Array<{ space_id: string }>).map((r) => r.space_id)
  if (linkedIds.length) {
    // An unadopted Space (sanity_event_id still null) is the one we want; a Space
    // already claimed by a DIFFERENT event must not be stolen from it.
    const { data } = await db
      .from('community_spaces')
      .select(cols)
      .in('id', linkedIds)
      .is('sanity_event_id', null)
      .limit(1)
    if (data?.length) return data[0] as SpaceRow
  }

  const bySlug = await db.from('community_spaces').select(cols).eq('slug', ev.slug).maybeSingle()
  if (bySlug.data && (bySlug.data as SpaceRow).sanity_event_id === null) return bySlug.data as SpaceRow

  return null
}

/** The event slug this Space is currently linked to, if any. */
async function currentLinkedSlug(db: SupabaseClient, spaceId: string): Promise<string | null> {
  const { data } = await db
    .from('community_space_sources')
    .select('object_ref')
    .eq('space_id', spaceId)
    .eq('object_type', 'event')
    .limit(1)
  return ((data ?? []) as Array<{ object_ref: string }>)[0]?.object_ref ?? null
}

/**
 * Bring one Sanity event's Space into line: create it if missing, rename it to
 * the event's current title, repair the slug everywhere if it has moved, keep
 * the event link and the container pointed at it, and re-backfill the roster.
 *
 * Idempotent — running it on an already-correct event changes nothing.
 */
export async function syncEventSpace(
  db: SupabaseClient,
  ev: SanityEventRef,
): Promise<EventSpaceSyncResult> {
  const notes: string[] = []
  const result: EventSpaceSyncResult = {
    spaceId: null, containerId: null, created: false,
    renamedFrom: null, slugCollision: false, grantsCleared: 0, notes,
  }

  const existing = await findSpace(db, ev)

  // ── 1. Repair a moved slug across every table that stores one ──────────────
  //
  // The old slug is whatever this Space is currently linked to. rename_event_slug
  // (migration 144) covers event_slug columns plus campaign_ref and object_ref,
  // so the containers move with everything else — the hop that was missed last
  // time, which is why every event Space had an empty roster.
  if (existing) {
    const linked = await currentLinkedSlug(db, existing.id)
    if (linked && linked !== ev.slug) {
      const { error } = await db.rpc('rename_event_slug', { p_old: linked, p_new: ev.slug })
      if (error) {
        notes.push(`slug repair ${linked} → ${ev.slug} failed: ${error.message}`)
      } else {
        result.renamedFrom = linked
        notes.push(`repaired slug ${linked} → ${ev.slug}`)
      }
    }
  }

  // ── 2. The event container ────────────────────────────────────────────────
  const containerId = await ensureEventContainer(db, ev.slug, ev.title)
  result.containerId = containerId
  if (containerId) {
    await db
      .from('mentoring_cohorts')
      .update({ sanity_event_id: ev.sanityId })
      .eq('campaign_ref', ev.slug)
      .eq('container_type', 'event_participation')
  }

  // ── 3. The Space itself ───────────────────────────────────────────────────
  let spaceId: string | null = existing?.id ?? null

  if (!existing) {
    // Space slug mirrors the event slug. If that name is taken by an unrelated
    // Space, fall back to an _id-suffixed slug rather than failing the sync —
    // the Space is found by _id, so its slug is cosmetic.
    const { data: clash } = await db.from('community_spaces').select('id').eq('slug', ev.slug).maybeSingle()
    const slug = clash ? `${ev.slug}-${ev.sanityId.slice(0, 6).toLowerCase()}` : ev.slug
    if (clash) {
      result.slugCollision = true
      notes.push(`slug '${ev.slug}' taken; created as '${slug}'`)
    }
    const { data: created, error } = await db
      .from('community_spaces')
      .insert({
        slug,
        name: ev.title,
        description: `Space for everyone taking part in ${ev.title}.`,
        access_type: 'private',
        min_tier_rank: 0,
        display_order: 50,
        sanity_event_id: ev.sanityId,
      })
      .select('id')
      .maybeSingle()
    if (error || !created) {
      notes.push(`space create failed: ${error?.message ?? 'no row returned'}`)
      return result
    }
    spaceId = (created as { id: string }).id
    result.created = true
  } else {
    // Adopt + retitle. The name tracks Sanity: that is the rule, and it is what
    // stops Spaces drifting to things like '2027 Nevada …' once the year is
    // pulled from the event.
    const patch: Record<string, unknown> = { sanity_event_id: ev.sanityId }
    if (existing.name !== ev.title) {
      patch.name = ev.title
      notes.push(`renamed Space '${existing.name}' → '${ev.title}'`)
    }
    if (existing.slug !== ev.slug) {
      const { data: clash } = await db
        .from('community_spaces').select('id').eq('slug', ev.slug).neq('id', existing.id).maybeSingle()
      if (clash) {
        result.slugCollision = true
        notes.push(`Space slug left as '${existing.slug}' — '${ev.slug}' belongs to another Space`)
      } else {
        patch.slug = ev.slug
        notes.push(`Space slug '${existing.slug}' → '${ev.slug}'`)
      }
    }
    const { error } = await db.from('community_spaces').update(patch).eq('id', existing.id)
    if (error) notes.push(`space update failed: ${error.message}`)
  }

  if (!spaceId) return result
  result.spaceId = spaceId

  // ── 4. The event link ─────────────────────────────────────────────────────
  await db.from('community_space_sources').upsert(
    { space_id: spaceId, object_type: 'event', object_ref: ev.slug },
    { onConflict: 'space_id,object_type,object_ref', ignoreDuplicates: true },
  )

  // ── 5. An event Space grants access through the event, and only that ───────
  // Mirrors the admin API's refusal and lib/spaces' read-time suppression, so a
  // Space adopted from the old hand-built world sheds its org-wide role grants
  // the first time this runs over it.
  for (const table of ['community_space_tiers', 'community_space_roles'] as const) {
    const { data } = await db.from(table).delete().eq('space_id', spaceId).select('space_id')
    const n = data?.length ?? 0
    if (n) {
      result.grantsCleared += n
      notes.push(`cleared ${n} ${table === 'community_space_tiers' ? 'tier' : 'role'} grant(s)`)
    }
  }

  // ── 6. A channel to talk in ───────────────────────────────────────────────
  const { data: channel } = await db
    .from('community_channels').select('id').eq('space_id', spaceId).eq('slug', 'general').maybeSingle()
  if (!channel) {
    await db.from('community_channels')
      .insert({ space_id: spaceId, slug: 'general', name: 'General', display_order: 0 })
  }

  // ── 7. Backfill the roster from the event ─────────────────────────────────
  await reconcileEventSpaceRoster(db, ev.slug)

  return result
}
