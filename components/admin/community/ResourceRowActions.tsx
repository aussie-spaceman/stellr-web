'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from '@/components/ui/Toast'

type Tier = { id: string; name: string }

// Per-resource permission control (the "green circle") + individual delete.
// The circle is green when the resource is open to everyone who can reach it, and
// amber when restricted to specific membership tiers. Clicking opens a tier picker
// that overrides access for this single resource.
export function ResourceRowActions({
  resourceId,
  allTiers,
  assignedTierIds,
}: {
  resourceId: string
  allTiers: Tier[]
  assignedTierIds: string[]
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set(assignedTierIds))
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const restricted = selected.size > 0

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const save = async () => {
    setBusy(true)
    const res = await fetch('/api/admin/community/resources', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: resourceId, tierIds: [...selected] }),
    })
    setBusy(false)
    if (!res.ok) return toast('Could not update access')
    setOpen(false)
    toast(selected.size > 0 ? 'Access restricted to selected tiers' : 'Open to all members')
    router.refresh()
  }

  const remove = async () => {
    if (!confirm('Delete this resource? Its file is removed permanently.')) return
    setBusy(true)
    const res = await fetch(`/api/admin/community/resources?id=${resourceId}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) return toast('Could not delete resource')
    toast('Resource deleted')
    router.refresh()
  }

  const summary = restricted
    ? `${selected.size} tier${selected.size === 1 ? '' : 's'}`
    : 'All members'

  return (
    <div className="flex items-center justify-end gap-3">
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={busy}
          title={restricted ? 'Restricted to selected tiers — click to edit' : 'Open to all members — click to restrict by tier'}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-muted disabled:opacity-50"
        >
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: restricted ? '#E0922F' : '#1FA97A' }}
            aria-hidden
          />
          {summary}
        </button>

        {open && (
          <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-brand-border bg-white p-2 shadow-lg">
            <p className="px-1 pb-1 text-[11px] text-brand-muted-soft">
              Leave all unchecked to keep this resource open to everyone who can reach it.
            </p>
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {allTiers.map((t) => (
                <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-brand-muted hover:bg-brand-canvas">
                  <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                  {t.name}
                </label>
              ))}
            </div>
            <div className="mt-2 flex justify-end gap-2 border-t border-brand-hairline pt-2">
              <button onClick={() => setOpen(false)} className="rounded px-2 py-1 text-xs text-brand-muted-soft hover:text-brand-muted">Cancel</button>
              <button onClick={save} disabled={busy} className="rounded-md bg-brand-blue px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-blue-dark disabled:opacity-50">
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={remove}
        disabled={busy}
        aria-label="Delete resource"
        className="text-brand-muted-soft hover:text-red-500 disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}
