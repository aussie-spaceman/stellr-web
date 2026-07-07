'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

// Conflicts sidebar (Rules tab): members who reach the same object twice —
// on the roster AND as a manager (access_redundancy_audit, migration 125).

interface Conflict {
  memberName: string
  object_type: string
  object_id: string
  roster_role: string
  manager_role: string
}

export function ConflictsPanel() {
  const [rows, setRows] = useState<Conflict[] | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/admin/access/conflicts')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => active && setRows(j?.conflicts ?? []))
    return () => { active = false }
  }, [])

  return (
    <aside>
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-brand-blue-dark">
        <AlertTriangle className="h-4 w-4 text-amber-500" /> Conflicts
      </h2>
      {!rows ? (
        <p className="text-xs text-brand-muted-soft">Checking…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-brand-muted-soft">No redundant roster/manager pairings.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((c, i) => (
            <li key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
              <span className="font-medium text-brand-blue-dark">{c.memberName}</span>{' '}
              is both <b>{c.roster_role}</b> and <b>{c.manager_role}</b> on {c.object_type}{' '}
              <span className="text-brand-muted-soft">{c.object_id.slice(0, 8)}…</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
