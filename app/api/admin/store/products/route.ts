import { NextResponse } from 'next/server'
import { canManageStoreCatalog } from '@/lib/store/auth'
import { createProduct, listProducts } from '@/lib/store/products'

export const dynamic = 'force-dynamic'

// Admin catalog: list all products (with variants), create a new draft product.
export async function GET() {
  if (!(await canManageStoreCatalog())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const products = await listProducts()
    return NextResponse.json({ products })
  } catch (err) {
    console.error('[store/products] list:', err)
    return NextResponse.json({ error: 'Could not load products' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  if (!(await canManageStoreCatalog())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  if (!body?.name || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }
  try {
    const { id } = await createProduct({
      name: body.name,
      product_type: body.product_type,
      description: body.description ?? null,
    })
    return NextResponse.json({ id })
  } catch (err) {
    console.error('[store/products] create:', err)
    return NextResponse.json({ error: 'Could not create product' }, { status: 500 })
  }
}
