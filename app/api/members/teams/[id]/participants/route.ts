import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { ownsTeam } from '@/lib/team-access'
import { assertNotImpersonating } from '@/lib/impersonation'
import { addParticipantToGroup, GROUP_FOR_ADD_COLUMNS } from '@/lib/group-participant-add'

// POST /api/members/teams/[id]/participants — group organiser adds a participant
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — see lib/impersonation.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: registrationId } = await params
  const db = supabaseServer()

  const { data: member } = await db
    .from('members')
    .select('id, email')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const { data: registration } = await db
    .from('registrations')
    .select(`teacher_member_id, teacher_email, teacher_poc_email, ${GROUP_FOR_ADD_COLUMNS}`)
    .eq('id', registrationId)
    .eq('type', 'group')
    .maybeSingle()

  if (!registration) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  // Ownership by member id OR registrant email OR nominated teacher-POC email
  // (see lib/team-access). The brittle event_role === 'teacher' gate also
  // rejected student managers and the teacher POC, who both own the team.
  if (!ownsTeam(member, registration)) {
    console.warn('[teams/participants] Access denied', { registrationId, memberId: member.id })
    return NextResponse.json({ error: 'You do not have access to this team' }, { status: 403 })
  }

  const body = await req.json()

  // Everything after the ownership check is shared with the admin event roster
  // (lib/group-participant-add.ts), so both paths add a person identically.
  const result = await addParticipantToGroup(db, registration, body, { memberId: member.id, label: 'organiser' })
  return NextResponse.json(result.body, { status: result.status })
}
