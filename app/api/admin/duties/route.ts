import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getSignedInMember } from '@/lib/community'
import { DUTY_SCOPES } from '@/lib/admin-auth'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { syncDutyGranted, syncDutyRevoked } from '@/lib/authz/role-sync'
import { reportRoleSyncFailure, roleSyncMetadata } from '@/lib/authz/role-sync-report'
import { withAudit } from '@/lib/audit/route'

// Admin CRUD for the duties function-scope seam (migration 044).

const ROUTE = '/api/admin/duties'

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

// What this request acted on, which withAudit's spec cannot read for itself: the body has
// gone. The member id, never the email a grant may have been keyed on.
const audited = new WeakMap<Request, { memberId: string; scopes?: string[]; userId: string | null }>()

export const POST = withAudit(
  ({ args: [req] }) => {
    const a = audited.get(req)
    return {
      action: 'duty.grant',
      actor: a ? { userId: a.userId } : { session: true },
      tenant: { stellr: true },
      target: { table: 'admin_duties', id: a?.memberId ?? null },
      metadata: { scopes: a?.scopes ?? null },
    }
  },
  grantDuty,
)

// POST — grant/replace a member's function scopes.
// Body: { memberId?, email?, scopes: string[] } — member from the picker (id) or email.
async function grantDuty(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { memberId, email, scopes } = await req.json().catch(() => ({}))
  if ((!memberId && !email) || !Array.isArray(scopes) || scopes.length === 0) {
    return NextResponse.json({ error: 'a member (memberId or email) and a non-empty scopes[] required' }, { status: 400 })
  }
  const clean = [...new Set(scopes)].filter((s) => (DUTY_SCOPES as readonly string[]).includes(s))
  if (clean.length === 0) return NextResponse.json({ error: 'no valid scopes' }, { status: 400 })

  const db = supabaseServer()
  const lookup = db.from('members').select('id, first_name, last_name, email')
  const { data: member } = await (memberId
    ? lookup.eq('id', memberId)
    : lookup.ilike('email', String(email).trim())
  ).maybeSingle()
  if (!member) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
  audited.set(req, { memberId: member.id, scopes: clean, userId: (await auth()).userId })

  const admin = await getSignedInMember()
  const { error } = await db.from('admin_duties').upsert(
    { member_id: member.id, scopes: clean, granted_by: admin?.id ?? null, updated_at: new Date().toISOString() },
    { onConflict: 'member_id' },
  )
  if (error) {
    console.error('[duties] upsert error:', error)
    return NextResponse.json({ error: 'Could not save the duty' }, { status: 500 })
  }

  // S5 C9 dual-write. A failure here is reported, and never fails the grant.
  const sync = await syncDutyGranted(db, member.id)
  await reportRoleSyncFailure('duty_grant', sync, { method: 'POST', routePath: ROUTE })

  // deep review AUTH-6: staff function scopes grant admin-area access, so who
  // set them (and to what) must be recoverable. Best-effort, like the rest of
  // the audit trail — a logging failure never fails the grant.
  await logActivity({
    ...(await actorFromAuth()),
    memberId: member.id,
    category: 'account',
    action: 'duty_scopes_set',
    summary: `Duties set: ${clean.join(', ')}`,
    metadata: { scopes: clean, ...roleSyncMetadata(sync) },
  })

  return NextResponse.json({ ok: true, member })
}

export const DELETE = withAudit(
  ({ args: [req] }) => {
    const a = audited.get(req)
    return {
      action: 'duty.revoke',
      actor: a ? { userId: a.userId } : { session: true },
      tenant: { stellr: true },
      target: { table: 'admin_duties', id: a?.memberId ?? null },
    }
  },
  revokeDuty,
)

// DELETE — remove a member's staff role. Body: { memberId }
async function revokeDuty(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { memberId } = await req.json().catch(() => ({}))
  if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })
  audited.set(req, { memberId, userId: (await auth()).userId })

  const db = supabaseServer()
  const { error } = await db.from('admin_duties').delete().eq('member_id', memberId)
  if (error) {
    console.error('[duties] delete error:', error)
    return NextResponse.json({ error: 'Could not remove the duty' }, { status: 500 })
  }

  // S5 C9 dual-write. A failure here is reported, and never fails the revoke.
  const sync = await syncDutyRevoked(db, memberId)
  await reportRoleSyncFailure('duty_revoke', sync, { method: 'DELETE', routePath: ROUTE })

  // deep review AUTH-6: a revoke is as audit-worthy as a grant.
  await logActivity({
    ...(await actorFromAuth()),
    memberId,
    category: 'account',
    action: 'duty_scopes_removed',
    summary: 'Duties removed',
    ...(sync.ok ? {} : { metadata: roleSyncMetadata(sync) }),
  })

  return NextResponse.json({ ok: true })
}
