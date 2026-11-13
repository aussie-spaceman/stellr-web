// Check-in for volunteer mentors and event managers (Nov 2026).
//
// They are not on an event's roster, so participants.checked_in_at can't hold
// their arrival. The desk lists them on a Mentors tab (components/admin/
// CheckInLive.tsx) and a tap writes a row to event_crew_check_ins; undo
// deletes it. The "All attendees" email group (lib/event-emails/audiences.ts)
// reads these rows beside the roster's check-ins.
//
// Who is listed is exactly who the Mentors email group reaches
// (loadMentorContacts): the event container's active volunteers and the
// event's managers. Anyone who is also on the roster (a mentor who registered
// through the form) is left off the tab: the People tab checks them in.

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadMentorContacts } from '@/lib/event-emails/audiences'
import { CREW_KEY, type DeskCrewCheckIn, type DeskCrewPerson } from '@/lib/check-in-desk'

/** The Mentors tab: one row per person, by address, minus anyone on the roster. */
export async function loadDeskCrew(db: SupabaseClient, slug: string): Promise<(DeskCrewPerson & { memberId: string | null })[]> {
  const [contacts, { data: rosterRows }] = await Promise.all([
    loadMentorContacts(db, slug),
    db
      .from('participants')
      .select('member_id, registrations!inner(event_slug, status)')
      .eq('registrations.event_slug', slug)
      .neq('registrations.status', 'withdrawn')
      .not('member_id', 'is', null),
  ])
  const onRoster = new Set(((rosterRows ?? []) as { member_id: string | null }[]).map((r) => r.member_id))
  const seen = new Set<string>()
  const out: (DeskCrewPerson & { memberId: string | null })[] = []
  // Volunteers come first, so someone who is both is listed once, as a mentor.
  for (const c of contacts) {
    const email = c.email.trim().toLowerCase()
    if (seen.has(email) || (c.memberId && onRoster.has(c.memberId))) continue
    seen.add(email)
    out.push({ id: c.key, firstName: c.firstName, lastName: c.lastName, role: c.role, memberId: c.memberId })
  }
  return out
}

/** This event's crew check-ins, by crew key. */
export async function loadCrewCheckIns(db: SupabaseClient, slug: string): Promise<Map<string, DeskCrewCheckIn>> {
  const { data, error } = await db
    .from('event_crew_check_ins')
    .select('crew_key, checked_in_at, check_in_method')
    .eq('event_slug', slug)
  if (error) throw new Error(`event_crew_check_ins: ${error.message}`)
  return new Map(
    ((data ?? []) as { crew_key: string; checked_in_at: string; check_in_method: string }[]).map((r) => [
      r.crew_key,
      { checkedInAt: r.checked_in_at, checkInMethod: r.check_in_method },
    ]),
  )
}

export type CrewWriteResult = { ok: true } | { ok: false; status: number; error: string }

/**
 * Checks a mentor or event manager in (at `at`) or undoes it. The key must
 * name someone on this event's Mentors tab. A second check-in keeps the first
 * time, as a participant's does.
 */
export async function writeCrewCheckIn(
  db: SupabaseClient,
  slug: string,
  key: unknown,
  op: { checkIn: true; at: string; by: string | null } | { checkIn: false },
): Promise<CrewWriteResult> {
  if (typeof key !== 'string' || !CREW_KEY.test(key)) return { ok: false, status: 400, error: 'crewKey required' }
  const person = (await loadDeskCrew(db, slug)).find((s) => s.id === key)
  if (!person) return { ok: false, status: 404, error: 'Not a mentor or event manager of this event' }

  const { error } = op.checkIn
    ? await db.from('event_crew_check_ins').upsert(
        {
          event_slug: slug,
          crew_key: key,
          role: person.role,
          member_id: person.memberId,
          checked_in_at: op.at,
          check_in_method: 'manual',
          checked_in_by: op.by,
        },
        { onConflict: 'event_slug,crew_key', ignoreDuplicates: true },
      )
    : await db.from('event_crew_check_ins').delete().eq('event_slug', slug).eq('crew_key', key)
  if (error) {
    console.error('[check-in] crew write failed:', error.message)
    return { ok: false, status: 500, error: 'Database error' }
  }
  return { ok: true }
}
