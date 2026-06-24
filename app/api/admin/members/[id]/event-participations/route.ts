import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { applyGrantTrigger } from '@/lib/membership-grants'

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

// POST /api/admin/members/[id]/event-participations — admin adds event record for a member
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: memberId } = await params
  const body = await req.json()
  const { event_year, event_location, team_name, award } = body

  const db = supabaseServer()

  const { data, error } = await db
    .from('event_participations')
    .insert({
      member_id: memberId,
      event_year: event_year || null,
      event_location: event_location || null,
      team_name: team_name || null,
      award: award || null,
    })
    .select()
    .single()

  if (error) {
    console.error('Admin event participation insert error:', error)
    return NextResponse.json({ error: 'Failed to create record' }, { status: 500 })
  }

  // Fire membership grant rules: attendance always, plus an award upgrade when an
  // award is recorded. Rules decide which tier (if any) applies for the member's
  // role/bracket; an empty rule set is a no-op. Best-effort — never block the save.
  const grants: Array<{ trigger: string; rule: string | null; granted: boolean }> = []
  try {
    const attend = await applyGrantTrigger(memberId, 'event_attendance', { grantKeySeed: data.id }, db)
    grants.push({ trigger: 'event_attendance', rule: attend.rule?.name ?? null, granted: attend.granted })
    if (award) {
      const won = await applyGrantTrigger(memberId, 'event_award', { award, grantKeySeed: data.id }, db)
      grants.push({ trigger: 'event_award', rule: won.rule?.name ?? null, granted: won.granted })
    }
  } catch (e) {
    console.error('Admin event participation grant-trigger error:', e)
  }

  return NextResponse.json({ participation: data, grants })
}
