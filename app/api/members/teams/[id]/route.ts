import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { supabaseServer } from '@/lib/supabase'
import { ownsTeam, teamViewerRole, type TeamViewerRegistration } from '@/lib/team-access'
import { resolveRequestMember } from '@/lib/impersonation'
import { isDetailsHiddenFrom, organiserViewOfParticipant } from '@/lib/team-linked-details'

// GET /api/members/teams/[id] — full team detail with participants
// An admin holding a view-as ticket reads it as the viewed member.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const db = supabaseServer()

  const { member, unauthorised, impersonating: isViewAs } = await resolveRequestMember<{
    id: string
    email: string | null
  }>(db, 'id, email')
  if (unauthorised) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  // Admin view-as is a read-only lens over someone else's portal — it must
  // never write, so it skips the on-demand join-token mint below. (This keyed
  // off ?memberId= before S0, so a full-portal view-as session DID mint one.)

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

  // A participant who does not manage the group sees who is on it and nothing
  // else. This response used to return every participant row in full — dates
  // of birth, health conditions, emergency contacts, guardians' emails — plus
  // every teammate's agreement signer, to any student on the team. Only the
  // organisers' view (TeacherTeamsView) reads the full detail.
  if (!owns) {
    const parts = registration.participants as (Record<string, unknown> & { id: string; member_id?: string | null })[]
    return NextResponse.json({
      registration: {
        id: registration.id,
        event_slug: registration.event_slug,
        event_title: registration.event_title,
        school_name: registration.school_name,
        status: registration.status,
        participants: parts.map((p) =>
          p.member_id === member.id
            ? p
            : {
                id: p.id,
                first_name: p.first_name,
                last_name: p.last_name,
                event_role: p.event_role,
                event_companies: p.event_companies ?? null,
              },
        ),
        joinUrl: null,
        docusignEnvelopes: {},
        viewerRole: null,
      },
      watchActive: false,
    })
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
    // Looked up for every group, not just the email-link method — the organiser can
    // hand the link to a member regardless of how they first supplied details.
    db.from('group_join_tokens')
      .select('token, expires_at')
      .eq('registration_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    participantIds.length > 0
      ? db.from('agreements')
          .select('id, participant_id, status, envelope_type, signer_name, signer_email, sent_at, completed_at, reminder_sent_at')
          .in('participant_id', participantIds)
          // Oldest first, so the map below keeps each participant's newest
          // agreement: after a void and reissue a participant has two rows,
          // and an unordered read could show the dead one.
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: null }),
  ])

  const watchActive = watchChannel
    ? new Date(watchChannel.expiration) > new Date()
    : false

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
  let joinUrl: string | null = null
  if (token && new Date((token as { expires_at: string }).expires_at) > new Date()) {
    joinUrl = `${siteUrl}/register/${regAny.event_slug}/join/${(token as { token: string }).token}`
  } else if (owns && !isViewAs) {
    // Groups registered before every method got a token — and groups whose 30-day
    // token has lapsed — mint one on open, mirroring the on-demand spreadsheet
    // endpoint. Only for the real organiser: admin view-as is read-only, so it
    // never writes (a stale-token view-as simply shows no link).
    const freshToken = randomBytes(32).toString('hex')
    const { error: mintError } = await db.from('group_join_tokens').insert({
      token: freshToken,
      registration_id: id,
      event_slug: regAny.event_slug,
      event_title: regAny.event_title,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    })
    if (mintError) {
      console.error('[teams/id] Join token mint error (non-fatal):', mintError)
    } else {
      joinUrl = `${siteUrl}/register/${regAny.event_slug}/join/${freshToken}`
    }
  }

  const docusignEnvelopes: Record<string, {
    id: string; status: string; envelope_type: string; signer_name: string; signer_email: string
    sent_at: string; completed_at: string | null; reminder_sent_at: string | null
    /** Signers on the live form whose email bounced, and student suggestions waiting (Fix email). */
    bounced: number; pending_suggestions: number
  }> = {}
  const roster = registration.participants as Record<string, unknown>[]
  const hiddenIds = new Set(roster.filter((p) => isDetailsHiddenFrom(p, member.id)).map((p) => p.id))
  const liveIds = (envelopes ?? []).filter((e) => e.status === 'sent' || e.status === 'delivered').map((e) => e.id as string)
  const bouncedBy = new Map<string, number>()
  const pendingBy = new Map<string, number>()
  if (liveIds.length) {
    const [{ data: bouncedRows }, { data: pendingRows }] = await Promise.all([
      db.from('agreement_recipients').select('envelope_row').in('envelope_row', liveIds).eq('status', 'autoresponded'),
      db.from('agreement_email_changes').select('agreement_id').in('agreement_id', liveIds).eq('status', 'pending'),
    ])
    for (const r of (bouncedRows ?? []) as { envelope_row: string }[]) bouncedBy.set(r.envelope_row, (bouncedBy.get(r.envelope_row) ?? 0) + 1)
    for (const r of (pendingRows ?? []) as { agreement_id: string }[]) pendingBy.set(r.agreement_id, (pendingBy.get(r.agreement_id) ?? 0) + 1)
  }
  for (const e of envelopes ?? []) {
    const hidden = hiddenIds.has(e.participant_id)
    docusignEnvelopes[e.participant_id] = {
      id: e.id, status: e.status, envelope_type: e.envelope_type ?? 'minor',
      signer_name: hidden ? '' : e.signer_name, signer_email: hidden ? '' : e.signer_email,
      sent_at: e.sent_at, completed_at: e.completed_at, reminder_sent_at: e.reminder_sent_at,
      // A row kept private shows no contact details, so nothing to fix here.
      bounced: hidden ? 0 : bouncedBy.get(e.id) ?? 0,
      pending_suggestions: hidden ? 0 : pendingBy.get(e.id) ?? 0,
    }
  }

  const viewerRole = teamViewerRole(member, registration as unknown as TeamViewerRegistration)

  const participants = roster.map((p) => organiserViewOfParticipant(p, member.id))

  return NextResponse.json({ registration: { ...registration, participants, joinUrl, docusignEnvelopes, viewerRole }, watchActive })
}
