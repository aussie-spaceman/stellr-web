import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { remindEnvelopeRow } from '@/lib/esign/operations'
import { ownsTeam } from '@/lib/team-access'
import { assertNotImpersonating } from '@/lib/impersonation'

const DAY_MS = 24 * 60 * 60 * 1000
/** A first nudge only once the signer has had a week with the original. */
const FIRST_RESEND_AFTER_MS = 7 * DAY_MS
/** And no more than one manual nudge a day after that. */
const RESEND_COOLDOWN_MS = DAY_MS

const LIVE = ['created', 'sent', 'delivered']

// POST /api/members/teams/[id]/participants/[pid]/docusign-resend
// A group's organiser re-sends the signing request to whoever on a participant's
// agreement has not signed yet.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; pid: string }> },
) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — see lib/impersonation.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id, pid } = await params
  const db = supabaseServer()

  const [{ data: member }, { data: reg }, { data: participant }] = await Promise.all([
    db.from('members')
      .select('id, email')
      .eq('clerk_user_id', userId)
      .eq('is_active', true)
      .maybeSingle(),
    db.from('registrations')
      .select('teacher_member_id, teacher_email, teacher_poc_email')
      .eq('id', id)
      .maybeSingle(),
    // The participant must belong to THIS registration. It used to be looked
    // up by id alone, so an organiser of any group could re-send another
    // group's agreements by changing the id in the URL.
    db.from('participants')
      .select('id')
      .eq('id', pid)
      .eq('registration_id', id)
      .maybeSingle(),
  ])

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  // Only an owner of this registration — the registrant (teacher or student
  // manager) or the nominated teacher POC — can resend (see lib/team-access).
  if (!reg || !ownsTeam(member, reg)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!participant) return NextResponse.json({ error: 'Participant not found' }, { status: 404 })

  // The participant's newest agreement. After a void and reissue there are two
  // rows, and `.maybeSingle()` on the participant id used to error on both —
  // reporting "no consent form" for exactly the families who needed a nudge.
  const { data: envelope } = await db
    .from('docusign_envelopes')
    .select('id, envelope_id, provider, status, sent_at, reused_from, last_manual_resend_at')
    .eq('participant_id', pid)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!envelope) {
    return NextResponse.json({ error: 'No consent form found for this participant' }, { status: 404 })
  }
  if (envelope.reused_from || envelope.status === 'completed') {
    return NextResponse.json({ error: 'Consent form already completed' }, { status: 400 })
  }
  if (!LIVE.includes(envelope.status as string)) {
    return NextResponse.json(
      { error: 'This form was cancelled, so it cannot be re-sent. Ask Stellr to issue a new one.' },
      { status: 400 },
    )
  }

  const now = Date.now()
  const sinceSent = now - new Date(envelope.sent_at as string).getTime()
  if (sinceSent < FIRST_RESEND_AFTER_MS) {
    const daysLeft = Math.ceil((FIRST_RESEND_AFTER_MS - sinceSent) / DAY_MS)
    return NextResponse.json(
      { error: `Reminders can only be sent after 7 days. Try again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.` },
      { status: 429 },
    )
  }
  const lastManual = envelope.last_manual_resend_at as string | null
  if (lastManual && now - new Date(lastManual).getTime() < RESEND_COOLDOWN_MS) {
    return NextResponse.json(
      { error: 'A reminder was sent in the last 24 hours. Try again tomorrow.' },
      { status: 429 },
    )
  }

  await remindEnvelopeRow(db, envelope as { envelope_id: string; provider: string | null })

  // last_manual_resend_at, NOT reminder_sent_at: the reminder cron used to skip
  // any envelope with reminder_sent_at set, so a teacher nudging their own team
  // member silently switched off all future automated chasing for that family
  // (4 Sept 2026).
  const stamp = new Date(now).toISOString()
  await db
    .from('docusign_envelopes')
    .update({ last_manual_resend_at: stamp, updated_at: stamp })
    .eq('id', envelope.id)

  return NextResponse.json({ ok: true })
}
