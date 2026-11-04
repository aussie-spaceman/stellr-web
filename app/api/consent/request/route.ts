import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { assertNotImpersonating } from '@/lib/impersonation'
import { normalizeEmail } from '@/lib/member-enums'
import { voidEnvelopeRow, remindEnvelopeRow } from '@/lib/esign/operations'
import { logActivity } from '@/lib/activity-log'
import { MEMBERSHIP_SLUG } from '@/lib/membership-agreement'
import { shadowSyncFields } from '@/lib/field-crypto-shadow'
import {
  RESEND_INTERVAL_MS, getPendingConsent, isPlausibleEmail, markConsentRequestSent, openPendingConsent,
  sendConsentRequest, settlePendingConsent, signedInMemberForConsent,
} from '@/lib/pending-consent'

// POST /api/consent/request — the signed-in member's own guardian-consent
// request (decision 24, lib/pending-consent). Two uses:
//
//   • {}                              — send it again (a reminder of the form
//                                       already out, or a fresh one if that
//                                       was voided or declined);
//   • { guardian_email, guardian_name? } — the email was wrong: the consent
//                                       form out for signature is voided and a
//                                       new one goes to the corrected address.
//
// Only the membership consent form is ever voided or reminded here: an event's
// permission form for the same member is the event's business, not this one's.
// Once an hour at most, so it cannot be used to flood someone's inbox. Never
// changes the 30-day purge date. The member can only act on their own request.

export async function POST(req: Request) {
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const db = supabaseServer()
  const member = await signedInMemberForConsent(db)
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  let pending
  try {
    pending = await getPendingConsent(db, member.id)
  } catch (err) {
    console.error('[consent-request] reading the request failed:', err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
  if (!pending) return NextResponse.json({ code: 'no_pending_consent', error: 'Nothing is waiting for consent.' }, { status: 404 })
  if (await settlePendingConsent(db, member.id)) return NextResponse.json({ state: 'consented' })

  if (pending.last_sent_at && Date.now() - new Date(pending.last_sent_at).getTime() < RESEND_INTERVAL_MS) {
    return NextResponse.json(
      { code: 'too_soon', error: 'We sent it recently. Please give it an hour, and check the spam folder too.' },
      { status: 429 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as { guardian_email?: unknown; guardian_name?: unknown }
  const changing = body.guardian_email !== undefined && body.guardian_email !== null && body.guardian_email !== ''
  // Opened at the age screen, but no parent or guardian named yet: the
  // onboarding form is where that happens.
  if (!pending.guardian_email) {
    return NextResponse.json(
      { code: 'guardian_not_named', error: 'Please finish setting up your account first.' },
      { status: 409 },
    )
  }
  let guardianEmail = pending.guardian_email
  if (changing) {
    if (!isPlausibleEmail(body.guardian_email)) {
      return NextResponse.json({ error: "Please check your parent or guardian's email address." }, { status: 400 })
    }
    guardianEmail = normalizeEmail(body.guardian_email)
    if (guardianEmail === normalizeEmail(member.email)) {
      return NextResponse.json(
        { code: 'guardian_email_is_own', error: "Please use your parent or guardian's own email address, not yours." },
        { status: 400 },
      )
    }
  }

  // The membership consent form out for signature for this member. Never an
  // event's form (event_slug is the event's), which this route must not touch.
  const { data: open } = await db
    .from('agreements')
    .select('id, envelope_id, provider')
    .eq('member_id', member.id)
    .eq('envelope_type', 'minor')
    .eq('event_slug', MEMBERSHIP_SLUG)
    .in('status', ['created', 'sent', 'delivered'])
  const openRows = (open ?? []) as Array<{ id: string; envelope_id: string; provider: string | null }>

  // The hourly limit counts every send ATTEMPT, whatever comes of it. Stamped
  // before anything goes out: sendConsentRequest stamps only an 'issued'
  // envelope, so an answer such as 'in flight', or a send that failed, left the
  // clock where it was and the next request could send again at once.
  await markConsentRequestSent(db, member.id)

  if (changing && guardianEmail !== pending.guardian_email) {
    for (const row of openRows) {
      try {
        await voidEnvelopeRow(db, row, 'The parent or guardian email was corrected')
      } catch (err) {
        console.error('[consent-request] void failed:', err)
        return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
      }
    }
    const guardianName = pending.band === 'teen' && typeof body.guardian_name === 'string' && body.guardian_name.trim()
      ? body.guardian_name.trim().slice(0, 120)
      : pending.guardian_name
    await openPendingConsent(db, { memberId: member.id, band: pending.band, guardianName, guardianEmail })
    if (pending.band === 'teen') {
      // The teen's emergency contact is the guardian the form goes to.
      await db.from('members').update({ ec_email: guardianEmail }).eq('id', member.id)
      // S4 field encryption: inert unless FIELD_CRYPTO_MODE=shadow; never fails this write.
      shadowSyncFields('members', [member.id])
    }
    await logActivity({
      memberId: member.id,
      category: 'account',
      action: 'guardian_consent_email_changed',
      summary: 'Changed the parent or guardian email for the consent request and sent it again',
      actorType: 'member',
      actorMemberId: member.id,
    }, db)
    const result = await sendConsentRequest(db, member.id)
    return NextResponse.json({ state: 'sent', outcome: result.outcome })
  }

  if (openRows.length) {
    await remindEnvelopeRow(db, openRows[0])
    return NextResponse.json({ state: 'sent', outcome: 'reminded' })
  }
  const result = await sendConsentRequest(db, member.id)
  return NextResponse.json({ state: 'sent', outcome: result.outcome })
}
