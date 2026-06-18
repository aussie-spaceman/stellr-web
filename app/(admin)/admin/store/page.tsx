import Link from 'next/link'
import { Plus } from 'lucide-react'
import { listProducts } from '@/lib/store/products'
import { ProductTable } from '@/components/admin/store/ProductTable'
import { StoreNav } from './StoreNav'

export const metadata = { title: 'Admin — Store' }
export const dynamic = 'force-dynamic'

// Store · Products. The merchandise catalog — one SKU set reused by the public
// storefront and event registration (PRD §12).
export default async function StoreProductsPage() {
  const products = await listProducts()

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Store</h1>
          <p className="mt-0.5 mb-4 text-sm text-gray-500">
            Merchandise catalog. Products sync from Printful; prices and discounts are managed here.
          </p>
        </div>
        <Link
          href="/admin/store/new"
          className="flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" /> New product
        </Link>
      </div>
      <StoreNav />
      <ProductTable products={products} />
    </div>
  )
}
