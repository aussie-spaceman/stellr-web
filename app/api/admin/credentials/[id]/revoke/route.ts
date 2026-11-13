import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventCrew } from '@/lib/authz'
import { getSignedInMember } from '@/lib/community'
import { revokeCredential, holderIsMinor, CREDENTIAL_COLUMNS, type CredentialRow } from '@/lib/credentials'
import { logActivity } from '@/lib/activity-log'
import { sendEmail, credentialRevokedEmail } from '@/lib/email'
import { recipientForCredential } from '@/lib/credentials-notify'
import { withAudit } from '@/lib/audit/route'
import { loadEventRecord } from '@/lib/tenancy/load-scoped'
import { isStellrScope } from '@/lib/tenancy/scope-context'

const ROUTE = '/api/admin/credentials/[id]/revoke'

// What this request acted on, which withAudit's spec cannot read for itself. The reason is
// free text and can name the holder, so it stays out of the event: credentials holds it.
const audited = new WeakMap<Request, { id: string; userId: string; tenantId: string }>()

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, { params: Promise<{ id: string }> }] }) => {
    const a = audited.get(req)
    return {
      action: 'credential.record.revoke',
      actor: a ? { userId: a.userId } : { session: true },
      tenant: { tenantId: a?.tenantId ?? null },
      target: { table: 'credentials', id: a?.id ?? null },
    }
  },
  revoke,
)

// POST /api/admin/credentials/[id]/revoke  { reason }
// Admins revoke anything; event managers only credentials of their events.
// The page keeps answering at its URL — as "Revoked" — which is the point.
async function revoke(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const crew = await requireEventCrew({ route: ROUTE })
  if (!crew.ok) return NextResponse.json({ error: 'Forbidden' }, { status: crew.status })

  const { id } = await params
  audited.set(req, { id, userId: crew.userId, tenantId: crew.tenantId })
  const db = supabaseServer()
  // Course credentials have no event to be assigned to: admins only.
  const loaded = await loadEventRecord<CredentialRow>(crew, 'credentials', id, {
    db,
    select: CREDENTIAL_COLUMNS,
    notFound: () => NextResponse.json({ error: 'Not found' }, { status: 404 }),
    label: ROUTE,
  })
  if (!loaded.ok) return loaded.response

  const body = (await req.json().catch(() => ({}))) as { reason?: string }
  const reason = (body.reason ?? '').trim()
  if (!reason) return NextResponse.json({ error: 'A reason is required' }, { status: 400 })

  // The acting admin, never the member they may be viewing as: getCurrentMember()
  // resolves to the viewed member while a view-as ticket is live, which would
  // record the member (often a minor) as the person who revoked (S0, Nov 2026).
  const actor = await getSignedInMember()
  const row = await revokeCredential(db, id, reason, actor?.id ?? null)
  if (!row) return NextResponse.json({ error: 'Already revoked' }, { status: 409 })

  // The member's activity log is global, and a tenant's records stay off it (owner decision B8).
  if (row.member_id && isStellrScope(crew.scope)) {
    await logActivity({
      memberId: row.member_id,
      category: 'account',
      actorType: 'admin',
      actorMemberId: actor?.id ?? null,
      action: 'credential_revoked',
      summary: `Credential revoked: ${row.title} (${row.number}) — ${reason}`,
      metadata: { credentialId: row.id, reason },
    })
  }

  // Tell the holder (guardian for a Minor, per the policy). Non-fatal.
  try {
    const to = await recipientForCredential(db, row)
    const toGuardian = (await holderIsMinor(db, row)) && !!to?.guardianEmail && !!to?.guardianFirstName
    const address = toGuardian ? to?.guardianEmail : to?.email
    if (to && address) {
      const mail = credentialRevokedEmail({
        recipientFirstName: to.firstName,
        guardianFirstName: toGuardian ? to.guardianFirstName : null,
        title: row.title,
        number: row.number,
        reason,
      })
      await sendEmail({ to: address, cc: toGuardian && to.email ? [to.email] : undefined, ...mail })
    }
  } catch (err) {
    console.error('[credentials] revoke email failed:', err)
  }

  return NextResponse.json({ ok: true, credential: row })
}
