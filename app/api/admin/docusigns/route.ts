import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

// GET /api/admin/docusigns — all DocuSign envelopes across all participants
export async function GET() {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = supabaseServer()

  const { data: envelopes } = await db
    .from('docusign_envelopes')
    .select('id, envelope_id, status, signer_name, signer_email, minor_name, event_title, event_slug, sent_at, completed_at, declined_at, reminder_sent_at, participant_id, member_id')
    .order('sent_at', { ascending: false })

  return NextResponse.json({ envelopes: envelopes ?? [] })
}
