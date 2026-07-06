import type { SupabaseClient } from '@supabase/supabase-js'
import { grantTier } from '@/lib/membership-grants'
import { resolveTierMap } from '@/lib/tiers-server'

// Free base tier granted to a *non-member* on their first competition/campaign
// registration, keyed on the member's stored age_bracket. Mirrors the existing
// auto-signup grants (025): high_school → Explorer, college → Alumni,
// adult → Educator. Students become Explorer; adults (teachers) become Educator.
const FREE_TIER_BY_BRACKET: Record<string, string> = {
  high_school: 'Explorer',
  college: 'Alumni',
  adult: 'Educator',
}

/**
 * Ensure a member who has no membership yet gets the free base tier for their age
 * bracket. Used when someone registers for an event or campaign — a non-member is
 * turned into an Explorer / Educator / Alumni member, no payment required.
 *
 * Guarded to non-members only: if the member already holds ANY active, unexpired
 * membership (a paid tier, or one a grant rule just issued), this is a no-op — so
 * it never downgrades an existing member. Idempotent and non-fatal: registration
 * must never fail because of this.
 */
export async function autoGrantBaseMembership(
  db: SupabaseClient,
  memberId: string | null | undefined,
): Promise<void> {
  try {
    if (!memberId) return

    // The member's stored, normalised bracket ('high_school' | 'college' | 'adult').
    const { data: member } = await db
      .from('members')
      .select('age_bracket')
      .eq('id', memberId)
      .maybeSingle()
    const tierName = FREE_TIER_BY_BRACKET[(member?.age_bracket as string) ?? '']
    if (!tierName) return

    // Non-members only — skip if any active, unexpired membership already exists.
    const today = new Date().toISOString().split('T')[0]
    const { data: active } = await db
      .from('member_memberships')
      .select('id, expires_at')
      .eq('member_id', memberId)
      .eq('renewal_status', 'active')
    if ((active ?? []).some((m) => !m.expires_at || m.expires_at >= today)) return

    const tiers = await resolveTierMap()
    const tierId = tiers.idByName[tierName]
    if (!tierId) return

    await grantTier(
      { memberId, tierId, months: null, source: 'system', replacesFree: false },
      db,
    )
  } catch (e) {
    console.error('[auto-membership] autoGrantBaseMembership failed (non-fatal):', e)
  }
}
