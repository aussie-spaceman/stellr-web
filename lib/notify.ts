import { supabaseServer } from '@/lib/supabase'
import { sendEmail, staffAlertEmail } from '@/lib/email'
import { escapeHtml } from '@/lib/email-layout'
import { sendSms, SMS_ENABLED } from '@/lib/sms'
import { staffAudienceMemberIds } from '@/lib/authz/audiences'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

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
  await deliver(memberId, input, true)
}

/**
 * One member's notification. `allowInApp` false skips the in-app row:
 * community_notifications is Stellr's community table, so another tenant's
 * alert goes by email (and SMS) only.
 */
async function deliver(memberId: string, input: NotifyInput, allowInApp: boolean): Promise<void> {
  const db = supabaseServer()

  const [{ data: member }, { data: prefs }] = await Promise.all([
    db.from('members').select('email').eq('id', memberId).maybeSingle(),
    db.from('member_notification_prefs').select('*').eq('member_id', memberId).maybeSingle(),
  ])

  // Default to in-app + email on when no prefs row exists.
  const inapp = allowInApp && (prefs?.inapp_enabled ?? true)
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
        // deep review PUB-2: `input.body` is plain notification text (names,
        // free text) — escape it before it becomes the HTML fallback body so
        // injected markup can't render. A caller-supplied `input.email.html` is
        // already-built HTML and is the caller's responsibility to escape.
        html: input.email?.html ?? `<p>${escapeHtml(input.body)}</p>`,
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
 * Staff scopes that receive an admin alert in Stellr: anyone whose staff_roles
 * row grants 'all' or 'community', so member-raised issues (e.g. a flagged
 * unavailable training resource) reach the people who can fix them. Platform
 * admins are Clerk role claims, not rows there, so an admin is only reached if
 * also granted a scope on /admin/staff.
 */
const ALERT_SCOPES = ['all', 'community'] as const

export interface StaffAlertOptions {
  /**
   * The tenant whose staff the alert is for. Stellr when omitted, as for every
   * caller today. Take it from the tenant_id of the database row the alert is
   * about (the event, registration or envelope), never from the host, a header
   * or the request body: the alert body goes to this tenant's admins.
   */
  tenantId?: string
}

/**
 * The ids in `ids` whose member row is active. Another tenant's admin audience
 * comes from tenant_memberships, which a deactivated member can still hold, so
 * its alert keeps to active members, as the weekly digest does. Throws so the
 * caller treats it as a failed lookup.
 */
async function activeMemberIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabaseServer().from('members').select('id').in('id', ids).eq('is_active', true)
  if (error) throw new Error(`members: ${error.message}`)
  return [...new Set(((data ?? []) as { id: string }[]).map((m) => m.id))].sort()
}

/**
 * Notify a tenant's staff. Best-effort. Recipients come from lib/authz/audiences
 * (S5 B17): for Stellr, the same staff_roles query as before, whatever
 * AUTHZ_SOURCE says; for another tenant, its tenant_admin memberships.
 *
 * When a Stellr lookup fails or finds nobody, the alert goes to the staff inbox
 * instead: on 28 Sept 2026 prod had zero staff_roles rows and every admin alert
 * silently reached nobody.
 *
 * Another tenant's alert never goes to Stellr's inbox, because its body can hold
 * that tenant's personal data. Tenants have no alert contact of their own yet, so
 * on a failed lookup or with no tenant admin the alert is dropped and logged with
 * the tenant id and the reason (never the body). Its admins get it by email only,
 * and only while their member row is active: the in-app bell is Stellr's
 * community table. tenants.status is not read yet. Whether a suspended tenant's
 * admins keep getting alerts is an open owner decision.
 */
export async function notifyCommunityAdmins(input: NotifyInput, opts: StaffAlertOptions = {}): Promise<void> {
  const tenantId = opts.tenantId ?? STELLR_TENANT_ID
  const stellr = tenantId === STELLR_TENANT_ID
  let ids: string[] = []
  let lookupFailed = false
  try {
    const audience = await staffAudienceMemberIds(supabaseServer(), tenantId, ALERT_SCOPES)
    ids = stellr ? audience : await activeMemberIds(audience)
  } catch (e) {
    lookupFailed = true
    console.error(
      stellr
        ? '[notify] staff_roles lookup failed; falling back to the staff inbox:'
        : `[notify] staff lookup failed for tenant ${tenantId}:`,
      e,
    )
  }
  if (ids.length > 0) {
    for (const id of ids) await deliver(id, input, stellr)
    return
  }

  if (!stellr) {
    console.error(
      `[notify] admin alert for tenant ${tenantId} dropped: ` +
        (lookupFailed ? 'its staff lookup failed' : 'it has no tenant admin') +
        '. It is not sent to the Stellr staff inbox.',
    )
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
      // deep review PUB-2: same as notifyMember — escape the plain-text body
      // when it falls through to the HTML body. `note` is a server-built
      // constant.
      html: `${input.email?.html ?? `<p>${escapeHtml(input.body)}</p>`}<p><em>${note}</em></p>`,
      text: `${input.email?.text ?? input.body}\n\n${note}`,
    })
  } catch (e) {
    console.error('[notify] fallback admin alert email failed:', e)
  }
}
