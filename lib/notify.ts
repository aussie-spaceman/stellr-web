import { supabaseServer } from '@/lib/supabase'
import { sendEmail } from '@/lib/email'
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
