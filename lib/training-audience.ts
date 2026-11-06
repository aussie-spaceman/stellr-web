import type { SupabaseClient } from '@supabase/supabase-js'
import { STELLR_OR_NULL } from '@/lib/tenancy/stellr-scope'

// Who an event/campaign course assignment is for, by the person's relationship
// to the event (migration 20261104181312). Read from the roster an admin
// controls — cohort_members.relationship on the event's event_participation
// containers — never from the self-chosen members.event_role.

export type Audience = 'all' | 'participants' | 'volunteers'
export const AUDIENCES: readonly Audience[] = ['all', 'participants', 'volunteers']

/** A person's place on an event roster. Teachers/hosts are neither. */
export type RosterKind = 'participant' | 'volunteer'

export function normalizeAudience(v: unknown): Audience {
  return AUDIENCES.includes(v as Audience) ? (v as Audience) : 'all'
}

/** Does an assignment with `audience` apply to someone holding `relationships`? */
export function audienceIncludes(audience: unknown, relationships: Iterable<string>): boolean {
  const a = normalizeAudience(audience)
  if (a === 'all') return true
  const want: RosterKind = a === 'participants' ? 'participant' : 'volunteer'
  for (const r of relationships) if (r === want) return true
  return false
}

/** Only event and campaign Objects carry an audience; the rest are always 'all'. */
export function objectUsesAudience(objectType: string): boolean {
  return objectType === 'competition' || objectType === 'campaign'
}

/**
 * A member's active relationships to each event they are rostered on, keyed by
 * event slug (mentoring_cohorts.campaign_ref). Students sit on group child
 * containers, volunteers on the event-level one — both carry the slug.
 */
export async function memberEventRelationships(
  db: SupabaseClient,
  memberId: string,
): Promise<Map<string, Set<string>>> {
  const { data } = await db
    .from('cohort_members')
    .select('relationship, mentoring_cohorts!inner(campaign_ref, container_type)')
    .eq('member_id', memberId)
    .eq('status', 'active')
  const out = new Map<string, Set<string>>()
  for (const r of (data ?? []) as unknown as {
    relationship: string | null
    mentoring_cohorts: { campaign_ref: string | null; container_type: string } | { campaign_ref: string | null; container_type: string }[] | null
  }[]) {
    const c = Array.isArray(r.mentoring_cohorts) ? r.mentoring_cohorts[0] : r.mentoring_cohorts
    if (!c || c.container_type !== 'event_participation' || !c.campaign_ref) continue
    const set = out.get(c.campaign_ref) ?? new Set<string>()
    set.add(r.relationship ?? 'participant')
    out.set(c.campaign_ref, set)
  }
  return out
}

export interface EventVolunteer {
  memberId: string
  firstName: string | null
  lastName: string | null
  ageBracket: string | null
}

/**
 * Active volunteers on an event (the event's Volunteers panel). `stellrOnly` is for
 * a Stellr-only cron: it leaves out a container stamped for another tenant. The
 * inner join means that drops the roster row, and a NULL tenant counts as Stellr's.
 */
export async function eventVolunteers(
  db: SupabaseClient,
  slug: string,
  opts: { stellrOnly?: boolean } = {},
): Promise<EventVolunteer[]> {
  const query = db
    .from('cohort_members')
    .select('member_id, mentoring_cohorts!inner(campaign_ref, container_type), members(first_name, last_name, age_bracket)')
    .eq('relationship', 'volunteer')
    .eq('status', 'active')
    .eq('mentoring_cohorts.container_type', 'event_participation')
    .eq('mentoring_cohorts.campaign_ref', slug)
  const { data } = await (opts.stellrOnly ? query.or(STELLR_OR_NULL, { referencedTable: 'mentoring_cohorts' }) : query)
  const seen = new Set<string>()
  const out: EventVolunteer[] = []
  for (const r of (data ?? []) as unknown as {
    member_id: string | null
    members: { first_name?: string; last_name?: string; age_bracket?: string } | { first_name?: string; last_name?: string; age_bracket?: string }[] | null
  }[]) {
    if (!r.member_id || seen.has(r.member_id)) continue
    seen.add(r.member_id)
    const m = Array.isArray(r.members) ? r.members[0] : r.members
    out.push({
      memberId: r.member_id,
      firstName: m?.first_name ?? null,
      lastName: m?.last_name ?? null,
      ageBracket: m?.age_bracket ?? null,
    })
  }
  return out
}
