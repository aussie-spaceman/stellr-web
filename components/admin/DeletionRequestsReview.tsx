'use client'

import { useState } from 'react'
import Link from 'next/link'

interface Requester {
  first_name: string | null
  last_name: string | null
  email: string | null
}

export interface DeletionRequest {
  id: string
  entity_type: string
  entity_id: string
  reason: string | null
  status: string
  created_at: string
  requested_by: string | null
  members: Requester | Requester[] | null
}

interface Blocker {
  table: string
  label: string
  count: number
}

const ENTITY_LABELS: Record<string, string> = {
  event_participation: 'Event activity',
  school: 'School link',
  session: 'Coaching/mentoring session',
}

function getRequester(item: DeletionRequest): Requester | null {
  if (!item.members) return null
  return Array.isArray(item.members) ? item.members[0] ?? null : item.members
}

// Renders the member-initiated deletion requests inside the Activity Review Log.
// Approve runs the actual deletion server-side; if still blocked, the server
// returns the dependent list which is shown inline.
export function DeletionRequestsReview({ initialRequests }: { initialRequests: DeletionRequest[] }) {
  const [items, setItems] = useState(initialRequests)
  const [processing, setProcessing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [blockersFor, setBlockersFor] = useState<Record<string, Blocker[]>>({})

  async function review(id: string, action: 'approve' | 'reject') {
    if (action === 'reject' && !confirm('Decline this deletion request?')) return
    setProcessing(id)
    setError(null)
    const res = await fetch(`/api/admin/deletion-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const data = await res.json().catch(() => ({}))
    setProcessing(null)

    if (res.status === 409 && data.blockers) {
      setBlockersFor((m) => ({ ...m, [id]: data.blockers }))
      return
    }
    if (!res.ok) {
      setError(data.error || 'Failed — please try again.')
      return
    }
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  if (items.length === 0) return null

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Deletion requests</h2>
        <p className="mt-1 text-sm text-gray-500">
          Members have asked to remove these items. Approving deletes the item; declining leaves it in place.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {items.map((item) => {
        const requester = getRequester(item)
        const blockers = blockersFor[item.id]
        return (
          <div key={item.id} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="inline-block text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                  {ENTITY_LABELS[item.entity_type] ?? item.entity_type}
                </span>
                <p className="mt-1.5 text-sm">
                  {requester ? (
                    <Link href={`/admin/members/${item.requested_by}`} className="font-medium text-indigo-600 hover:text-indigo-800">
                      {requester.first_name} {requester.last_name}
                    </Link>
                  ) : (
                    <span className="font-medium text-gray-700">Unknown member</span>
                  )}
                </p>
                {requester?.email && <p className="text-xs text-gray-400">{requester.email}</p>}
              </div>
              <p className="text-xs text-gray-400 shrink-0">
                {new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </div>

            {item.reason && <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-3">{item.reason}</p>}

            {blockers && blockers.length > 0 && (
              <ul className="text-sm text-gray-700 space-y-1 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <li className="text-amber-800 font-medium">Delete these first:</li>
                {blockers.map((b) => (
                  <li key={b.table} className="flex justify-between"><span>{b.label}</span><span className="font-medium">{b.count}</span></li>
                ))}
              </ul>
            )}

            <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
              <button
                onClick={() => review(item.id, 'approve')}
                disabled={processing === item.id}
                className="bg-green-600 text-white text-sm font-medium px-4 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {processing === item.id ? 'Working…' : 'Approve & delete'}
              </button>
              <button
                onClick={() => review(item.id, 'reject')}
                disabled={processing === item.id}
                className="ml-auto text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
