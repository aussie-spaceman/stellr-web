import { NextResponse } from 'next/server'
import { canManageStoreCatalog } from '@/lib/store/auth'
import { listSyncProducts, printfulEnabled } from '@/lib/store/printful'

export const dynamic = 'force-dynamic'

// Lists the Printful sync products available to import variants from (used by
// the product form's "link to Printful" picker).
export async function GET() {
  if (!(await canManageStoreCatalog())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!printfulEnabled()) return NextResponse.json({ enabled: false, products: [] })
  try {
    const products = await listSyncProducts()
    return NextResponse.json({ enabled: true, products })
  } catch (err) {
    console.error('[store/printful] list:', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
