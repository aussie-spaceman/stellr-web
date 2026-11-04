import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { communityWriteBlock } from '@/lib/community'
import { getOnboardedMember } from '@/lib/onboarded-member'
import { assertNotImpersonating } from '@/lib/impersonation'
import { getHostCaps } from '@/lib/sessions'

// Host weekly availability (FR-COM-11/12): coaches/mentors set when they're free.

async function isHost(memberId: string): Promise<boolean> {
  const caps = await getHostCaps(memberId)
  return caps.canCoach || caps.canMentor
}

// POST — add a window. Body: { weekday, startMinute, endMinute, sessionType? }
export async function POST(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getOnboardedMember()
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Decision 24: age and guardian-consent restrictions (lib/community).
  const restricted = await communityWriteBlock(member, 'host')
  if (restricted) return restricted
  if (!(await isHost(member.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getOnboardedMember()
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Decision 24: age and guardian-consent restrictions (lib/community).
  const restricted = await communityWriteBlock(member, 'host')
  if (restricted) return restricted
  if (!(await isHost(member.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
