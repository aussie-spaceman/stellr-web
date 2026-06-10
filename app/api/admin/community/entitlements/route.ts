import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'

// Admin CRUD for the tier→content entitlement map (migration 017).
// Powers the drag-and-drop access matrix. All gating decisions elsewhere read
// from content_entitlements via lib/community.ts (memberHasEntitlement).

async function requireAdmin() {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  return role === 'admin'
}

// GET — list all entitlement rows (the matrix reads these to render chips).
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = supabaseServer()
  const { data } = await db
    .from('content_entitlements')
    .select('id, tier_id, target_type, target_ref, access_level')
  return NextResponse.json({ entitlements: data ?? [] })
}

// POST — grant a tier access to a target. Idempotent on the unique key.
// Body: { tierId, targetType, targetRef, accessLevel? }
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { tierId, targetType, targetRef, accessLevel } = await req.json().catch(() => ({}))
  if (!tierId || !targetType || !targetRef) {
    return NextResponse.json({ error: 'tierId, targetType, targetRef required' }, { status: 400 })
  }

  const admin = await getCurrentMember()
  const db = supabaseServer()
  const { data, error } = await db
    .from('content_entitlements')
    .upsert(
      {
        tier_id: tierId,
        target_type: targetType,
        target_ref: targetRef,
        access_level: accessLevel ?? 'view',
        created_by: admin?.id ?? null,
      },
      { onConflict: 'tier_id,target_type,target_ref,access_level' }
    )
    .select('id')
    .single()

  if (error) {
    console.error('[entitlements] upsert error:', error)
    return NextResponse.json({ error: 'Could not grant access' }, { status: 500 })
  }
  return NextResponse.json({ id: data.id })
}

// DELETE — revoke an entitlement row. Body: { id }
export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = supabaseServer()
  const { error } = await db.from('content_entitlements').delete().eq('id', id)
  if (error) {
    console.error('[entitlements] delete error:', error)
    return NextResponse.json({ error: 'Could not revoke access' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
