import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { resendEnvelope } from '@/lib/docusign'

// POST /api/admin/docusigns/[id]/resend — admin can resend any envelope at any time
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const db = supabaseServer()

  const { data: envelope } = await db
    .from('docusign_envelopes')
    .select('envelope_id, status, reused_from')
    .eq('id', id)
    .maybeSingle()

  if (!envelope) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (envelope.reused_from) {
    return NextResponse.json({ error: 'Covered by an agreement already on record — nothing to resend' }, { status: 400 })
  }
  if (envelope.status === 'completed') {
    return NextResponse.json({ error: 'Envelope already completed' }, { status: 400 })
  }
  if (envelope.status === 'voided') {
    return NextResponse.json({ error: 'Envelope has been voided' }, { status: 400 })
  }

  await resendEnvelope(envelope.envelope_id)

  await db
    .from('docusign_envelopes')
    .update({ reminder_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ ok: true })
}
