'use client'

import { useState } from 'react'
import Link from 'next/link'

interface Member {
  id: string
  first_name: string
  last_name: string
  email: string
}

interface PendingItem {
  id: string
  event_year: number | null
  event_location: string | null
  team_name: string | null
  award: string | null
  status: string
  created_at: string
  members: Member | Member[] | null
}

function getMember(item: PendingItem): Member | null {
  if (!item.members) return null
  return Array.isArray(item.members) ? item.members[0] ?? null : item.members
}

const CURRENT_YEAR = new Date().getFullYear()

export function ActivityLogReview({ initialItems }: { initialItems: PendingItem[] }) {
  const [items, setItems] = useState(initialItems)
  const [editing, setEditing] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Record<string, string>>({})
  const [processing, setProcessing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function startEdit(item: PendingItem) {
    setEditing(item.id)
    setEditForm({
      event_year: item.event_year?.toString() ?? '',
      event_location: item.event_location ?? '',
      team_name: item.team_name ?? '',
      award: item.award ?? '',
    })
  }

  async function handleApprove(id: string, withEdits = false) {
    setProcessing(id)
    setError(null)
    const body = withEdits
      ? {
          event_year: editForm.event_year ? parseInt(editForm.event_year) : null,
          event_location: editForm.event_location || null,
          team_name: editForm.team_name || null,
          award: editForm.award || null,
          status: 'approved',
        }
      : { status: 'approved' }

    const res = await fetch(`/api/admin/event-participations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setProcessing(null)
    if (!res.ok) {
      setError('Failed to approve — please try again.')
      return
    }
    setItems((prev) => prev.filter((i) => i.id !== id))
    setEditing(null)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this submission? This cannot be undone.')) return
    setProcessing(id)
    setError(null)
    const res = await fetch(`/api/admin/event-participations/${id}`, { method: 'DELETE' })
    setProcessing(null)
    if (!res.ok) {
      setError('Failed to delete — please try again.')
      return
    }
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading uppercase text-title text-brand-blue-dark">Activity Log Review</h1>
        <p className="mt-1 text-sm text-brand-muted-soft">
          Members submit historical event activity for admin approval before it appears on their profile.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {items.length === 0 ? (
        <div className="bg-white rounded-xl border border-brand-border p-10 text-center">
          <p className="text-brand-muted-soft text-sm">No pending submissions — you&apos;re all caught up.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-brand-muted-soft">{items.length} pending submission{items.length !== 1 ? 's' : ''}</p>
          {items.map((item) => {
            const member = getMember(item)
            const isEditing = editing === item.id
            return (
              <div key={item.id} className="bg-white rounded-xl border border-brand-border p-5 space-y-4">
                {/* Member info */}
                <div className="flex items-start justify-between gap-4">
                  <div>
                    {member ? (
                      <Link
                        href={`/admin/members/${member.id}`}
                        className="font-medium text-brand-blue hover:text-brand-blue text-sm"
                      >
                        {member.first_name} {member.last_name}
                      </Link>
                    ) : (
                      <span className="font-medium text-brand-muted text-sm">Unknown member</span>
                    )}
                    {member?.email && (
                      <p className="text-xs text-brand-muted-soft mt-0.5">{member.email}</p>
                    )}
                  </div>
                  <p className="text-xs text-brand-muted-soft shrink-0">
                    Submitted {new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>

                {/* Activity data */}
                {isEditing ? (
                  <div className="grid grid-cols-2 gap-3 bg-brand-canvas rounded-lg p-4 border border-brand-border">
                    <div>
                      <label className="block text-xs text-brand-muted-soft mb-1">Event Year</label>
                      <input
                        type="number"
                        min={2000}
                        max={CURRENT_YEAR + 1}
                        value={editForm.event_year}
                        onChange={(e) => setEditForm((f) => ({ ...f, event_year: e.target.value }))}
                        className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-brand-muted-soft mb-1">Event Location</label>
                      <input
                        type="text"
                        value={editForm.event_location}
                        onChange={(e) => setEditForm((f) => ({ ...f, event_location: e.target.value }))}
                        className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-brand-muted-soft mb-1">Team</label>
                      <input
                        type="text"
                        value={editForm.team_name}
                        onChange={(e) => setEditForm((f) => ({ ...f, team_name: e.target.value }))}
                        className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-brand-muted-soft mb-1">Awards</label>
                      <input
                        type="text"
                        value={editForm.award}
                        onChange={(e) => setEditForm((f) => ({ ...f, award: e.target.value }))}
                        className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-brand-muted space-y-1 pl-1">
                    <p><span className="text-brand-muted-soft">Year:</span> {item.event_year ?? '—'}</p>
                    <p><span className="text-brand-muted-soft">Location:</span> {item.event_location ?? '—'}</p>
                    <p><span className="text-brand-muted-soft">Team:</span> {item.team_name ?? '—'}</p>
                    <p><span className="text-brand-muted-soft">Award:</span> {item.award ?? '—'}</p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-3 pt-1 border-t border-brand-hairline">
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => handleApprove(item.id, true)}
                        disabled={processing === item.id}
                        className="bg-green-600 text-white text-sm font-medium px-4 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50"
                      >
                        {processing === item.id ? 'Saving…' : 'Approve with edits'}
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="text-sm text-brand-muted-soft hover:text-brand-muted"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleApprove(item.id)}
                        disabled={processing === item.id}
                        className="bg-green-600 text-white text-sm font-medium px-4 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50"
                      >
                        {processing === item.id ? 'Approving…' : 'Approve'}
                      </button>
                      <button
                        onClick={() => startEdit(item)}
                        className="text-sm font-medium text-brand-blue hover:text-brand-blue border border-brand-blue px-3 py-1.5 rounded-lg"
                      >
                        Edit &amp; Approve
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        disabled={processing === item.id}
                        className="ml-auto text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
