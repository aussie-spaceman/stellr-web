import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { actorFromAuth } from '@/lib/activity-log'
import { assertNotImpersonating } from '@/lib/impersonation'
import { loadComplianceForMember } from '@/lib/compliance'
import { withAudit } from '@/lib/audit/route'
import { deleteExternalCheck, externalCheckSchema, saveExternalCheck } from '@/lib/external-background-check'

// The member's own background check from another organisation. The member id
// comes from the session, never the request, so the audit target is the table.
const submitAudit = {
  action: 'compliance.external_check.submit' as const,
  actor: { session: true } as const,
  tenant: { stellr: true } as const,
  target: { table: 'member_external_background_checks' },
  metadata: { via: 'member' },
}
const removeAudit = {
  action: 'compliance.external_check.remove' as const,
  actor: { session: true } as const,
  tenant: { stellr: true } as const,
  target: { table: 'member_external_background_checks' },
  metadata: { via: 'member' },
}

// POST /api/members/compliance/external-check — the member submits a background
// check they already hold from another organisation. The document was uploaded
// first (purpose 'external-bc-document'); this saves the details with it in one
// request, so there is never a check without its document. Re-submitting
// replaces the check and resets verification.
export const POST = withAudit(submitAudit, async (req: Request) => {
  // Read-only while an admin is viewing as this member.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = externalCheckSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }

  const db = supabaseServer()
  const result = await saveExternalCheck(db, {
    memberId: member.id,
    input: parsed.data,
    purpose: 'external-bc-document',
    submittedBy: 'member',
    actor: await actorFromAuth(),
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  const summary = await loadComplianceForMember(db, member.id)
  return NextResponse.json({ ok: true, state: summary?.state ?? 'awaiting_verification', validUntil: result.validUntil })
})

// DELETE — the member withdraws the check and its document at any time.
export const DELETE = withAudit(removeAudit, async () => {
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const result = await deleteExternalCheck(supabaseServer(), { memberId: member.id, actor: await actorFromAuth(), byAdmin: false })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true })
})
