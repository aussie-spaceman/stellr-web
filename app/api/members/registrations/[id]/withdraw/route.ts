import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { assertNotImpersonating } from '@/lib/impersonation'
import { previewRefund } from '@/lib/refunds/preview'
import { executeDeletion, DeletionBlockedError } from '@/lib/deletion/execute'
import { removeEventParticipation } from '@/lib/event-participation-sync'
import { notifyCommunityAdmins } from '@/lib/notify'
import { logActivity } from '@/lib/activity-log'
import { formatMoney } from '@/lib/group-billing'

// A member withdraws their own individual registration (29 Oct 2026).
//   GET  → what withdrawing would refund, for the confirm dialog.
//   POST { reason? } → withdraw: the registration is marked withdrawn (a soft
//        delete, so it and the member's account are kept and they can hear about
//        future years), unsigned agreements are voided, the paid fee is refunded
//        under the 45-day money-back guarantee, and staff are told.
// Group places are removed from the Teams tab instead.

type Db = ReturnType<typeof supabaseServer>

interface Owned { registrationId: string; participantId: string; memberId: string; eventSlug: string; eventTitle: string; email: string; name: string }

async function ownRegistration(db: Db, registrationId: string): Promise<Owned | NextResponse> {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { data: member } = await db
    .from('members')
    .select('id, email, first_name, last_name')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const { data: reg } = await db
    .from('registrations')
    .select('id, type, status, event_slug, event_title')
    .eq('id', registrationId)
    .maybeSingle()
  if (!reg || reg.type !== 'individual') return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
  if (reg.status === 'withdrawn') return NextResponse.json({ error: 'You have already withdrawn from this event.' }, { status: 409 })

  const { data: participant } = await db
    .from('participants')
    .select('id, member_id, checked_in_at')
    .eq('registration_id', registrationId)
    .eq('member_id', member.id)
    .maybeSingle()
  if (!participant) return NextResponse.json({ error: 'Registration not found' }, { status: 404 })
  if (participant.checked_in_at) {
    return NextResponse.json({ error: 'You have already checked in at this event, so the registration can’t be withdrawn here. Reply to your confirmation email and we’ll help.' }, { status: 409 })
  }
  return {
    registrationId,
    participantId: participant.id as string,
    memberId: member.id as string,
    eventSlug: reg.event_slug as string,
    eventTitle: reg.event_title as string,
    email: member.email as string,
    name: [member.first_name, member.last_name].filter(Boolean).join(' '),
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()
  const owned = await ownRegistration(db, id)
  if (owned instanceof NextResponse) return owned

  const p = await previewRefund(owned.participantId)
  const refundCents = p.options.cash?.cents ?? 0
  let refund: string
  if (!p.paid) refund = 'Nothing has been paid, so there is nothing to refund.'
  else if (p.alreadyRefunded || p.externalRefund?.full) refund = 'Your payment has already been refunded.'
  else if (refundCents > 0) refund = `You’ll be refunded ${formatMoney(refundCents, p.currency)} to the card or account you paid with.`
  else if (p.daysSincePayment != null && p.daysSincePayment > p.guaranteeDays) {
    refund = `You paid ${p.daysSincePayment} days ago, which is outside our ${p.guaranteeDays}-day money-back guarantee, so no refund is due.`
  } else refund = 'We’ll check your payment and refund it if it’s within our money-back guarantee.'
  return NextResponse.json({ eventTitle: owned.eventTitle, refundCents, currency: p.currency, refund })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — see lib/impersonation.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const { id } = await params
  const db = supabaseServer()
  const owned = await ownRegistration(db, id)
  if (owned instanceof NextResponse) return owned
  const body = await req.json().catch(() => null)
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : ''

  let result: Awaited<ReturnType<typeof executeDeletion>>
  try {
    // Soft: status 'withdrawn' + withdrawn_at. The registration, participant and
    // member rows all stay; in-flight agreements are voided; the fee is refunded.
    result = await executeDeletion('registration', id, {
      mode: 'soft',
      deletedBy: owned.memberId,
      refundChoice: 'cash',
      refundNote: reason ? `Withdrawn by the member: ${reason}` : 'Withdrawn by the member',
      actorType: 'member',
    })
  } catch (e) {
    if (e instanceof DeletionBlockedError) {
      return NextResponse.json({ error: 'This registration can’t be withdrawn online. Reply to your confirmation email and we’ll help.' }, { status: 409 })
    }
    console.error('[registrations/withdraw] failed:', e)
    return NextResponse.json({ error: 'Something went wrong withdrawing your registration. Please try again.' }, { status: 500 })
  }

  // The soft path leaves Space access in place; a withdrawn member leaves the
  // event's Space (no-op if they hold another active place on the event).
  await removeEventParticipation(db, { memberId: owned.memberId, eventSlug: owned.eventSlug })

  const refund = result.refunds[0]
  const refundLine = refund?.type === 'cash'
    ? `A ${formatMoney(refund.refundCents)} refund is on its way to the card or account you paid with. It usually arrives within 5–10 business days.`
    : refund?.type === 'manual_required'
      ? 'Our team will process your refund by hand and email you when it’s done.'
      : null

  await logActivity({
    memberId: owned.memberId,
    category: 'event',
    action: 'registration_withdrawn',
    summary: `Withdrew from ${owned.eventTitle}${reason ? ` — ${reason}` : ''}`,
    metadata: { registrationId: id, eventSlug: owned.eventSlug, refund: refund ?? null },
    actorType: 'member',
    actorMemberId: owned.memberId,
  }, db)
  await notifyCommunityAdmins({
    type: 'action',
    body: `${owned.name || owned.email} withdrew from ${owned.eventTitle}${reason ? ` (“${reason}”)` : ''}. Refund: ${refund ? refund.detail : 'none'}.`,
  }).catch(() => {})

  return NextResponse.json({
    message: ['You’ve withdrawn from this event. Your Stellr account stays, so we can let you know about future events.', refundLine].filter(Boolean).join(' '),
  })
}
