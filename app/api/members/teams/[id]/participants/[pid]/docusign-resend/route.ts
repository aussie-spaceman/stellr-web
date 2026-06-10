import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { resendEnvelope } from '@/lib/docusign'

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
      .select('id, event_role')
      .eq('clerk_user_id', userId)
      .eq('is_active', true)
      .maybeSingle(),
    db.from('registrations')
      .select('teacher_member_id')
      .eq('id', id)
      .maybeSingle(),
    db.from('docusign_envelopes')
      .select('id, envelope_id, status, sent_at')
      .eq('participant_id', pid)
      .maybeSingle(),
  ])

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const isManager =
    member.event_role === 'teacher' || member.event_role === 'school_student_manager'
  if (!isManager) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Verify teacher owns this registration
  if (!reg || reg.teacher_member_id !== member.id) {
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
