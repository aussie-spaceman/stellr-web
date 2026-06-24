'use client'

import { useRef, useState } from 'react'
import { X } from 'lucide-react'

export interface PickedPerson {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
}

function personName(m: PickedPerson): string {
  return [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email || 'Member'
}

// V2-styled type-ahead member picker with selected chips. `endpoint` lets it back
// onto either the mentor (/api/community/members/search) or admin search.
export function MemberSearchField({
  endpoint = '/api/community/members/search',
  selected,
  onChange,
  placeholder = 'Search members by name or email…',
}: {
  endpoint?: string
  selected: PickedPerson[]
  onChange: (next: PickedPerson[]) => void
  placeholder?: string
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PickedPerson[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = (v: string) => {
    setQ(v)
    if (timer.current) clearTimeout(timer.current)
    if (v.trim().length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    setLoading(true)
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${endpoint}?q=${encodeURIComponent(v.trim())}`)
        const json = res.ok ? await res.json() : { members: [] }
        setResults(json.members ?? [])
        setOpen(true)
      } finally {
        setLoading(false)
      }
    }, 250)
  }

  const add = (m: PickedPerson) => {
    if (!selected.some((s) => s.id === m.id)) onChange([...selected, m])
    setQ('')
    setResults([])
    setOpen(false)
  }
  const remove = (id: string) => onChange(selected.filter((s) => s.id !== id))

  return (
    <div>
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((m) => (
            <span key={m.id} className="inline-flex items-center gap-1.5 rounded-pill bg-space-violet-chip px-2.5 py-1 text-[12.5px] font-medium text-space-violet-text">
              {personName(m)}
              <button type="button" onClick={() => remove(m.id)} aria-label="Remove">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          value={q}
          onChange={(e) => search(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className="w-full rounded-[9px] border border-line px-3.5 py-2.5 text-sm text-content outline-none focus:border-space-violet"
        />
        {open && (
          <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-[12px] border border-line bg-white py-1 shadow-card-lift">
            {results.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add(m)}
                  className="block w-full px-3.5 py-2 text-left text-sm hover:bg-surface"
                >
                  <span className="font-medium text-ink">{personName(m)}</span>
                  {m.email && <span className="ml-2 text-xs text-content-muted">{m.email}</span>}
                </button>
              </li>
            ))}
            {results.length === 0 && (
              <li className="px-3.5 py-2 text-xs text-content-muted">{loading ? 'Searching…' : 'No matching members'}</li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
