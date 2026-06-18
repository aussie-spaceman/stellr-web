'use client'

import { useState } from 'react'
import { CheckCircle2, Circle } from 'lucide-react'

export interface ActionItem {
  id: string
  title: string
  is_done: boolean
  due_date?: string | null
  module_title?: string | null
}

// Member-facing checklist of actions a coach/mentor set (FR-COM-11/12).
export function ActionChecklist({ actions }: { actions: ActionItem[] }) {
  const [items, setItems] = useState(actions)
  const [busy, setBusy] = useState<string | null>(null)

  const toggle = async (item: ActionItem) => {
    const next = !item.is_done
    setBusy(item.id)
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, is_done: next } : i)))
    try {
      const res = await fetch('/api/community/sessions/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: item.id, done: next }),
      })
      if (!res.ok) {
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, is_done: !next } : i)))
      }
    } finally {
      setBusy(null)
    }
  }

  if (items.length === 0) {
    return <p className="text-sm text-gray-400">No actions assigned.</p>
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-2">
          <button onClick={() => toggle(item)} disabled={busy === item.id} className="shrink-0">
            {item.is_done ? (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            ) : (
              <Circle className="h-5 w-5 text-gray-300" />
            )}
          </button>
          <span className={`text-sm ${item.is_done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
            {item.title}
            {item.module_title && (
              <span className="ml-1.5 text-xs text-indigo-500">📘 {item.module_title}</span>
            )}
            {item.due_date && !item.is_done && (
              <span
                className={`ml-1.5 text-xs ${
                  new Date(item.due_date).getTime() < Date.now() ? 'text-red-500' : 'text-gray-400'
                }`}
              >
                due {new Date(item.due_date).toLocaleDateString()}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}
