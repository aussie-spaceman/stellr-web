'use client'

import { useState } from 'react'
import { X, GripVertical } from 'lucide-react'

export interface Tier {
  id: string
  name: string
  is_free: boolean
}

export interface Target {
  type:
    | 'space'
    | 'training_module'
    | 'resource'
    | 'event_material'
    | 'campaign_material'
    | 'mentoring'
    | 'coaching'
  ref: string // uuid, sanity _id, or '*'
  label: string
  group: string // section heading
}

export interface Entitlement {
  id: string
  tier_id: string
  target_type: string
  target_ref: string
  access_level: string
}

interface Props {
  tiers: Tier[]
  targets: Target[]
  initial: Entitlement[]
}

// Drag a tier chip onto a content row to grant access; click the × on an assigned
// chip to revoke. Uses native HTML5 drag-and-drop — no extra dependency. Writes
// go through /api/admin/community/entitlements; the gating logic everywhere else
// reads the same table (content_entitlements).
export function EntitlementMatrix({ tiers, targets, initial }: Props) {
  const [rows, setRows] = useState<Entitlement[]>(initial)
  const [dragTier, setDragTier] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const tierById = new Map(tiers.map((t) => [t.id, t]))

  const grant = async (target: Target, tierId: string) => {
    // Skip if already granted (any access level) for this exact target.
    if (rows.some((r) => r.tier_id === tierId && r.target_type === target.type && r.target_ref === target.ref))
      return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/community/entitlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tierId,
          targetType: target.type,
          targetRef: target.ref,
          accessLevel: 'view',
        }),
      })
      const json = await res.json()
      if (res.ok) {
        setRows((prev) => [
          ...prev,
          { id: json.id, tier_id: tierId, target_type: target.type, target_ref: target.ref, access_level: 'view' },
        ])
      }
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id: string) => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/community/entitlements', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (res.ok) setRows((prev) => prev.filter((r) => r.id !== id))
    } finally {
      setBusy(false)
    }
  }

  const chipsFor = (target: Target) =>
    rows.filter((r) => r.target_type === target.type && r.target_ref === target.ref)

  // Group targets by their section heading, preserving order.
  const groups = targets.reduce<Record<string, Target[]>>((acc, t) => {
    ;(acc[t.group] ??= []).push(t)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {/* Tier palette */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
          Membership tiers — drag onto content to grant access
        </p>
        <div className="flex flex-wrap gap-2">
          {tiers.map((t) => (
            <span
              key={t.id}
              draggable
              onDragStart={() => setDragTier(t.id)}
              onDragEnd={() => setDragTier(null)}
              className={`inline-flex cursor-grab items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
                t.is_free
                  ? 'border-gray-300 bg-gray-50 text-gray-700'
                  : 'border-indigo-200 bg-indigo-50 text-indigo-700'
              }`}
            >
              <GripVertical className="h-3 w-3 opacity-50" />
              {t.name}
            </span>
          ))}
        </div>
      </div>

      {/* Content rows grouped by section */}
      {Object.entries(groups).map(([group, items]) => (
        <div key={group}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{group}</h2>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            {items.map((target) => (
              <div
                key={`${target.type}:${target.ref}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dragTier && grant(target, dragTier)}
                className={`flex items-center justify-between gap-4 border-b border-gray-100 px-4 py-3 last:border-b-0 ${
                  dragTier ? 'hover:bg-indigo-50/50' : ''
                }`}
              >
                <span className="text-sm font-medium text-gray-900">{target.label}</span>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {chipsFor(target).length === 0 && (
                    <span className="text-xs text-gray-400">
                      Open to all members (legacy tier rule)
                    </span>
                  )}
                  {chipsFor(target).map((r) => {
                    const tier = tierById.get(r.tier_id)
                    return (
                      <span
                        key={r.id}
                        className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
                      >
                        {tier?.name ?? 'Tier'}
                        <button
                          onClick={() => revoke(r.id)}
                          disabled={busy}
                          aria-label="Revoke"
                          className="hover:text-indigo-900 disabled:opacity-50"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
            {items.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-gray-400">Nothing to configure here yet.</p>
            )}
          </div>
        </div>
      ))}

      <p className="text-xs text-gray-400">
        Rows with no tier chips fall back to the content&apos;s built-in free/paid rule. Add a chip to
        switch that row to explicit tier-based access.
      </p>
    </div>
  )
}
