import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { getHostCaps } from '@/lib/sessions'

// Host weekly availability (FR-COM-11/12): coaches/mentors set when they're free.

async function requireHost() {
  const member = await getCurrentMember()
  if (!member) return null
  const caps = await getHostCaps(member.id)
  if (!caps.canCoach && !caps.canMentor) return null
  return member
}

// POST — add a window. Body: { weekday, startMinute, endMinute, sessionType? }
export async function POST(req: Request) {
  const member = await requireHost()
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const b = await req.json().catch(() => ({}))
  if (
    typeof b.weekday !== 'number' ||
    typeof b.startMinute !== 'number' ||
    typeof b.endMinute !== 'number' ||
    b.endMinute <= b.startMinute
  ) {
    return NextResponse.json({ error: 'Valid weekday/startMinute/endMinute required' }, { status: 400 })
  }

  const db = supabaseServer()
  const { data, error } = await db
    .from('host_availability')
    .insert({
      host_member_id: member.id,
      weekday: b.weekday,
      start_minute: b.startMinute,
      end_minute: b.endMinute,
      session_type: b.sessionType ?? 'both',
    })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: 'Could not add window' }, { status: 500 })
  return NextResponse.json({ id: data.id })
}

// DELETE — remove a window. Body: { id }
export async function DELETE(req: Request) {
  const member = await requireHost()
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = supabaseServer()
  const { error } = await db
    .from('host_availability')
    .delete()
    .eq('id', id)
    .eq('host_member_id', member.id) // can only delete own windows
  if (error) return NextResponse.json({ error: 'Could not delete' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
