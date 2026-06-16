import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'

// Admin: grant coach/mentor permission (FR-COM-11/12).
// PRD rule: may be assigned to anyone EXCEPT an Event Participation Role of
// School Student — enforced here.

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { memberId, email, canCoach, canMentor, bio } = await req.json().catch(() => ({}))
  if (!memberId && !email) {
    return NextResponse.json({ error: 'memberId or email required' }, { status: 400 })
  }

  const db = supabaseServer()
  const lookup = db.from('members').select('id, event_role')
  const { data: target } = await (memberId
    ? lookup.eq('id', memberId)
    : lookup.ilike('email', String(email).trim())
  ).maybeSingle()
  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (target.event_role === 'school_student') {
    return NextResponse.json(
      { error: 'School Students cannot be granted coach/mentor permissions.' },
      { status: 422 }
    )
  }

  const admin = await getCurrentMember()
  const { error } = await db.from('session_hosts').upsert(
    {
      member_id: target.id,
      can_coach: Boolean(canCoach),
      can_mentor: Boolean(canMentor),
      bio: bio ?? null,
      approved_by: admin?.id ?? null,
      approved_at: new Date().toISOString(),
    },
    { onConflict: 'member_id' }
  )
  if (error) {
    console.error('[hosts] grant error:', error)
    return NextResponse.json({ error: 'Could not grant permission' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

// DELETE — revoke all host permissions. Body: { memberId }
export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { memberId } = await req.json().catch(() => ({}))
  if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })
  const db = supabaseServer()
  const { error } = await db.from('session_hosts').delete().eq('member_id', memberId)
  if (error) return NextResponse.json({ error: 'Could not revoke' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
