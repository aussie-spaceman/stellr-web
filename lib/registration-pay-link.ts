import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail, registrationPaymentLinkEmail } from '@/lib/email'
import { ensurePayToken, payPageUrl } from '@/lib/registration-checkout'

// Email the durable pay link for a pending card registration.
//
// Three callers: the registration routes (right after the rows are created,
// so an interrupted checkout is never a dead end), the duplicate check (a
// resubmitted form for a pending registration re-sends it instead of refusing),
// and the admin roster. Only the first two are unauthenticated, which is why
// the cooldown exists: without it the public form could be used to flood any
// address that happens to be registered.

export const PAY_LINK_COOLDOWN_MS = 10 * 60_000

export interface SendPayLinkOptions {
  /** Ignore the cooldown (admin, and the first send at registration). */
  force?: boolean
  cooldownMs?: number
  /** Additional addresses, already validated by the caller (admin only). */
  extraRecipients?: string[]
}

export type SendPayLinkSkipReason = 'not_pending' | 'not_card' | 'nothing_to_pay' | 'no_recipient' | 'cooldown'

export interface SendPayLinkResult {
  sent: boolean
  reason?: SendPayLinkSkipReason
  /** Every address the email went to (empty when not sent). */
  recipients: string[]
}

interface RegForPayLink {
  id: string
  event_slug: string
  event_title: string
  type: 'individual' | 'group' | 'campaign'
  status: 'pending' | 'confirmed' | 'withdrawn'
  invoice_requested: boolean
  member_pays_individually: boolean
  amount_due_cents: number | null
  adult_count: number | null
  student_count: number | null
  teacher_first_name: string | null
  teacher_email: string | null
  teacher_poc_email: string | null
  pay_link_sent_at: string | null
}

export async function sendPayLinkEmail(
  db: SupabaseClient,
  registrationId: string,
  opts: SendPayLinkOptions = {},
): Promise<SendPayLinkResult> {
  const { data: regRow } = await db
    .from('registrations')
    .select(
      'id, event_slug, event_title, type, status, invoice_requested, member_pays_individually, amount_due_cents, adult_count, student_count, teacher_first_name, teacher_email, teacher_poc_email, pay_link_sent_at',
    )
    .eq('id', registrationId)
    .maybeSingle()
  const reg = regRow as RegForPayLink | null
  if (!reg || reg.status !== 'pending') return { sent: false, reason: 'not_pending', recipients: [] }
  if (reg.invoice_requested || reg.member_pays_individually || reg.type === 'campaign') {
    return { sent: false, reason: 'not_card', recipients: [] }
  }
  // A free event's registration left 'pending' (a pre-existing gap on the
  // individual route) owes nothing — "payment of $0.00 is still needed" would
  // only alarm people.
  if ((reg.amount_due_cents ?? 0) <= 0) return { sent: false, reason: 'nothing_to_pay', recipients: [] }

  const cooldownMs = opts.cooldownMs ?? PAY_LINK_COOLDOWN_MS
  if (!opts.force && reg.pay_link_sent_at) {
    const since = Date.now() - new Date(reg.pay_link_sent_at).getTime()
    if (since >= 0 && since < cooldownMs) return { sent: false, reason: 'cooldown', recipients: [] }
  }

  // Who gets it. Individual: the registrant, plus the emergency contact when
  // one was given — for a minor that is the parent, and the parent is usually
  // the one paying. Group: the organiser, plus a student manager's teacher POC.
  let firstName = 'there'
  let seats: number | undefined
  const to: string[] = []
  if (reg.type === 'individual') {
    const { data: partRow } = await db
      .from('participants')
      .select('first_name, email, emergency_contact_email')
      .eq('registration_id', reg.id)
      .limit(1)
      .maybeSingle()
    const p = partRow as { first_name: string; email: string; emergency_contact_email: string | null } | null
    if (p) {
      firstName = p.first_name?.trim() || firstName
      to.push(p.email, p.emergency_contact_email ?? '')
    }
  } else {
    firstName = reg.teacher_first_name?.trim() || firstName
    seats = (reg.adult_count ?? 0) + (reg.student_count ?? 0) || undefined
    to.push(reg.teacher_email ?? '', reg.teacher_poc_email ?? '')
  }
  to.push(...(opts.extraRecipients ?? []))

  const recipients = [...new Set(to.map((e) => e.trim().toLowerCase()).filter(Boolean))]
  if (recipients.length === 0) return { sent: false, reason: 'no_recipient', recipients: [] }

  const token = await ensurePayToken(db, reg.id)
  const [primary, ...cc] = recipients
  await sendEmail({
    to: primary,
    cc,
    ...registrationPaymentLinkEmail({
      firstName,
      eventTitle: reg.event_title,
      amountCents: reg.amount_due_cents ?? 0,
      seats,
      payUrl: payPageUrl(reg.event_slug, token),
      registrationId: reg.id,
    }),
  })

  // Stamp AFTER the send so a Resend failure is retried rather than silenced.
  const { error } = await db
    .from('registrations')
    .update({ pay_link_sent_at: new Date().toISOString() })
    .eq('id', reg.id)
  if (error) console.error('[registration-pay-link] sent_at stamp failed (non-fatal):', error)

  return { sent: true, recipients }
}
