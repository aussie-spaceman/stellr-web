import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventCrew } from '@/lib/authz'
import { CREDENTIAL_TENANT_COLUMNS, credentialState, type CredentialRow } from '@/lib/credentials'
import { recipientForCredential, sendCredentialIssuedEmail } from '@/lib/credentials-notify'
import { withAudit } from '@/lib/audit/route'
import { loadEventRecord } from '@/lib/tenancy/load-scoped'

const ROUTE = '/api/admin/credentials/[id]/resend'

// What this request acted on, which withAudit's spec cannot read for itself.
const audited = new WeakMap<Request, { id: string; userId: string; tenantId: string }>()

export const POST = withAudit(
  ({ args: [req] }: { args: [Request, { params: Promise<{ id: string }> }] }) => {
    const a = audited.get(req)
    return {
      action: 'credential.email.resend',
      actor: a ? { userId: a.userId } : { session: true },
      tenant: { tenantId: a?.tenantId ?? null },
      target: { table: 'credentials', id: a?.id ?? null },
    }
  },
  resendCredential,
)

// POST /api/admin/credentials/[id]/resend — re-send the "credential issued"
// email to the holder (guardian for a minor). Same scoping as revoke.
async function resendCredential(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const crew = await requireEventCrew({ route: ROUTE })
  if (!crew.ok) return NextResponse.json({ error: 'Forbidden' }, { status: crew.status })

  const { id } = await params
  audited.set(req, { id, userId: crew.userId, tenantId: crew.tenantId })
  const db = supabaseServer()
  const loaded = await loadEventRecord<CredentialRow>(crew, 'credentials', id, {
    db,
    // With its tenant, so the email's Stellr-only check reads nothing more (S5 A10a).
    select: CREDENTIAL_TENANT_COLUMNS,
    notFound: () => NextResponse.json({ error: 'Not found' }, { status: 404 }),
    label: ROUTE,
  })
  if (!loaded.ok) return loaded.response
  const cred = loaded.row
  if (credentialState(cred) !== 'valid') return NextResponse.json({ error: 'Only a valid credential can be re-sent' }, { status: 400 })

  const to = await recipientForCredential(db, cred)
  if (!to) return NextResponse.json({ error: 'No holder on record to send to' }, { status: 400 })

  const sent = await sendCredentialIssuedEmail(db, cred, to)
  if (!sent) return NextResponse.json({ error: 'No email address on record' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
