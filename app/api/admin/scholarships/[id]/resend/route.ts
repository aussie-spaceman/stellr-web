import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireScholarshipAdmin } from '@/lib/scholarship-admin'
import { sendScholarshipOfferEmails } from '@/lib/scholarship-offer'

// POST /api/admin/scholarships/[id]/resend — sends the offer emails again,
// worded for where the student has got to (e.g. no "complete your details"
// once their details are in, and nothing at all to pay once paid).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const reviewer = await requireScholarshipAdmin()
  if (!reviewer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const to = await sendScholarshipOfferEmails(supabaseServer(), id)
  if (to.length === 0) return NextResponse.json({ error: 'Only an offered scholarship has emails to send' }, { status: 409 })
  return NextResponse.json({ ok: true, emailedTo: to })
}
