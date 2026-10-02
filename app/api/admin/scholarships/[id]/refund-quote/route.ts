import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { stripeClient } from '@/lib/stripe'
import { requireScholarshipAdmin } from '@/lib/scholarship-admin'
import { quoteScholarshipRefund } from '@/lib/scholarship-refund'
import { isScholarshipPercent } from '@/lib/scholarship-levels'

// GET /api/admin/scholarships/[id]/refund-quote?registrationId=…&percent=50
// What offering this level would reimburse a student who has already paid —
// shown in the review panel before the reviewer confirms. A read; nothing moves.
export async function GET(req: Request) {
  const reviewer = await requireScholarshipAdmin()
  if (!reviewer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const url = new URL(req.url)
  const registrationId = url.searchParams.get('registrationId')
  const percent = Number(url.searchParams.get('percent'))
  if (!registrationId || !isScholarshipPercent(percent)) {
    return NextResponse.json({ error: 'registrationId and a scholarship level are required' }, { status: 400 })
  }
  const quote = await quoteScholarshipRefund(supabaseServer(), stripeClient(), registrationId, percent)
  return NextResponse.json(quote)
}
