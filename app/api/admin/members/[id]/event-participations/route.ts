import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

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

  return NextResponse.json({ participation: data })
}
