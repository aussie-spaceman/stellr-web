'use client'

import { useEffect, useRef } from 'react'
import type { LpFaqItem } from '@/content/lp/types'

/**
 * The FAQ rows themselves.
 *
 * Server-rendered `open`, then collapsed below 768px on mount. Doing it this
 * way round is deliberate: the expanded state is what ships in the HTML, so a
 * crawler and a reader with JavaScript off both get all eight answers, and only
 * a phone with a working browser pays the collapse. The reverse — closed by
 * default, opened by script — would hide approved copy from exactly the readers
 * who cannot get it back.
 *
 * The effect mutates `open` directly rather than through React state. `open` is
 * a DOM property the user is also allowed to change by clicking, so owning it
 * in state would mean fighting the browser for control of a control that
 * already works.
 */
export function FaqList({ items }: { items: readonly LpFaqItem[] }) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!window.matchMedia('(max-width: 767px)').matches) return
    listRef.current
      ?.querySelectorAll('details')
      .forEach((row) => {
        row.open = false
      })
    // Runs once: a visitor who rotates to landscape has already chosen which
    // rows they want open, and reopening all eight under them would be rude.
  }, [])

  return (
    <div ref={listRef} className="border-t border-line">
      {items.map((item, i) => (
        <details key={item.q} open className="border-b border-line">
          <summary className="flex cursor-pointer list-none items-baseline gap-4 py-[18px] [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden="true"
              className="font-display text-ds-meta font-bold tracking-[0.06em] text-primary tabular-nums"
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="font-display text-lg font-semibold text-ink">{item.q}</span>
          </summary>
          <p className="mb-5 max-w-[46em] pl-[35px] text-ds-body leading-relaxed text-content-secondary">
            {item.a}
          </p>
        </details>
      ))}
    </div>
  )
}
