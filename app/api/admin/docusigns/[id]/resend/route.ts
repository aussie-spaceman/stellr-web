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

  // Records the manual resend WITHOUT touching reminder_sent_at. Writing that
  // column here used to permanently remove the envelope from the reminder cron,
  // which filtered on `reminder_sent_at IS NULL` — so an admin helpfully
  // pressing "Resend" silently switched off all future automated chasing for
  // that family (4 Sept 2026).
  const now = new Date().toISOString()
  await db
    .from('docusign_envelopes')
    .update({ last_manual_resend_at: now, updated_at: now })
    .eq('id', id)

  return NextResponse.json({ ok: true })
}
