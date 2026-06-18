'use client'

import { useEffect } from 'react'
import { clearCart } from '@/lib/store/cart-client'

// Empties the cart after a successful checkout (rendered on the success page).
export function ClearCartOnLoad() {
  useEffect(() => {
    clearCart()
  }, [])
  return null
}
