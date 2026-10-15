'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'

/**
 * Expanding search for the app header: a magnifying-glass icon that opens a
 * text field when clicked. Enter submits to the community search page; Esc or
 * focus loss collapses it back to the icon.
 *
 * From sm the field grows leftward inside the bar. On a phone the bar has no
 * room for it (it needed ~396px of a 327px bar), so the open field takes its
 * own full-width row under the bar instead.
 */
export function AppSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const expand = () => {
    // Focus inside the tap itself: iOS only raises the keyboard for a focus
    // that happens during the tap. The field is collapsed but still in the
    // page, so it can take focus before it opens.
    inputRef.current?.focus({ preventScroll: true })
    setOpen(true)
    // And again once it's open, in case the browser wouldn't focus it collapsed.
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
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
        className={
          open
            ? // Phone: a row of its own, full width under the bar (the header is
              // the positioned ancestor). From sm: inline, grown to 14rem.
              'absolute inset-x-0 top-full border-b border-line bg-white px-4 py-2 shadow-card ' +
              'sm:static sm:w-56 sm:border-0 sm:bg-transparent sm:p-0 sm:opacity-100 sm:shadow-none sm:transition-all sm:duration-200 sm:ease-out'
            : 'w-0 overflow-hidden opacity-0 sm:transition-all sm:duration-200 sm:ease-out'
        }
      >
        <input
          ref={inputRef}
          type="search"
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={collapse}
          onKeyDown={(e) => e.key === 'Escape' && collapse()}
          placeholder="Search…"
          aria-label="Search the community"
          // Collapsed, the field is out of the tab order; the icon opens it.
          tabIndex={open ? 0 : -1}
          className="w-full rounded-md border border-line-strong px-3 py-1.5 text-input mouse:text-sm text-brand-grey-dark placeholder:text-content-faint focus:border-brand-blue focus:outline-none"
        />
      </div>
      {open ? (
        <button
          type="submit"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-content-muted hover:bg-surface hover:text-content-body"
          aria-label="Submit search"
          // Runs before the input's blur collapses the field
          onMouseDown={(e) => e.preventDefault()}
        >
          <Search className="h-5 w-5" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          onClick={expand}
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-content-muted hover:bg-surface hover:text-content-body"
          aria-label="Open search"
        >
          <Search className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
    </form>
  )
}
