import type { SupabaseClient } from '@supabase/supabase-js'
import { logActivity } from '@/lib/activity-log'
import { applyGrantTrigger } from '@/lib/membership-grants'
import { ensureRosterMembership } from '@/lib/container-sync'
import { syncObjectSpaceRoster } from '@/lib/space-inheritance'

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
    /** When given, also sync the competition container roster (P1). */
    registrationId?: string | null
  },
): Promise<void> {
  if (!p.memberId || !p.eventSlug) return
  try {
    // Keep the competition container roster in sync — the member event portal
    // resolves access through it. Independent of the event_participations row.
    if (p.registrationId) {
      await ensureRosterMembership(db, p.registrationId, p.memberId)
    }

    // Roster them into the event's Space. This lives here, rather than in the
    // registration routes, because it has to hold for EVERY way a member can
    // come to be registered — and it did not: app/api/register/group and
    // group-join called syncObjectSpaceRoster themselves, but
    // app/api/register/individual never did, so a solo registrant got a
    // container row and no Space row and could not reach their own event Space.
    // Every path already funnels through here, so this is the seam that covers
    // all of them at once. Idempotent + non-fatal, like everything in this file.
    await syncObjectSpaceRoster(db, 'event', p.eventSlug, p.memberId)

    const { data: existing } = await db
      .from('event_participations')
      .select('id')
      .eq('member_id', p.memberId)
      .eq('event_slug', p.eventSlug)
      .maybeSingle()
    if (existing) return

    const { error } = await db.from('event_participations').insert({
      member_id: p.memberId,
      event_slug: p.eventSlug,
      event_title: p.eventTitle || null,
      event_year: p.eventYear ?? new Date().getFullYear(),
      status: 'approved',
    })
    if (error) {
      console.error('[event-participation] insert error (non-fatal):', error)
    } else {
      await logActivity({
        memberId: p.memberId,
        category: 'event',
        action: 'event_registered',
        summary: `Registered for ${p.eventTitle || p.eventSlug}`,
        metadata: { eventSlug: p.eventSlug, eventTitle: p.eventTitle ?? null },
        actorType: 'system',
      }, db)
      // Competition registration grant rules (e.g. school student → Pathfinder,
      // or N workshop/cohort credits). The rule's role condition decides who
      // qualifies; non-matchers are a no-op. Seeded on the event slug so a credit
      // grant fires once per member per event. Non-fatal.
      await applyGrantTrigger(p.memberId, 'competition_registration', { grantKeySeed: p.eventSlug }, db)
    }
  } catch (e) {
    console.error('[event-participation] recordEventParticipation failed (non-fatal):', e)
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
      .select('event_slug, event_title')
      .eq('id', registrationId)
      .maybeSingle()
    if (error || !reg?.event_slug) return
    await Promise.all(
      ids.map((memberId) =>
        recordEventParticipation(db, {
          memberId,
          eventSlug: reg.event_slug as string,
          eventTitle: reg.event_title as string | null,
          registrationId,
        }),
      ),
    )
  } catch (e) {
    console.error('[event-participation] recordEventParticipationForRegistration failed (non-fatal):', e)
  }
}

// deep review REG-10: the inverse of recordEventParticipation. When a member is
// removed or withdrawn from an event, their inherited community-Space access has
// to be torn down — AND the cohort roster row that carries it has to be removed,
// because reconcileEventSpaceRoster (lib/space-inheritance) rebuilds every linked
// Space from the ACTIVE cohort roster on the next registration for that event, so
// a Space row deleted on its own is silently re-granted. The registration-side
// counterpart of BG-5 (volunteer removal).
//
// Does nothing — deliberately — when the member still holds another active
// (non-withdrawn) participant row on the same event: that registration still
// entitles them, so one removal must not strip access they have by another route.
//
// cohort_members.status / community_space_members.status only allow
// 'invited'/'active' (no 'removed' state exists), so "deactivate the cohort
// membership" is a row delete. Idempotent + non-fatal, like the grant it undoes;
// a removal must never be blocked by this.
export async function removeEventParticipation(
  db: SupabaseClient,
  p: { memberId: string | null | undefined; eventSlug: string | null | undefined },
): Promise<void> {
  if (!p.memberId || !p.eventSlug) return
  const memberId = p.memberId
  const eventSlug = p.eventSlug
  try {
    // Still entitled by another registration on this event? Then leave it all in
    // place. Counts only non-withdrawn registrations (the active roster).
    const { count: stillIn } = await db
      .from('participants')
      .select('id, registrations!inner(event_slug, status)', { count: 'exact', head: true })
      .eq('member_id', memberId)
      .eq('registrations.event_slug', eventSlug)
      .neq('registrations.status', 'withdrawn')
    if ((stillIn ?? 0) > 0) return

    // 1. Deactivate the cohort membership — delete the roster row(s) in this
    //    event's containers (event-level root + any group sub-containers, all
    //    container_type='event_participation', campaign_ref=slug). This is what
    //    stops reconcileEventSpaceRoster re-granting the Space.
    const { data: cohorts } = await db
      .from('mentoring_cohorts')
      .select('id')
      .eq('container_type', 'event_participation')
      .eq('campaign_ref', eventSlug)
    const cohortIds = (cohorts ?? []).map((c) => (c as { id: string }).id)
    if (cohortIds.length) {
      const { error } = await db.from('cohort_members').delete().eq('member_id', memberId).in('cohort_id', cohortIds)
      if (error) console.error('[event-participation] cohort removal failed (non-fatal):', error)
    }

    // 2. Remove the inherited Space membership for every Space linked to the event.
    const { data: links } = await db
      .from('community_space_sources')
      .select('space_id')
      .eq('object_type', 'event')
      .eq('object_ref', eventSlug)
    const spaceIds = (links ?? []).map((r) => (r as { space_id: string }).space_id)
    if (spaceIds.length) {
      const { error } = await db
        .from('community_space_members')
        .delete()
        .eq('member_id', memberId)
        .in('space_id', spaceIds)
      if (error) console.error('[event-participation] space removal failed (non-fatal):', error)
    }

    // 3. Delete the auto-created participation row ((member_id, event_slug) is the
    //    partial unique key from migration 034).
    const { error: epErr } = await db
      .from('event_participations')
      .delete()
      .eq('member_id', memberId)
      .eq('event_slug', eventSlug)
    if (epErr) console.error('[event-participation] participation removal failed (non-fatal):', epErr)
  } catch (e) {
    console.error('[event-participation] removeEventParticipation failed (non-fatal):', e)
  }
}
