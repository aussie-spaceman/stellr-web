import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { STAFF_SCOPES } from '@/lib/admin-auth'

// Admin CRUD for the staff-roles function-scope seam (migration 044).

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

// POST — grant/replace a member's function scopes. Body: { email, scopes: string[] }
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email, scopes } = await req.json().catch(() => ({}))
  if (!email || !Array.isArray(scopes) || scopes.length === 0) {
    return NextResponse.json({ error: 'email and a non-empty scopes[] required' }, { status: 400 })
  }
  const clean = [...new Set(scopes)].filter((s) => (STAFF_SCOPES as readonly string[]).includes(s))
  if (clean.length === 0) return NextResponse.json({ error: 'no valid scopes' }, { status: 400 })

  const db = supabaseServer()
  const { data: member } = await db
    .from('members')
    .select('id, first_name, last_name, email')
    .ilike('email', String(email).trim())
    .maybeSingle()
  if (!member) return NextResponse.json({ error: 'No member with that email.' }, { status: 404 })

  const admin = await getCurrentMember()
  const { error } = await db.from('staff_roles').upsert(
    { member_id: member.id, scopes: clean, granted_by: admin?.id ?? null, updated_at: new Date().toISOString() },
    { onConflict: 'member_id' },
  )
  if (error) {
    console.error('[staff-roles] upsert error:', error)
    return NextResponse.json({ error: 'Could not save staff role' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, member })
}

// DELETE — remove a member's staff role. Body: { memberId }
export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { memberId } = await req.json().catch(() => ({}))
  if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })

  const db = supabaseServer()
  const { error } = await db.from('staff_roles').delete().eq('member_id', memberId)
  if (error) {
    console.error('[staff-roles] delete error:', error)
    return NextResponse.json({ error: 'Could not remove staff role' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
