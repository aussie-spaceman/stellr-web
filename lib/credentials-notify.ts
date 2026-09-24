import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail, credentialIssuedEmail, credentialsMadePrivateEmail } from '@/lib/email'
import { shareConsentFor, canShare, credentialUrl, unpublishCredentialsFor, type CredentialRow } from '@/lib/credentials'

// The "you've earned a credential" email, addressed the way the DocuSign
// notices are: an adult hears directly; a minor's guardian is the addressee
// and the minor is Cc'd when they have an address. Kept out of
// lib/credentials so the issuance module stays free of mail dependencies.

export interface CredentialRecipient {
  firstName: string
  email: string | null
  guardianFirstName?: string | null
  guardianEmail?: string | null
}

/** Non-fatal: a mail outage must never undo an issue. Returns whether it sent. */
export async function sendCredentialIssuedEmail(
  db: SupabaseClient,
  row: CredentialRow,
  to: CredentialRecipient,
): Promise<boolean> {
  try {
    const consent = await shareConsentFor(db, row)
    const toGuardian = row.is_minor && !!to.guardianEmail && !!to.guardianFirstName
    const address = toGuardian ? to.guardianEmail : to.email
    if (!address) return false

    const mail = credentialIssuedEmail({
      recipientFirstName: to.firstName,
      guardianFirstName:  toGuardian ? to.guardianFirstName : null,
      title:    row.title,
      issuer:   row.issuer,
      url:      credentialUrl(row.number),
      isMinor:  row.is_minor,
      canShare: canShare(row, consent).ok,
    })
    await sendEmail({
      to: address,
      cc: toGuardian && to.email ? [to.email] : undefined,
      ...mail,
    })
    return true
  } catch (err) {
    console.error('[credentials] issued email failed:', err)
    return false
  }
}

/**
 * Honour a guardian's opt-out: take every public page down, then tell the
 * family which ones changed. Shared by the admin toggle and the DocuSign
 * completion webhook. Mail failure is logged, never thrown — the pages are
 * already private, which is the part that matters.
 */
export async function applyGuardianOptOut(
  db: SupabaseClient,
  who: { memberId: string | null; participantId: string | null },
): Promise<number> {
  const rows = await unpublishCredentialsFor(db, who)
  if (rows.length === 0) return 0
  try {
    const to = await recipientForCredential(db, rows[0])
    const toGuardian = !!to?.guardianEmail && !!to?.guardianFirstName
    const address = toGuardian ? to!.guardianEmail : to?.email
    if (to && address) {
      const mail = credentialsMadePrivateEmail({
        recipientFirstName: to.firstName,
        guardianFirstName:  toGuardian ? to.guardianFirstName : null,
        titles: rows.map(r => r.title),
      })
      await sendEmail({ to: address, cc: toGuardian && to.email ? [to.email] : undefined, ...mail })
    }
  } catch (err) {
    console.error('[credentials] made-private email failed:', err)
  }
  return rows.length
}

/** Resolve the addressee for a stored credential from its member or participant. */
export async function recipientForCredential(db: SupabaseClient, row: CredentialRow): Promise<CredentialRecipient | null> {
  if (row.member_id) {
    const { data: m } = await db
      .from('members')
      .select('first_name, email, ec_first_name, ec_email')
      .eq('id', row.member_id)
      .maybeSingle()
    if (m) return { firstName: m.first_name, email: m.email, guardianFirstName: m.ec_first_name, guardianEmail: m.ec_email }
  }
  if (row.participant_id) {
    const { data: p } = await db
      .from('participants')
      .select('first_name, email, emergency_contact_first_name, emergency_contact_email')
      .eq('id', row.participant_id)
      .maybeSingle()
    if (p) return { firstName: p.first_name, email: p.email, guardianFirstName: p.emergency_contact_first_name, guardianEmail: p.emergency_contact_email }
  }
  return null
}
