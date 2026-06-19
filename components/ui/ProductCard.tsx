import Link from 'next/link'
import { ShoppingBag } from 'lucide-react'
import type { StoreProductWithVariants } from '@/lib/store/types'

function priceRange(p: StoreProductWithVariants): string {
  const prices = (p.variants ?? []).filter((v) => v.active).map((v) => v.market_price_cents)
  if (prices.length === 0) return '—'
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`
  return min === max ? fmt(min) : `${fmt(min)}–${fmt(max)}`
}

export function ProductCard({ product }: { product: StoreProductWithVariants }) {
  const img = product.images?.[0]
  return (
    <Link
      href={`/store/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-line-light bg-white shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="relative flex h-52 items-center justify-center bg-gradient-to-br from-brand-blue-dark to-blue-900">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <ShoppingBag size={40} className="text-blue-300 opacity-60" />
        )}
      </div>
      <div className="flex flex-1 flex-col p-5">
        <span className="mb-2 w-fit rounded-full bg-surface px-2 py-1 text-xs font-semibold capitalize text-content-body">
          {product.product_type}
        </span>
        <h3 className="font-bold leading-snug text-brand-blue-dark">{product.name}</h3>
        <div className="mt-auto pt-3 text-lg font-semibold text-ink">{priceRange(product)}</div>
      </div>
    </Link>
  )
}
