// Shared types for the web store module (PRD §12). The Supabase server client is
// untyped in this project, so query results are cast to these shapes at the
// lib-layer boundary.

export type ProductType = 'apparel' | 'merch' | 'sticker' | 'digital'
export type ProductStatus = 'draft' | 'active' | 'archived'
export type PodProvider = 'printful' | 'self'

export interface StoreProduct {
  id: string
  slug: string
  name: string
  description: string | null
  product_type: ProductType
  status: ProductStatus
  pod_provider: PodProvider
  pod_sync_product_id: string | null
  images: string[]
  is_event_shirt: boolean
  featured: boolean
  created_at: string
}

export interface StoreVariant {
  id: string
  product_id: string
  sku: string
  label: string | null
  options: Record<string, string>
  market_price_cents: number
  pod_sync_variant_id: string | null
  inventory_qty: number | null
  active: boolean
}

export interface StoreProductWithVariants extends StoreProduct {
  variants: StoreVariant[]
}

export type DiscountScopeTier = 'all' | 'product' | 'category'
export type DiscountScopeEvent = 'global' | 'event'

export interface TierDiscount {
  id: string
  tier_id: string
  scope: DiscountScopeTier
  product_id: string | null
  category: string | null
  percent_off: number
}

export interface EventDiscount {
  id: string
  scope: DiscountScopeEvent
  event_slug: string | null
  product_id: string | null
  category: string | null
  percent_off: number
}

// Pricing context — drives which discount axis applies (they don't stack).
export type PriceContext =
  | { kind: 'storefront'; tierId?: string | null }
  | { kind: 'event'; eventSlug: string }

export interface PriceResult {
  base_cents: number
  percent_off: number
  unit_cents: number
}
