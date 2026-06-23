'use client'

import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'

// Transient confirmation toast: bottom-center, dark navy pill, green check,
// auto-dismiss ~2.8s. Module-level pub/sub so any client component can fire a
// toast via `toast('Saved')` without threading a context. <Toaster /> is mounted
// once in the community layout.

type Listener = (msg: string) => void
const listeners = new Set<Listener>()

export function toast(message: string) {
  listeners.forEach((l) => l(message))
}

let counter = 0

export function Toaster() {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([])

  useEffect(() => {
    const l: Listener = (msg) => {
      const id = ++counter
      setItems((cur) => [...cur, { id, msg }])
      setTimeout(() => setItems((cur) => cur.filter((i) => i.id !== id)), 2800)
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
          className="pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-white shadow-lg"
          style={{ background: '#13183A' }}
          role="status"
        >
          <Check className="h-4 w-4" style={{ color: '#1FA97A' }} />
          {i.msg}
        </div>
      ))}
    </div>
  )
}
