'use client'

import { useState } from 'react'
import { X, GripVertical } from 'lucide-react'

export interface Tier {
  id: string
  name: string
  is_free: boolean
  age_bracket?: string | null
}

// Access levels are ordinal — higher implies the lower ones (see lib/community.ts).
export const ACCESS_LEVELS = ['view', 'download', 'enroll', 'host'] as const
export type AccessLevel = (typeof ACCESS_LEVELS)[number]

// Group tiers into audience families for the palette so 15 tiers stay scannable.
// Derived from membership_tiers.age_bracket; tiers without one fall into "Public".
const FAMILY_ORDER = ['Public & general', 'Students', 'College & mentors', 'Educators & adults']
function familyOf(tier: Tier): string {
  switch (tier.age_bracket) {
    case 'high_school':
      return 'Students'
    case 'college':
      return 'College & mentors'
    case 'adult':
      return 'Educators & adults'
    default:
      return 'Public & general'
  }
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
  tier_id: string | null
  content_tier: string | null
  target_type: string
  target_ref: string
  access_level: string
}

// The competition content tiers, ordered low→high. A content-tier row grants the
// target to anyone enrolled in a campaign at that tier or above (see lib/community.ts).
export const CONTENT_TIERS = ['core', 'baseline', 'advanced', 'premium'] as const
export type ContentTier = (typeof CONTENT_TIERS)[number]

// What's being dragged onto a content row — a membership tier or a content tier.
type DragSubject = { kind: 'tier'; id: string } | { kind: 'content'; tier: ContentTier }

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
  const [drag, setDrag] = useState<DragSubject | null>(null)
  const [busy, setBusy] = useState(false)
  const tierById = new Map(tiers.map((t) => [t.id, t]))

  const grant = async (target: Target, subject: DragSubject) => {
    // Skip if this subject already has a chip (any access level) on this target.
    const dup = rows.some(
      (r) =>
        r.target_type === target.type &&
        r.target_ref === target.ref &&
        (subject.kind === 'tier' ? r.tier_id === subject.id : r.content_tier === subject.tier)
    )
    if (dup) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/community/entitlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(subject.kind === 'tier' ? { tierId: subject.id } : { contentTier: subject.tier }),
          targetType: target.type,
          targetRef: target.ref,
          accessLevel: 'view',
        }),
      })
      const json = await res.json()
      if (res.ok) {
        setRows((prev) => [
          ...prev,
          {
            id: json.id,
            tier_id: subject.kind === 'tier' ? subject.id : null,
            content_tier: subject.kind === 'content' ? subject.tier : null,
            target_type: target.type,
            target_ref: target.ref,
            access_level: 'view',
          },
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

  const changeLevel = async (id: string, level: AccessLevel) => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/community/entitlements', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, accessLevel: level }),
      })
      if (res.ok) {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, access_level: level } : r)))
      }
    } finally {
      setBusy(false)
    }
  }

  const chipsFor = (target: Target) =>
    rows.filter((r) => r.target_type === target.type && r.target_ref === target.ref)

  // Tier palette grouped into audience families, families in a stable order.
  const tierFamilies = tiers.reduce<Record<string, Tier[]>>((acc, t) => {
    ;(acc[familyOf(t)] ??= []).push(t)
    return acc
  }, {})
  const orderedFamilies = FAMILY_ORDER.filter((f) => tierFamilies[f]?.length)

  // Group targets by their section heading, preserving order.
  const groups = targets.reduce<Record<string, Target[]>>((acc, t) => {
    ;(acc[t.group] ??= []).push(t)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {/* Tier palette, grouped by audience family */}
      <div className="rounded-xl border border-brand-border bg-white p-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-brand-muted-soft">
          Membership tiers — drag onto content to grant access
        </p>
        <div className="space-y-3">
          {orderedFamilies.map((family) => (
            <div key={family}>
              <p className="mb-1.5 text-[11px] font-medium text-brand-muted-soft">{family}</p>
              <div className="flex flex-wrap gap-2">
                {tierFamilies[family].map((t) => (
                  <span
                    key={t.id}
                    draggable
                    onDragStart={() => setDrag({ kind: 'tier', id: t.id })}
                    onDragEnd={() => setDrag(null)}
                    className={`inline-flex cursor-grab items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
                      t.is_free
                        ? 'border-brand-border bg-brand-canvas text-brand-muted'
                        : 'border-brand-blue bg-brand-blue/5 text-brand-blue'
                    }`}
                  >
                    <GripVertical className="h-3 w-3 opacity-50" />
                    {t.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Content-tier palette — per-campaign subjects (cumulative low→high) */}
      <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-amber-700">
          Content tiers — drag onto campaign content to grant by purchased tier
        </p>
        <div className="flex flex-wrap gap-2">
          {CONTENT_TIERS.map((ct) => (
            <span
              key={ct}
              draggable
              onDragStart={() => setDrag({ kind: 'content', tier: ct })}
              onDragEnd={() => setDrag(null)}
              className="inline-flex cursor-grab items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-medium capitalize text-amber-800"
            >
              <GripVertical className="h-3 w-3 opacity-50" />
              {ct}
            </span>
          ))}
        </div>
      </div>

      {/* Content rows grouped by section */}
      {Object.entries(groups).map(([group, items]) => (
        <div key={group}>
          <h2 className="mb-2 text-sm font-subheading font-semibold uppercase tracking-wide text-brand-muted-soft">{group}</h2>
          <div className="overflow-hidden rounded-xl border border-brand-border bg-white">
            {items.map((target) => (
              <div
                key={`${target.type}:${target.ref}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => drag && grant(target, drag)}
                className={`flex items-center justify-between gap-4 border-b border-brand-hairline px-4 py-3 last:border-b-0 ${
                  drag ? 'hover:bg-brand-blue-dark/50' : ''
                }`}
              >
                <span className="text-sm font-medium text-brand-blue-dark">{target.label}</span>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {chipsFor(target).length === 0 && (
                    <span className="text-xs text-brand-muted-soft">
                      Open to all members (legacy tier rule)
                    </span>
                  )}
                  {chipsFor(target).map((r) => {
                    const isContent = !!r.content_tier
                    const label = isContent
                      ? (r.content_tier as string)
                      : (tierById.get(r.tier_id ?? '')?.name ?? 'Tier')
                    return (
                      <span
                        key={r.id}
                        className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-xs font-medium ${
                          isContent ? 'bg-amber-100 capitalize text-amber-800' : 'bg-brand-blue/5 text-brand-blue'
                        }`}
                      >
                        {label}
                        <select
                          value={r.access_level}
                          onChange={(e) => changeLevel(r.id, e.target.value as AccessLevel)}
                          disabled={busy}
                          aria-label={`Access level for ${label}`}
                          className={`rounded px-1 py-0.5 text-[11px] font-medium disabled:opacity-50 ${
                            isContent ? 'bg-amber-200/70 text-amber-900' : 'bg-brand-blue/10/70 text-brand-blue'
                          }`}
                        >
                          {ACCESS_LEVELS.map((lvl) => (
                            <option key={lvl} value={lvl}>
                              {lvl}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => revoke(r.id)}
                          disabled={busy}
                          aria-label="Revoke"
                          className="hover:text-brand-blue disabled:opacity-50"
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
              <p className="px-4 py-6 text-center text-sm text-brand-muted-soft">Nothing to configure here yet.</p>
            )}
          </div>
        </div>
      ))}

      <p className="text-xs text-brand-muted-soft">
        Rows with no tier chips fall back to the content&apos;s built-in free/paid rule. Add a chip to
        switch that row to explicit tier-based access.
      </p>
    </div>
  )
}
