'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { Select } from '@stellr/web-ui'

export interface ModuleRef {
  id: string
  title: string
}
export interface Prereq {
  id: string
  target_ref: string
  requires_target_ref: string
}

// Configure the Phase 5 gates per training module: prerequisites (must complete X
// first) and persistence (keep open vs re-gate once a container archives).
export default function GatesManager({
  modules,
  prereqs,
  persistence,
}: {
  modules: ModuleRef[]
  prereqs: Prereq[]
  persistence: Record<string, string>
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  // Scope prerequisites/persistence to a single course — the one being viewed —
  // rather than listing every module at once. Other modules remain available as
  // prerequisite options in the picker below.
  const [selectedId, setSelectedId] = useState(modules[0]?.id ?? '')
  const courseSelectId = useId()
  const titleOf = (id: string) => modules.find((m) => m.id === id)?.title ?? id

  async function addPrereq(targetRef: string, requiresRef: string) {
    if (!requiresRef) return
    setBusy(true)
    await fetch('/api/admin/community/gates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'prereq', targetRef, requiresRef }),
    })
    setBusy(false)
    router.refresh()
  }
  async function removePrereq(id: string) {
    setBusy(true)
    await fetch('/api/admin/community/gates', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setBusy(false)
    router.refresh()
  }
  async function setPersistence(targetRef: string, policy: string) {
    setBusy(true)
    await fetch('/api/admin/community/gates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'persistence', targetRef, policy }),
    })
    setBusy(false)
    router.refresh()
  }

  if (modules.length === 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-brand-border bg-white">
        <p className="px-4 py-6 text-center text-sm text-brand-muted-soft">No training modules yet.</p>
      </div>
    )
  }

  const selected = modules.find((m) => m.id === selectedId) ?? modules[0]
  const mine = prereqs.filter((p) => p.target_ref === selected.id)

  return (
    <div className="space-y-3">
      {/* Per-course scope banner — mirrors the Reminders tab selector. */}
      <div className="rounded-2xl border p-4" style={{ borderColor: '#CFE0FB', background: '#EFF3FE' }}>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor={courseSelectId} className="text-sm font-semibold text-brand-blue-bright">Prerequisites for course</label>
          <div className="w-72 max-w-full">
            <Select id={courseSelectId} value={selected.id} onChange={(e) => setSelectedId(e.target.value)} className="font-medium">
              {modules.map((m) => (
                <option key={m.id} value={m.id}>{m.title}</option>
              ))}
            </Select>
          </div>
          {busy && <span className="text-xs text-brand-muted-soft">Saving…</span>}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-brand-border bg-white">
        <div className="px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium text-brand-blue-dark">{selected.title}</span>
            <label className="flex items-center gap-1.5 text-xs text-brand-muted-soft">
              On archive:
              <span className="w-36">
                <Select
                  value={persistence[selected.id] ?? 're_gate'}
                  onChange={(e) => setPersistence(selected.id, e.target.value)}
                  disabled={busy}
                >
                  <option value="re_gate">re-gate</option>
                  <option value="keep_open">keep open</option>
                </Select>
              </span>
            </label>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-brand-muted-soft">Requires:</span>
            {mine.length === 0 && <span className="text-xs text-brand-muted-soft">—</span>}
            {mine.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1 rounded-full bg-amber-50 py-0.5 pl-2 pr-1 text-xs font-medium text-amber-800"
              >
                {titleOf(p.requires_target_ref)}
                <button
                  onClick={() => removePrereq(p.id)}
                  disabled={busy}
                  aria-label="Remove prerequisite"
                  className="hover:text-amber-900 disabled:opacity-50"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <div className="w-56 max-w-full">
              <Select
                value=""
                onChange={(e) => addPrereq(selected.id, e.target.value)}
                disabled={busy}
                aria-label={`Add a prerequisite for ${selected.title}`}
              >
                <option value="">+ add prerequisite…</option>
                {modules
                  .filter((o) => o.id !== selected.id && !mine.some((p) => p.requires_target_ref === o.id))
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title}
                    </option>
                  ))}
              </Select>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
