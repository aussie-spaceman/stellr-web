'use client'

import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface CalendarSession {
  id: string
  title: string | null
  scheduled_start: string
  status: string
}

export function SessionCalendar({ sessions }: { sessions: CalendarSession[] }) {
  const [offset, setOffset] = useState(0)
  const today = new Date()
  const viewDate = new Date(today.getFullYear(), today.getMonth() + offset, 1)
  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()

  const byDay = useMemo(() => {
    const map = new Map<number, CalendarSession[]>()
    for (const s of sessions) {
      const d = new Date(s.scheduled_start)
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate()
        if (!map.has(day)) map.set(day, [])
        map.get(day)!.push(s)
      }
    }
    return map
  }, [sessions, year, month])

  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startDay = new Date(year, month, 1).getDay()
  const cells: (number | null)[] = Array.from({ length: startDay }, () => null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const monthLabel = viewDate.toLocaleString('en-AU', { month: 'long', year: 'numeric' })
  const todayDate = today.getDate()
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button onClick={() => setOffset(offset - 1)} className="rounded p-1 hover:bg-brand-hairline">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold text-brand-muted">{monthLabel}</span>
        <button onClick={() => setOffset(offset + 1)} className="rounded p-1 hover:bg-brand-hairline">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-px text-center text-xs">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <div key={d} className="py-1 font-medium text-brand-muted-soft">{d}</div>
        ))}
        {cells.map((day, i) => {
          const daySessionList = day ? byDay.get(day) : undefined
          const isToday = isCurrentMonth && day === todayDate
          return (
            <div
              key={i}
              className={`relative min-h-[2.5rem] rounded p-1 ${isToday ? 'bg-brand-blue/5' : ''}`}
              title={daySessionList?.map((s) => s.title ?? 'Session').join(', ')}
            >
              {day && (
                <>
                  <span className={`text-xs ${isToday ? 'font-bold text-brand-blue' : 'text-brand-muted'}`}>{day}</span>
                  {daySessionList && (
                    <div className="mt-0.5 flex justify-center gap-0.5">
                      {daySessionList.slice(0, 3).map((s) => (
                        <span
                          key={s.id}
                          className={`inline-block h-1.5 w-1.5 rounded-full ${
                            s.status === 'completed' ? 'bg-green-400' : s.status === 'cancelled' ? 'bg-brand-border' : 'bg-brand-blue'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
