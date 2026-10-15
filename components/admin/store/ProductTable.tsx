'use client'

import Link from 'next/link'
import { Package, Link2 } from 'lucide-react'
import type { StoreProductWithVariants } from '@/lib/store/types'

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  draft: 'bg-brand-hairline text-brand-muted',
  archived: 'bg-amber-100 text-amber-800',
}

// On a phone the table scrolls sideways inside its card instead of being
// clipped, with the product name (the link into it) held at the left edge.
// border-separate: a sticky cell in a collapsed table leaves its borders
// behind when it moves, so row lines live on the cells.
const TH = 'whitespace-nowrap border-b border-line-light px-4 py-2 font-medium'
const TD = 'border-b border-line-light px-4 py-2.5 group-last:border-b-0'
const STICKY = 'sticky left-0 z-10 border-r border-line-light'

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
    <div
      role="region"
      aria-label="Products"
      tabIndex={0}
      className="relative overflow-x-auto rounded-ds-card border border-line bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
    >
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead className="bg-surface text-left text-xs uppercase tracking-wide text-content-muted">
          <tr>
            <th scope="col" className={`${TH} ${STICKY} bg-surface`}>Product</th>
            <th scope="col" className={TH}>Type</th>
            <th scope="col" className={TH}>Variants</th>
            <th scope="col" className={TH}>Price</th>
            <th scope="col" className={TH}>Status</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} className="group hover:bg-surface">
              <td className={`${TD} ${STICKY} bg-white group-hover:bg-surface`}>
                <Link href={`/admin/store/${p.id}`} className="font-medium text-ink hover:text-primary hover:underline">
                  {p.name}
                </Link>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-content-muted">
                  {p.slug}
                  {p.pod_sync_product_id && (
                    <span className="flex items-center gap-0.5 text-primary">
                      <Link2 className="h-3 w-3" aria-hidden /> Printful
                    </span>
                  )}
                  {p.is_event_shirt && <span className="text-amber-600">event shirt</span>}
                </div>
              </td>
              <td className={`${TD} whitespace-nowrap capitalize text-content-body`}>{p.product_type}</td>
              <td className={`${TD} whitespace-nowrap text-content-body`}>{p.variants?.length ?? 0}</td>
              <td className={`${TD} whitespace-nowrap text-content-body`}>{priceRange(p)}</td>
              <td className={`${TD} whitespace-nowrap`}>
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
