import { supabaseServer } from '@/lib/supabase'
import { ProductCard } from '@/components/ui/ProductCard'
import type { StoreProductWithVariants } from '@/lib/store/types'

export const metadata = {
  title: 'Store — Stellr Education',
  description: 'Official Stellr merchandise — apparel, stickers and more.',
}
export const dynamic = 'force-dynamic'

export default async function StorePage() {
  const db = supabaseServer()
  const { data } = await db
    .from('store_products')
    .select('*, variants:store_variants(*)')
    .eq('status', 'active')
    .order('featured', { ascending: false })
    .order('created_at', { ascending: false })
  const products = (data ?? []) as StoreProductWithVariants[]

  return (
    <div className="section-padding">
      <div className="container-max">
        <h1 className="text-3xl font-bold text-brand-blue-dark">Store</h1>
        <p className="mt-1 mb-8 text-brand-grey-dark">Official Stellr merchandise. Members get tier discounts at checkout.</p>

        {products.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 p-12 text-center text-gray-500">
            No products available yet — check back soon.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
