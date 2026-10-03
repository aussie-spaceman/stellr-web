import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { assertNotImpersonating } from '@/lib/impersonation'
import { submittedResponseFor } from '@/lib/survey/member'
import { withdrawQuote } from '@/lib/survey/withdraw'

// POST /api/members/surveys/responses/[id]/withdraw-quote — the member
// withdraws permission to quote one of their own responses (V2.3 §2).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await assertNotImpersonating()
  if (blocked) return blocked
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const db = supabaseServer()
  if (!(await submittedResponseFor(db, member.id, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await withdrawQuote(db, id, member.id, 'member')
  return NextResponse.json({ ok: true })
}
