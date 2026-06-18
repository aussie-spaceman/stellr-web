'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Assignment {
  id: string
  clerk_user_id: string
  email?: string | null
}

export default function EventManagerAssignments({
  eventSlug,
  initialAssignments,
}: {
  eventSlug: string
  initialAssignments: Assignment[]
}) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    if (!email.trim()) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/admin/event-managers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), event_slug: eventSlug }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.error ?? 'Failed to add event manager')
      return
    }
    setEmail('')
    router.refresh()
  }

  async function remove(clerkUserId: string) {
    setBusy(true)
    await fetch('/api/admin/event-managers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clerk_user_id: clerkUserId, event_slug: eventSlug }),
    })
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="bg-white rounded-xl border border-brand-border p-4 space-y-3">
      <h3 className="text-sm font-semibold text-brand-muted uppercase tracking-wide">Event Managers</h3>
      {initialAssignments.length === 0 ? (
        <p className="text-sm text-brand-muted-soft">No event managers assigned to this event.</p>
      ) : (
        <ul className="space-y-1.5">
          {initialAssignments.map((a) => (
            <li key={a.id} className="flex items-center justify-between text-sm">
              <span className="text-brand-muted">{a.email ?? a.clerk_user_id}</span>
              <button
                onClick={() => remove(a.clerk_user_id)}
                disabled={busy}
                className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="manager@email.com"
          className="flex-1 border border-brand-border rounded-lg px-3 py-1.5 text-sm"
        />
        <button
          onClick={add}
          disabled={busy || !email.trim()}
          className="text-sm font-medium bg-brand-blue text-white rounded-lg px-3 py-1.5 disabled:opacity-50"
        >
          Assign
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-xs text-brand-muted-soft">
        The user must already have an account with the Event Manager role in Clerk.
      </p>
    </div>
  )
}
