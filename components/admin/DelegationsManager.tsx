'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import type { ObjectType } from '@/lib/object-roles'

export interface Delegation {
  id: string
  object_type: ObjectType
  object_id: string
  role: string
  member_name: string | null
  member_email: string | null
}

const OBJECT_TYPES: ObjectType[] = ['event', 'group', 'container']

// Central oversight of the "manage" axis: every explicit object_roles grant,
// grouped by object, plus a form to grant new ones. Platform admins / Event
// Managers are set in Clerk (role metadata) — noted, not managed here.
export default function DelegationsManager({ initial }: { initial: Delegation[] }) {
  const router = useRouter()
  const [objectType, setObjectType] = useState<ObjectType>('group')
  const [objectId, setObjectId] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function grant() {
    if (!objectId.trim() || !email.trim()) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/admin/object-roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), objectType, objectId: objectId.trim() }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.error ?? 'Failed to grant')
      return
    }
    setObjectId('')
    setEmail('')
    router.refresh()
  }

  async function revoke(id: string) {
    setBusy(true)
    await fetch('/api/admin/object-roles', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setBusy(false)
    router.refresh()
  }

  // Group grants by object so each event/group/container reads as one row.
  const groups = initial.reduce<Record<string, Delegation[]>>((acc, d) => {
    ;(acc[`${d.object_type}:${d.object_id}`] ??= []).push(d)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
        Platform admins and Event Managers are set in Clerk (role metadata) — the platform-wide RBAC
        axis. The grants below are object-scoped: full read/write over a single event, group or
        container. A grantee must already be a member; no membership tier is required.
      </div>

      {/* Grant a new object role */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Grant a manager</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={objectType}
            onChange={(e) => setObjectType(e.target.value as ObjectType)}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm capitalize"
          >
            {OBJECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            value={objectId}
            onChange={(e) => setObjectId(e.target.value)}
            placeholder={objectType === 'event' ? 'event slug' : `${objectType} id`}
            className="w-48 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="member@email.com"
            className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <button
            onClick={grant}
            disabled={busy || !objectId.trim() || !email.trim()}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Grant
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>

      {/* Existing grants grouped by object */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {Object.keys(groups).length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-gray-400">No object roles granted yet.</p>
        )}
        {Object.entries(groups).map(([key, rows]) => {
          const [type, ...rest] = key.split(':')
          const id = rest.join(':')
          return (
            <div key={key} className="border-b border-gray-100 px-4 py-3 last:border-b-0">
              <div className="mb-1.5 flex items-baseline gap-2">
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium capitalize text-gray-600">
                  {type}
                </span>
                <span className="text-sm font-medium text-gray-900">{id}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {rows.map((d) => (
                  <span
                    key={d.id}
                    className="inline-flex items-center gap-1 rounded-full bg-indigo-50 py-0.5 pl-3 pr-1 text-xs font-medium text-indigo-700"
                  >
                    {d.member_name?.trim() || d.member_email || 'Member'}
                    <button
                      onClick={() => revoke(d.id)}
                      disabled={busy}
                      aria-label="Revoke"
                      className="hover:text-indigo-900 disabled:opacity-50"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
