import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { stripeClient } from '@/lib/stripe'
import { requireScholarshipAdmin } from '@/lib/scholarship-admin'
import { issueScholarshipRefund } from '@/lib/scholarship-refund'
import { SCHOLARSHIP_COLUMNS, type ScholarshipApplication } from '@/lib/scholarships'

// POST /api/admin/scholarships/[id]/refund — retry the reimbursement for a
// student who had already paid, after a first attempt needed manual handling
// (e.g. Stripe was unreachable). Safe to repeat: a scholarship reimbursement
// already issued is not issued again, and the Stripe refund carries the same
// idempotency key as the first attempt.
const schema = z.object({ method: z.enum(['cash', 'credit']).default('cash') })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const reviewer = await requireScholarshipAdmin()
  if (!reviewer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const { id } = await params
  const db = supabaseServer()
  const { data } = await db.from('scholarship_applications').select(SCHOLARSHIP_COLUMNS).eq('id', id).maybeSingle()
  const app = data as ScholarshipApplication | null
  if (!app || app.status !== 'offered' || !app.registration_id || app.percent_off == null || !app.registration_paid_at_offer) {
    return NextResponse.json({ error: 'Only an offer on an already-paid registration has a reimbursement' }, { status: 409 })
  }
  const result = await issueScholarshipRefund(db, stripeClient(), {
    applicationId: app.id,
    registrationId: app.registration_id,
    percent: app.percent_off,
    method: parsed.data.method,
    actorMemberId: reviewer.memberId,
  })
  return NextResponse.json({ ok: result.type === 'cash' || result.type === 'credit', result })
}
