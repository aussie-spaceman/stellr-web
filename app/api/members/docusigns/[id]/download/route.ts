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

// GET /api/members/docusigns/[id]/download — the member's own signed agreement.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
