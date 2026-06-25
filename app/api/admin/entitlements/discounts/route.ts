import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { isAdminClaims } from '@/lib/admin-auth'
import { listDiscounts, upsertDiscount, deleteDiscount, type DiscountInput } from '@/lib/entitlements'

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return isAdminClaims(sessionClaims)
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const discounts = await listDiscounts()
    return NextResponse.json({ discounts })
  } catch (err) {
    console.error('[admin/entitlements/discounts] list:', err)
    return NextResponse.json({ error: 'Could not load discounts' }, { status: 500 })
  }
}

// Create or update a tier discount / coupon.
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await req.json().catch(() => null)) as (DiscountInput & { id?: string }) | null
  if (!body || (body.kind !== 'tier' && body.kind !== 'coupon')) {
    return NextResponse.json({ error: "kind must be 'tier' or 'coupon'" }, { status: 400 })
  }
  try {
    const discount = await upsertDiscount(body)
    return NextResponse.json({ discount })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not save discount'
    console.error('[admin/entitlements/discounts] upsert:', err)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  try {
    await deleteDiscount(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/entitlements/discounts] delete:', err)
    return NextResponse.json({ error: 'Could not delete discount' }, { status: 500 })
  }
}
