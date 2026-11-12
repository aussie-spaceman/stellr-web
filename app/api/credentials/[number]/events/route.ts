import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { rateLimit } from '@/lib/rate-limit-async'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { recordOnHost, recordTenant } from '@/lib/tenancy/host-record'
import { withAudit } from '@/lib/audit/route'
import { auditSubject, noteAuditSubject } from '@/lib/audit/route-subject'
import { getCredentialByNumber, recordCredentialEvent, type CredentialEventKind } from '@/lib/credentials'

// POST /api/credentials/[number]/events  { kind }
// Share-click telemetry from the owner's action bar. Unauthenticated on
// purpose (the click has already happened; a sign-in check would just lose
// it), so the kinds are a short allow-list and the route is rate-limited.
//
// Another host's credential answers as a number nobody holds (S5 A10a), and the
// write is audited on the credential's tenant's chain once it is known.
const CLIENT_KINDS: CredentialEventKind[] = ['linkedin_add', 'linkedin_share', 'copy_link']

export const POST = withAudit(
  ({ args: [req] }) => ({ action: 'credential.event.create', ...auditSubject(req, 'credentials') }),
  async (req: Request, { params }: { params: Promise<{ number: string }> }) => {
    const limited = await rateLimit(req, 'credential-events', { limit: 30, windowMs: 60_000, tenantId: (await requestTenant()).tenantId })
    if (limited) return limited

    const body = (await req.json().catch(() => ({}))) as { kind?: string }
    const kind = CLIENT_KINDS.find((k) => k === body.kind)
    if (!kind) return NextResponse.json({ error: 'Unknown kind' }, { status: 400 })

    const { number } = await params
    const db = supabaseServer()
    const cred = await getCredentialByNumber(db, number)
    // One guard per line: the IDOR canary (scripts/idor-canary.mjs) deletes the host check alone.
    if (!cred) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!(await recordOnHost(cred))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    noteAuditSubject(req, { userId: null, tenantId: recordTenant(cred.tenant_id), id: cred.id, detail: { kind } })

    await recordCredentialEvent(db, cred.id, kind)
    return NextResponse.json({ ok: true })
  },
)
