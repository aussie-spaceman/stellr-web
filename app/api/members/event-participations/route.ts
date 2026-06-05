import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

// POST /api/members/event-participations — member adds a new event activity record
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const { event_year, event_location, team_name, award } = body

  const db = supabaseServer()

  const { data: member } = await db
    .from('members')
    .select('id')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .single()

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const { data, error } = await db
    .from('event_participations')
    .insert({
      member_id: member.id,
      event_year: event_year || null,
      event_location: event_location || null,
      team_name: team_name || null,
      award: award || null,
    })
    .select()
    .single()

  if (error) {
    console.error('Event participation insert error:', error)
    return NextResponse.json({ error: 'Failed to create record' }, { status: 500 })
  }

  return NextResponse.json({ participation: data })
}
