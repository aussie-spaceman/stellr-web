// A background check the member already holds from another organisation — a
// school district, a state agency, another screening vendor. Same shape as the
// teacher license (lib/teacher-license.ts) with three differences (owner, 9 Nov
// 2026): no license number or state; the document is mandatory; and it lasts
// BC_VALIDITY_YEARS from the date the check was completed (or to an earlier
// expiry printed on it). Once an admin verifies it, it clears the member for
// everything a background check clears them for (lib/compliance.ts).
//
// The member and an admin submit through the same function, so both pass the
// same checks. A submission always resets verification: entering a check is not
// verifying it. Verify is bound to the version the admin reviewed (BG-9).
//
// The document is sensitive (it may name offences, addresses, ID numbers). It
// lives in the private teacher-licenses bucket under "<memberId>/bc/", is only
// ever served through a short-lived signed URL to the member or an admin, and is
// deleted from storage when it is replaced or withdrawn.

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BC_VALIDITY_YEARS, externalCheckValidUntil } from '@/lib/compliance'
import { claimUpload, type UploadPurpose } from '@/lib/uploads'
import { logActivity, type Actor } from '@/lib/activity-log'
import { TEACHER_LICENSE_BUCKET, externalBcPrefix, isLicenseDocumentType } from '@/lib/teacher-license'
import { notifyCommunityAdmins } from '@/lib/notify'
import { sendEmail } from '@/lib/email'
import { emailLayout, escapeHtml as esc } from '@/lib/email-layout'
import { AUTH_APP_URL } from '@/lib/env'
import { CLEARANCE_PATH } from '@/lib/compliance-links'
import { formatDateShort } from '@/lib/utils'
import { recheckEventManagerClearance } from '@/lib/event-manager'

export const EXTERNAL_BC_BUCKET = TEACHER_LICENSE_BUCKET
export const EXTERNAL_BC_TABLE = 'member_external_background_checks'

/** The folder a member's uploaded check sits in. Upload grants and claims both pin to it. */
export { externalBcPrefix }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export const externalCheckSchema = z.object({
  issuer: z.string().trim().min(1, 'Say who ran the check').max(200, 'Keep the issuer under 200 characters'),
  completed_on: z.string().regex(ISO_DATE, 'Completion date must be YYYY-MM-DD'),
  document_expires_on: z
    .string()
    .regex(ISO_DATE, 'Expiry date must be YYYY-MM-DD')
    .nullish()
    .or(z.literal('').transform(() => null)),
  storagePath: z.string().min(1, 'Upload the background check document'),
  fileType: z.string().min(1, 'Upload the background check document'),
})

export type ExternalCheckInput = z.infer<typeof externalCheckSchema>

/**
 * Date rules, as of `today` (YYYY-MM-DD). Returns an error message or null.
 * A check that has already run out is refused at the door rather than saved as
 * something that can never clear anyone.
 */
export function validateExternalCheckDates(
  input: { completed_on: string; document_expires_on?: string | null },
  today: string = new Date().toISOString().slice(0, 10),
): string | null {
  if (Number.isNaN(Date.parse(`${input.completed_on}T00:00:00Z`))) return 'Completion date is not a real date'
  if (input.completed_on > today) return 'The completion date can’t be in the future'
  if (input.document_expires_on) {
    if (Number.isNaN(Date.parse(`${input.document_expires_on}T00:00:00Z`))) return 'Expiry date is not a real date'
    if (input.document_expires_on < input.completed_on) return 'The expiry date is before the completion date'
  }
  const until = externalCheckValidUntil({ completed_on: input.completed_on, document_expires_on: input.document_expires_on ?? null })
  if (until < today) {
    return input.document_expires_on && input.document_expires_on === until
      ? 'This check has already expired'
      : `Checks completed more than ${BC_VALIDITY_YEARS} years ago no longer count. A new check is needed`
  }
  return null
}

export type SaveResult =
  | { ok: true; updatedAt: string; validUntil: string }
  | { ok: false; status: number; error: string }

/**
 * Save (or replace) a member's uploaded check. The browser has already put the
 * file in storage via /api/uploads/sign under `purpose`; this confirms the bytes
 * (claimUpload, pinned to the member's bc/ folder), writes the row with
 * verification cleared, removes any previous document, logs it and alerts staff.
 */
export async function saveExternalCheck(
  db: SupabaseClient,
  args: {
    memberId: string
    input: ExternalCheckInput
    purpose: Extract<UploadPurpose, 'external-bc-document' | 'external-bc-document-admin'>
    submittedBy: 'member' | 'admin'
    actor: Actor
    now?: Date
  },
): Promise<SaveResult> {
  const { memberId, input, purpose, submittedBy, actor } = args
  const now = args.now ?? new Date()
  const dateError = validateExternalCheckDates(input, now.toISOString().slice(0, 10))
  if (dateError) return { ok: false, status: 400, error: dateError }
  if (!isLicenseDocumentType(input.fileType)) {
    return { ok: false, status: 400, error: 'Upload an image (PNG/JPG/WebP/HEIC) or PDF.' }
  }
  const prefix = externalBcPrefix(memberId)
  if (!input.storagePath.startsWith(prefix)) return { ok: false, status: 403, error: 'Forbidden' }

  // Bytes are checked on the STORED object; a failed check deletes it.
  const claimed = await claimUpload({ purpose, storagePath: input.storagePath, expectedPrefix: prefix })
  if ('error' in claimed) return { ok: false, status: claimed.status, error: claimed.error }

  const { data: existing } = await db.from(EXTERNAL_BC_TABLE).select('id, document_path').eq('member_id', memberId).maybeSingle()

  const stamp = now.toISOString()
  const { error } = await db.from(EXTERNAL_BC_TABLE).upsert(
    {
      member_id: memberId,
      issuer: input.issuer,
      completed_on: input.completed_on,
      document_expires_on: input.document_expires_on ?? null,
      document_path: input.storagePath,
      verified_at: null,
      verified_by: null,
      verified_label: null,
      submitted_by: submittedBy,
      updated_at: stamp,
    },
    { onConflict: 'member_id' },
  )
  if (error) {
    console.error('[external-bc] save error:', error)
    return { ok: false, status: 500, error: 'Failed to save the background check' }
  }

  const previous = (existing as { document_path?: string | null } | null)?.document_path
  if (previous && previous !== input.storagePath) {
    await db.storage.from(EXTERNAL_BC_BUCKET).remove([previous])
  }

  const validUntil = externalCheckValidUntil({ completed_on: input.completed_on, document_expires_on: input.document_expires_on ?? null })
  await logActivity(
    {
      memberId,
      category: 'compliance',
      action: submittedBy === 'admin' ? 'external_bc_submitted_by_admin' : 'external_bc_submitted',
      summary: `Background check from ${input.issuer} uploaded${submittedBy === 'admin' ? ' by admin' : ''} — awaiting verification`,
      // Dates and issuer only: never the document path or anything read from the file.
      metadata: { issuer: input.issuer, completed_on: input.completed_on, document_expires_on: input.document_expires_on ?? null, valid_until: validUntil },
      ...actor,
    },
    db,
  )
  if (submittedBy === 'member') await alertExternalCheckReview(db, memberId, input.issuer)
  // A new version is unverified: if it was what cleared them, Event Manager access goes now.
  await recheckEventManagerClearance(db, memberId, actor)

  return { ok: true, updatedAt: stamp, validUntil }
}

/** Remove the check and its document entirely (the document is mandatory, so there is no "row without file"). */
export async function deleteExternalCheck(
  db: SupabaseClient,
  args: { memberId: string; actor: Actor; byAdmin: boolean },
): Promise<{ ok: true; removed: boolean } | { ok: false; status: number; error: string }> {
  const { data: row } = await db.from(EXTERNAL_BC_TABLE).select('id, document_path, issuer').eq('member_id', args.memberId).maybeSingle()
  if (!row) return { ok: true, removed: false }
  const r = row as { id: string; document_path: string; issuer: string }
  const { error } = await db.from(EXTERNAL_BC_TABLE).delete().eq('id', r.id)
  if (error) {
    console.error('[external-bc] delete error:', error)
    return { ok: false, status: 500, error: 'Failed to remove the background check' }
  }
  await db.storage.from(EXTERNAL_BC_BUCKET).remove([r.document_path])
  await logActivity(
    {
      memberId: args.memberId,
      category: 'compliance',
      action: args.byAdmin ? 'external_bc_deleted_by_admin' : 'external_bc_deleted',
      summary: `Uploaded background check from ${r.issuer} removed${args.byAdmin ? ' by admin' : ''}`,
      ...args.actor,
    },
    db,
  )
  await recheckEventManagerClearance(db, args.memberId, args.actor)
  return { ok: true, removed: true }
}

/**
 * Admin verify / unverify. Verify must name the version reviewed (updatedAt):
 * the guarded update matches nothing if the member replaced the check since the
 * admin opened the page, so we can't certify a document nobody looked at.
 */
export async function setExternalCheckVerified(
  db: SupabaseClient,
  args: { memberId: string; verify: boolean; updatedAt?: string; actor: Actor },
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: row } = await db
    .from(EXTERNAL_BC_TABLE)
    .select('id, issuer, completed_on, document_expires_on')
    .eq('member_id', args.memberId)
    .maybeSingle()
  if (!row) return { ok: false, status: 404, error: 'No uploaded background check on file for this member' }
  const r = row as { id: string; issuer: string; completed_on: string; document_expires_on: string | null }
  if (args.verify && !args.updatedAt) return { ok: false, status: 400, error: 'Missing background check version' }
  if (args.verify) {
    const dateError = validateExternalCheckDates(r)
    if (dateError) return { ok: false, status: 409, error: `${dateError}. It can’t be verified.` }
  }

  const now = new Date().toISOString()
  let update = db
    .from(EXTERNAL_BC_TABLE)
    .update({
      verified_at: args.verify ? now : null,
      verified_by: args.verify ? args.actor.actorMemberId ?? null : null,
      verified_label: args.verify ? args.actor.actorLabel ?? null : null,
      updated_at: now,
    })
    .eq('id', r.id)
  if (args.verify) update = update.eq('updated_at', args.updatedAt!)
  const { data: rows, error } = await update.select('id')
  if (error) {
    console.error('[external-bc] verify error:', error)
    return { ok: false, status: 500, error: 'Failed to update the background check' }
  }
  if (args.verify && (!rows || rows.length === 0)) {
    return { ok: false, status: 409, error: 'This background check was changed since you reviewed it. Reload and verify the current version.' }
  }

  const validUntil = externalCheckValidUntil(r)
  await logActivity(
    {
      memberId: args.memberId,
      category: 'compliance',
      action: args.verify ? 'external_bc_verified' : 'external_bc_unverified',
      summary: args.verify
        ? `Uploaded background check from ${r.issuer} verified by admin (valid until ${validUntil})`
        : `Uploaded background check from ${r.issuer}: verification removed`,
      metadata: { issuer: r.issuer, valid_until: validUntil },
      ...args.actor,
    },
    db,
  )
  if (args.verify) await notifyExternalCheckVerified(db, args.memberId, validUntil)
  else await recheckEventManagerClearance(db, args.memberId, args.actor)
  return { ok: true }
}

// ── Notifications ───────────────────────────────────────────────────────────

const ALERT_COOLDOWN_MS = 30 * 60_000

/** Tell staff there is an uploaded check to verify. One alert per member per 30 minutes. Never throws. */
export async function alertExternalCheckReview(db: SupabaseClient, memberId: string, issuer: string): Promise<void> {
  try {
    const since = new Date(Date.now() - ALERT_COOLDOWN_MS).toISOString()
    const { count } = await db
      .from('member_activity_log')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', memberId)
      .eq('action', 'external_bc_review_alert_sent')
      .gte('created_at', since)
    if ((count ?? 0) > 0) return

    const { data: member } = await db.from('members').select('first_name, last_name, email').eq('id', memberId).maybeSingle()
    if (!member) return
    const name = [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email || 'A member'
    const url = `${AUTH_APP_URL}/admin/members/${memberId}`
    await notifyCommunityAdmins({
      type: 'action',
      body: `${name} uploaded a background check — waiting verification`,
      referenceType: 'license_review',
      referenceId: memberId,
      email: {
        subject: `Background check to verify: ${name}`,
        html: emailLayout({
          heading: 'A background check is waiting verification',
          preheader: `${name} uploaded a background check from another organisation.`,
          bodyHtml: `
            <p>${esc(name)} uploaded a background check from <strong>${esc(issuer)}</strong>. They are not cleared to work with students until it is verified.</p>
            <p>Open their member page, view the document, and check that it is a cleared result for this person, who ran it, and the completion date. Then choose <strong>Mark verified</strong>.</p>
            <p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#3C6DF6;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Review the check</a></p>`,
        }),
        text: `${name} uploaded a background check from ${issuer}. They are not cleared to work with students until it is verified.\n\nOpen their member page, view the document, and check that it is a cleared result for this person, who ran it, and the completion date. Then choose Mark verified:\n${url}`,
      },
    })
    await logActivity(
      { memberId, category: 'compliance', action: 'external_bc_review_alert_sent', summary: 'Team alerted to verify an uploaded background check', actorType: 'system' },
      db,
    )
  } catch (err) {
    console.error('[external-bc] team alert failed:', err)
  }
}

export function externalCheckVerifiedEmail({ firstName, validUntil, url }: { firstName: string; validUntil: string; url: string }) {
  const until = formatDateShort(validUntil)
  const subject = 'Your background check is verified'
  const html = emailLayout({
    heading: 'You’re cleared',
    preheader: `Your background check is verified until ${until}.`,
    bodyHtml: `
        <p>Hi ${esc(firstName)},</p>
        <p>We’ve verified the background check you uploaded, so you’re cleared to work with students at Stellr events until <strong>${esc(until)}</strong>. There’s nothing more to do.</p>
        <p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#3C6DF6;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">View my clearance</a></p>`,
  })
  const text = `Hi ${firstName},\n\nWe've verified the background check you uploaded, so you're cleared to work with students at Stellr events until ${until}. There's nothing more to do.\n\nView my clearance: ${url}\n\n— Stellr Education`
  return { subject, html, text }
}

async function notifyExternalCheckVerified(db: SupabaseClient, memberId: string, validUntil: string): Promise<void> {
  try {
    const { data: member } = await db.from('members').select('first_name, email').eq('id', memberId).maybeSingle()
    if (!member?.email) return
    await sendEmail({
      to: member.email,
      ...externalCheckVerifiedEmail({ firstName: member.first_name || 'there', validUntil, url: `${AUTH_APP_URL}${CLEARANCE_PATH}` }),
    })
    await db.from('community_notifications').insert({
      recipient_member_id: memberId,
      type: 'action',
      reference_type: 'compliance_cleared',
      reference_id: memberId,
      body: `Your background check is verified — you're cleared until ${formatDateShort(validUntil)}.`,
    })
  } catch (err) {
    console.error('[external-bc] verified notice failed:', err)
  }
}
