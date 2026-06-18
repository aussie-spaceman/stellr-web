// Printful (print-on-demand) client for the web store (PRD §12).
//
// Thin fetch wrapper over the Printful v1 REST API. Mirrors the rest of the
// codebase: env-guarded, returns null / throws clearly when unconfigured, no
// extra dependency. See docs/WEB-STORE-PLAN.md.
//
// Auth: a store-level API token (PRINTFUL_API_KEY). When an account-level token
// is used instead, PRINTFUL_STORE_ID scopes requests to the right store via the
// X-PF-Store-Id header.
//
// Order flow: storefront purchases create a confirmed order at payment time
// (direct → member home); event/campaign batches create ONE confirmed order
// when the batch is committed (→ venue or school). Both reference Printful
// sync_variant_id, mapped onto store_variants.pod_sync_variant_id.

const PRINTFUL_BASE = 'https://api.printful.com'

export function printfulEnabled(): boolean {
  return Boolean(process.env.PRINTFUL_API_KEY)
}

export interface PrintfulRecipient {
  name: string
  address1: string
  address2?: string
  city: string
  state_code: string // 2-letter US state
  country_code: string // e.g. 'US'
  zip: string
  email?: string
  phone?: string
}

export interface PrintfulItem {
  sync_variant_id: number
  quantity: number
}

interface PrintfulEnvelope<T> {
  code: number
  result: T
  error?: { reason?: string; message?: string }
}

async function pf<T>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.PRINTFUL_API_KEY
  if (!key) throw new Error('Printful not configured (PRINTFUL_API_KEY)')

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }
  const storeId = process.env.PRINTFUL_STORE_ID
  if (storeId) headers['X-PF-Store-Id'] = storeId

  const res = await fetch(`${PRINTFUL_BASE}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
    cache: 'no-store',
  })

  const body = (await res.json().catch(() => null)) as PrintfulEnvelope<T> | null
  if (!res.ok || !body) {
    const reason = body?.error?.message || body?.error?.reason || `HTTP ${res.status}`
    throw new Error(`Printful ${path} failed: ${reason}`)
  }
  return body.result
}

// --- Catalog sync -----------------------------------------------------------

export interface PrintfulSyncProductSummary {
  id: number
  external_id: string
  name: string
  variants: number
  synced: number
  thumbnail_url?: string
}

export interface PrintfulSyncVariant {
  id: number // sync_variant_id — used on order lines
  external_id: string
  name: string
  sku: string | null
  retail_price: string | null
  currency: string | null
  product?: { image?: string }
}

export function listSyncProducts(): Promise<PrintfulSyncProductSummary[]> {
  return pf<PrintfulSyncProductSummary[]>('/store/products')
}

export function getSyncProduct(
  id: number,
): Promise<{ sync_product: PrintfulSyncProductSummary; sync_variants: PrintfulSyncVariant[] }> {
  return pf(`/store/products/${id}`)
}

// --- Shipping & orders ------------------------------------------------------

export interface PrintfulShippingRate {
  id: string
  name: string
  rate: string
  currency: string
  minDeliveryDays?: number
  maxDeliveryDays?: number
}

export function getShippingRates(args: {
  recipient: PrintfulRecipient
  items: PrintfulItem[]
}): Promise<PrintfulShippingRate[]> {
  return pf<PrintfulShippingRate[]>('/shipping/rates', {
    method: 'POST',
    body: JSON.stringify(args),
  })
}

export interface PrintfulOrder {
  id: number
  external_id: string | null
  status: string
  shipments?: Array<{ tracking_url?: string; tracking_number?: string }>
}

// Create an order. confirm=true submits it for fulfilment immediately; pass
// confirm=false to leave it as an editable draft (useful for previewing a
// batch before the Event Manager commits).
export function createOrder(args: {
  recipient: PrintfulRecipient
  items: PrintfulItem[]
  external_id: string
  confirm?: boolean
}): Promise<PrintfulOrder> {
  const { confirm = true, ...body } = args
  return pf<PrintfulOrder>(`/orders${confirm ? '?confirm=1' : ''}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// --- Webhook verification ---------------------------------------------------
//
// Printful v1 webhooks are not HMAC-signed; the documented practice is to put a
// secret in the configured webhook URL and verify it on receipt. We accept the
// secret either as an `x-printful-secret` header or a `secret` query param and
// match it against PRINTFUL_WEBHOOK_SECRET. Fails closed when no secret is set.
export function verifyPrintfulWebhook(request: Request): boolean {
  const expected = process.env.PRINTFUL_WEBHOOK_SECRET
  if (!expected) return false
  const headerSecret = request.headers.get('x-printful-secret')
  const url = new URL(request.url)
  const querySecret = url.searchParams.get('secret')
  return headerSecret === expected || querySecret === expected
}
