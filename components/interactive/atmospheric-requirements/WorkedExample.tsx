'use client'

import * as React from 'react'
import { ChevronDown } from 'lucide-react'

// A reveal-able worked solution. Students try the problem, then open the working.
export function WorkedExample({
  prompt,
  children,
}: {
  prompt: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <div className="rounded-panel border border-line bg-white p-6">
      <p className="text-content-secondary leading-relaxed">{prompt}</p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-4 inline-flex items-center gap-2 rounded-control border border-primary px-4 py-2 text-sm font-semibold text-primary hover:bg-primary-soft"
        aria-expanded={open}
      >
        {open ? 'Hide solution' : 'Show solution'}
        <ChevronDown size={16} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>
      {open && (
        <div className="mt-4 rounded-ds-card bg-surface border border-line p-5 text-sm text-content-secondary leading-relaxed space-y-2">
          {children}
        </div>
      )}
    </div>
  )
}
