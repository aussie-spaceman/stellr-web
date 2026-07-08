import type { SupabaseClient } from '@supabase/supabase-js'

// Access Convergence — Object → Space roster inheritance (migration 123).
//
// A member gets into a Space by being assigned to an Object (Event, Training,
// Mentor Cohort, Coaching Workshop) that is linked to the Space via
// community_space_sources. They can't be invited into a Space directly — the
// admin "invite" flow only layers the Moderator role on top of inherited access.

export type SpaceObjectType = 'event' | 'training' | 'mentoring' | 'coaching'

/**
 * Roster a member into every Space linked to the given Object. Inherited members
 * join as base 'member' with active status. Idempotent + non-fatal — never blocks
 * the assignment it hangs off of.
 */
export async function syncObjectSpaceRoster(
  db: SupabaseClient,
  objectType: SpaceObjectType,
  objectRef: string,
  memberId: string,
): Promise<void> {
  try {
    const { data: links } = await db
      .from('community_space_sources')
      .select('space_id')
      .eq('object_type', objectType)
      .eq('object_ref', objectRef)
    const spaceIds = (links ?? []).map((r) => (r as { space_id: string }).space_id)
    if (spaceIds.length === 0) return
    await db.from('community_space_members').upsert(
      spaceIds.map((space_id) => ({ space_id, member_id: memberId, role: 'member', status: 'active' })),
      { onConflict: 'space_id,member_id', ignoreDuplicates: true },
    )
  } catch (e) {
    console.error('[space-inheritance] syncObjectSpaceRoster failed (non-fatal):', e)
  }
}

/**
 * Active member ids of an Object (the inverse of syncObjectSpaceRoster's per-
 * member view). Event members come from the event-participation containers for
 * that slug; mentoring/coaching members from the referenced cohort's roster.
 * Training sources are not backfilled here (members reach training-linked spaces
 * via their event/cohort assignment, not the module id).
 */
async function objectActiveMemberIds(
  db: SupabaseClient,
  objectType: SpaceObjectType,
  objectRef: string,
): Promise<string[]> {
  let cohortIds: string[] = []
  if (objectType === 'event') {
    const { data: containers } = await db
      .from('mentoring_cohorts')
      .select('id')
      .eq('container_type', 'event_participation')
      .eq('campaign_ref', objectRef)
    cohortIds = (containers ?? []).map((c) => (c as { id: string }).id)
  } else if (objectType === 'mentoring' || objectType === 'coaching') {
    // For these the source ref IS the cohort id.
    cohortIds = [objectRef]
  } else {
    return []
  }
  if (cohortIds.length === 0) return []
  const { data: cm } = await db
    .from('cohort_members')
    .select('member_id')
    .in('cohort_id', cohortIds)
    .eq('status', 'active')
  return [...new Set((cm ?? []).map((r) => (r as { member_id: string }).member_id))]
}

/**
 * Backfill a Space roster when an Object is newly linked to it. Rosters every
 * member already assigned to that Object as base 'member'. Without this, only
 * members assigned AFTER the link (via syncObjectSpaceRoster) inherit the space
 * — anyone who registered earlier is stranded. Idempotent + non-fatal.
 */
export async function syncSpaceSourceRoster(
  db: SupabaseClient,
  spaceId: string,
  objectType: SpaceObjectType,
  objectRef: string,
): Promise<void> {
  try {
    const memberIds = await objectActiveMemberIds(db, objectType, objectRef)
    if (memberIds.length === 0) return
    await db.from('community_space_members').upsert(
      memberIds.map((member_id) => ({ space_id: spaceId, member_id, role: 'member', status: 'active' })),
      { onConflict: 'space_id,member_id', ignoreDuplicates: true },
    )
  } catch (e) {
    console.error('[space-inheritance] syncSpaceSourceRoster failed (non-fatal):', e)
  }
}
