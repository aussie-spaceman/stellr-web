import { NextResponse } from 'next/server'
import { requireEventRoute } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { firstLinkedMemberId, stellrOnlyDb } from '@/lib/events/admin-records'
import { sendPayLinkEmail } from '@/lib/registration-pay-link'
import { isEmailLike, maskEmail } from '@/lib/utils'
import { loadEventRecord, refuseOutsideStellr, refuseUnlessStellrEvent } from '@/lib/tenancy/load-scoped'

// POST /api/admin/events/[slug]/payment-link — email the durable pay link for
// a pending card registration (admins + assigned event managers). Goes to the
// registrant and their emergency contact (individual) or the organiser and
// teacher POC (group), plus any addresses the admin adds — a parent writing in
// from an address that isn't on the registration, for instance.
//   body: { registrationId: string, extraRecipients?: string[] }
//
// The pay page takes payment on Stellr's Stripe account: priced tenant events wait on S9.
// Until then a tenant's event is refused for everyone, a Stellr admin included
// (refuseUnlessStellrEvent), before the registration is read or anyone is emailed.

const ROUTE = '/api/admin/events/[slug]/payment-link'

type Ctx = { params: Promise<{ slug: string }> }

type Registration = {
  id: string
  event_slug: string
  status: string
  invoice_requested: boolean | null
  member_pays_individually: boolean | null
  teacher_member_id: string | null
}

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'registration.pay_link.send', ...auditSubject(req, 'registrations') }),
  sendPayLink,
)

async function sendPayLink(req: Request, { params }: Ctx) {
  const { slug } = await params
  const staff = await requireEventRoute(slug, { route: ROUTE })
  if (!staff.ok) return staff.response
  noteAuditSubject(req, { userId: staff.userId, tenantId: staff.tenantId, eventSlug: slug })
  const refused = refuseOutsideStellr(staff.scope)
  if (refused) return refused
  const foreign = await refuseUnlessStellrEvent(supabaseServer(), slug, ROUTE)
  if (foreign) return foreign

  const body = await req.json().catch(() => null)
  const registrationId = typeof body?.registrationId === 'string' ? body.registrationId : null
  if (!registrationId) return NextResponse.json({ error: 'registrationId required' }, { status: 400 })
  noteAuditSubject(req, { id: registrationId })
  const extraRaw: unknown[] = Array.isArray(body?.extraRecipients) ? body.extraRecipients : []
  const extraRecipients = extraRaw.filter((e): e is string => typeof e === 'string').map((e) => e.trim())
  const bad = extraRecipients.find((e) => !isEmailLike(e))
  if (bad) return NextResponse.json({ error: `Not an email address: ${bad}` }, { status: 400 })

  const db = supabaseServer()
  const loaded = await loadEventRecord<Registration>(staff, 'registrations', registrationId, {
    db,
    select: 'id, event_slug, status, invoice_requested, member_pays_individually, teacher_member_id',
    notFound: () => NextResponse.json({ error: 'Registration not found for this event' }, { status: 404 }),
    label: ROUTE,
  })
  if (!loaded.ok) return loaded.response
  const reg = loaded.row
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
  const subjectMemberId = reg.teacher_member_id ?? (await firstLinkedMemberId(stellrOnlyDb(staff.scope, db), registrationId)) ?? actor.actorMemberId ?? null
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
