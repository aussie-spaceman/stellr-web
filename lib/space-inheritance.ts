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
