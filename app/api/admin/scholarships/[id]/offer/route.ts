import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { requireScholarshipAdmin } from '@/lib/scholarship-admin'
import { offerScholarship } from '@/lib/scholarship-offer'
import { isScholarshipPercent } from '@/lib/scholarships'

// POST /api/admin/scholarships/[id]/offer — "Offer & register": records the
// level, links the student, attaches any registration they already have, and
// (by default) sends the three offer emails. A student who had already paid is
// reimbursed the difference (lib/scholarship-refund.ts).
const schema = z.object({
  percent: z.number().refine(isScholarshipPercent, 'Choose a scholarship level'),
  eventSlug: z.string().min(1, 'Choose an event'),
  memberId: z.string().uuid().nullable().optional(),
  sendEmails: z.boolean().default(true),
  /** Already paid: card refund (default) or account credit. */
  refundMethod: z.enum(['cash', 'credit']).default('cash'),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const reviewer = await requireScholarshipAdmin()
  if (!reviewer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }
  const { id } = await params
  const { percent, eventSlug, memberId, sendEmails, refundMethod } = parsed.data
  if (!isScholarshipPercent(percent)) return NextResponse.json({ error: 'Choose a scholarship level' }, { status: 400 })

  const result = await offerScholarship(supabaseServer(), {
    applicationId: id,
    percent,
    eventSlug,
    memberId: memberId ?? null,
    reviewer,
    sendEmails,
    refundMethod,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({
    ok: true,
    registrationId: result.registrationId,
    emailedTo: result.emailedTo,
    refund: result.refund,
  })
}
