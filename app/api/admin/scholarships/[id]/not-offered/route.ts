import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireScholarshipAdmin } from '@/lib/scholarship-admin'
import { markNotOffered } from '@/lib/scholarship-offer'

// POST /api/admin/scholarships/[id]/not-offered — closes an application
// without an offer. No email goes to the applicant (owner, 2 Oct 2026).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const reviewer = await requireScholarshipAdmin()
  if (!reviewer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const result = await markNotOffered(supabaseServer(), id, reviewer)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 })
  return NextResponse.json({ ok: true })
}
