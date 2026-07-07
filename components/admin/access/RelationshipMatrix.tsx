'use client'

import { useEffect, useState } from 'react'

// The 7×7 object-type relationship grid (object_type_relations). Row type "may
// attach" column type; click a cell to toggle. Server-side, lib/access-objects
// attachAllowed() reads the same table before every attach write.

const TYPES = ['event', 'campaign', 'space', 'course', 'resource', 'workshop', 'cohort'] as const

type Cell = { from_type: string; to_type: string; allowed: boolean }

export function RelationshipMatrix() {
  const [cells, setCells] = useState<Map<string, boolean> | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/admin/access/relations')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!active || !j?.relations) return
        setCells(new Map((j.relations as Cell[]).map((c) => [`${c.from_type}:${c.to_type}`, c.allowed])))
      })
    return () => { active = false }
  }, [])

  const toggle = async (from: string, to: string) => {
    if (!cells || from === to) return
    const key = `${from}:${to}`
    const next = !(cells.get(key) ?? false)
    setCells(new Map(cells).set(key, next))
    const res = await fetch('/api/admin/access/relations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromType: from, toType: to, allowed: next }),
    })
    if (!res.ok) setCells(new Map(cells).set(key, !next)) // revert on failure
  }

  if (!cells) return <p className="text-xs text-brand-muted-soft">Loading matrix…</p>

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="p-1.5 text-left text-brand-muted-soft font-normal">may attach →</th>
            {TYPES.map((t) => (
              <th key={t} className="p-1.5 text-brand-muted font-medium capitalize">{t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TYPES.map((from) => (
            <tr key={from}>
              <th className="p-1.5 text-left text-brand-muted font-medium capitalize">{from}</th>
              {TYPES.map((to) => {
                const allowed = cells.get(`${from}:${to}`) ?? false
                const self = from === to
                return (
                  <td key={to} className="p-1">
                    <button
                      onClick={() => toggle(from, to)}
                      disabled={self}
                      aria-label={`${from} may attach ${to}: ${allowed ? 'yes' : 'no'}`}
                      className={
                        'h-7 w-10 rounded-md border text-[11px] font-medium ' +
                        (self
                          ? 'border-brand-hairline bg-brand-canvas text-brand-muted-soft cursor-default'
                          : allowed
                            ? 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100'
                            : 'border-brand-hairline bg-white text-brand-muted-soft hover:bg-brand-canvas')
                      }
                    >
                      {self ? '—' : allowed ? '✓' : '·'}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
