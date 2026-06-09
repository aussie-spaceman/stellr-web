import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getEnvelopeDocument } from '@/lib/docusign'

// GET /api/members/docusigns/[id]/download — stream executed PDF to the member
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { data: envelope } = await db
    .from('docusign_envelopes')
    .select('envelope_id, status')
    .eq('id', id)
    .eq('member_id', member.id)
    .maybeSingle()

  if (!envelope) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (envelope.status !== 'completed') {
    return NextResponse.json({ error: 'Document not yet signed' }, { status: 400 })
  }

  const docBytes = await getEnvelopeDocument(envelope.envelope_id)

  return new NextResponse(docBytes, {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': 'attachment; filename="consent-form.pdf"',
    },
  })
}
