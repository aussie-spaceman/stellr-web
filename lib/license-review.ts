import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyCommunityAdmins } from '@/lib/notify'
import { sendEmail } from '@/lib/email'
import { emailLayout, escapeHtml as esc } from '@/lib/email-layout'
import { AUTH_APP_URL } from '@/lib/env'
import { logActivity } from '@/lib/activity-log'
import { CLEARANCE_PATH } from '@/lib/compliance-links'
import { formatDateShort } from '@/lib/utils'

// The two halves of a teaching license review (28 Oct 2026):
//   - a teacher submits license details or uploads the photo → staff are told
//     there is something to verify (bell + email, via notifyCommunityAdmins,
//     which falls back to the staff inbox when nobody holds the scope);
//   - an admin verifies it → the teacher is told they are cleared.
// Before this, a submission only reached the activity log, so it waited until
// someone happened to open the Background checks page.
//
// Neither ever throws: the license is saved whatever happens to the message.

/** One alert per teacher in this window: entering details then uploading the photo is one submission. */
const ALERT_COOLDOWN_MS = 30 * 60_000

export type LicenseSubmission = 'details' | 'document'

export async function alertLicenseReview(
  db: SupabaseClient,
  memberId: string,
  kind: LicenseSubmission,
  opts: { now?: Date } = {},
): Promise<{ sent: boolean; reason?: 'cooldown' | 'member_not_found' | 'error' }> {
  try {
    const now = opts.now ?? new Date()
    const since = new Date(now.getTime() - ALERT_COOLDOWN_MS).toISOString()
    const { count } = await db
      .from('member_activity_log')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', memberId)
      .eq('action', 'license_review_alert_sent')
      .gte('created_at', since)
    if ((count ?? 0) > 0) return { sent: false, reason: 'cooldown' }

    const { data: member } = await db
      .from('members')
      .select('first_name, last_name, email')
      .eq('id', memberId)
      .maybeSingle()
    if (!member) return { sent: false, reason: 'member_not_found' }
    const name = [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email || 'A teacher'

    const url = `${AUTH_APP_URL}/admin/members/${memberId}`
    const what = kind === 'document' ? 'uploaded a photo of their teaching license' : 'submitted their teaching license'
    const body = `${name} ${what} — waiting verification`
    await notifyCommunityAdmins({
      type: 'action',
      body,
      referenceType: 'license_review',
      referenceId: memberId,
      email: {
        subject: `License to verify: ${name}`,
        html: emailLayout({
          heading: 'A teaching license is waiting verification',
          preheader: `${name} ${what}.`,
          bodyHtml: `
            <p>${esc(name)} ${esc(what)}. They are not cleared to work with students until it is verified.</p>
            <p>Open their member page, view the document, check the number, state and expiry, then choose <strong>Mark verified</strong>.</p>
            <p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#3C6DF6;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Review the license</a></p>`,
        }),
        text: `${name} ${what}. They are not cleared to work with students until it is verified.\n\nOpen their member page, view the document, check the number, state and expiry, then choose Mark verified:\n${url}`,
      },
    })
    await logActivity(
      {
        memberId,
        category: 'compliance',
        action: 'license_review_alert_sent',
        summary: `Staff alerted to verify the teaching license (${kind})`,
        metadata: { kind },
        actorType: 'system',
      },
      db,
    )
    return { sent: true }
  } catch (err) {
    console.error('[license-review] admin alert failed:', err)
    return { sent: false, reason: 'error' }
  }
}

export function licenseVerifiedEmail({ firstName, expiryDate, url }: { firstName: string; expiryDate: string; url: string }) {
  const until = formatDateShort(expiryDate)
  const subject = 'Your teaching license is verified'
  const html = emailLayout({
    heading: 'You’re cleared',
    preheader: `Your teaching license is verified until ${until}.`,
    bodyHtml: `
        <p>Hi ${esc(firstName)},</p>
        <p>We’ve verified your teaching license, so you’re cleared to work with students at Stellr events until <strong>${esc(until)}</strong>. There’s nothing more to do.</p>
        <p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#3C6DF6;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">View my clearance</a></p>
        <p style="color:#6b7280;font-size:14px">If your license is renewed, update it in your account before it expires.</p>`,
  })
  const text = `Hi ${firstName},\n\nWe've verified your teaching license, so you're cleared to work with students at Stellr events until ${until}. There's nothing more to do.\n\nView my clearance: ${url}\n\nIf your license is renewed, update it in your account before it expires.\n\n— Stellr Education`
  return { subject, html, text }
}

/** Tell the teacher their license was verified: email (not preference-gated — it's about their clearance) + bell. */
export async function notifyLicenseVerified(
  db: SupabaseClient,
  memberId: string,
  expiryDate: string,
): Promise<{ sent: boolean }> {
  try {
    const { data: member } = await db.from('members').select('first_name, email').eq('id', memberId).maybeSingle()
    if (!member?.email) return { sent: false }
    const mail = licenseVerifiedEmail({
      firstName: member.first_name || 'there',
      expiryDate,
      url: `${AUTH_APP_URL}${CLEARANCE_PATH}`,
    })
    await sendEmail({ to: member.email, ...mail })
    await db.from('community_notifications').insert({
      recipient_member_id: memberId,
      type: 'action',
      reference_type: 'compliance_cleared',
      reference_id: memberId,
      body: `Your teaching license is verified — you're cleared until ${formatDateShort(expiryDate)}.`,
    })
    return { sent: true }
  } catch (err) {
    console.error('[license-review] verified notice failed:', err)
    return { sent: false }
  }
}
