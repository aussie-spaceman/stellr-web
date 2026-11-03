import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { getSignedInMember } from '@/lib/community'
import { revokeCredential, holderIsMinor, CREDENTIAL_COLUMNS, type CredentialRow } from '@/lib/credentials'
import { logActivity } from '@/lib/activity-log'
import { sendEmail, credentialRevokedEmail } from '@/lib/email'
import { recipientForCredential } from '@/lib/credentials-notify'

// POST /api/admin/credentials/[id]/revoke  { reason }
// Admins revoke anything; event managers only credentials of their events.
// The page keeps answering at its URL — as "Revoked" — which is the point.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()
  const { data } = await db.from('credentials').select(CREDENTIAL_COLUMNS).eq('id', id).maybeSingle()
  const cred = data as CredentialRow | null
  if (!cred) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const access = await requireEventAccess(cred.event_slug ?? undefined)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  // Course credentials have no event to be assigned to: platform admins only.
  if (!cred.event_slug && !access.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as { reason?: string }
  const reason = (body.reason ?? '').trim()
  if (!reason) return NextResponse.json({ error: 'A reason is required' }, { status: 400 })

  // The acting admin, never the member they may be viewing as: getCurrentMember()
  // resolves to the viewed member while a view-as ticket is live, which would
  // record the member (often a minor) as the person who revoked (S0, Nov 2026).
  const actor = await getSignedInMember()
  const row = await revokeCredential(db, id, reason, actor?.id ?? null)
  if (!row) return NextResponse.json({ error: 'Already revoked' }, { status: 409 })

  if (row.member_id) {
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
