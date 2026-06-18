import { NextResponse } from 'next/server'
import { canManageStoreCatalog } from '@/lib/store/auth'
import { createVariant, deleteVariant, updateVariant } from '@/lib/store/products'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

// Variant CRUD for a product. Create with POST; edit with PATCH (variantId in
// body); remove with DELETE (?variantId=).
export async function POST(req: Request, { params }: Ctx) {
  if (!(await canManageStoreCatalog())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  if (!body?.sku || typeof body.market_price_cents !== 'number') {
    return NextResponse.json({ error: 'sku and market_price_cents required' }, { status: 400 })
  }
  try {
    const created = await createVariant(id, {
      sku: body.sku,
      label: body.label ?? null,
      options: body.options ?? {},
      market_price_cents: body.market_price_cents,
      inventory_qty: body.inventory_qty ?? null,
    })
    return NextResponse.json(created)
  } catch (err) {
    console.error('[store/variants] create:', err)
    return NextResponse.json({ error: 'Could not add variant' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  if (!(await canManageStoreCatalog())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  if (!body?.variantId) return NextResponse.json({ error: 'variantId required' }, { status: 400 })
  try {
    const { variantId, ...patch } = body
    await updateVariant(variantId, patch)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[store/variants] patch:', err)
    return NextResponse.json({ error: 'Could not update variant' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  if (!(await canManageStoreCatalog())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const variantId = new URL(req.url).searchParams.get('variantId')
  if (!variantId) return NextResponse.json({ error: 'variantId required' }, { status: 400 })
  try {
    await deleteVariant(variantId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[store/variants] delete:', err)
    return NextResponse.json({ error: 'Could not delete variant' }, { status: 500 })
  }
}
