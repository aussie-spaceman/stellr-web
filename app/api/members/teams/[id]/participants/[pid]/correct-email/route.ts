import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { assertNotImpersonating } from '@/lib/impersonation'
import { organiserCorrect, organiserView } from '@/lib/esign/email-changes'
import { withAudit } from '@/lib/audit/route'

// GET  /api/members/teams/[id]/participants/[pid]/correct-email
//      The participant's bounced signers and any student suggestion waiting.
// POST /api/members/teams/[id]/participants/[pid]/correct-email
//      body { recipientId, email }: a group organiser (registrant teacher or
//      student manager, or the nominated teacher) fixes a bounced address.
// Rules: lib/esign/email-changes.ts.

async function sessionMember() {
  const { userId } = await auth()
  if (!userId) return null
  const { data } = await supabaseServer()
    .from('members')
    .select('id, email')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()
  return (data as { id: string; email: string | null } | null) ?? null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; pid: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const member = await sessionMember()
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  const { id, pid } = await params
  const view = await organiserView(supabaseServer(), member, id, pid)
  if (!view.ok) return NextResponse.json({ error: view.error, code: view.code }, { status: view.status })
  return NextResponse.json({ bounced: view.bounced, pending: view.pending })
}

// withAudit records every answer but a 4xx. Group registrations are Stellr's
// (as in the payment-method route); the correction itself is also a row in
// agreement_email_changes.
const auditSpec = ({ args: [req] }: { args: [Request, unknown] }) => ({
  action: 'agreement.recipient.fix' as const,
  actor: { session: true } as const,
  tenant: { stellr: true } as const,
  target: { table: 'participants', id: new URL(req.url).pathname.split('/').at(-2) ?? null },
})

export const POST = withAudit(auditSpec, correct)

async function correct(req: NextRequest, { params }: { params: Promise<{ id: string; pid: string }> }) {
  // Read-only while an admin is viewing as this member (lib/impersonation).
  const blocked = await assertNotImpersonating()
  if (blocked) return blocked
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const member = await sessionMember()
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  const { id, pid } = await params
  const body = await req.json().catch(() => null)
  const recipientId = typeof body?.recipientId === 'string' ? body.recipientId : null
  if (!recipientId) return NextResponse.json({ error: 'recipientId and email are required' }, { status: 400 })
  const result = await organiserCorrect(supabaseServer(), { member, registrationId: id, participantId: pid, recipientId, email: body?.email })
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
  return NextResponse.json({ ok: true, email: result.email })
}
