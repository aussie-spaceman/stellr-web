// Client-side shopping cart for the storefront (PRD §12). Stored in localStorage
// — the checkout API re-derives every price server-side, so the cart only holds
// what's needed to render and to name the line items. Never trust these prices.

export interface CartItem {
  variantId: string
  productSlug: string
  name: string
  label: string | null
  unitCents: number // display only
  qty: number
  image?: string | null
}

const KEY = 'stellr_cart_v1'

export function getCart(): CartItem[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]') as CartItem[]
  } catch {
    return []
  }
}

function save(items: CartItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items))
  window.dispatchEvent(new Event('cart-changed'))
}

export function addToCart(item: CartItem) {
  const items = getCart()
  const existing = items.find((i) => i.variantId === item.variantId)
  if (existing) existing.qty += item.qty
  else items.push(item)
  save(items)
}

export function setQty(variantId: string, qty: number) {
  save(getCart().map((i) => (i.variantId === variantId ? { ...i, qty } : i)).filter((i) => i.qty > 0))
}

export function removeFromCart(variantId: string) {
  save(getCart().filter((i) => i.variantId !== variantId))
}

export function clearCart() {
  if (typeof window === 'undefined') return
  save([])
}

export function cartCount(): number {
  return getCart().reduce((n, i) => n + i.qty, 0)
}
