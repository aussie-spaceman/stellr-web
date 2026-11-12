import { NextResponse } from 'next/server'
import { requireEventRoute } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { withAudit } from '@/lib/audit/route'
import { loadEventRecord, refuseOutsideStellr, refuseUnlessStellrEvent, scopedRowWrite } from '@/lib/tenancy/load-scoped'

// POST /api/admin/events/[slug]/invoice-paid — mark a group registration's
// invoice settled (or clear it). Invoiced registrations have no automatic paid
// signal (they're paid offline), so an admin records it here; the member billing
// pills and the roster then read as paid and a receipt becomes available.
//   body: { registrationId: string, paid: boolean }
//
// A tenant has no invoices until S9, and C20 takes group invoices. Until then the
// invoice is on Stellr's Stripe account, so a tenant's event is refused for everyone,
// a Stellr admin included (refuseUnlessStellrEvent).

const ROUTE = '/api/admin/events/[slug]/invoice-paid'

type Ctx = { params: Promise<{ slug: string }> }

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'registration.invoice_paid.set', ...auditSubject(req, 'registrations') }),
  setInvoicePaid,
)

async function setInvoicePaid(req: Request, { params }: Ctx) {
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
  const paid = body?.paid === true
  if (!registrationId) return NextResponse.json({ error: 'registrationId required' }, { status: 400 })
  noteAuditSubject(req, { id: registrationId, detail: { paid } })

  const db = supabaseServer()
  const loaded = await loadEventRecord<{ id: string; event_slug: string; invoice_requested: boolean | null; teacher_member_id: string | null }>(
    staff,
    'registrations',
    registrationId,
    {
      db,
      select: 'id, event_slug, invoice_requested, teacher_member_id',
      notFound: () => NextResponse.json({ error: 'Registration not found for this event' }, { status: 404 }),
      label: ROUTE,
    },
  )
  if (!loaded.ok) return loaded.response
  const reg = loaded.row
  if (!reg.invoice_requested) {
    return NextResponse.json({ error: 'This registration is not paid by invoice' }, { status: 400 })
  }

  const actor = await actorFromAuth()
  const { error } = await scopedRowWrite(staff.scope, 'registrations', registrationId, { db }).update({
    invoice_paid_at: paid ? new Date().toISOString() : null,
    invoice_paid_by: paid ? (actor.actorMemberId ?? null) : null,
  })
  if (error) {
    console.error('[admin/invoice-paid] update error:', error)
    return NextResponse.json({ error: 'Failed to update invoice status' }, { status: 500 })
  }

  const subjectMemberId = reg.teacher_member_id ?? actor.actorMemberId ?? null
  if (subjectMemberId) {
    await logActivity(
      {
        memberId: subjectMemberId,
        category: 'billing',
        action: paid ? 'invoice_marked_paid' : 'invoice_marked_unpaid',
        summary: `Group invoice ${paid ? 'marked paid' : 'marked unpaid'} for ${slug}`,
        metadata: { registrationId, eventSlug: slug },
        ...actor,
      },
      db,
    )
  }

  return NextResponse.json({ ok: true, invoicePaidAt: paid ? new Date().toISOString() : null })
}
