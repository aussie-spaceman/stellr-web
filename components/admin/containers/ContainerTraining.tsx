'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, GraduationCap } from 'lucide-react'
import { formatDateShort } from '@/lib/utils'

export interface ContentRow {
  id: string
  content_ref: string
  title: string
  is_mandatory: boolean
  due_at: string | null
}

export interface ModuleOption {
  id: string
  title: string
}

// Assign/remove training modules on a container (competition, cohort, etc.).
// Writes to container_contents via /api/admin/containers/[containerId]/contents.
export function ContainerTraining({
  containerId,
  initialContents,
  allModules,
}: {
  containerId: string
  initialContents: ContentRow[]
  allModules: ModuleOption[]
}) {
  const router = useRouter()
  const [contents, setContents] = useState<ContentRow[]>(initialContents)
  const [moduleId, setModuleId] = useState(allModules[0]?.id ?? '')
  const [mandatory, setMandatory] = useState(false)
  const [dueAt, setDueAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const assignedIds = new Set(contents.map((c) => c.content_ref))
  const available = allModules.filter((m) => !assignedIds.has(m.id))

  const add = async () => {
    if (!moduleId) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch(`/api/admin/containers/${containerId}/contents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId, isMandatory: mandatory, dueAt: dueAt || null }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to assign'); return }
      const title = allModules.find((m) => m.id === moduleId)?.title ?? moduleId
      setContents((prev) => [
        ...prev,
        { id: json.id, content_ref: moduleId, title, is_mandatory: mandatory, due_at: dueAt || null },
      ])
      setModuleId(available.find((m) => m.id !== moduleId)?.id ?? available[0]?.id ?? '')
      setDueAt('')
      setMandatory(false)
      setSaved(true)
      router.refresh()
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/containers/${containerId}/contents`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (res.ok) {
        setContents((prev) => prev.filter((c) => c.id !== id))
        router.refresh()
      } else {
        const json = await res.json().catch(() => ({}))
        setError(json.error ?? 'Could not remove')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {contents.length === 0 ? (
        <p className="text-sm text-brand-muted-soft">No training modules assigned yet.</p>
      ) : (
        <ul className="space-y-2">
          {contents.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-3 rounded-lg border border-brand-border bg-white px-3 py-2.5"
            >
              <GraduationCap className="h-4 w-4 shrink-0 text-brand-blue" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-brand-blue-dark">{c.title}</p>
                <p className="text-xs text-brand-muted-soft">
                  {c.is_mandatory ? (
                    <span className="font-medium text-red-600">Mandatory</span>
                  ) : (
                    'Optional'
                  )}
                  {c.due_at && <> · due {formatDateShort(c.due_at)}</>}
                </p>
              </div>
              <button
                onClick={() => remove(c.id)}
                disabled={busy}
                className="shrink-0 text-brand-muted-soft hover:text-red-500 disabled:opacity-50"
                aria-label="Remove"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 && (
        <div className="rounded-lg border border-brand-border bg-white p-3 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-muted-soft">
            Assign training module
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={moduleId}
              onChange={(e) => { setModuleId(e.target.value); setSaved(false) }}
              className="rounded-md border border-brand-border px-3 py-2 text-sm"
            >
              {available.map((m) => (
                <option key={m.id} value={m.id}>{m.title}</option>
              ))}
            </select>
            <label className="flex flex-col gap-0.5 text-xs text-brand-muted-soft">
              Due date (optional)
              <input
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="rounded-md border border-brand-border px-3 py-2 text-sm text-brand-muted"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-brand-muted cursor-pointer">
            <input
              type="checkbox"
              checked={mandatory}
              onChange={(e) => setMandatory(e.target.checked)}
              className="rounded border-brand-border"
            />
            Mandatory
          </label>
          {error && <p className="text-xs text-red-600">{error}</p>}
          {saved && !error && <p className="text-xs text-green-600">Module assigned.</p>}
          <button
            onClick={add}
            disabled={busy || !moduleId}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-blue-dark px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Assign
          </button>
        </div>
      )}

      {available.length === 0 && allModules.length > 0 && (
        <p className="text-xs text-brand-muted-soft">All published courses are assigned.</p>
      )}
      {allModules.length === 0 && (
        <p className="text-xs text-brand-muted-soft">
          No published courses found. Create one under Training first.
        </p>
      )}
    </div>
  )
}
