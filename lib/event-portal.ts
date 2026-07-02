import { supabaseServer } from '@/lib/supabase'
import { getEventsBySlugs, getAllEvents, getAllCampaigns } from '@/lib/sanity'
import { registrationStatus } from '@/lib/utils'
import {
  type CommunityMember,
  memberCanAccess,
  signedDownloadUrl,
} from '@/lib/community'

// FR-COM-13 — Event & Campaign portal.
// Lets a member access materials for the events/campaigns they're registered for.
// Participation resolves through the competition container roster (cohort_members
// on event_participation containers, migration 062 / P1); the activity type (live
// event vs campaign) and the Sanity _id come from the CMS.

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

  // The competitions the member is on the roster for: active cohort_members rows on
  // event_participation containers (migration 062). campaign_ref is the event_slug.
  const { data: rosters } = await db
    .from('cohort_members')
    .select('mentoring_cohorts!inner(campaign_ref, name, container_type)')
    .eq('member_id', member.id)
    .eq('status', 'active')

  type Row = {
    mentoring_cohorts:
      | { campaign_ref: string | null; name: string; container_type: string }
      | { campaign_ref: string | null; name: string; container_type: string }[]
      | null
  }
  const conts = ((rosters ?? []) as unknown as Row[])
    .map((r) => (Array.isArray(r.mentoring_cohorts) ? r.mentoring_cohorts[0] : r.mentoring_cohorts))
    .filter(
      (c): c is { campaign_ref: string; name: string; container_type: string } =>
        !!c && c.container_type === 'event_participation' && !!c.campaign_ref,
    )

  // De-dupe by slug; keep the first container name (minus any " — group" suffix)
  // as a title fallback for when Sanity can't resolve the event.
  const bySlug = new Map<string, string>()
  for (const c of conts) if (!bySlug.has(c.campaign_ref)) bySlug.set(c.campaign_ref, c.name.split(' — ')[0])

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

/** A row in the member-facing event/campaign catalog. Either something the
 *  member is already registered for, or an upcoming event/campaign they could
 *  register for (shown regardless of whether registration is currently open). */
export interface CatalogEvent {
  slug: string
  title: string
  /** 'live_event' | 'campaign'. */
  activityType: string
  date?: string
  city?: string
  state?: string
  /** True when the member is a confirmed participant of this event. */
  registered: boolean
  /** Derived registration window state, for the status badge. */
  status: 'open' | 'coming-soon' | 'closed'
}

const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000

/**
 * The member-facing catalog (FR-COM-13, "My Events & Campaigns" → browse):
 *   • every event/campaign the member is registered for, plus
 *   • all other live events and campaigns available in the next 12 months,
 *     INCLUDING ones whose registration hasn't opened yet.
 * Registration-status-agnostic by design — the window, not the open flag,
 * decides visibility. De-duplicated by slug; registered entries win.
 */
export async function getMemberEventCatalog(member: CommunityMember): Promise<CatalogEvent[]> {
  const now = Date.now()
  const horizon = now + TWELVE_MONTHS_MS
  const currentYear = new Date().getFullYear()

  const [registered, allEvents, allCampaigns] = await Promise.all([
    getMemberEvents(member),
    getAllEvents().catch(() => null),
    getAllCampaigns().catch(() => null),
  ])

  const bySlug = new Map<string, CatalogEvent>()

  // 1) Upcoming live events within the 12-month window (any registration state).
  type EventDoc = {
    slug?: { current?: string }
    title?: string
    date?: string
    city?: string
    state?: string
    activityType?: string
    registrationOpen?: boolean
    registrationOpenDate?: string
    registrationCloseDate?: string
  }
  for (const e of (allEvents ?? []) as EventDoc[]) {
    const slug = e.slug?.current
    if (!slug) continue
    if (e.date) {
      const t = new Date(e.date).getTime()
      if (Number.isFinite(t) && (t < now || t > horizon)) continue // outside window
    }
    bySlug.set(slug, {
      slug,
      title: e.title ?? slug,
      activityType: e.activityType ?? 'live_event',
      date: e.date,
      city: e.city,
      state: e.state,
      registered: false,
      status: registrationStatus(e.registrationOpenDate, e.registrationCloseDate),
    })
  }

  // 2) Current/upcoming campaigns (no fixed date — bound by campaign year).
  type CampaignDoc = {
    slug?: { current?: string }
    title?: string
    campaignYear?: number
    registrationOpen?: boolean
  }
  for (const c of (allCampaigns ?? []) as CampaignDoc[]) {
    const slug = c.slug?.current
    if (!slug) continue
    if (typeof c.campaignYear === 'number' && c.campaignYear < currentYear) continue // past campaign
    bySlug.set(slug, {
      slug,
      title: c.title ?? slug,
      activityType: 'campaign',
      registered: false,
      // Campaigns keep their manual on/off toggle (no live-event Open/Close dates).
      status: c.registrationOpen ? 'open' : 'closed',
    })
  }

  // 3) Overlay the member's registrations — these always appear, even if the
  //    event is outside the catalog window (e.g. already started).
  for (const r of registered) {
    const existing = bySlug.get(r.slug)
    if (existing) {
      existing.registered = true
    } else {
      bySlug.set(r.slug, {
        slug: r.slug,
        title: r.title,
        activityType: r.activityType,
        date: r.date,
        registered: true,
        status: 'closed',
      })
    }
  }

  // Sort: dated soonest-first, undated (campaigns) last; stable by title.
  return [...bySlug.values()].sort((a, b) => {
    const ta = a.date ? new Date(a.date).getTime() : Number.POSITIVE_INFINITY
    const tb = b.date ? new Date(b.date).getTime() : Number.POSITIVE_INFINITY
    if (ta !== tb) return ta - tb
    return a.title.localeCompare(b.title)
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
