import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireEventAccess } from '@/lib/event-access'
import { supabaseServer } from '@/lib/supabase'
import { stripeClient } from '@/lib/stripe'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import {
  groupInvoiceSummary,
  invoiceTotals,
  resolveDiscountCode,
  setGroupDiscount,
  formatMoney,
} from '@/lib/group-billing'

// "Invoice & discount…" on a group in the event roster.
//   GET  → the group's places, current invoice and invoice history.
//   POST { action: 'preview', code }  → what the invoice would be with that code.
//   POST { action: 'apply', code }    → revise the open invoice with the discount.
//   POST { action: 'remove' }         → revise it without one.
// Reading is open to the event's managers; changing money is admins only.
// See lib/group-billing.ts.

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), code: z.string().trim().min(1).max(64) }),
  z.object({ action: z.literal('apply'), code: z.string().trim().min(1).max(64) }),
  z.object({ action: z.literal('remove') }),
])

type Db = ReturnType<typeof supabaseServer>

async function guard(db: Db, id: string, write: boolean) {
  const access = await requireEventAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const { data: reg } = await db.from('registrations').select('event_slug, type, teacher_member_id').eq('id', id).maybeSingle()
  if (!reg || reg.type !== 'group') return NextResponse.json({ error: 'Group registration not found' }, { status: 404 })
  if (!access.isAdmin && (write || !(access.assignedSlugs ?? []).includes(reg.event_slug as string))) {
    return NextResponse.json({ error: write ? 'Only admins can change an invoice' : 'Forbidden' }, { status: 403 })
  }
  return { slug: reg.event_slug as string, teacherMemberId: (reg.teacher_member_id as string | null) ?? null }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()
  const g = await guard(db, id, false)
  if (g instanceof NextResponse) return g
  const summary = await groupInvoiceSummary(db, stripeClient(), id)
  if (!summary) return NextResponse.json({ error: 'Group registration not found' }, { status: 404 })
  return NextResponse.json(summary)
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()
  const g = await guard(db, id, true)
  if (g instanceof NextResponse) return g

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Enter a discount code' }, { status: 400 })
  const stripe = stripeClient()
  if (!stripe) return NextResponse.json({ error: 'Stripe is not configured here' }, { status: 503 })

  const body = parsed.data
  const discount = body.action === 'remove' ? null : await resolveDiscountCode(stripe, body.code)
  if (body.action !== 'remove' && !discount) {
    return NextResponse.json({ error: `"${body.code}" isn't an active discount code or coupon in Stripe.` }, { status: 404 })
  }

  if (body.action === 'preview') {
    const summary = await groupInvoiceSummary(db, stripe, id)
    if (!summary?.perSeatCents) return NextResponse.json({ error: 'Could not work out the per-participant price.' }, { status: 409 })
    const totals = invoiceTotals(summary.seats, summary.perSeatCents, discount!.terms)
    return NextResponse.json({
      label: discount!.label,
      ...totals,
      summary: `${summary.seats} × ${formatMoney(summary.perSeatCents, summary.currency)} = ${formatMoney(totals.subtotalCents, summary.currency)}, less ${formatMoney(totals.discountCents, summary.currency)} = ${formatMoney(totals.totalCents, summary.currency)}`,
    })
  }

  const actor = await actorFromAuth()
  let result: Awaited<ReturnType<typeof setGroupDiscount>>
  try {
    result = await setGroupDiscount(db, stripe, id, discount, { memberId: actor.actorMemberId ?? null, label: 'admin' })
  } catch (e) {
    console.error('[admin/invoice] discount failed:', e)
    return NextResponse.json({ error: `Stripe refused the change: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 })

  if (g.teacherMemberId) {
    await logActivity({
      memberId: g.teacherMemberId,
      category: 'billing',
      action: discount ? 'group_invoice_discount_applied' : 'group_invoice_discount_removed',
      summary: discount ? `Discount ${discount.label} applied to the group invoice for ${g.slug}` : `Discount removed from the group invoice for ${g.slug}`,
      metadata: { registrationId: id, eventSlug: g.slug, invoiceId: result.invoiceId, couponId: discount?.couponId ?? null },
      ...actor,
    }, db)
  }
  return NextResponse.json({ message: result.message, invoiceId: result.invoiceId })
}
