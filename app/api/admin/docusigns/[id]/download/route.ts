import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getEnvelopeDocument } from '@/lib/docusign'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  if (role !== 'admin') return NextResponse.json({ error: 'Unauthorised' }, { status: 403 })

  const { id } = await params
  const db = supabaseServer()

  const { data: envelope } = await db
    .from('docusign_envelopes')
    .select('envelope_id, status, minor_name, reused_from')
    .eq('id', id)
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
  const filename = `consent-${(envelope.minor_name as string).replace(/\s+/g, '-').toLowerCase()}.pdf`

  return new NextResponse(docBytes, {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
