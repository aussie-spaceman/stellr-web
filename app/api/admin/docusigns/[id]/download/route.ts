import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentTenantId, requireTenantCrew } from '@/lib/authz'
import {
  STORED_RECORD_COLUMNS,
  loadSignedRecord,
  logRecordAccess,
  type StoredRecordRow,
} from '@/lib/esign/archive'
import { signedRecordResponse } from '@/lib/esign/download-response'
import { withAudit } from '@/lib/audit/route'
import { loadRecord } from '@/lib/tenancy/load-scoped'
import { tenantWideScope } from '@/lib/tenancy/scope-context'

const ROUTE = '/api/admin/docusigns/[id]/download'

// What this request acted on, which withAudit's spec cannot read for itself.
const audited = new WeakMap<Request, { id: string; userId: string | null; tenantId: string; artifact: string }>()

export const GET = withAudit(
  ({ args: [req] }: { args: [NextRequest, { params: Promise<{ id: string }> }] }) => {
    const a = audited.get(req)
    return {
      action: 'agreement.record.download',
      actor: a ? { userId: a.userId } : { session: true },
      tenant: { tenantId: a?.tenantId ?? null },
      target: { table: 'agreements', id: a?.id ?? null },
      metadata: { artifact: a?.artifact ?? null },
    }
  },
  download,
)

// GET /api/admin/docusigns/[id]/download[?artifact=certificate]
// The signed agreement, or the signing engine's certificate for it. Every
// download is recorded in esign_access_log against the admin who made it.
async function download(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireTenantCrew(currentTenantId(), ['tenant_admin'], { route: ROUTE })
  if (!admin.ok) return NextResponse.json({ error: 'Unauthorised' }, { status: 403 })
  const { userId } = await auth()

  const { id } = await params
  const artifact = new URL(req.url).searchParams.get('artifact') === 'certificate' ? 'certificate' : 'pdf'
  audited.set(req, { id, userId, tenantId: admin.tenantId, artifact })
  const db = supabaseServer()

  const scope = tenantWideScope(admin.tenantId, 'tenant_admin')
  const loaded = await loadRecord<StoredRecordRow>(scope, 'agreements', id, {
    db,
    select: STORED_RECORD_COLUMNS,
    notFound: () => NextResponse.json({ error: 'Not found' }, { status: 404 }),
    label: ROUTE,
  })
  if (!loaded.ok) return loaded.response
  const row = loaded.row
  if (row.status !== 'completed') {
    return NextResponse.json({ error: 'Document not yet signed' }, { status: 400 })
  }

  // Coverage rows carry a synthetic envelope_id; the signed PDF lives on the
  // original envelope they point at. The pointer is data, so the original has to be in the
  // caller's scope in its own right.
  let original = row
  if (row.reused_from) {
    const found = await loadRecord<StoredRecordRow>(scope, 'agreements', row.reused_from, {
      db,
      select: STORED_RECORD_COLUMNS,
      notFound: () => NextResponse.json({ error: 'Original agreement not found' }, { status: 404 }),
      label: ROUTE,
    })
    if (!found.ok) return found.response
    original = found.row
  }

  const record = await loadSignedRecord(db, original, artifact)
  if (record.kind !== 'unavailable') {
    await logRecordAccess(db, {
      envelopeRow: original.id,
      action: artifact === 'certificate' ? 'certificate' : 'download',
      actorType: 'admin',
      actorId: userId,
      detail: {
        requestedRow: id,
        // A restricted record is kept for legal claims only; an admin may still
        // open it, and that is exactly what the log is for.
        restricted: Boolean(original.restricted_at),
      },
    })
  }
  return signedRecordResponse(record)
}
