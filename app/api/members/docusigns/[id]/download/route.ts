import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { assertNotImpersonating } from '@/lib/impersonation'
import {
  STORED_RECORD_COLUMNS,
  loadSignedRecord,
  logRecordAccess,
  resolveOriginal,
  type StoredRecordRow,
} from '@/lib/esign/archive'
import { signedRecordResponse } from '@/lib/esign/download-response'
import { auditMutation } from '@/lib/audit/route'
import { noteAudit, selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

// GET /api/members/docusigns/[id]/download — the member's own signed agreement.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return audited(req, { action: 'member.agreement.download', table: 'agreements' }, () => downloadAgreement(req, ctx))
}

async function downloadAgreement(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // An admin viewing as a member sees the member's status but cannot pull
  // their signed documents through this lens: that would be an unlogged copy
  // of a minor's consent form. Admins download from the admin consent-forms
  // page, where every download is recorded against them.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const db = supabaseServer()

  const { data: member } = await db
    .from('members')
    .select('id')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()
  if (!member) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: row } = await db
    .from('agreements')
    .select(STORED_RECORD_COLUMNS)
    .eq('id', id)
    .eq('member_id', member.id)
    .maybeSingle()

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  noteAudit(req, { targetId: id })
  if ((row as StoredRecordRow).status !== 'completed') {
    return NextResponse.json({ error: 'Document not yet signed' }, { status: 400 })
  }

  // Coverage rows carry a synthetic envelope_id; the signed PDF lives on the
  // original envelope they point at.
  const original = await resolveOriginal(db, row as StoredRecordRow)
  // A restricted record is kept only for legal claims (see migration
  // 20261002173459); it is not served, and to the member it does not exist.
  if (!original || original.restricted_at) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const record = await loadSignedRecord(db, original, 'pdf')
  if (record.kind !== 'unavailable') {
    await logRecordAccess(db, {
      envelopeRow: original.id,
      action: 'download',
      actorType: 'member',
      actorId: member.id as string,
      detail: { requestedRow: id },
    })
  }
  return signedRecordResponse(record)
}

// The audit event for this route (docs/TENANCY-S5.md, B16): written after the response,
// never for a 4xx, ids and short codes only. lib/community/self-service-audit decides
// what is written; the call stays here because the coverage gate reads it here.
async function audited(req: Request, spec: SelfServiceAudit, run: () => Promise<Response>): Promise<Response> {
  let res: Response | undefined
  try {
    return (res = await run())
  } finally {
    await record(req, res, spec)
  }
}

async function record(req: Request, res: Response | undefined, spec: SelfServiceAudit) {
  const event = await selfServiceEvent(req, res, spec)
  if (!event) return
  await auditMutation(event, { afterResponse: true })
}
