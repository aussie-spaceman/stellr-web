import { NextResponse } from 'next/server'
import { requireEventRoute } from '@/lib/authz'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { getEventRoster } from '@/lib/event-admin'
import { getEventBySlug } from '@/lib/events/repo'
import { type StellarEvent } from '@/lib/sanity'
import { sendEmail, outstandingItemsReminderEmail } from '@/lib/email'
import { supabaseServer } from '@/lib/supabase'
import { ensurePayToken, payPageUrl } from '@/lib/registration-checkout'
import { enforcedTenantFilter, refuseOutsideStellr, refuseUnlessStellrEvent } from '@/lib/tenancy/load-scoped'

// POST /api/admin/events/[slug]/remind — one-click reminder emails for the
// participants matching the roster filters (admins + assigned event managers).
//   body: { payment: boolean, docusign: boolean }  (at least one true)
// Filter semantics mirror the roster UI: when both flags are set only
// participants failing BOTH checks are emailed, and the email covers both.
// Recipients: the participant; CC the emergency contact for minors and the
// teacher / student manager for group registrations.
//
// Stellr's sender and its pay pages: B14 opens this to a tenant.

const ROUTE = '/api/admin/events/[slug]/remind'

type Ctx = { params: Promise<{ slug: string }> }

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'event.reminder.send', ...auditSubject(req, 'registrations') }),
  sendReminders,
)

async function sendReminders(req: Request, { params }: Ctx) {
  const { slug } = await params
  const staff = await requireEventRoute(slug, { route: ROUTE })
  if (!staff.ok) return staff.response
  noteAuditSubject(req, { userId: staff.userId, tenantId: staff.tenantId, eventSlug: slug })
  const refused = refuseOutsideStellr(staff.scope)
  if (refused) return refused
  const foreign = await refuseUnlessStellrEvent(supabaseServer(), slug, ROUTE)
  if (foreign) return foreign

  const body = await req.json().catch(() => null)
  const payment = body?.payment === true
  const docusign = body?.docusign === true
  if (!payment && !docusign) {
    return NextResponse.json({ error: 'Select the Payment: Outstanding or DocuSign: Outstanding filter first' }, { status: 400 })
  }

  const event = (await getEventBySlug(slug)) as StellarEvent | null
  if (!event) return NextResponse.json({ error: 'Unknown event' }, { status: 404 })

  const roster = await getEventRoster(slug, event.date, { tenant: enforcedTenantFilter(staff.scope, 'registrations') })

  const db = supabaseServer()
  let sent = 0
  let failed = 0
  for (const group of roster.groups) {
    // Card registrations get the durable pay page in the reminder. Before this
    // the copy pointed at "the link previously emailed", which for individual
    // registrations had never existed.
    let payUrl: string | undefined
    if (payment && group.payLinkSendable) {
      payUrl = payPageUrl(slug, await ensurePayToken(db, group.registrationId))
    }
    for (const p of group.participants) {
      if (payment && p.paid) continue
      if (docusign && p.docusign !== 'outstanding') continue
      if (!p.email) continue

      const content = outstandingItemsReminderEmail({
        firstName: p.first_name,
        eventTitle: event.title,
        payment: payment ? { method: p.payment_pill.startsWith('invoice') ? 'invoice' : 'link', payUrl } : undefined,
        docusign: docusign ? { minor: p.minor, guardianName: p.emergency_contact_name } : undefined,
      })

      const cc = new Set<string>()
      if (p.minor && p.emergency_contact_email) cc.add(p.emergency_contact_email.toLowerCase())
      if (group.type === 'group' && group.teacherEmail) cc.add(group.teacherEmail.toLowerCase())
      cc.delete(p.email.toLowerCase())

      try {
        await sendEmail({ to: p.email, cc: [...cc], ...content })
        sent++
      } catch (err) {
        console.error(`[remind] Failed to email ${p.email} for ${slug}:`, err)
        failed++
      }
    }
  }

  noteAuditSubject(req, { detail: { sent, failed } })
  return NextResponse.json({ sent, failed })
}
