'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import type { ObjectType } from '@/lib/object-roles'
import MemberPicker, { type PickedMember } from '@/components/admin/MemberPicker'

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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add(member: PickedMember) {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/admin/object-roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: member.id, objectType, objectId }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.error ?? 'Failed to add manager')
      return
    }
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
    <div className="rounded-xl border border-brand-border bg-white p-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-brand-muted-soft">{label}</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {initialAssignments.length === 0 && (
          <span className="text-sm text-brand-muted-soft">No managers assigned.</span>
        )}
        {initialAssignments.map((a) => (
          <span
            key={a.id}
            className="inline-flex items-center gap-1 rounded-full bg-brand-blue/5 py-0.5 pl-3 pr-1 text-xs font-medium text-brand-blue"
          >
            {a.name?.trim() || a.email || 'Member'}
            <button
              onClick={() => remove(a.id)}
              disabled={busy}
              aria-label="Remove manager"
              className="hover:text-brand-blue disabled:opacity-50"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <MemberPicker disabled={busy} placeholder="Add a manager — search by name or email…" onPick={add} />
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}
