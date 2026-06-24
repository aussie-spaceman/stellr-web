'use client'

import { useState } from 'react'
import { Plus, X, Check } from 'lucide-react'
import { ObjectPicker } from './ObjectPicker'
import type { TrainableObject, ObjectType } from '@/lib/training-admin'

// Assignments & requirements card (Course builder). A course is assigned to any
// number of Objects; each assignment carries a requirement PER membership tier
// (Mandatory / Optional / N-A), stored on the Course↔Object join — NOT the Course.
// Tiers are data-driven from the real membership_tiers (the prototype's
// Explorer/Catalyst/Patron were placeholders).

export type Requirement = 'mandatory' | 'optional' | 'na'

export interface AdminTier {
  id: string
  name: string
  age_bracket: string | null
  sort_order: number
}

export interface AdminAssignment {
  id: string
  object_type: ObjectType
  object_ref: string
  object_label: string | null
  default_requirement: Requirement
  tier_requirements: Record<string, Requirement>
  due_at: string | null
}

const OBJECT_TYPE_LABELS: Record<ObjectType, string> = {
  competition: 'Competition',
  campaign: 'Campaign',
  cohort: 'Cohort',
  workshop: 'Workshop',
  space: 'Space',
}

const BRACKET_LABEL: Record<string, string> = {
  high_school: 'High school',
  college: 'College',
  adult: 'Adults',
}

const REQ_OPTS: { value: Requirement; label: string; hint: string }[] = [
  { value: 'mandatory', label: 'Mandatory', hint: 'Required — counts toward this tier’s mandatory progress and can carry a deadline.' },
  { value: 'optional', label: 'Optional', hint: 'Offered to this tier but not required.' },
  { value: 'na', label: 'N/A', hint: 'Not applicable — this course is not assigned to this tier.' },
]

// Selected requirement is shown as a clearly-highlighted green pill (with a tick);
// the unselected options stay muted so the active choice is unambiguous.
const ACTIVE_PILL = { background: '#1FA97A', color: '#fff' }

function ReqControl({ value, onChange }: { value: Requirement; onChange: (v: Requirement) => void }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-brand-border bg-white p-0.5">
      {REQ_OPTS.map((o) => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            title={o.hint}
            onClick={() => onChange(o.value)}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition"
            style={active ? ACTIVE_PILL : { color: '#8A91AB' }}
          >
            {active && <Check className="h-3 w-3" />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function AssignmentCard({
  assignment,
  tiers,
  dirty,
  saving,
  onChange,
  onSave,
  onRemove,
}: {
  assignment: AdminAssignment
  tiers: AdminTier[]
  dirty: boolean
  saving: boolean
  onChange: (patch: Partial<Pick<AdminAssignment, 'default_requirement' | 'tier_requirements' | 'due_at'>>) => void
  onSave: () => void
  onRemove: () => void
}) {
  // Group tiers by age bracket for a scannable layout.
  const groups = new Map<string, AdminTier[]>()
  for (const t of tiers) {
    const k = t.age_bracket ?? 'other'
    groups.set(k, [...(groups.get(k) ?? []), t])
  }

  const setTier = (tierId: string, req: Requirement) =>
    onChange({ tier_requirements: { ...assignment.tier_requirements, [tierId]: req } })

  // Set every tier in an age bracket at once (bulk control on the bracket header).
  const setBracket = (ts: AdminTier[], req: Requirement) => {
    const next = { ...assignment.tier_requirements }
    for (const t of ts) next[t.id] = req
    onChange({ tier_requirements: next })
  }

  // The deadline only applies to mandatory work, so it stays disabled until this
  // course is mandatory for the default or at least one tier.
  const isMandatoryAnywhere =
    assignment.default_requirement === 'mandatory' ||
    Object.values(assignment.tier_requirements).includes('mandatory')

  return (
    <div className="rounded-xl border border-brand-border bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold" style={{ background: '#EAF0FE', color: '#2C53C6' }}>
            {OBJECT_TYPE_LABELS[assignment.object_type]}
          </span>
          <span className="font-semibold text-brand-blue-dark">{assignment.object_label ?? assignment.object_ref}</span>
        </div>
        <button onClick={onRemove} aria-label="Remove assignment" className="text-brand-muted-soft hover:text-red-500">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Default requirement — global setting applied to every tier unless overridden. */}
      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-brand-canvas px-3 py-2">
        <span className="text-xs font-medium text-brand-muted">All tiers (default)</span>
        <ReqControl value={assignment.default_requirement} onChange={(v) => onChange({ default_requirement: v })} />
      </div>

      {/* Per-tier overrides, grouped by age bracket — each bracket can be set in bulk. */}
      <div className="mt-3 space-y-3">
        {[...groups.entries()].map(([bracket, ts]) => (
          <div key={bracket}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted-soft">
                {BRACKET_LABEL[bracket] ?? 'Other'}
              </p>
              <div className="flex items-center gap-1 text-[10px] text-brand-muted-soft">
                <span>Set all:</span>
                {REQ_OPTS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    title={`Set every ${BRACKET_LABEL[bracket] ?? ''} tier to ${o.label}`}
                    onClick={() => setBracket(ts, o.value)}
                    className="rounded border border-brand-border px-1.5 py-0.5 font-semibold text-brand-muted hover:bg-brand-canvas"
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              {ts.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-brand-muted">{t.name}</span>
                  <ReqControl
                    value={assignment.tier_requirements[t.id] ?? assignment.default_requirement}
                    onChange={(v) => setTier(t.id, v)}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Deadline — only meaningful for mandatory work. */}
      <label
        className={`mt-3 flex items-center gap-2 text-xs font-medium ${isMandatoryAnywhere ? 'text-brand-muted-soft' : 'text-brand-muted-soft/50'}`}
        title={isMandatoryAnywhere ? undefined : 'Set this course to Mandatory for a tier to enable a deadline.'}
      >
        Deadline
        <input
          type="date"
          disabled={!isMandatoryAnywhere}
          value={assignment.due_at ? assignment.due_at.slice(0, 10) : ''}
          onChange={(e) => onChange({ due_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
          className="rounded-md border border-brand-border px-2 py-1 text-xs font-normal text-brand-blue-dark disabled:cursor-not-allowed disabled:bg-brand-canvas disabled:opacity-60"
        />
      </label>

      {/* Explicit save — changes are staged locally until saved. */}
      <div className="mt-3 flex items-center justify-end gap-2 border-t border-brand-hairline pt-3">
        {dirty && <span className="text-[11px] text-brand-muted-soft">Unsaved changes</span>}
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving}
          className="rounded-lg bg-brand-blue px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-blue-dark disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

export function ObjectAssignments({
  moduleId,
  assignments: initial,
  objects,
  tiers,
}: {
  moduleId: string
  assignments: AdminAssignment[]
  objects: TrainableObject[]
  tiers: AdminTier[]
}) {
  const [assignments, setAssignments] = useState<AdminAssignment[]>(initial)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState<Set<string>>(new Set())

  const assignedRefs = new Set(assignments.map((a) => a.object_ref))
  const available = objects.filter((o) => !assignedRefs.has(o.ref))

  const addObject = async (ref: string) => {
    const obj = objects.find((o) => o.ref === ref)
    if (!obj) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/training/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moduleId,
          objectType: obj.type,
          objectRef: obj.ref,
          objectLabel: obj.label,
          defaultRequirement: 'optional',
          tierRequirements: {},
        }),
      })
      if (res.ok) {
        const { id } = await res.json()
        setAssignments((prev) => [
          ...prev,
          { id, object_type: obj.type, object_ref: obj.ref, object_label: obj.label, default_requirement: 'optional', tier_requirements: {}, due_at: null },
        ])
        setAdding(false)
      }
    } finally {
      setBusy(false)
    }
  }

  // Stage edits locally; they persist only when the card's Save button is pressed.
  const updateLocal = (id: string, changes: Partial<AdminAssignment>) => {
    setAssignments((prev) => prev.map((a) => (a.id === id ? { ...a, ...changes } : a)))
    setDirty((prev) => new Set(prev).add(id))
  }

  const save = async (id: string) => {
    const current = assignments.find((a) => a.id === id)
    if (!current) return
    setSaving((prev) => new Set(prev).add(id))
    try {
      await fetch('/api/admin/training/assignments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          defaultRequirement: current.default_requirement,
          tierRequirements: current.tier_requirements,
          dueAt: current.due_at,
        }),
      })
      setDirty((prev) => { const n = new Set(prev); n.delete(id); return n })
    } finally {
      setSaving((prev) => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  const remove = async (id: string) => {
    setAssignments((prev) => prev.filter((a) => a.id !== id))
    setDirty((prev) => { const n = new Set(prev); n.delete(id); return n })
    await fetch(`/api/admin/training/assignments?id=${id}`, { method: 'DELETE' })
  }

  return (
    <div className="rounded-xl border border-brand-border bg-white p-4">
      <h3 className="text-base font-bold text-brand-blue-dark">Assignments &amp; requirements</h3>
      <p className="mt-0.5 text-sm text-brand-muted-soft">
        Assign this course to any number of Objects. Whether it&apos;s mandatory or optional is set <strong>per Object</strong> — and per membership tier within each.
      </p>

      <div className="mt-4 space-y-3">
        {assignments.map((a) => (
          <AssignmentCard
            key={a.id}
            assignment={a}
            tiers={tiers}
            dirty={dirty.has(a.id)}
            saving={saving.has(a.id)}
            onChange={(changes) => updateLocal(a.id, changes)}
            onSave={() => save(a.id)}
            onRemove={() => remove(a.id)}
          />
        ))}
      </div>

      <div className="mt-3">
        {adding ? (
          <div className="flex items-center gap-2">
            <ObjectPicker objects={available} value={null} onChange={addObject} />
            <button onClick={() => setAdding(false)} className="text-sm text-brand-muted-soft hover:text-brand-muted">Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            disabled={busy || available.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-brand-border px-3 py-2 text-sm font-semibold text-brand-muted transition hover:bg-brand-canvas disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Assign to Object
          </button>
        )}
      </div>
    </div>
  )
}
