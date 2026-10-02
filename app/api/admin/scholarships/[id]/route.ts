import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { requireScholarshipAdmin } from '@/lib/scholarship-admin'

// PATCH /api/admin/scholarships/[id] — reviewer notes. (Event, member and
// level are set by the offer itself.)
const schema = z.object({ adminNotes: z.string().max(5000) })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const reviewer = await requireScholarshipAdmin()
  if (!reviewer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { id } = await params
  const { error } = await supabaseServer()
    .from('scholarship_applications')
    .update({ admin_notes: parsed.data.adminNotes.trim() || null })
    .eq('id', id)
  if (error) return NextResponse.json({ error: 'Could not save notes' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
