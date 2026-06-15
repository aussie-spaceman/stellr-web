// Container lifecycle + persistence gate (access-model Phase 5).
//
// Chat/roster access already lives in lib/sessions.ts (cohort/coaching/space).
// This module adds only the genuinely new piece: the persistence gate that
// decides what stays accessible once a container archives.

import { supabaseServer } from '@/lib/supabase'

/** Whether the container (cohort) has been archived. */
export async function containerIsArchived(cohortId: string): Promise<boolean> {
  const db = supabaseServer()
  const { data } = await db
    .from('mentoring_cohorts')
    .select('lifecycle')
    .eq('id', cohortId)
    .maybeSingle()
  return data?.lifecycle === 'archived'
}

/**
 * Persistence gate (decision D1). While a container is ACTIVE, access is always
 * allowed. Once it ARCHIVES, a target persists for past members only if its
 * content_persistence policy is 'keep_open'; otherwise it re-gates (the default)
 * and the caller falls back to normal tier entitlement.
 *
 * Returns true = the item stays open to the (former) roster member.
 */
export async function persistenceAllows(
  targetType: string,
  targetRef: string,
  containerArchived: boolean,
): Promise<boolean> {
  if (!containerArchived) return true
  const db = supabaseServer()
  const { data } = await db
    .from('content_persistence')
    .select('policy')
    .eq('target_type', targetType)
    .eq('target_ref', targetRef)
    .maybeSingle()
  return data?.policy === 'keep_open'
}
