import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { assertNotImpersonating } from '@/lib/impersonation'
import { getCredentialByNumber, shareConsentFor, setVisibility } from '@/lib/credentials'
import { recordOnHost, recordTenant } from '@/lib/tenancy/host-record'
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

// POST /api/credentials/[number]/visibility  { visibility: 'public' | 'private' }
// Owner-only. Making it public is gated by canShare() inside setVisibility —
// age/consent is resolved here, never trusted from the client.
//
// Another host's credential answers as one the caller does not hold, before the owner
// check (S5 A10a). The change is audited as the signed-in user, on the credential's
// tenant's chain.
export const POST = withAudit(
  ({ args: [req] }) => ({ action: 'credential.visibility.set', ...auditSubject(req, 'credentials'), actor: { session: true } }),
  setCredentialVisibility,
)

async function setCredentialVisibility(req: Request, { params }: { params: Promise<{ number: string }> }) {
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { visibility?: string }
  const visibility = body.visibility === 'public' ? 'public' : body.visibility === 'private' ? 'private' : null
  if (!visibility) return NextResponse.json({ error: 'visibility must be public or private' }, { status: 400 })

  const { number } = await params
  const db = supabaseServer()
  const cred = await getCredentialByNumber(db, number)
  if (!cred || !(await recordOnHost(cred)) || cred.owner_member_id !== member.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  noteAuditSubject(req, { tenantId: recordTenant(cred.tenant_id), id: cred.id, detail: { visibility } })

  const consent = await shareConsentFor(db, cred)
  const result = await setVisibility(db, cred, visibility, consent)
  if (!result.ok) {
    return NextResponse.json({ error: `This credential cannot be made public (${result.reason.replace(/_/g, ' ')}).` }, { status: 403 })
  }
  return NextResponse.json({ ok: true, visibility: result.row.visibility })
}
