import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { resolveRequestMember } from '@/lib/impersonation'
import { teamViewerRole, type TeamViewerRegistration } from '@/lib/team-access'

// GET /api/members/teams
// Managers: all group registrations they own — as the registrant (teacher or
//   student manager) OR as the nominated teacher point of contact.
// Students: all registrations they appear in as a participant.
// Admins may pass ?memberId= to read another member's teams (view-as).
export async function GET(req: Request) {
  const db = supabaseServer()

  const { member, unauthorised } = await resolveRequestMember<{ id: string; email: string | null }>(
    req,
    db,
    'id, email',
  )
  if (unauthorised) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  // Managed teams are matched by member id OR the email the group was registered
  // under, OR the nominated teacher-POC email (see lib/team-access) — not by
  // event_role, which broke whenever the session resolved to a different/duplicate
  // members row than the registration, and never recognised the student manager
  // (a participant member) or the teacher POC at all.
  const ownerOr = member.email
    ? `teacher_member_id.eq.${member.id},teacher_email.eq.${member.email},teacher_poc_email.eq.${member.email}`
    : `teacher_member_id.eq.${member.id}`

  const { data: registrations, error } = await db
    .from('registrations')
    .select(`
      id, event_slug, event_title, school_name, status, created_at,
      teacher_first_name, teacher_last_name, teacher_email, teacher_member_id,
      spreadsheet_id, registrant_role,
      teacher_poc_first_name, teacher_poc_last_name, teacher_poc_email,
      member_pays_individually, details_method, adult_count, student_count,
      participants(id, event_role, first_name, last_name, email, join_completed_at, individual_payment_status, event_companies(number, name))
    `)
    .or(ownerOr)
    .eq('type', 'group')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[teams] DB error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  if ((registrations ?? []).length > 0) {

    // Attach join URLs for email_link registrations
    const emailLinkIds = (registrations ?? [])
      .filter((r: { details_method: string }) => r.details_method === 'email_link')
      .map((r: { id: string }) => r.id)

    let joinUrlMap: Record<string, string> = {}
    if (emailLinkIds.length > 0) {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
      const { data: tokens } = await db
        .from('group_join_tokens')
        .select('registration_id, token, expires_at, event_slug')
        .in('registration_id', emailLinkIds)
      if (tokens) {
        for (const t of tokens as { registration_id: string; token: string; expires_at: string; event_slug: string }[]) {
          if (new Date(t.expires_at) > new Date()) {
            joinUrlMap[t.registration_id] = `${siteUrl}/register/${t.event_slug}/join/${t.token}`
          }
        }
      }
    }

    const teams = (registrations ?? []).map((r) => ({
      ...r,
      joinUrl: joinUrlMap[(r as { id: string }).id] ?? null,
      // How the viewer relates to this group, so the portal can label it
      // (Student Manager / Teacher POC / Teacher).
      viewerRole: teamViewerRole(member, r as unknown as TeamViewerRegistration),
    }))

    // Also return any groups this member has joined as a participant
    const { data: participations } = await db
      .from('participants')
      .select(`
        id, event_role, first_name, last_name, join_completed_at, individual_payment_status,
        registrations(
          id, event_slug, event_title, school_name, status, created_at,
          teacher_first_name, teacher_last_name, teacher_email,
          member_pays_individually, invoice_requested
        )
      `)
      .eq('member_id', member.id)
      .not('join_completed_at', 'is', null)

    // Exclude any participations that belong to a registration they manage (avoid duplicates)
    const managedIds = new Set((registrations ?? []).map((r: { id: string }) => r.id))
    const joinedTeams = (participations ?? []).filter(
      (p: { registrations: { id: string }[] | { id: string } | null }) => {
        const reg = Array.isArray(p.registrations) ? p.registrations[0] : p.registrations
        return reg && !managedIds.has(reg.id)
      }
    )

    return NextResponse.json({ teams, participations: joinedTeams, role: 'group_manager' })
  }

  // No managed teams — return any registrations they're a participant in.
  const { data: participations, error: studentError } = await db
    .from('participants')
    .select(`
      id, event_role, first_name, last_name, join_completed_at, individual_payment_status,
      registrations(
        id, event_slug, event_title, school_name, status, created_at,
        teacher_first_name, teacher_last_name, teacher_email,
        member_pays_individually, invoice_requested
      )
    `)
    .eq('member_id', member.id)
    .not('join_completed_at', 'is', null)

  if (studentError) {
    console.error('[teams] DB error:', studentError)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  return NextResponse.json({ teams: participations ?? [], role: 'student' })
}
