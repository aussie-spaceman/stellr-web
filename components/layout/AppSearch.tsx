'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'

/**
 * Expanding search for the app header: a magnifying-glass icon that grows
 * leftward into a text field when clicked. Enter submits to the community
 * search page; Esc or focus loss collapses it back to the icon.
 */
export function AppSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const expand = () => {
    setOpen(true)
    // Wait for the input to mount before focusing
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const collapse = () => {
    setOpen(false)
    setQuery('')
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    router.push(`/community/search?q=${encodeURIComponent(q)}`)
    collapse()
  }

  return (
    <form onSubmit={submit} className="flex items-center justify-end" role="search">
      <div
        className={`overflow-hidden transition-all duration-200 ease-out ${
          open ? 'w-44 sm:w-56 opacity-100' : 'w-0 opacity-0'
        }`}
      >
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={collapse}
          onKeyDown={(e) => e.key === 'Escape' && collapse()}
          placeholder="Search…"
          aria-label="Search the community"
          className="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm text-brand-grey-dark placeholder:text-gray-400 focus:border-brand-blue focus:outline-none"
        />
      </div>
      {open ? (
        <button
          type="submit"
          className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Submit search"
          // Runs before the input's blur collapses the field
          onMouseDown={(e) => e.preventDefault()}
        >
          <Search className="h-5 w-5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={expand}
          className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Open search"
        >
          <Search className="h-5 w-5" />
        </button>
      )}
    </form>
  )
}
