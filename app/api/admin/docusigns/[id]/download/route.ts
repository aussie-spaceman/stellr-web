import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import {
  STORED_RECORD_COLUMNS,
  loadSignedRecord,
  logRecordAccess,
  resolveOriginal,
  type StoredRecordRow,
} from '@/lib/esign/archive'
import { signedRecordResponse } from '@/lib/esign/download-response'

// GET /api/admin/docusigns/[id]/download[?artifact=certificate]
// The signed agreement, or the signing engine's certificate for it. Every
// download is recorded in esign_access_log against the admin who made it.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId, sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  if (role !== 'admin') return NextResponse.json({ error: 'Unauthorised' }, { status: 403 })

  const { id } = await params
  const artifact = new URL(req.url).searchParams.get('artifact') === 'certificate' ? 'certificate' : 'pdf'
  const db = supabaseServer()

  const { data: row } = await db
    .from('agreements')
    .select(STORED_RECORD_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if ((row as StoredRecordRow).status !== 'completed') {
    return NextResponse.json({ error: 'Document not yet signed' }, { status: 400 })
  }

  // Coverage rows carry a synthetic envelope_id; the signed PDF lives on the
  // original envelope they point at.
  const original = await resolveOriginal(db, row as StoredRecordRow)
  if (!original) return NextResponse.json({ error: 'Original agreement not found' }, { status: 404 })

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
