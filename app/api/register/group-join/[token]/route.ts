import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

interface RouteParams {
  params: Promise<{ token: string }>
}

// GET /api/register/group-join/[token] — return registration info for a join token
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { token } = await params
  const db = supabaseServer()

  const { data: tokenRow, error } = await db
    .from('group_join_tokens')
    .select('*, registrations(teacher_first_name, teacher_last_name, teacher_email, school_name, registrant_role, status)')
    .eq('token', token)
    .maybeSingle()

  if (error || !tokenRow) {
    return NextResponse.json({ error: 'Invalid or expired registration link' }, { status: 404 })
  }

  if (new Date(tokenRow.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This registration link has expired. Please contact your group organiser.' }, { status: 410 })
  }

  const reg = tokenRow.registrations as {
    teacher_first_name: string; teacher_last_name: string; teacher_email: string
    school_name: string; registrant_role: string; status: string
  }

  return NextResponse.json({
    token,
    registrationId: tokenRow.registration_id,
    eventSlug: tokenRow.event_slug,
    eventTitle: tokenRow.event_title,
    expiresAt: tokenRow.expires_at,
    organiser: {
      firstName: reg.teacher_first_name,
      lastName: reg.teacher_last_name,
      role: reg.registrant_role,
    },
    schoolName: reg.school_name,
    registrationStatus: reg.status,
  })
}
