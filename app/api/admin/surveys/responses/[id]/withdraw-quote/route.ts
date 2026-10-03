import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireSurveyAdmin } from '@/lib/survey/admin-auth'
import { withdrawQuote } from '@/lib/survey/withdraw'

// POST /api/admin/surveys/responses/[id]/withdraw-quote — an admin withdraws a
// response's quote (e.g. on a parent's request). Permanent; logged.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSurveyAdmin()
  if (!gate.ok) return gate.response
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const done = await withdrawQuote(supabaseServer(), id, gate.userId, 'admin')
  return done ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found, not submitted, or already withdrawn.' }, { status: 404 })
}
