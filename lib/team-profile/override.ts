// Team profile override (30 Oct 2026): staff let Auto-Assign place a student
// who hasn't submitted a team profile. The student is balanced on what the
// roster already knows (age, school, experience, gender, ethnicity) and shows
// "Overridden" in the Team profiles panel. Emails and reminders carry on; once
// the student submits, Submitted replaces Overridden and the next Auto-Assign
// uses their answers. Stored on participants.team_profile_overridden_*.

import type { SupabaseClient } from '@supabase/supabase-js'
import { STUDENT_ROLES } from '@/lib/membership-rules'

export interface OverrideActor {
  /** Clerk user id of the admin or event manager. */
  userId: string
  /** Their name, else email; null when Clerk didn't say. */
  name: string | null
}

export const overrideFields = (actor: OverrideActor, at = new Date()) => ({
  team_profile_overridden_at: at.toISOString(),
  team_profile_overridden_by: actor.userId,
  team_profile_overridden_by_name: actor.name,
})

export const CLEARED_OVERRIDE = {
  team_profile_overridden_at: null,
  team_profile_overridden_by: null,
  team_profile_overridden_by_name: null,
}

/**
 * "Override all not submitted": every student on the event's roster (not
 * withdrawn) who hasn't submitted a team profile and isn't already overridden.
 */
export async function overrideOutstanding(
  db: SupabaseClient,
  slug: string,
  actor: OverrideActor,
): Promise<{ overridden: number }> {
  const [{ data: parts, error: pErr }, { data: profiles, error: tErr }] = await Promise.all([
    db
      .from('participants')
      .select('id, event_role, team_profile_overridden_at, registrations!inner(event_slug, status)')
      .eq('registrations.event_slug', slug),
    db.from('team_profiles').select('participant_id').eq('event_slug', slug).not('submitted_at', 'is', null),
  ])
  if (pErr || tErr) throw new Error(`Loading students failed: ${(pErr ?? tErr)!.message}`)

  const submitted = new Set((profiles ?? []).map((p) => p.participant_id as string))
  const ids: string[] = []
  for (const p of parts ?? []) {
    const reg = (Array.isArray(p.registrations) ? p.registrations[0] : p.registrations) as { status: string } | null
    if (!reg || reg.status === 'withdrawn') continue
    if (!STUDENT_ROLES.includes((p.event_role as string) ?? '')) continue
    if (p.team_profile_overridden_at || submitted.has(p.id as string)) continue
    ids.push(p.id as string)
  }

  const fields = overrideFields(actor)
  for (let i = 0; i < ids.length; i += 150) {
    const { error } = await db.from('participants').update(fields).in('id', ids.slice(i, i + 150))
    if (error) throw new Error(`Saving overrides failed: ${error.message}`)
  }
  return { overridden: ids.length }
}
