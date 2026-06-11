'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface CompanyRow {
  id: string
  number: number
  name: string | null
  count: number
}

export default function EventCompanies({
  eventSlug,
  companies,
  studentCount,
}: {
  eventSlug: string
  companies: CompanyRow[]
  studentCount: number
}) {
  const router = useRouter()
  const [count, setCount] = useState(companies.length || 2)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [names, setNames] = useState<Record<string, string>>(
    Object.fromEntries(companies.map((c) => [c.id, c.name ?? '']))
  )

  const api = `/api/admin/events/${eventSlug}/companies`

  async function call(init: RequestInit) {
    setBusy(true)
    setError(null)
    const res = await fetch(api, { headers: { 'Content-Type': 'application/json' }, ...init })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.error ?? 'Request failed')
      return false
    }
    router.refresh()
    return true
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Companies</h3>
        <span className="text-xs text-gray-400">{studentCount} students to assign</span>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-sm text-gray-600">Number of companies</label>
          <input
            type="number"
            min={1}
            max={10}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
          />
          <button
            onClick={() => call({ method: 'PUT', body: JSON.stringify({ count }) })}
            disabled={busy || count < 1 || count > 10}
            className="text-sm font-medium border border-gray-300 rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Set
          </button>
          <button
            onClick={async () => {
              if (
                companies.some((c) => c.count > 0) &&
                !window.confirm('Re-running auto-assign will overwrite existing company assignments. Continue?')
              )
                return
              await call({ method: 'POST', body: JSON.stringify({ action: 'auto_assign' }) })
            }}
            disabled={busy || companies.length === 0 || studentCount === 0}
            className="text-sm font-medium bg-indigo-600 text-white rounded-lg px-3 py-1.5 disabled:opacity-50"
          >
            Auto-Assign Students
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {companies.length === 0 ? (
        <p className="text-sm text-gray-400">Set the number of companies (1–10) to get started.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {companies.map((c) => (
            <div key={c.id} className="border border-gray-200 rounded-lg p-3 space-y-1.5">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase">Company {c.number}</span>
                <span className="text-sm font-bold text-gray-900 tabular-nums">{c.count}</span>
              </div>
              <input
                type="text"
                placeholder="Optional name"
                value={names[c.id] ?? ''}
                onChange={(e) => setNames((n) => ({ ...n, [c.id]: e.target.value }))}
                onBlur={() => {
                  if ((names[c.id] ?? '') !== (c.name ?? '')) {
                    call({ method: 'POST', body: JSON.stringify({ action: 'rename', companyId: c.id, name: names[c.id] }) })
                  }
                }}
                className="w-full border border-gray-200 rounded px-2 py-1 text-sm"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
