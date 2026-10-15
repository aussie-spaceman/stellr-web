'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@stellr/web-ui'
import { tokens } from '@/lib/tokens'

export type CalendarEntry = {
  id: string
  /** ISO start time */
  start: string
  href: string
  /** Who or what the entry is for: shown on the chip and in the key. */
  groupKey: string
  groupLabel: string
  /** The session's own title, shown in the agenda and to screen readers. */
  title: string | null
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
// One colour per group, from the brand palette. It marks the chip's edge only:
// text stays ink on white, so it reads whatever the colour.
const PALETTE = [
  tokens.color.spaceViolet,
  tokens.color.primary,
  tokens.color.enviroGreen,
  tokens.color.pathwayAmber,
  tokens.color.avatarTeal,
  tokens.color.danger,
  tokens.color.primaryDeep,
  tokens.themeTint.enviroText,
]
const GRID_VISIBLE = 3

const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })

/**
 * Month view of sessions. Below md it is an agenda (one row per session,
 * grouped by day), because a seven-column grid on a phone leaves each day
 * about 45px wide. From md it is the month grid; a busy day's "+N more" opens
 * that day in place.
 */
export function MonthCalendar({ entries, emptyLabel = 'No sessions this month.' }: { entries: CalendarEntry[]; emptyLabel?: string }) {
  const today = useMemo(() => new Date(), [])
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() })
  const [openDay, setOpenDay] = useState<number | null>(null)

  const colorOf = useMemo(() => {
    const map = new Map<string, string>()
    let i = 0
    for (const e of entries) if (!map.has(e.groupKey)) map.set(e.groupKey, PALETTE[i++ % PALETTE.length])
    return map
  }, [entries])

  const inMonth = useMemo(
    () =>
      entries
        .filter((e) => {
          const d = new Date(e.start)
          return d.getFullYear() === cursor.y && d.getMonth() === cursor.m
        })
        .sort((a, b) => a.start.localeCompare(b.start)),
    [entries, cursor]
  )

  const byDay = useMemo(() => {
    const map = new Map<number, CalendarEntry[]>()
    for (const e of inMonth) {
      const day = new Date(e.start).getDate()
      if (!map.has(day)) map.set(day, [])
      map.get(day)!.push(e)
    }
    return map
  }, [inMonth])

  const first = new Date(cursor.y, cursor.m, 1)
  const startOffset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const move = (delta: number) => {
    const m = cursor.m + delta
    setCursor({ y: cursor.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 })
    setOpenDay(null)
  }

  const groupsInView = [...new Map(inMonth.map((e) => [e.groupKey, e.groupLabel])).entries()]
  const isToday = (d: number) => cursor.y === today.getFullYear() && cursor.m === today.getMonth() && d === today.getDate()

  const chip = (e: CalendarEntry) => (
    <Link
      key={e.id}
      href={e.href}
      className="block min-h-6 truncate rounded border-l-4 bg-surface px-1.5 py-0.5 text-xs font-medium text-ink hover:bg-line-light"
      style={{ borderLeftColor: colorOf.get(e.groupKey) }}
      aria-label={`${timeFmt.format(new Date(e.start))}, ${e.groupLabel}${e.title ? ` · ${e.title}` : ''}`}
    >
      {timeFmt.format(new Date(e.start))} {e.groupLabel}
    </Link>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        <button
          onClick={() => move(-1)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-control text-content-secondary hover:bg-surface"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <h2 className="min-w-[10rem] text-center font-display text-lg font-bold text-ink" aria-live="polite">
          {monthFmt.format(first)}
        </h2>
        <button
          onClick={() => move(1)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-control text-content-secondary hover:bg-surface"
          aria-label="Next month"
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      </div>

      {/* Phones: agenda */}
      <div className="md:hidden">
        {inMonth.length === 0 ? (
          <p className="rounded-ds-card border border-line bg-white px-4 py-6 text-center text-sm text-content-muted">{emptyLabel}</p>
        ) : (
          <ol className="space-y-4">
            {[...byDay.entries()].map(([day, items]) => (
              <li key={day}>
                <h3 className={cn('mb-1.5 text-sm font-semibold', isToday(day) ? 'text-space-violet-text' : 'text-content-body')}>
                  {dayFmt.format(new Date(cursor.y, cursor.m, day))}
                  {isToday(day) && ' · Today'}
                </h3>
                <ul className="overflow-hidden rounded-ds-card border border-line bg-white">
                  {items.map((e) => (
                    <li key={e.id} className="border-b border-line-light last:border-b-0">
                      <Link
                        href={e.href}
                        className="flex min-h-11 items-center gap-3 border-l-4 px-3 py-2"
                        style={{ borderLeftColor: colorOf.get(e.groupKey) }}
                      >
                        <span className="w-16 shrink-0 text-sm tabular-nums text-content-muted">{timeFmt.format(new Date(e.start))}</span>
                        <span className="min-w-0">
                          <span className="block break-words text-sm font-medium text-ink">{e.groupLabel}</span>
                          {e.title && <span className="block break-words text-xs text-content-muted">{e.title}</span>}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Tablets and up: month grid */}
      <div className="hidden overflow-hidden rounded-card border border-line bg-white md:block">
        <div className="grid grid-cols-7 border-b border-line-light bg-surface">
          {WEEKDAYS.map((w) => (
            <div key={w} className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-[0.05em] text-content-muted">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const items = d != null ? byDay.get(d) ?? [] : []
            const expanded = d != null && openDay === d
            const shown = expanded ? items : items.slice(0, GRID_VISIBLE)
            return (
              <div key={i} className="min-h-[90px] min-w-0 border-b border-r border-line-light p-1.5 [&:nth-child(7n)]:border-r-0">
                {d != null && (
                  <>
                    <span
                      className={cn(
                        'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs',
                        isToday(d) ? 'bg-space-violet font-bold text-white' : 'text-content-muted'
                      )}
                    >
                      {d}
                    </span>
                    <div className="mt-1 space-y-1">
                      {shown.map(chip)}
                      {items.length > GRID_VISIBLE && (
                        <button
                          type="button"
                          onClick={() => setOpenDay(expanded ? null : d)}
                          aria-expanded={expanded}
                          className="min-h-6 px-1 text-xs font-medium text-primary-deep hover:underline"
                        >
                          {expanded ? 'Show fewer' : `+${items.length - GRID_VISIBLE} more`}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {groupsInView.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Key">
          {groupsInView.map(([key, label]) => (
            <li key={key} className="inline-flex items-center gap-1.5 text-sm text-content-secondary">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf.get(key) }} aria-hidden /> {label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
