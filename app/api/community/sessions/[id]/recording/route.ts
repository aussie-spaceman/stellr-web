import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, signedDownloadUrl } from '@/lib/community'

// GET /api/community/sessions/[id]/recording
// Returns a short-lived signed URL to the offloaded recording, only for the
// session's host or a participant (FR-COM-11/12).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { id } = await params

  const db = supabaseServer()
  const { data: session } = await db
    .from('sessions')
    .select('id, host_member_id, recording_path, recording_status')
    .eq('id', id)
    .maybeSingle()
  if (!session || !session.recording_path || session.recording_status !== 'available') {
    return NextResponse.json({ error: 'No recording available' }, { status: 404 })
  }

  // Authorise: host or participant.
  let allowed = session.host_member_id === member.id
  if (!allowed) {
    const { data: p } = await db
      .from('session_participants')
      .select('member_id')
      .eq('session_id', id)
      .eq('member_id', member.id)
      .maybeSingle()
    allowed = !!p
  }
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = await signedDownloadUrl(session.recording_path)
  if (!url) return NextResponse.json({ error: 'Could not generate link' }, { status: 500 })
  return NextResponse.json({ url })
}
