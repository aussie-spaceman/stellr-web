'use client'

import Link from 'next/link'
import { Package, Link2 } from 'lucide-react'
import type { StoreProductWithVariants } from '@/lib/store/types'

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  draft: 'bg-brand-hairline text-brand-muted',
  archived: 'bg-amber-100 text-amber-800',
}

function priceRange(p: StoreProductWithVariants): string {
  const prices = (p.variants ?? []).map((v) => v.market_price_cents)
  if (prices.length === 0) return '—'
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`
  return min === max ? fmt(min) : `${fmt(min)}–${fmt(max)}`
}

export function ProductTable({ products }: { products: StoreProductWithVariants[] }) {
  if (products.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-brand-border p-10 text-center text-sm text-brand-muted-soft">
        <Package className="mx-auto mb-2 h-6 w-6 text-brand-muted-soft" />
        No products yet. Create one, then sync its variants from Printful.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-brand-border">
      <table className="w-full text-sm">
        <thead className="bg-brand-canvas text-left text-xs uppercase tracking-wide text-brand-muted-soft">
          <tr>
            <th className="px-4 py-2 font-medium">Product</th>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">Variants</th>
            <th className="px-4 py-2 font-medium">Price</th>
            <th className="px-4 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-hairline">
          {products.map((p) => (
            <tr key={p.id} className="hover:bg-brand-canvas">
              <td className="px-4 py-2.5">
                <Link href={`/admin/store/${p.id}`} className="font-medium text-brand-blue-dark hover:text-brand-blue">
                  {p.name}
                </Link>
                <div className="flex items-center gap-2 text-xs text-brand-muted-soft">
                  {p.slug}
                  {p.pod_sync_product_id && (
                    <span className="flex items-center gap-0.5 text-brand-blue">
                      <Link2 className="h-3 w-3" /> Printful
                    </span>
                  )}
                  {p.is_event_shirt && <span className="text-amber-600">event shirt</span>}
                </div>
              </td>
              <td className="px-4 py-2.5 capitalize text-brand-muted">{p.product_type}</td>
              <td className="px-4 py-2.5 text-brand-muted">{p.variants?.length ?? 0}</td>
              <td className="px-4 py-2.5 text-brand-muted">{priceRange(p)}</td>
              <td className="px-4 py-2.5">
                <span className={'rounded-md px-2 py-0.5 text-[11px] ' + (STATUS_BADGE[p.status] ?? STATUS_BADGE.draft)}>
                  {p.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
