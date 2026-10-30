import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { requireScholarshipAdmin } from '@/lib/scholarship-admin'
import { cancelScholarship } from '@/lib/scholarship-cancel'

// POST /api/admin/scholarships/[id]/cancel { reason? } — cancels an offered
// scholarship at any stage. No email goes to the student (owner, 30 Oct 2026).
const schema = z.object({ reason: z.string().max(1000).optional() })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const reviewer = await requireScholarshipAdmin()
  if (!reviewer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const parsed = schema.safeParse((await req.json().catch(() => null)) ?? {})
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { id } = await params
  const result = await cancelScholarship(supabaseServer(), id, { source: 'admin', reason: parsed.data.reason, reviewer })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, message: result.message, amountDueRestoredCents: result.amountDueRestoredCents })
}
