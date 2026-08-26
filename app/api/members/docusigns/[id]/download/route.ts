import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getEnvelopeDocument } from '@/lib/docusign'
import { impersonatedMemberId } from '@/lib/impersonation'

// GET /api/members/docusigns/[id]/download — stream executed PDF to the member
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const db = supabaseServer()

  // Honours an admin view-as session (read only).
  const viewAsId = await impersonatedMemberId()
  const { data: member } = viewAsId
    ? await db.from('members').select('id').eq('id', viewAsId).maybeSingle()
    : await db
        .from('members')
        .select('id')
        .eq('clerk_user_id', userId)
        .eq('is_active', true)
        .maybeSingle()

  if (!member) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: envelope } = await db
    .from('docusign_envelopes')
    .select('envelope_id, status, reused_from')
    .eq('id', id)
    .eq('member_id', member.id)
    .maybeSingle()

  if (!envelope) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (envelope.status !== 'completed') {
    return NextResponse.json({ error: 'Document not yet signed' }, { status: 400 })
  }

  // Coverage rows carry a synthetic envelope_id; the signed PDF lives on the
  // original envelope they point at.
  let docusignId = envelope.envelope_id
  if (envelope.reused_from) {
    const { data: root } = await db
      .from('docusign_envelopes')
      .select('envelope_id')
      .eq('id', envelope.reused_from)
      .maybeSingle()
    if (!root) return NextResponse.json({ error: 'Original agreement not found' }, { status: 404 })
    docusignId = root.envelope_id
  }

  const docBytes = await getEnvelopeDocument(docusignId)

  return new NextResponse(docBytes, {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': 'attachment; filename="consent-form.pdf"',
    },
  })
}
