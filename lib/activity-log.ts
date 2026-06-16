// Per-member activity log (migration 046).
//
// One place that knows how to append an audit entry to member_activity_log and
// how to resolve "who did it" from the current Clerk session. The log is fully
// shared — the member sees the same entries an admin sees — so there is no
// visibility flag here.
//
// Writes are BEST-EFFORT: logActivity never throws, so instrumenting a payment
// webhook or a profile save can't break the originating action if logging fails.

import type { SupabaseClient } from '@supabase/supabase-js'
import { auth, currentUser } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { memberIdForClerkUser } from '@/lib/deletion/actor'

export type ActivityCategory =
  | 'membership'
  | 'profile'
  | 'account'
  | 'event'
  | 'billing'
  | 'docusign'
  | 'community'
  | 'school'

export type ActorType = 'admin' | 'member' | 'system' | 'stripe' | 'docusign'

export interface Actor {
  actorType: ActorType
  actorMemberId?: string | null
  actorLabel?: string | null
}

export interface LogActivityInput extends Partial<Actor> {
  /** The member whose profile this activity is recorded against. */
  memberId: string
  category: ActivityCategory
  /** Machine key, e.g. 'tier_granted' | 'profile_updated'. */
  action: string
  /** Human sentence shown in the timeline, e.g. 'Granted Pathfinder membership'. */
  summary: string
  metadata?: Record<string, unknown>
}

/**
 * Append one entry to member_activity_log. Best-effort: errors are logged and
 * swallowed so callers in request/webhook paths are never interrupted.
 */
export async function logActivity(
  input: LogActivityInput,
  client?: SupabaseClient,
): Promise<void> {
  try {
    if (!input.memberId) return
    const db = client ?? supabaseServer()
    const { error } = await db.from('member_activity_log').insert({
      member_id: input.memberId,
      actor_type: input.actorType ?? 'system',
      actor_member_id: input.actorMemberId ?? null,
      actor_label: input.actorLabel ?? null,
      category: input.category,
      action: input.action,
      summary: input.summary,
      metadata: input.metadata ?? {},
    })
    if (error) console.error('[activity-log] insert error:', error)
  } catch (err) {
    console.error('[activity-log] logActivity threw:', err)
  }
}

/**
 * Resolve the acting party from the current Clerk session. Returns actorType
 * 'admin' when the session carries the admin role claim, otherwise 'member'.
 * actorMemberId is the linked members.id when one exists (admins may not have a
 * member row); actorLabel is a denormalised display name/email snapshot.
 *
 * Safe to call best-effort: on any failure it falls back to a 'system' actor.
 */
export async function actorFromAuth(): Promise<Actor> {
  try {
    const { userId, sessionClaims } = await auth()
    if (!userId) return { actorType: 'system' }

    const isAdmin =
      (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
    const actorMemberId = await memberIdForClerkUser(userId)

    let actorLabel: string | null = null
    try {
      const u = await currentUser()
      const name = [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim()
      const email =
        u?.emailAddresses?.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
        u?.emailAddresses?.[0]?.emailAddress ??
        null
      actorLabel = name || email || null
    } catch {
      /* currentUser() best-effort only */
    }

    return {
      actorType: isAdmin ? 'admin' : 'member',
      actorMemberId,
      actorLabel,
    }
  } catch (err) {
    console.error('[activity-log] actorFromAuth threw:', err)
    return { actorType: 'system' }
  }
}
