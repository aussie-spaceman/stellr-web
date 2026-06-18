import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ShoppingBag } from 'lucide-react'
import { supabaseServer } from '@/lib/supabase'
import { AddToCart } from '@/components/store/AddToCart'
import type { StoreProductWithVariants } from '@/lib/store/types'

export const dynamic = 'force-dynamic'

async function load(slug: string): Promise<StoreProductWithVariants | null> {
  const db = supabaseServer()
  const { data } = await db
    .from('store_products')
    .select('*, variants:store_variants(*)')
    .eq('slug', slug)
    .eq('status', 'active')
    .maybeSingle()
  return (data as StoreProductWithVariants | null) ?? null
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const product = await load(slug)
  return { title: product ? `${product.name} — Stellr Store` : 'Store — Stellr Education' }
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const product = await load(slug)
  if (!product) notFound()
  const img = product.images?.[0] ?? null

  return (
    <div className="section-padding">
      <div className="container-max">
        <Link href="/store" className="mb-6 inline-flex items-center gap-1 text-sm text-brand-grey-dark hover:text-brand-blue">
          <ArrowLeft className="h-4 w-4" /> Store
        </Link>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div className="flex h-80 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-brand-blue-dark to-blue-900 lg:h-[28rem]">
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img} alt={product.name} className="h-full w-full object-cover" />
            ) : (
              <ShoppingBag size={56} className="text-blue-300 opacity-60" />
            )}
          </div>

          <div>
            <span className="mb-2 inline-block rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold capitalize text-gray-600">
              {product.product_type}
            </span>
            <h1 className="mb-3 text-3xl font-bold text-brand-blue-dark">{product.name}</h1>
            {product.description && <p className="mb-6 text-brand-grey-dark">{product.description}</p>}
            <AddToCart
              productSlug={product.slug}
              productName={product.name}
              image={img}
              variants={(product.variants ?? []).map((v) => ({
                id: v.id,
                label: v.label,
                market_price_cents: v.market_price_cents,
                active: v.active,
              }))}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
