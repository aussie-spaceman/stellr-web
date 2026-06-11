'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Blocker {
  table: string
  label: string
  count: number
  adminHref?: string
}

interface Props {
  /** Registry entity type, e.g. 'member', 'school', 'event'. */
  entity: string
  /** Row id (uuid) or slug for slug-keyed entities. */
  id: string
  /** Human name shown in the confirm dialog. */
  name: string
  /** Where to send the admin after a successful delete. */
  redirectTo?: string
  /** Hide the permanent-delete option for entities that should only soft-delete. */
  allowHardDelete?: boolean
  className?: string
}

// Reusable admin delete affordance. On open it runs a preflight; if the item is
// blocked by linked records it lists exactly what must be deleted first instead
// of offering a delete. Otherwise it offers Soft-delete (default, recoverable)
// and Permanently delete (typed confirmation).
export function DeleteEntityButton({
  entity,
  id,
  name,
  redirectTo,
  allowHardDelete = true,
  className,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [blockers, setBlockers] = useState<Blocker[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'soft' | 'hard'>('soft')
  const [confirmText, setConfirmText] = useState('')

  async function openDialog() {
    setOpen(true)
    setError(null)
    setBlockers(null)
    setMode('soft')
    setConfirmText('')
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/deletion/preflight?entity=${encodeURIComponent(entity)}&id=${encodeURIComponent(id)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Preflight failed')
      setBlockers(data.blockers as Blocker[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check dependencies')
    } finally {
      setLoading(false)
    }
  }

  async function doDelete() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/deletion', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity, id, mode }),
      })
      const data = await res.json()
      if (res.status === 409 && data.blockers) {
        setBlockers(data.blockers as Blocker[])
        return
      }
      if (!res.ok) throw new Error(data.error || 'Delete failed')

      const failures = (data.externalResults ?? []).filter((r: { ok: boolean }) => !r.ok)
      if (failures.length > 0) {
        setError(`Deleted, but external cleanup had issues: ${failures.map((f: { detail: string }) => f.detail).join('; ')}`)
        setTimeout(() => finish(), 2500)
        return
      }
      finish()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setLoading(false)
    }
  }

  function finish() {
    setOpen(false)
    if (redirectTo) router.push(redirectTo)
    else router.refresh()
  }

  const hasBlockers = blockers !== null && blockers.length > 0
  const hardConfirmed = mode === 'soft' || confirmText.trim().toUpperCase() === 'DELETE'

  return (
    <>
      <button
        onClick={openDialog}
        className={className ?? 'text-sm font-medium text-red-600 hover:text-red-800 border border-red-200 px-3 py-1.5 rounded-lg'}
      >
        Delete
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !loading && setOpen(false)}>
          <div className="bg-white rounded-xl border border-gray-200 shadow-xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900">Delete {name}?</h2>

            {loading && !blockers && <p className="text-sm text-gray-500">Checking dependencies…</p>}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            {hasBlockers ? (
              <div className="space-y-2">
                <p className="text-sm text-gray-700">
                  This can&apos;t be deleted yet. Remove the following linked items first:
                </p>
                <ul className="text-sm text-gray-700 space-y-1 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  {blockers!.map((b) => (
                    <li key={b.table} className="flex justify-between gap-3">
                      <span>{b.label}</span>
                      <span className="font-medium">
                        {b.count}
                        {b.adminHref && (
                          <a href={b.adminHref} className="ml-2 text-indigo-600 hover:text-indigo-800">view</a>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex justify-end pt-2">
                  <button onClick={() => setOpen(false)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">Close</button>
                </div>
              </div>
            ) : (
              blockers !== null && (
                <div className="space-y-4">
                  {allowHardDelete && (
                    <div className="space-y-2">
                      <label className="flex items-start gap-2 text-sm text-gray-700">
                        <input type="radio" checked={mode === 'soft'} onChange={() => setMode('soft')} className="mt-0.5" />
                        <span><span className="font-medium">Soft-delete</span> — hide it but keep the data (recoverable).</span>
                      </label>
                      <label className="flex items-start gap-2 text-sm text-gray-700">
                        <input type="radio" checked={mode === 'hard'} onChange={() => setMode('hard')} className="mt-0.5" />
                        <span><span className="font-medium">Permanently delete</span> — purge from the database. An archive snapshot is kept for support.</span>
                      </label>
                    </div>
                  )}

                  {mode === 'hard' && (
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Type DELETE to confirm</label>
                      <input
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-3 pt-1">
                    <button onClick={() => setOpen(false)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancel</button>
                    <button
                      onClick={doDelete}
                      disabled={loading || !hardConfirmed}
                      className="bg-red-600 text-white text-sm font-medium px-4 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-50"
                    >
                      {loading ? 'Deleting…' : mode === 'hard' ? 'Permanently delete' : 'Soft-delete'}
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </>
  )
}
