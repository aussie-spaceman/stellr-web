import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { ownsTeam, teamViewerRole, type TeamViewerRegistration } from '@/lib/team-access'
import { resolveRequestMember } from '@/lib/impersonation'

// GET /api/members/teams/[id] — full team detail with participants
// Admins may pass ?memberId= to read another member's team detail (view-as).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const db = supabaseServer()

  const { member, unauthorised } = await resolveRequestMember<{ id: string; email: string | null }>(
    req,
    db,
    'id, email',
  )
  if (unauthorised) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const { data: registration, error } = await db
    .from('registrations')
    .select(`
      id, event_slug, event_title, school_name, status, created_at,
      teacher_first_name, teacher_last_name, teacher_email, teacher_member_id,
      spreadsheet_id, registrant_role,
      teacher_poc_first_name, teacher_poc_last_name, teacher_poc_email,
      member_pays_individually, details_method,
      participants(*, event_companies(number, name))
    `)
    .eq('id', id)
    .eq('type', 'group')
    .maybeSingle()

  if (error) {
    console.error('[teams/id] DB error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!registration) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  // Access control: the group organiser owns it (the registrant — teacher or
  // student manager — OR the nominated teacher POC, matched by member id/email;
  // see lib/team-access), otherwise the caller must be a participant in it.
  const owns = ownsTeam(member, registration)
  const isParticipant = (registration.participants as { member_id?: string | null }[])
    .some(p => p.member_id === member.id)
  if (!owns && !isParticipant) {
    console.warn('[teams/id] Access denied', { registrationId: id, memberId: member.id })
    return NextResponse.json({ error: 'You do not have access to this team' }, { status: 403 })
  }

  // Watch channel, join token, and DocuSign envelopes are independent — fetch in parallel
  const regAny = registration as Record<string, unknown>
  const participantIds = (registration.participants as { id: string }[]).map(p => p.id)

  const [{ data: watchChannel }, { data: token }, { data: envelopes }] = await Promise.all([
    db.from('sheet_watch_channels')
      .select('expiration')
      .eq('registration_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    regAny.details_method === 'email_link'
      ? db.from('group_join_tokens')
          .select('token, expires_at')
          .eq('registration_id', id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    participantIds.length > 0
      ? db.from('docusign_envelopes')
          .select('id, participant_id, status, envelope_type, signer_name, signer_email, sent_at, completed_at, reminder_sent_at')
          .in('participant_id', participantIds)
      : Promise.resolve({ data: null }),
  ])

  const watchActive = watchChannel
    ? new Date(watchChannel.expiration) > new Date()
    : false

  let joinUrl: string | null = null
  if (token && new Date((token as { expires_at: string }).expires_at) > new Date()) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
    joinUrl = `${siteUrl}/register/${regAny.event_slug}/join/${(token as { token: string }).token}`
  }

  const docusignEnvelopes: Record<string, {
    id: string; status: string; envelope_type: string; signer_name: string; signer_email: string
    sent_at: string; completed_at: string | null; reminder_sent_at: string | null
  }> = {}
  for (const e of envelopes ?? []) {
    docusignEnvelopes[e.participant_id] = {
      id: e.id, status: e.status, envelope_type: e.envelope_type ?? 'minor',
      signer_name: e.signer_name, signer_email: e.signer_email,
      sent_at: e.sent_at, completed_at: e.completed_at, reminder_sent_at: e.reminder_sent_at,
    }
  }

  const viewerRole = owns
    ? teamViewerRole(member, registration as unknown as TeamViewerRegistration)
    : null

  return NextResponse.json({ registration: { ...registration, joinUrl, docusignEnvelopes, viewerRole }, watchActive })
}
