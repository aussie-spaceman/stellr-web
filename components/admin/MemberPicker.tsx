'use client'

import { useRef, useState } from 'react'

export interface PickedMember {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  membership_id?: string | number | null
}

// Type-ahead picker backed by the member database (/api/admin/members/search).
// Use anywhere an admin needs to choose a real member instead of typing an exact
// email. Calls onPick with the chosen member and clears itself.
export default function MemberPicker({
  onPick,
  placeholder = 'Search members by name or email…',
  disabled = false,
}: {
  onPick: (m: PickedMember) => void
  placeholder?: string
  disabled?: boolean
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PickedMember[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function onChange(v: string) {
    setQ(v)
    setActive(0)
    if (timer.current) clearTimeout(timer.current)
    if (v.trim().length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    setLoading(true)
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/members/search?q=${encodeURIComponent(v.trim())}`)
        const json = res.ok ? await res.json() : { members: [] }
        setResults(json.members ?? [])
        setActive(0)
        setOpen(true)
      } finally {
        setLoading(false)
      }
    }, 250)
  }

  function pick(m: PickedMember) {
    onPick(m)
    setQ('')
    setResults([])
    setActive(0)
    setOpen(false)
  }

  // Keyboard support: ArrowUp/Down to move, Enter to pick the highlighted match,
  // Escape to close. Without this, hitting Enter after typing does nothing.
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const m = results[active]
      if (m) pick(m)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const name = (m: PickedMember) =>
    [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Member'

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50"
      />
      {open && (
        <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {results.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(m)}
                className={`block w-full px-3 py-1.5 text-left text-sm ${i === active ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
              >
                <span className="font-medium text-gray-900">{name(m)}</span>
                <span className="ml-2 text-xs text-gray-400">
                  {m.email}
                  {m.membership_id ? ` · #${m.membership_id}` : ''}
                </span>
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-3 py-2 text-xs text-gray-400">{loading ? 'Searching…' : 'No matching members'}</li>
          )}
        </ul>
      )}
    </div>
  )
}
