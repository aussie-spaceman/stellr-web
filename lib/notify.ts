import { supabaseServer } from '@/lib/supabase'
import { sendEmail, staffAlertEmail } from '@/lib/email'
import { sendSms, SMS_ENABLED } from '@/lib/sms'

// Multi-channel notification dispatch (FR-COM-06 + session reminders).
// Respects member_notification_prefs (migration 017): in-app always recorded
// when enabled, email when enabled, SMS when enabled AND the provider is live.
// SMS is a no-op until Twilio/A2P is wired (see lib/sms.ts) — call sites are
// already SMS-ready, so no changes are needed when it ships.

export type NotifyType =
  | 'reply'
  | 'mention'
  | 'announcement'
  | 'resource'
  | 'session'
  | 'session_reminder'
  | 'recording'
  | 'action'
  | 'invite'

export interface NotifyInput {
  type: NotifyType
  /** Short in-app + SMS body. */
  body: string
  referenceType?: string
  referenceId?: string
  actorMemberId?: string
  /** Optional richer email; falls back to `body` when omitted. */
  email?: { subject: string; html: string; text?: string }
}

export async function notifyMember(memberId: string, input: NotifyInput): Promise<void> {
  const db = supabaseServer()

  const [{ data: member }, { data: prefs }] = await Promise.all([
    db.from('members').select('email').eq('id', memberId).maybeSingle(),
    db.from('member_notification_prefs').select('*').eq('member_id', memberId).maybeSingle(),
  ])

  // Default to in-app + email on when no prefs row exists.
  const inapp = prefs?.inapp_enabled ?? true
  const email = prefs?.email_enabled ?? true
  const sms = prefs?.sms_enabled ?? false

  if (inapp) {
    await db.from('community_notifications').insert({
      recipient_member_id: memberId,
      actor_member_id: input.actorMemberId ?? null,
      type: input.type,
      reference_type: input.referenceType ?? null,
      reference_id: input.referenceId ?? null,
      body: input.body,
    })
  }

  if (email && member?.email) {
    try {
      await sendEmail({
        to: member.email,
        subject: input.email?.subject ?? input.body,
        html: input.email?.html ?? `<p>${input.body}</p>`,
        text: input.email?.text ?? input.body,
      })
    } catch (e) {
      console.error('[notify] email failed:', e)
    }
  }

  if (sms && SMS_ENABLED && prefs?.sms_number) {
    await sendSms({ to: prefs.sms_number, body: input.body })
  }
}

/** Notify several members (e.g. a whole cohort). Best-effort, sequential. */
export async function notifyMembers(memberIds: string[], input: NotifyInput): Promise<void> {
  for (const id of memberIds) await notifyMember(id, input)
}

/**
 * Member ids of community staff — anyone whose staff_roles.scopes grants 'all' or
 * 'community'. Used to route member-raised issues (e.g. a flagged unavailable
 * training resource) to the people who can fix them. Platform admins are Clerk
 * role claims, not rows here, so an admin is only reached if also granted a scope
 * on /admin/staff. Throws on a query error so the caller can fall back.
 */
async function communityAdminMemberIds(): Promise<string[]> {
  const db = supabaseServer()
  const { data, error } = await db
    .from('staff_roles')
    .select('member_id')
    .overlaps('scopes', ['all', 'community'])
  if (error) throw new Error(error.message)
  return [...new Set((data ?? []).map((r) => (r as { member_id: string }).member_id).filter(Boolean))]
}

/**
 * Notify every community admin. Best-effort. When no staff are configured (or the
 * lookup fails) the alert goes to the staff inbox instead — on 28 Sept 2026 prod
 * had zero staff_roles rows and every admin alert silently reached nobody.
 */
export async function notifyCommunityAdmins(input: NotifyInput): Promise<void> {
  let ids: string[] = []
  try {
    ids = await communityAdminMemberIds()
  } catch (e) {
    console.error('[notify] staff_roles lookup failed; falling back to the staff inbox:', e)
  }
  if (ids.length > 0) {
    await notifyMembers(ids, input)
    return
  }

  const to = staffAlertEmail()
  console.error(
    `[notify] no staff_roles holder of 'all' or 'community' — admin alert sent to ${to} instead. ` +
      'Grant a scope on /admin/staff so alerts reach a named person.',
  )
  const note = `Sent to ${to} because no staff member holds the 'all' or 'community' scope. Grant one on /admin/staff.`
  try {
    await sendEmail({
      to,
      subject: input.email?.subject ?? input.body,
      html: `${input.email?.html ?? `<p>${input.body}</p>`}<p><em>${note}</em></p>`,
      text: `${input.email?.text ?? input.body}\n\n${note}`,
    })
  } catch (e) {
    console.error('[notify] fallback admin alert email failed:', e)
  }
}
