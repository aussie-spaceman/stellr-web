'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import type { TrainableObject, ObjectType } from '@/lib/training-admin'

// Searchable, scrollable combobox over every trainable Object, grouped by type.
// Stays usable as the list grows (panel max-height 240px, type-to-filter).

const GROUP_ORDER: { type: ObjectType; label: string }[] = [
  { type: 'competition', label: 'Competitions' },
  { type: 'campaign', label: 'Campaigns' },
  { type: 'cohort', label: 'Cohorts' },
  { type: 'workshop', label: 'Workshops' },
  { type: 'space', label: 'Spaces' },
]

export function ObjectPicker({
  objects,
  value,
  onChange,
}: {
  objects: TrainableObject[]
  value: string | null
  onChange: (ref: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const current = objects.find((o) => o.ref === value)
  const q = query.trim().toLowerCase()
  const matches = objects.filter((o) => q === '' || o.label.toLowerCase().includes(q))

  return (
    <div ref={ref} className="relative w-full max-w-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-brand-border bg-white px-3 py-2.5 text-sm font-medium text-brand-blue-dark hover:border-brand-blue"
      >
        <span className="truncate">{current?.label ?? 'Select an Object'}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-brand-muted-soft" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-brand-border bg-white shadow-[0_18px_40px_-30px_rgba(20,26,61,.4)]">
          <div className="relative border-b border-brand-hairline p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted-soft" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Objects"
              aria-label="Search Objects"
              className="w-full rounded-lg border border-brand-border py-2 pl-9 pr-3 text-sm focus:border-brand-blue focus:outline-none"
            />
          </div>
          <div className="max-h-[240px] overflow-y-auto p-1" role="listbox">
            {GROUP_ORDER.map(({ type, label }) => {
              const items = matches.filter((o) => o.type === type)
              if (items.length === 0) return null
              return (
                <div key={type}>
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-brand-muted-soft">
                    {label}
                  </p>
                  {items.map((o) => (
                    <button
                      key={`${o.type}-${o.ref}`}
                      role="option"
                      aria-selected={o.ref === value}
                      onClick={() => {
                        onChange(o.ref)
                        setOpen(false)
                        setQuery('')
                      }}
                      className={`block w-full truncate rounded-lg px-3 py-2 text-left text-sm transition hover:bg-brand-canvas ${
                        o.ref === value ? 'font-semibold text-brand-blue-dark' : 'text-brand-muted'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )
            })}
            {matches.length === 0 && (
              <p className="px-3 py-4 text-sm text-brand-muted-soft">No Objects match “{query}”.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
