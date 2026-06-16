import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { grantObjectRole, type ObjectType } from '@/lib/object-roles'

// Admin CRUD for object_roles — the "manage" axis (access-model Phase 3).
// Generalises /api/admin/event-managers to any object (event / group / container).

const OBJECT_TYPES: ObjectType[] = ['event', 'group', 'container']

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

// POST — grant a member manager rights over an object. The member comes from the
// member-search picker (memberId) or, as a fallback, by email.
// Decision D5: the grantee must already be a member (members row); no tier needed.
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { memberId, email, objectType, objectId } = await req.json().catch(() => ({}))
  if ((!memberId && !email) || !objectType || !objectId) {
    return NextResponse.json({ error: 'objectType, objectId and a member (memberId or email) required' }, { status: 400 })
  }
  if (!OBJECT_TYPES.includes(objectType)) {
    return NextResponse.json({ error: 'invalid objectType' }, { status: 400 })
  }

  const db = supabaseServer()
  const lookup = db.from('members').select('id, first_name, last_name, email')
  const { data: member } = await (memberId
    ? lookup.eq('id', memberId)
    : lookup.ilike('email', String(email).trim())
  ).maybeSingle()
  if (!member) {
    return NextResponse.json(
      { error: 'Member not found. Managers must have a member account first (D5).' },
      { status: 404 }
    )
  }

  const admin = await getCurrentMember()
  const res = await grantObjectRole(member.id, objectType, objectId, admin?.id ?? null)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 })
  return NextResponse.json({ ok: true, member })
}

// DELETE — revoke a grant. Body: { id } (object_roles row id).
export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = supabaseServer()
  const { error } = await db.from('object_roles').delete().eq('id', id)
  if (error) {
    console.error('[object-roles] delete error:', error)
    return NextResponse.json({ error: 'Could not revoke role' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
