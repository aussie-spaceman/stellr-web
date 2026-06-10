'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Participation {
  id: string
  event_year: number | null
  event_location: string | null
  team_name: string | null
  award: string | null
  status?: string | null
}

interface Props {
  participations: Participation[]
  /** Set to a member-id to enable add/delete controls (member portal) */
  editable?: boolean
  /** Admin-mode: supply the member id for the POST endpoint */
  adminMemberId?: string
}

const CURRENT_YEAR = new Date().getFullYear()

function blankForm() {
  return { event_year: '', event_location: '', team_name: '', award: '' }
}

export function EventHistory({ participations: initialParticipations, editable = false, adminMemberId }: Props) {
  const router = useRouter()
  const [items, setItems] = useState(initialParticipations)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(blankForm())
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const postUrl = adminMemberId
    ? `/api/admin/members/${adminMemberId}/event-participations`
    : '/api/members/event-participations'

  const deleteUrl = (id: string) => adminMemberId
    ? `/api/admin/event-participations/${id}`
    : `/api/members/event-participations/${id}`

  async function handleAdd() {
    setSaving(true)
    const res = await fetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_year: form.event_year ? parseInt(form.event_year) : null,
        event_location: form.event_location || null,
        team_name: form.team_name || null,
        award: form.award || null,
      }),
    })
    setSaving(false)
    if (res.ok) {
      const { participation } = await res.json()
      setItems((prev) => [participation, ...prev].sort((a, b) => (b.event_year ?? 0) - (a.event_year ?? 0)))
      setForm(blankForm())
      setAdding(false)
      router.refresh()
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    const res = await fetch(deleteUrl(id), { method: 'DELETE' })
    setDeletingId(null)
    if (res.ok) {
      setItems((prev) => prev.filter((p) => p.id !== id))
      router.refresh()
    }
  }

  const sorted = [...items].sort((a, b) => (b.event_year ?? 0) - (a.event_year ?? 0))

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-900">
          {adminMemberId ? 'Event Activity' : 'Log Historical Event Activity'}
        </h2>
        {editable && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-sm font-medium text-brand-blue hover:text-brand-blue-dark"
          >
            <span className="text-lg leading-none">+</span> Add activity
          </button>
        )}
      </div>

      {!adminMemberId && !adding && (
        <p className="text-xs text-gray-400 mb-4">
          Log past Stellr events you&apos;ve participated in. Submissions are reviewed by an admin before appearing on your profile.
        </p>
      )}

      {adding && (
        <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
          <h3 className="text-sm font-medium text-gray-700">New event activity</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Event Year</label>
              <input
                type="number"
                min={2000}
                max={CURRENT_YEAR + 1}
                placeholder={String(CURRENT_YEAR)}
                value={form.event_year}
                onChange={(e) => setForm((f) => ({ ...f, event_year: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Event Location</label>
              <input
                type="text"
                placeholder="City, State"
                value={form.event_location}
                onChange={(e) => setForm((f) => ({ ...f, event_location: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Team</label>
              <input
                type="text"
                placeholder="Team / company name"
                value={form.team_name}
                onChange={(e) => setForm((f) => ({ ...f, team_name: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Awards</label>
              <input
                type="text"
                placeholder="e.g. 1st Place"
                value={form.award}
                onChange={(e) => setForm((f) => ({ ...f, award: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleAdd}
              disabled={saving}
              className="bg-brand-blue text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => { setAdding(false); setForm(blankForm()) }}
              className="border border-gray-200 text-gray-600 px-4 py-1.5 rounded-lg text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {sorted.length === 0 && !adding ? (
        <p className="text-sm text-gray-500">No events recorded yet.</p>
      ) : (
        <div className="space-y-3">
          {sorted.map((p) => (
            <div
              key={p.id}
              className="flex items-start justify-between py-3 border-b border-gray-100 last:border-0"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {p.event_year ?? '—'}
                  {p.event_location ? ` · ${p.event_location}` : ''}
                </p>
                {p.team_name && (
                  <p className="text-xs text-gray-500 mt-0.5">Team: {p.team_name}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {p.status === 'pending' && (
                  <span
                    className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium"
                    title="Submitted and awaiting admin approval before appearing on your profile."
                  >
                    Pending review
                  </span>
                )}
                {p.award && (
                  <span
                    className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full font-medium"
                    title={`Award received at this event: ${p.award}`}
                  >
                    {p.award}
                  </span>
                )}
                {editable && (p.status === 'pending' || adminMemberId) && (
                  <button
                    onClick={() => handleDelete(p.id)}
                    disabled={deletingId === p.id}
                    className="text-gray-300 hover:text-red-400 text-sm disabled:opacity-50 ml-1"
                    title={p.status === 'pending' ? 'Withdraw submission' : 'Remove'}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
