import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

// GET /api/members/teams
// Teachers: all registrations where teacher_member_id = this member
// Students: all registrations they appear in as a participant
export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = supabaseServer()

  const { data: member } = await db
    .from('members')
    .select('id, event_role')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  if (member.event_role === 'teacher' || member.event_role === 'school_student_manager') {
    const { data: registrations, error } = await db
      .from('registrations')
      .select(`
        id, event_slug, event_title, school_name, status, created_at,
        teacher_first_name, teacher_last_name, teacher_email,
        spreadsheet_id, registrant_role,
        teacher_poc_first_name, teacher_poc_last_name, teacher_poc_email,
        member_pays_individually, details_method,
        participants(id, event_role, first_name, last_name, email, join_completed_at, individual_payment_status)
      `)
      .eq('teacher_member_id', member.id)
      .eq('type', 'group')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[teams] DB error:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

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

    const teams = (registrations ?? []).map((r: { id: string }) => ({
      ...r,
      joinUrl: joinUrlMap[r.id] ?? null,
    }))

    // Also return any groups this member has joined as a participant
    const { data: participations } = await db
      .from('participants')
      .select(`
        id, event_role, first_name, last_name, join_completed_at,
        registrations(
          id, event_slug, event_title, school_name, status, created_at,
          teacher_first_name, teacher_last_name, teacher_email
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

  // school_student or other roles: find registrations they're a participant in
  const { data: participations, error } = await db
    .from('participants')
    .select(`
      id, event_role, first_name, last_name, join_completed_at,
      registrations(
        id, event_slug, event_title, school_name, status, created_at,
        teacher_first_name, teacher_last_name, teacher_email
      )
    `)
    .eq('member_id', member.id)
    .not('join_completed_at', 'is', null)

  if (error) {
    console.error('[teams] DB error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  return NextResponse.json({ teams: participations ?? [], role: 'student' })
}
