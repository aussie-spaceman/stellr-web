import type { SupabaseClient } from '@supabase/supabase-js'
import { sendGroupAccountInvite } from '@/lib/member-invite'
import { isUnder13On } from '@/lib/age'

// Daily catch-up for group logins. A group registration creates each person's
// login straight after the response (lib/group-registration-followup), but two
// cases are left for here:
//   - a child under 13, whose email waits until a parent has signed their
//     consent form (sendGroupAccountInvite returns 'awaiting_consent' until then);
//   - anyone the follow-up ran out of time for, or people added to the group
//     later from the sheet, join link or the organiser's portal.
// sendGroupAccountInvite sends at most once per member and skips anyone who
// already has a login, so re-running this is harmless.
//
// S0 (2 Nov 2026): a child under 13 who registered themselves (an individual
// registrant, or a group's student organiser) is refused a login at
// registration by the COPPA guard, and nothing else would ever make one once
// their parent signs. They are swept here too, but only while their date of
// birth says under 13 or cannot be read. Everyone else who registered
// themselves got their login at registration, or was deliberately given none
// (an existing member named on an anonymous form, deep review AUTH-N3), and
// this must not change that.

/** Group participants this recent are considered (covers the wait for consent). */
const WINDOW_DAYS = 30

export interface GroupInviteSweepResult {
  candidates: number
  outcomes: Record<string, number>
}

type Reg = {
  type: string
  event_title: string | null
  teacher_member_id: string | null
  teacher_first_name: string | null
  teacher_last_name: string | null
}

/** `self`: the registrant themselves, held back at registration for being under 13. */
type Candidate = { reg: Reg; self: boolean }

export async function sweepGroupAccountInvites(
  db: SupabaseClient,
  opts: { limit?: number; dryRun?: boolean; now?: Date } = {},
): Promise<GroupInviteSweepResult> {
  const now = opts.now ?? new Date()
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString()

  const { data, error } = await db
    .from('participants')
    .select('member_id, date_of_birth, registrations!inner(type, status, event_title, teacher_member_id, teacher_first_name, teacher_last_name)')
    .not('member_id', 'is', null)
    .gte('created_at', since)
    .in('registrations.type', ['group', 'individual'])
    .neq('registrations.status', 'withdrawn')
    .limit(1000)
  if (error) throw new Error(`Group participant query failed: ${error.message}`)

  const byMember = new Map<string, Candidate>()
  for (const row of (data ?? []) as Array<{ member_id: string; date_of_birth: string | null; registrations: Reg | Reg[] }>) {
    const reg = Array.isArray(row.registrations) ? row.registrations[0] : row.registrations
    if (!reg) continue
    // The organiser has their own login from the registration itself, as does
    // an individual registrant — unless the guard refused them for being under 13.
    const self = reg.type !== 'group' || row.member_id === reg.teacher_member_id
    if (self && !isUnder13On(row.date_of_birth)) continue
    // Someone a teacher registered gets the email that names the teacher.
    const prior = byMember.get(row.member_id)
    if (!prior || (prior.self && !self)) byMember.set(row.member_id, { reg, self })
  }

  // Only members still without a login or an invite need a look; one who
  // registered themselves, only while the member row too says under 13.
  const ids = [...byMember.keys()]
  let pending: string[] = []
  if (ids.length) {
    const { data: members, error: membersError } = await db
      .from('members')
      .select('id, date_of_birth')
      .in('id', ids)
      .is('clerk_user_id', null)
      .is('account_invite_sent_at', null)
    if (membersError) throw new Error(`Member lookup failed: ${membersError.message}`)
    pending = ((members ?? []) as Array<{ id: string; date_of_birth: string | null }>)
      .filter((m) => !byMember.get(m.id)!.self || isUnder13On(m.date_of_birth))
      .map((m) => m.id)
      .slice(0, opts.limit ?? 40)
  }

  const result: GroupInviteSweepResult = { candidates: pending.length, outcomes: {} }
  if (opts.dryRun) return result

  for (const memberId of pending) {
    const { reg, self } = byMember.get(memberId)!
    let outcome: string
    try {
      const r = await sendGroupAccountInvite(db, memberId, {
        eventTitle: reg.event_title ?? 'your event',
        organiserName: self
          ? null
          : [reg.teacher_first_name, reg.teacher_last_name].filter(Boolean).join(' ') || 'Your teacher',
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
