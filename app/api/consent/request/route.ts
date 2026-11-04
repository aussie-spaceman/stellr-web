import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { assertNotImpersonating } from '@/lib/impersonation'
import { normalizeEmail } from '@/lib/member-enums'
import { voidEnvelopeRow, remindEnvelopeRow } from '@/lib/esign/operations'
import { logActivity } from '@/lib/activity-log'
import {
  RESEND_INTERVAL_MS, getPendingConsent, isPlausibleEmail, markConsentRequestSent, openPendingConsent,
  sendConsentRequest, settlePendingConsent,
} from '@/lib/pending-consent'

// POST /api/consent/request — the signed-in member's own guardian-consent
// request (decision 24, lib/pending-consent). Two uses:
//
//   • {}                              — send it again (a reminder of the form
//                                       already out, or a fresh one if that
//                                       was voided or declined);
//   • { guardian_email, guardian_name? } — the email was wrong: the form out
//                                       for signature is voided and a new one
//                                       goes to the corrected address.
//
// Once an hour at most, so it cannot be used to flood someone's inbox. Never
// changes the 30-day purge date. The member can only act on their own request.

export async function POST(req: Request) {
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = supabaseServer()
  const pending = await getPendingConsent(db, member.id)
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

  // The forms out for signature for this member's consent.
  const { data: open } = await db
    .from('agreements')
    .select('id, envelope_id, provider')
    .eq('member_id', member.id)
    .eq('envelope_type', 'minor')
    .in('status', ['created', 'sent', 'delivered'])
  const openRows = (open ?? []) as Array<{ id: string; envelope_id: string; provider: string | null }>

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
    await markConsentRequestSent(db, member.id)
    return NextResponse.json({ state: 'sent', outcome: 'reminded' })
  }
  const result = await sendConsentRequest(db, member.id)
  return NextResponse.json({ state: 'sent', outcome: result.outcome })
}
