'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, AlertCircle } from 'lucide-react'

// Transient confirmation toast: bottom-center, dark navy pill, green check,
// auto-dismiss ~2.8s. Module-level pub/sub so any client component can fire a
// toast via `toast('Saved')` without threading a context. <Toaster /> is mounted
// once in the community layout.
//
// Optional second argument: `{ tone: 'error' }` swaps the check for a warning
// glyph; `{ action: { label, href } }` renders a link and holds the toast open
// longer so it can be clicked (e.g. "Go to space →" after joining).

export interface ToastAction {
  label: string
  href: string
}

export interface ToastOptions {
  tone?: 'success' | 'error'
  action?: ToastAction
}

interface ToastItem {
  id: number
  msg: string
  tone: 'success' | 'error'
  action?: ToastAction
}

type Listener = (item: Omit<ToastItem, 'id'>) => void
const listeners = new Set<Listener>()

export function toast(message: string, options: ToastOptions = {}) {
  const item = { msg: message, tone: options.tone ?? 'success', action: options.action }
  listeners.forEach((l) => l(item))
}

let counter = 0

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    const l: Listener = (item) => {
      const id = ++counter
      setItems((cur) => [...cur, { id, ...item }])
      // Toasts with an action stay up long enough to click it.
      const ttl = item.action ? 6000 : 2800
      setTimeout(() => setItems((cur) => cur.filter((i) => i.id !== id)), ttl)
    }
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2">
      {items.map((i) => (
        <div
          key={i.id}
          className="pointer-events-auto flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white shadow-lg"
          role="status"
        >
          {i.tone === 'error' ? (
            <AlertCircle className="h-4 w-4 shrink-0 text-star-gold" />
          ) : (
            <Check className="h-4 w-4 shrink-0 text-enviro-green" />
          )}
          {i.msg}
          {i.action && (
            <Link
              href={i.action.href}
              className="ml-1 whitespace-nowrap px-1 py-2 font-semibold text-star-gold underline underline-offset-2 hover:text-white"
            >
              {i.action.label}
            </Link>
          )}
        </div>
      ))}
    </div>
  )
}
