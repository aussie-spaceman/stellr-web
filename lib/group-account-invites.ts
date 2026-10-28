import type { SupabaseClient } from '@supabase/supabase-js'
import { sendGroupAccountInvite } from '@/lib/member-invite'

// Daily catch-up for group logins. A group registration creates each person's
// login straight after the response (lib/group-registration-followup), but two
// cases are left for here:
//   - a child under 13, whose email waits until a parent has signed their
//     consent form (sendGroupAccountInvite returns 'awaiting_consent' until then);
//   - anyone the follow-up ran out of time for, or people added to the group
//     later from the sheet, join link or the organiser's portal.
// sendGroupAccountInvite sends at most once per member and skips anyone who
// already has a login, so re-running this is harmless.

/** Group participants this recent are considered (covers the wait for consent). */
const WINDOW_DAYS = 30

export interface GroupInviteSweepResult {
  candidates: number
  outcomes: Record<string, number>
}

export async function sweepGroupAccountInvites(
  db: SupabaseClient,
  opts: { limit?: number; dryRun?: boolean; now?: Date } = {},
): Promise<GroupInviteSweepResult> {
  const now = opts.now ?? new Date()
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString()

  const { data, error } = await db
    .from('participants')
    .select('member_id, registrations!inner(type, status, event_title, teacher_member_id, teacher_first_name, teacher_last_name)')
    .not('member_id', 'is', null)
    .gte('created_at', since)
    .eq('registrations.type', 'group')
    .neq('registrations.status', 'withdrawn')
    .limit(1000)
  if (error) throw new Error(`Group participant query failed: ${error.message}`)

  type Reg = { event_title: string | null; teacher_member_id: string | null; teacher_first_name: string | null; teacher_last_name: string | null }
  const byMember = new Map<string, Reg>()
  for (const row of (data ?? []) as Array<{ member_id: string; registrations: Reg | Reg[] }>) {
    const reg = Array.isArray(row.registrations) ? row.registrations[0] : row.registrations
    // The organiser has their own login from the registration itself.
    if (!reg || row.member_id === reg.teacher_member_id) continue
    if (!byMember.has(row.member_id)) byMember.set(row.member_id, reg)
  }

  // Only members still without a login or an invite need a look.
  const ids = [...byMember.keys()]
  let pending: string[] = []
  if (ids.length) {
    const { data: members, error: membersError } = await db
      .from('members')
      .select('id')
      .in('id', ids)
      .is('clerk_user_id', null)
      .is('account_invite_sent_at', null)
    if (membersError) throw new Error(`Member lookup failed: ${membersError.message}`)
    pending = (members ?? []).map((m) => (m as { id: string }).id).slice(0, opts.limit ?? 40)
  }

  const result: GroupInviteSweepResult = { candidates: pending.length, outcomes: {} }
  if (opts.dryRun) return result

  for (const memberId of pending) {
    const reg = byMember.get(memberId)!
    let outcome: string
    try {
      const r = await sendGroupAccountInvite(db, memberId, {
        eventTitle: reg.event_title ?? 'your event',
        organiserName: [reg.teacher_first_name, reg.teacher_last_name].filter(Boolean).join(' ') || 'Your teacher',
      })
      outcome = r.sent ? 'sent' : r.reason
    } catch (err) {
      outcome = 'error'
      console.error(`[group-account-invites] invite for ${memberId} failed:`, err)
    }
    result.outcomes[outcome] = (result.outcomes[outcome] ?? 0) + 1
  }
  return result
}
