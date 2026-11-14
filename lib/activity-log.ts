// Per-member activity log (migration 046).
//
// One place that knows how to append an audit entry to member_activity_log and
// how to resolve "who did it" from the current Clerk session. The log is fully
// shared — the member sees the same entries an admin sees — so there is no
// visibility flag here.
//
// Writes are BEST-EFFORT: logActivity never throws, so instrumenting a payment
// webhook or a profile save can't break the originating action if logging fails.
// The exception is logActivityOrThrow, for the rows an action must not run without.

import { roleFromClaims } from '@/lib/authz/decide'
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
  | 'compliance'
  | 'survey'

export type ActorType = 'admin' | 'staff' | 'member' | 'system' | 'stripe' | 'docusign'

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
    const { error } = await db.from('member_activity_log').insert(toRow(input))
    if (error) console.error('[activity-log] insert error:', error)
  } catch (err) {
    console.error('[activity-log] logActivity threw:', err)
  }
}

/**
 * Append one entry and THROW when it cannot be recorded. For the few actions
 * whose audit row is itself the control — an adult staff member starting or
 * ending a view of a member's (often a minor's) portal — the caller must not go
 * ahead unrecorded. Everything else uses the best-effort logActivity above.
 */
export async function logActivityOrThrow(
  input: LogActivityInput,
  client?: SupabaseClient,
): Promise<void> {
  if (!input.memberId) throw new Error('[activity-log] memberId is required')
  const db = client ?? supabaseServer()
  const { error } = await db.from('member_activity_log').insert(toRow(input))
  if (error) throw new Error(`[activity-log] insert failed: ${error.message}`)
}

/**
 * Append many entries in one insert (a batch job logging per member). Same
 * best-effort contract as logActivity; entries without a memberId are dropped.
 */
export async function logActivities(
  inputs: LogActivityInput[],
  client?: SupabaseClient,
): Promise<void> {
  try {
    const rows = inputs.filter((input) => input.memberId).map(toRow)
    if (!rows.length) return
    const db = client ?? supabaseServer()
    const { error } = await db.from('member_activity_log').insert(rows)
    if (error) console.error('[activity-log] batch insert error:', error)
  } catch (err) {
    console.error('[activity-log] logActivities threw:', err)
  }
}

function toRow(input: LogActivityInput) {
  return {
    member_id: input.memberId,
    actor_type: input.actorType ?? 'system',
    actor_member_id: input.actorMemberId ?? null,
    actor_label: input.actorLabel ?? null,
    category: input.category,
    action: input.action,
    summary: input.summary,
    metadata: input.metadata ?? {},
  }
}

/**
 * Resolve the acting party from the current Clerk session. Returns actorType
 * 'admin' for the admin role claim, 'staff' for Staff (13 Nov 2026), otherwise
 * 'member'.
 * actorMemberId is the linked members.id when one exists (admins may not have a
 * member row); actorLabel is a denormalised display name/email snapshot.
 *
 * Safe to call best-effort: on any failure it falls back to a 'system' actor.
 */
/**
 * For a write from the admin portal: 'staff' when Staff made it, else 'admin'.
 * Routes that used to record every portal write as 'admin' call this, so a Staff
 * change is never written down as an admin's.
 */
export async function crewActorType(): Promise<'admin' | 'staff'> {
  try {
    const { sessionClaims } = await auth()
    return roleFromClaims(sessionClaims) === 'staff' ? 'staff' : 'admin'
  } catch {
    return 'admin'
  }
}

export async function actorFromAuth(): Promise<Actor> {
  try {
    const { userId, sessionClaims } = await auth()
    if (!userId) return { actorType: 'system' }

    const role = roleFromClaims(sessionClaims)
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
      actorType: role === 'admin' ? 'admin' : role === 'staff' ? 'staff' : 'member',
      actorMemberId,
      actorLabel,
    }
  } catch (err) {
    console.error('[activity-log] actorFromAuth threw:', err)
    return { actorType: 'system' }
  }
}
