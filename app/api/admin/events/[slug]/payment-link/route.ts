import { NextResponse } from 'next/server'
import { requireEventAccess } from '@/lib/event-access'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { sendPayLinkEmail } from '@/lib/registration-pay-link'
import { isEmailLike, maskEmail } from '@/lib/utils'

// POST /api/admin/events/[slug]/payment-link — email the durable pay link for
// a pending card registration (admins + assigned event managers). Goes to the
// registrant and their emergency contact (individual) or the organiser and
// teacher POC (group), plus any addresses the admin adds — a parent writing in
// from an address that isn't on the registration, for instance.
//   body: { registrationId: string, extraRecipients?: string[] }
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await req.json().catch(() => null)
  const registrationId = typeof body?.registrationId === 'string' ? body.registrationId : null
  if (!registrationId) return NextResponse.json({ error: 'registrationId required' }, { status: 400 })
  const extraRaw: unknown[] = Array.isArray(body?.extraRecipients) ? body.extraRecipients : []
  const extraRecipients = extraRaw.filter((e): e is string => typeof e === 'string').map((e) => e.trim())
  const bad = extraRecipients.find((e) => !isEmailLike(e))
  if (bad) return NextResponse.json({ error: `Not an email address: ${bad}` }, { status: 400 })

  const db = supabaseServer()
  const { data: reg } = await db
    .from('registrations')
    .select('id, event_slug, status, invoice_requested, member_pays_individually, teacher_member_id')
    .eq('id', registrationId)
    .maybeSingle()
  if (!reg || reg.event_slug !== slug) {
    return NextResponse.json({ error: 'Registration not found for this event' }, { status: 404 })
  }
  if (reg.status !== 'pending') {
    return NextResponse.json({ error: 'This registration has no payment outstanding' }, { status: 400 })
  }
  if (reg.invoice_requested || reg.member_pays_individually) {
    return NextResponse.json({ error: 'This registration is not paid by a single card checkout' }, { status: 400 })
  }

  let result
  try {
    result = await sendPayLinkEmail(db, registrationId, { force: true, extraRecipients })
  } catch (err) {
    console.error('[admin/payment-link] send failed:', err)
    return NextResponse.json({ error: 'The email could not be sent — try again shortly' }, { status: 502 })
  }
  if (!result.sent) {
    return NextResponse.json({ error: `Could not send the pay link (${result.reason ?? 'unknown'})` }, { status: 400 })
  }

  const actor = await actorFromAuth()
  const { data: firstPart } = await db
    .from('participants')
    .select('member_id')
    .eq('registration_id', registrationId)
    .not('member_id', 'is', null)
    .limit(1)
    .maybeSingle()
  const subjectMemberId =
    (reg.teacher_member_id as string | null) ?? (firstPart as { member_id?: string } | null)?.member_id ?? actor.actorMemberId ?? null
  if (subjectMemberId) {
    await logActivity(
      {
        memberId: subjectMemberId,
        category: 'billing',
        action: 'payment_link_sent',
        summary: `Pay link emailed for ${slug} to ${result.recipients.map(maskEmail).join(', ')}`,
        metadata: { registrationId, eventSlug: slug, recipients: result.recipients },
        ...actor,
      },
      db,
    )
  }

  return NextResponse.json({ ok: true, recipients: result.recipients.map(maskEmail) })
}
