import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { assertNotImpersonating } from '@/lib/impersonation'
import { submittedResponseFor } from '@/lib/survey/member'
import { withdrawQuote } from '@/lib/survey/withdraw'
import { auditMutation } from '@/lib/audit/route'
import { noteAudit, selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

// POST /api/members/surveys/responses/[id]/withdraw-quote — the member
// withdraws permission to quote one of their own responses (V2.3 §2).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return audited(req, { action: 'member.survey_quote.withdraw', table: 'survey_responses' }, () => withdrawQuotePermission(req, ctx))
}

async function withdrawQuotePermission(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await assertNotImpersonating()
  if (blocked) return blocked
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const db = supabaseServer()
  if (!(await submittedResponseFor(db, member.id, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  noteAudit(req, { targetId: id })
  await withdrawQuote(db, id, member.id, 'member', { actorType: 'member', actorMemberId: member.id })
  return NextResponse.json({ ok: true })
}

// The audit event for this route (docs/TENANCY-S5.md, B16): written after the response,
// never for a 4xx, ids and short codes only. lib/community/self-service-audit decides
// what is written; the call stays here because the coverage gate reads it here.
async function audited(req: Request, spec: SelfServiceAudit, run: () => Promise<Response>): Promise<Response> {
  let res: Response | undefined
  try {
    return (res = await run())
  } finally {
    await record(req, res, spec)
  }
}

async function record(req: Request, res: Response | undefined, spec: SelfServiceAudit) {
  const event = await selfServiceEvent(req, res, spec)
  if (!event) return
  await auditMutation(event, { afterResponse: true })
}
