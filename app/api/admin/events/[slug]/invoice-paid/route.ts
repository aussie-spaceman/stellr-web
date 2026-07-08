import { NextResponse } from 'next/server'
import { requireEventAccess } from '@/lib/event-access'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth, logActivity } from '@/lib/activity-log'

// POST /api/admin/events/[slug]/invoice-paid — mark a group registration's
// invoice settled (or clear it). Invoiced registrations have no automatic paid
// signal (they're paid offline), so an admin records it here; the member billing
// pills and the roster then read as paid and a receipt becomes available.
//   body: { registrationId: string, paid: boolean }
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const body = await req.json().catch(() => null)
  const registrationId = typeof body?.registrationId === 'string' ? body.registrationId : null
  const paid = body?.paid === true
  if (!registrationId) return NextResponse.json({ error: 'registrationId required' }, { status: 400 })

  const db = supabaseServer()
  const { data: reg } = await db
    .from('registrations')
    .select('id, event_slug, invoice_requested, teacher_member_id')
    .eq('id', registrationId)
    .maybeSingle()
  if (!reg || reg.event_slug !== slug) {
    return NextResponse.json({ error: 'Registration not found for this event' }, { status: 404 })
  }
  if (!reg.invoice_requested) {
    return NextResponse.json({ error: 'This registration is not paid by invoice' }, { status: 400 })
  }

  const actor = await actorFromAuth()
  const { error } = await db
    .from('registrations')
    .update({
      invoice_paid_at: paid ? new Date().toISOString() : null,
      invoice_paid_by: paid ? (actor.actorMemberId ?? null) : null,
    })
    .eq('id', registrationId)
  if (error) {
    console.error('[admin/invoice-paid] update error:', error)
    return NextResponse.json({ error: 'Failed to update invoice status' }, { status: 500 })
  }

  const subjectMemberId = (reg.teacher_member_id as string | null) ?? actor.actorMemberId ?? null
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
