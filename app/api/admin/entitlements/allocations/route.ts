import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { isAdminClaims } from '@/lib/admin-auth'
import { setTierAllocationQuantity } from '@/lib/entitlements'

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return isAdminClaims(sessionClaims)
}

// Update a tier's free-allocation quantity (e.g. free coaching sessions or
// free mentoring cohorts per period).
export async function PATCH(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await req.json().catch(() => null)) as { id?: string; quantity?: number } | null
  if (!body?.id || typeof body.quantity !== 'number') {
    return NextResponse.json({ error: 'id and quantity required' }, { status: 400 })
  }
  try {
    await setTierAllocationQuantity(body.id, body.quantity)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/entitlements/allocations] patch:', err)
    return NextResponse.json({ error: 'Could not update allocation' }, { status: 500 })
  }
}
