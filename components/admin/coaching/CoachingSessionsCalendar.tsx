'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { CoachingCalendarSession } from '@/lib/coaching'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
// Stable palette assigned per member so each member's session chips share a colour.
const PALETTE = ['#7C5CFC', '#3C6DF6', '#1FA97A', '#E0922F', '#16B6C4', '#D9433C', '#5B3FE0', '#0F6A4C']

export function CoachingSessionsCalendar({ sessions }: { sessions: CoachingCalendarSession[] }) {
  const today = useMemo(() => new Date(), [])
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() })

  // Colour key = member (per-member colour chips).
  const keyOf = (s: CoachingCalendarSession) => s.memberName ?? s.workshopId
  const colorByMember = useMemo(() => {
    const map = new Map<string, string>()
    let i = 0
    for (const s of sessions) { const k = keyOf(s); if (!map.has(k)) map.set(k, PALETTE[i++ % PALETTE.length]) }
    return map
  }, [sessions])

  const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date(cursor.y, cursor.m, 1))
  const first = new Date(cursor.y, cursor.m, 1)
  const startOffset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const byDay = useMemo(() => {
    const map = new Map<number, CoachingCalendarSession[]>()
    for (const s of sessions) {
      const d = new Date(s.start)
      if (d.getFullYear() === cursor.y && d.getMonth() === cursor.m) {
        const day = d.getDate()
        if (!map.has(day)) map.set(day, [])
        map.get(day)!.push(s)
      }
    }
    return map
  }, [sessions, cursor])

  const move = (delta: number) => {
    const m = cursor.m + delta
    setCursor({ y: cursor.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 })
  }

  const membersInView = [...new Set(sessions.filter((s) => { const d = new Date(s.start); return d.getFullYear() === cursor.y && d.getMonth() === cursor.m }).map(keyOf))]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => move(-1)} className="rounded-md p-1.5 text-content-secondary hover:bg-surface" aria-label="Previous month"><ChevronLeft className="h-5 w-5" /></button>
        <span className="font-display text-[18px] font-bold text-ink">{monthLabel}</span>
        <button onClick={() => move(1)} className="rounded-md p-1.5 text-content-secondary hover:bg-surface" aria-label="Next month"><ChevronRight className="h-5 w-5" /></button>
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-white">
        <div className="grid grid-cols-7 border-b border-line-light bg-surface">
          {WEEKDAYS.map((w) => (
            <div key={w} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.05em] text-content-faint">{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const isToday = d != null && cursor.y === today.getFullYear() && cursor.m === today.getMonth() && d === today.getDate()
            const items = d != null ? byDay.get(d) ?? [] : []
            return (
              <div key={i} className="min-h-[90px] border-b border-r border-line-light p-1.5 last:border-r-0 [&:nth-child(7n)]:border-r-0">
                {d != null && (
                  <>
                    <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[12px] ${isToday ? 'bg-space-violet font-bold text-white' : 'text-content-muted'}`}>{d}</span>
                    <div className="mt-1 space-y-1">
                      {items.slice(0, 3).map((s) => {
                        const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(s.start))
                        return (
                          <Link
                            key={s.id}
                            href={`/admin/academy/coaching/${s.workshopId}`}
                            className="block truncate rounded px-1.5 py-0.5 text-[10.5px] font-medium text-white"
                            style={{ background: colorByMember.get(keyOf(s)) }}
                            title={`${s.memberName ?? s.workshopName} · ${s.title ?? 'Session'}`}
                          >
                            {time} {s.memberName ?? s.workshopName}
                          </Link>
                        )
                      })}
                      {items.length > 3 && <span className="px-1 text-[10px] text-content-faint">+{items.length - 3} more</span>}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {membersInView.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {membersInView.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5 text-[12.5px] text-content-secondary">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorByMember.get(k) }} /> {k}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
