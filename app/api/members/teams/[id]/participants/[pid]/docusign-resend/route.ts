import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { resendEnvelope } from '@/lib/docusign'
import { ownsTeam } from '@/lib/team-access'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

// POST /api/members/teams/[id]/participants/[pid]/docusign-resend
// Teacher/manager can re-send if envelope is not completed and was sent > 7 days ago.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; pid: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id, pid } = await params
  const db = supabaseServer()

  const [{ data: member }, { data: reg }, { data: envelope }] = await Promise.all([
    db.from('members')
      .select('id, email')
      .eq('clerk_user_id', userId)
      .eq('is_active', true)
      .maybeSingle(),
    db.from('registrations')
      .select('teacher_member_id, teacher_email, teacher_poc_email')
      .eq('id', id)
      .maybeSingle(),
    db.from('docusign_envelopes')
      .select('id, envelope_id, status, sent_at')
      .eq('participant_id', pid)
      .maybeSingle(),
  ])

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  // Only an owner of this registration — the registrant (teacher or student
  // manager) or the nominated teacher POC — can resend (see lib/team-access).
  if (!reg || !ownsTeam(member, reg)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!envelope) {
    return NextResponse.json({ error: 'No consent form found for this participant' }, { status: 404 })
  }
  if (envelope.status === 'completed') {
    return NextResponse.json({ error: 'Consent form already completed' }, { status: 400 })
  }

  const msElapsed = Date.now() - new Date(envelope.sent_at).getTime()
  if (msElapsed < SEVEN_DAYS_MS) {
    const daysLeft = Math.ceil((SEVEN_DAYS_MS - msElapsed) / (24 * 60 * 60 * 1000))
    return NextResponse.json(
      { error: `Reminders can only be sent after 7 days. Try again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.` },
      { status: 429 },
    )
  }

  await resendEnvelope(envelope.envelope_id)

  await db
    .from('docusign_envelopes')
    .update({ reminder_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', envelope.id)

  return NextResponse.json({ ok: true })
}
