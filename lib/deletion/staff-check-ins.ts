// Event staff check-ins leave with the account (owner decision, 13 Nov 2026;
// tracker row attendee-email-cohort.4).
//
// event_staff_check_ins (migration 20261110120000) holds one row per mentor or
// event manager the desk checked in, keyed by lib/check-in-desk.ts staffKey:
//   v.<members.id>     a volunteer mentor: member_id is set and the FK is
//                      ON DELETE CASCADE, so a hard-deleted member's rows go
//                      with the members row
//   m.<Clerk user id>  an event manager: member_id is null when they have no
//                      members row, so nothing cascades and the Clerk id and
//                      arrival time would outlive the account
//
// Every account-removal path calls this one helper:
//   - Clerk user.deleted (app/api/webhooks/clerk): the login's m.* rows, and
//     the rows of the member rows it deactivates (a soft delete, so the FK
//     never cascades);
//   - lib/deletion/external.ts deleteUnsharedClerkLogin, once the login is
//     gone: the admin hard delete, the pending-consent purge and a privacy
//     request all reach it through executeDeletion, and the member merge
//     calls it for the dropped record's login.
//
// Removal is person-wide, across every tenant's events, so it takes the
// service-role client its caller already holds.

import type { SupabaseClient } from '@supabase/supabase-js'
import { STAFF_KEY, staffKey } from '@/lib/check-in-desk'

export type StaffCheckInPurgeResult = { ok: true; removed: number } | { ok: false; error: string }

const TABLE = 'event_staff_check_ins'

/**
 * Deletes the staff check-ins of one person: the event-manager rows keyed by
 * their Clerk login, and every row naming one of their member rows (by
 * member_id, or by a v.<id> key). Other people's rows are never matched.
 * Idempotent: a second run removes nothing.
 */
export async function purgeStaffCheckIns(
  db: Pick<SupabaseClient, 'from'>,
  who: { clerkUserId?: string | null; memberIds?: readonly (string | null | undefined)[] },
): Promise<StaffCheckInPurgeResult> {
  const managerKey = who.clerkUserId ? staffKey('event_manager', who.clerkUserId) : null
  const memberIds = [...new Set((who.memberIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0))]
  // A key the table's CHECK would refuse cannot be on any row.
  const volunteerKeys = memberIds.map((id) => staffKey('volunteer', id)).filter((k) => STAFF_KEY.test(k))

  const deletes: { column: 'staff_key' | 'member_id'; values: string[] }[] = []
  if (managerKey && STAFF_KEY.test(managerKey)) deletes.push({ column: 'staff_key', values: [managerKey] })
  if (memberIds.length) deletes.push({ column: 'member_id', values: memberIds })
  if (volunteerKeys.length) deletes.push({ column: 'staff_key', values: volunteerKeys })

  let removed = 0
  for (const d of deletes) {
    const { data, error } = await db.from(TABLE).delete().in(d.column, d.values).select('id')
    if (error) return { ok: false, error: `${TABLE}: ${error.message}` }
    removed += (data ?? []).length
  }
  return { ok: true, removed }
}
