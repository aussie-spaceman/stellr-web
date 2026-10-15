'use client'

import { Children, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { EventsFilterBar, type EventFilters } from './EventsFilterBar'

/** What the board needs to know about each card to filter it. */
export type BoardItem = {
  kind: 'event' | 'campaign'
  theme: string
  /** Matches the Middle School / High School chips. */
  middle: boolean
  high: boolean
}

const EMPTY: EventFilters = { theme: '', location: '', grade: '' }

function readFilters(): EventFilters {
  const p = new URLSearchParams(window.location.search)
  return { theme: p.get('theme') ?? '', location: p.get('location') ?? '', grade: p.get('grade') ?? '' }
}

function visible(item: BoardItem, f: EventFilters): boolean {
  if (f.location && f.location !== item.kind) return false
  if (f.theme && f.theme !== item.theme) return false
  if (f.grade === 'Middle School' && !item.middle) return false
  if (f.grade === 'High School' && !item.high) return false
  return true
}

/**
 * The /events board: the filter chips and the card grid. The server renders
 * every card (so the page can be cached and the cards are in the HTML); the
 * filters hide and show them here, keep the choice in the URL so a filtered
 * link still works, and never reload the page.
 */
export function EventsBoard({ items, children }: { items: BoardItem[]; children: React.ReactNode }) {
  const cards = Children.toArray(children)
  const [filters, setFilters] = useState<EventFilters>(EMPTY)

  // A shared or bookmarked filtered link: apply it after hydration.
  useEffect(() => setFilters(readFilters()), [])

  const change = (next: EventFilters) => {
    setFilters(next)
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v)
    const qs = p.toString()
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }

  const shown = useMemo(() => items.map((it) => visible(it, filters)), [items, filters])
  const count = shown.filter(Boolean).length

  return (
    <>
      <section className="border-b border-line bg-surface px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-content">
          <EventsFilterBar value={filters} onChange={change} />
        </div>
      </section>

      <section className="bg-white px-4 pb-20 pt-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-content">
          <p className="sr-only" role="status">
            {count} {count === 1 ? 'result' : 'results'}
          </p>
          {count > 0 ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {cards.map((card, i) => (shown[i] ? card : null))}
              <Link
                href="/host-an-event"
                className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-line px-5 py-8 text-center text-sm text-content-muted hover:border-primary hover:text-primary-deep"
              >
                More live Events are added each term.
                <span className="mt-1 font-semibold">Host one at your school →</span>
              </Link>
            </div>
          ) : (
            <div className="py-16 text-center text-content-muted">
              <p className="text-lg">No events or campaigns match your filters.</p>
              <button type="button" onClick={() => change(EMPTY)} className="mt-4 min-h-11 text-sm text-primary-deep hover:underline">
                Clear filters
              </button>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
