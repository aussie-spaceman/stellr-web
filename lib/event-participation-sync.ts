import type { SupabaseClient } from '@supabase/supabase-js'

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
  },
): Promise<void> {
  if (!p.memberId || !p.eventSlug) return
  try {
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
    if (error) console.error('[event-participation] insert error (non-fatal):', error)
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
        }),
      ),
    )
  } catch (e) {
    console.error('[event-participation] recordEventParticipationForRegistration failed (non-fatal):', e)
  }
}
