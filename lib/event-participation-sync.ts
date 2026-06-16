import type { SupabaseClient } from '@supabase/supabase-js'
import { applyGrantTrigger } from '@/lib/membership-grants'
import { logActivity } from '@/lib/activity-log'

// Content tiers are cumulative; only ever upgrade a participation, never downgrade.
const CONTENT_TIER_RANK: Record<string, number> = { core: 0, baseline: 1, advanced: 2, premium: 3 }

// Records a member's event registration into event_participations so the event
// surfaces in the "Event Activity" lists on the member portal, the admin member
// page, and the read-only view-as page — those all read event_participations,
// NOT registrations/participants, which is why a fresh registration was
// invisible there.
//
// Idempotent on (member_id, event_slug) and non-fatal: registration must never
// fail because of this. status defaults to 'approved' so it shows immediately
// (registration IS confirmed participation; the pending/approved workflow is
// only for member-submitted historical records). Requires the event_slug /
// event_title columns added by migration 034 — until that runs the insert is a
// logged no-op.
export async function recordEventParticipation(
  db: SupabaseClient,
  p: {
    memberId: string | null | undefined
    eventSlug: string | null | undefined
    eventTitle?: string | null
    eventYear?: number | null
    /** Competition content tier purchased for this participant (Phase 2). */
    contentTier?: string | null
  },
): Promise<void> {
  if (!p.memberId || !p.eventSlug) return
  try {
    const { data: existing } = await db
      .from('event_participations')
      .select('id, content_tier')
      .eq('member_id', p.memberId)
      .eq('event_slug', p.eventSlug)
      .maybeSingle()
    if (existing) {
      // Upgrade the content tier if a higher one was purchased; never downgrade.
      const cur = (existing.content_tier as string | null) ?? null
      if (
        p.contentTier &&
        (CONTENT_TIER_RANK[p.contentTier] ?? 0) > (cur ? CONTENT_TIER_RANK[cur] ?? -1 : -1)
      ) {
        await db.from('event_participations').update({ content_tier: p.contentTier }).eq('id', existing.id)
      }
      return
    }

    const { error } = await db.from('event_participations').insert({
      member_id: p.memberId,
      event_slug: p.eventSlug,
      event_title: p.eventTitle || null,
      event_year: p.eventYear ?? new Date().getFullYear(),
      status: 'approved',
      content_tier: p.contentTier ?? null,
    })
    if (error) {
      console.error('[event-participation] insert error (non-fatal):', error)
    } else {
      await logActivity({
        memberId: p.memberId,
        category: 'event',
        action: 'event_registered',
        summary: `Registered for ${p.eventTitle || p.eventSlug}`,
        metadata: { eventSlug: p.eventSlug, eventTitle: p.eventTitle ?? null, contentTier: p.contentTier ?? null },
        actorType: 'system',
      }, db)
    }
  } catch (e) {
    console.error('[event-participation] recordEventParticipation failed (non-fatal):', e)
  }
}

// Cascade a group registration's purchased Content Tier to every enrolled member
// (decision D3: the nominated adult / Student Manager buys for the whole group),
// and fire the campaign_enrollment grant for Premium (D2 → Pathfinder 12mo).
//
// Call this once the tier is final: at creation for free Baseline, and from the
// Stripe webhook's confirmRegistration for paid Advanced/Premium (so the paid
// membership grant only lands after payment). Idempotent + non-fatal: grantTier
// no-ops if the member already holds the tier, and content-tier upgrades only.
// The content tier to actually apply: free Baseline unlocks at registration, but
// paid Advanced/Premium only once the registration is confirmed (payment cleared),
// so no one gets paid content — or the Premium membership grant — before paying.
function effectiveContentTier(contentTier: string | null, status: string | null): string | null {
  if (!contentTier) return null
  if (contentTier === 'baseline') return 'baseline'
  return status === 'confirmed' ? contentTier : null
}

export async function applyCampaignContentTier(
  db: SupabaseClient,
  registrationId: string,
): Promise<void> {
  try {
    const { data: reg } = await db
      .from('registrations')
      .select('content_tier, event_slug, event_title, status')
      .eq('id', registrationId)
      .maybeSingle()
    if (!reg?.event_slug) return
    const tier = effectiveContentTier(
      (reg.content_tier as string | null) ?? null,
      (reg.status as string | null) ?? null,
    )
    if (!tier) return

    const { data: parts } = await db
      .from('participants')
      .select('member_id')
      .eq('registration_id', registrationId)
      .not('member_id', 'is', null)

    const memberIds = [...new Set((parts ?? []).map((p) => p.member_id as string).filter(Boolean))]

    for (const memberId of memberIds) {
      await recordEventParticipation(db, {
        memberId,
        eventSlug: reg.event_slug as string,
        eventTitle: reg.event_title as string | null,
        contentTier: tier,
      })
      // Premium enrollment grants a paid membership for the year (D2). Baseline /
      // Advanced grant content access only, so no membership change.
      if (tier === 'premium') {
        await applyGrantTrigger(memberId, 'campaign_enrollment', {}, db)
      }
    }
  } catch (e) {
    console.error('[event-participation] applyCampaignContentTier failed (non-fatal):', e)
  }
}

// Convenience wrapper for the team/portal/sheet paths that don't carry the event
// inline: look up the registration's event slug + title and record participation
// for every supplied member. Mirrors linkMembersToRegistrationSchool so the
// sheet-sync, Google-Sheets webhook, and portal add-participant routes stay
// one-liners. Non-fatal + idempotent.
export async function recordEventParticipationForRegistration(
  db: SupabaseClient,
  registrationId: string,
  memberIds: (string | null | undefined)[],
): Promise<void> {
  try {
    const ids = [...new Set(memberIds.filter((id): id is string => Boolean(id)))]
    if (ids.length === 0) return
    const { data: reg, error } = await db
      .from('registrations')
      .select('event_slug, event_title, content_tier, status')
      .eq('id', registrationId)
      .maybeSingle()
    if (error || !reg?.event_slug) return
    // Late-added members (sheet sync, portal add, teams) inherit the group's
    // content tier under the same payment gating as the rest of the roster.
    const tier = effectiveContentTier(
      (reg.content_tier as string | null) ?? null,
      (reg.status as string | null) ?? null,
    )
    await Promise.all(
      ids.map(async (memberId) => {
        await recordEventParticipation(db, {
          memberId,
          eventSlug: reg.event_slug as string,
          eventTitle: reg.event_title as string | null,
          contentTier: tier,
        })
        if (tier === 'premium') await applyGrantTrigger(memberId, 'campaign_enrollment', {}, db)
      }),
    )
  } catch (e) {
    console.error('[event-participation] recordEventParticipationForRegistration failed (non-fatal):', e)
  }
}
