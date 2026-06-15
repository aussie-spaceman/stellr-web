'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import type { ObjectType } from '@/lib/object-roles'

export interface ObjectRoleAssignment {
  id: string
  member_id: string
  name?: string | null
  email?: string | null
}

// Reusable manager assigner for any object (event / group / container) — the
// single object_roles-backed widget that replaces the bespoke per-event one.
// Drop it onto an object's admin page; grants are explicit and auditable.
export default function ObjectRoleAssignments({
  objectType,
  objectId,
  initialAssignments,
  label = 'Managers',
}: {
  objectType: ObjectType
  objectId: string
  initialAssignments: ObjectRoleAssignment[]
  label?: string
}) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    if (!email.trim()) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/admin/object-roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), objectType, objectId }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.error ?? 'Failed to add manager')
      return
    }
    setEmail('')
    router.refresh()
  }

  async function remove(id: string) {
    setBusy(true)
    await fetch('/api/admin/object-roles', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {initialAssignments.length === 0 && (
          <span className="text-sm text-gray-400">No managers assigned.</span>
        )}
        {initialAssignments.map((a) => (
          <span
            key={a.id}
            className="inline-flex items-center gap-1 rounded-full bg-indigo-50 py-0.5 pl-3 pr-1 text-xs font-medium text-indigo-700"
          >
            {a.name?.trim() || a.email || 'Member'}
            <button
              onClick={() => remove(a.id)}
              disabled={busy}
              aria-label="Remove manager"
              className="hover:text-indigo-900 disabled:opacity-50"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="member@email.com"
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
        <button
          onClick={add}
          disabled={busy || !email.trim()}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}
