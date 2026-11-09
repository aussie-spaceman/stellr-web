import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { assertNotImpersonating } from '@/lib/impersonation'
import { organiserDecide } from '@/lib/esign/email-changes'
import { withAudit } from '@/lib/audit/route'

// POST /api/members/teams/[id]/email-changes/[changeId]  body { decision: 'approve' | 'reject' }
// A group organiser approves or rejects a student's suggested parent/guardian
// address for a form in their group (lib/esign/email-changes.ts).

const auditSpec = ({ args: [req] }: { args: [Request, unknown] }) => ({
  action: 'agreement.suggestion.decide' as const,
  actor: { session: true } as const,
  tenant: { stellr: true } as const,
  target: { table: 'agreement_email_changes', id: new URL(req.url).pathname.split('/').at(-1) ?? null },
})

export const POST = withAudit(auditSpec, decide)

async function decide(req: NextRequest, { params }: { params: Promise<{ id: string; changeId: string }> }) {
  const blocked = await assertNotImpersonating()
  if (blocked) return blocked
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const db = supabaseServer()
  const { data: member } = await db.from('members').select('id, email').eq('clerk_user_id', userId).eq('is_active', true).maybeSingle()
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  const { id, changeId } = await params
  const body = await req.json().catch(() => null)
  const result = await organiserDecide(db, {
    member: member as { id: string; email: string | null },
    registrationId: id,
    changeId,
    decision: body?.decision,
  })
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
  return NextResponse.json({ ok: true, decision: result.decision })
}
