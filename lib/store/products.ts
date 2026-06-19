// Catalog data access for the web store (PRD §12). All reads/writes go through
// the service-role client; routes gate access with lib/store/auth.

import { supabaseServer } from '@/lib/supabase'
import { getSyncProduct } from './printful'
import type {
  ProductStatus,
  ProductType,
  StoreProduct,
  StoreProductWithVariants,
  StoreVariant,
} from './types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export async function listProducts(): Promise<StoreProductWithVariants[]> {
  const db = supabaseServer()
  const { data, error } = await db
    .from('store_products')
    .select('*, variants:store_variants(*)')
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listProducts: ${error.message}`)
  return (data ?? []) as StoreProductWithVariants[]
}

export async function getProduct(id: string): Promise<StoreProductWithVariants | null> {
  // A non-UUID id (e.g. a stray path segment) can never match — treat as not
  // found rather than letting Postgres throw "invalid input syntax for uuid".
  if (!UUID_RE.test(id)) return null
  const db = supabaseServer()
  const { data, error } = await db
    .from('store_products')
    .select('*, variants:store_variants(*)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`getProduct: ${error.message}`)
  return (data as StoreProductWithVariants | null) ?? null
}

export async function createProduct(input: {
  name: string
  product_type?: ProductType
  description?: string | null
}): Promise<{ id: string }> {
  const db = supabaseServer()
  // Slug must be unique; suffix with a short random tail on collision.
  const base = slugify(input.name) || 'product'
  let slug = base
  for (let i = 0; i < 5; i++) {
    const { data: clash } = await db.from('store_products').select('id').eq('slug', slug).maybeSingle()
    if (!clash) break
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`
  }
  const { data, error } = await db
    .from('store_products')
    .insert({
      name: input.name,
      slug,
      product_type: input.product_type ?? 'merch',
      description: input.description ?? null,
      status: 'draft',
    })
    .select('id')
    .single()
  if (error) throw new Error(`createProduct: ${error.message}`)
  return { id: (data as { id: string }).id }
}

const PRODUCT_PATCH_FIELDS = [
  'name',
  'description',
  'product_type',
  'status',
  'images',
  'is_event_shirt',
  'featured',
] as const

export async function updateProduct(id: string, patch: Partial<StoreProduct>): Promise<void> {
  const db = supabaseServer()
  const clean: Record<string, unknown> = {}
  for (const f of PRODUCT_PATCH_FIELDS) {
    if (f in patch && (patch as Record<string, unknown>)[f] !== undefined) {
      clean[f] = (patch as Record<string, unknown>)[f]
    }
  }
  if (Object.keys(clean).length === 0) return
  const { error } = await db.from('store_products').update(clean).eq('id', id)
  if (error) throw new Error(`updateProduct: ${error.message}`)
}

// Soft delete = archive (deletion-by-design: hide, retain). A hard purge goes
// through the deletion subsystem (lib/deletion).
export async function archiveProduct(id: string): Promise<void> {
  await updateProduct(id, { status: 'archived' as ProductStatus })
}

// --- Variants ---------------------------------------------------------------

export async function createVariant(
  productId: string,
  input: {
    sku: string
    label?: string | null
    options?: Record<string, string>
    market_price_cents: number
    pod_sync_variant_id?: string | null
    inventory_qty?: number | null
  },
): Promise<{ id: string }> {
  const db = supabaseServer()
  const { data, error } = await db
    .from('store_variants')
    .insert({
      product_id: productId,
      sku: input.sku,
      label: input.label ?? null,
      options: input.options ?? {},
      market_price_cents: input.market_price_cents,
      pod_sync_variant_id: input.pod_sync_variant_id ?? null,
      inventory_qty: input.inventory_qty ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(`createVariant: ${error.message}`)
  return { id: (data as { id: string }).id }
}

export async function updateVariant(variantId: string, patch: Partial<StoreVariant>): Promise<void> {
  const db = supabaseServer()
  const clean: Record<string, unknown> = {}
  for (const f of ['sku', 'label', 'options', 'market_price_cents', 'inventory_qty', 'active'] as const) {
    if (f in patch && (patch as Record<string, unknown>)[f] !== undefined) {
      clean[f] = (patch as Record<string, unknown>)[f]
    }
  }
  if (Object.keys(clean).length === 0) return
  const { error } = await db.from('store_variants').update(clean).eq('id', variantId)
  if (error) throw new Error(`updateVariant: ${error.message}`)
}

export async function deleteVariant(variantId: string): Promise<void> {
  const db = supabaseServer()
  const { error } = await db.from('store_variants').delete().eq('id', variantId)
  if (error) throw new Error(`deleteVariant: ${error.message}`)
}

// --- Printful sync ----------------------------------------------------------
//
// Pull a Printful sync product's variants into store_variants, mapping
// sync_variant_id → pod_sync_variant_id. Existing rows (matched by
// pod_sync_variant_id) are updated; new ones inserted. Prices seed
// market_price_cents from Printful's retail_price (admin can override later).
export async function syncFromPrintful(
  productId: string,
  printfulSyncProductId: number,
): Promise<{ imported: number }> {
  const db = supabaseServer()
  const { sync_product, sync_variants } = await getSyncProduct(printfulSyncProductId)

  const productSlugRow = await db.from('store_products').select('slug').eq('id', productId).maybeSingle()
  const productSlug = (productSlugRow.data as { slug?: string } | null)?.slug ?? 'item'

  let imported = 0
  for (const v of sync_variants) {
    const podId = String(v.id)
    const priceCents = v.retail_price ? Math.round(parseFloat(v.retail_price) * 100) : 0
    const sku = v.sku || `${productSlug}-${podId}`

    const { data: existing } = await db
      .from('store_variants')
      .select('id')
      .eq('product_id', productId)
      .eq('pod_sync_variant_id', podId)
      .maybeSingle()

    if (existing) {
      await db
        .from('store_variants')
        .update({ label: v.name, market_price_cents: priceCents })
        .eq('id', (existing as { id: string }).id)
    } else {
      await db.from('store_variants').insert({
        product_id: productId,
        sku,
        label: v.name,
        options: {},
        market_price_cents: priceCents,
        pod_sync_variant_id: podId,
      })
    }
    imported++
  }

  await db
    .from('store_products')
    .update({ pod_sync_product_id: String(sync_product.id) })
    .eq('id', productId)

  return { imported }
}
