import { supabaseServer } from '@/lib/supabase'
import { getEventsBySlugs } from '@/lib/sanity'
import {
  type CommunityMember,
  memberCanAccess,
  signedDownloadUrl,
} from '@/lib/community'

// FR-COM-13 — Event & Campaign portal.
// Lets a member access materials for the events/campaigns they're registered for.
// Registration lives in the `participants` + `registrations` tables; the activity
// type (live event vs campaign) and the Sanity _id come from the CMS.

export interface PortalEvent {
  /** Sanity event _id — the target_ref for entitlements/materials. May be null
   *  when the event isn't (yet) resolvable in Sanity; falls back to slug. */
  eventId: string | null
  slug: string
  title: string
  /** 'live_event' | 'campaign' | undefined (legacy events default to live). */
  activityType: string
  date?: string
}

/**
 * All events/campaigns the member is a confirmed participant in.
 * De-duplicated by event slug (a member can appear once per event).
 */
export async function getMemberEvents(member: CommunityMember): Promise<PortalEvent[]> {
  const db = supabaseServer()

  const { data: participations } = await db
    .from('participants')
    .select('registrations(event_slug, event_title)')
    .eq('member_id', member.id)

  type Row = { registrations: { event_slug: string; event_title: string } | { event_slug: string; event_title: string }[] | null }
  const regs = ((participations ?? []) as unknown as Row[])
    .map((p) => (Array.isArray(p.registrations) ? p.registrations[0] : p.registrations))
    .filter((r): r is { event_slug: string; event_title: string } => !!r?.event_slug)

  // De-dupe by slug, keeping the first title we see.
  const bySlug = new Map<string, string>()
  for (const r of regs) if (!bySlug.has(r.event_slug)) bySlug.set(r.event_slug, r.event_title)

  const slugs = [...bySlug.keys()]
  if (slugs.length === 0) return []

  // Enrich with Sanity activityType + _id; fall back gracefully if not found.
  const meta = await getEventsBySlugs(slugs)
  const metaBySlug = new Map(meta.map((m) => [m.slug.current, m]))

  return slugs.map((slug) => {
    const m = metaBySlug.get(slug)
    return {
      eventId: m?._id ?? null,
      slug,
      title: m?.title ?? bySlug.get(slug) ?? slug,
      activityType: m?.activityType ?? 'live_event',
      date: m?.date,
    } satisfies PortalEvent
  })
}

/** Whether the member is a participant of the given event slug (access guard). */
export async function memberIsParticipant(member: CommunityMember, slug: string): Promise<PortalEvent | null> {
  const events = await getMemberEvents(member)
  return events.find((e) => e.slug === slug) ?? null
}

export interface PortalMaterial {
  id: string
  title: string
  description: string | null
  file_type: string | null
  min_tier_rank: number
  /** Resolved per-member: whether they can download (entitlement-aware). */
  canDownload: boolean
}

/**
 * Materials attached to an event (community_resources rows whose event_ref is the
 * event's Sanity _id). Each material's download access is resolved against the
 * entitlement engine (with min_tier_rank fallback).
 */
export async function getEventMaterials(
  member: CommunityMember,
  event: PortalEvent
): Promise<PortalMaterial[]> {
  if (!event.eventId) return []
  const db = supabaseServer()

  const { data: resources } = await db
    .from('community_resources')
    .select('id, title, description, file_type, min_tier_rank, material_kind')
    .eq('event_ref', event.eventId)
    .order('created_at', { ascending: false })

  const targetType = event.activityType === 'campaign' ? 'campaign_material' : 'event_material'

  const out: PortalMaterial[] = []
  for (const r of resources ?? []) {
    const canDownload = await memberCanAccess(
      member,
      targetType,
      event.eventId,
      r.min_tier_rank,
      'download'
    )
    out.push({
      id: r.id,
      title: r.title,
      description: r.description,
      file_type: r.file_type,
      min_tier_rank: r.min_tier_rank,
      canDownload,
    })
  }
  return out
}

/** Re-export for routes that issue download links after the access check. */
export { signedDownloadUrl }
