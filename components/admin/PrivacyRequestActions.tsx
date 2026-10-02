'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@stellr/web-ui'

// Answering a privacy request: mark it in progress, or close it with a note of
// what was done (or why it was refused). The note is the record.

export function PrivacyRequestActions({ id, status }: { id: string; status: string }) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function update(next: 'in_progress' | 'completed' | 'refused') {
    setBusy(true); setError(null)
    const res = await fetch(`/api/admin/privacy-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next, note: note.trim() || undefined }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setError(data.error ?? 'Could not update it.')
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm text-ink">
        <span className="block font-semibold">What was done, or why not</span>
        <textarea rows={3} maxLength={2000} className="mt-1 w-full rounded-control border border-line px-3 py-2" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        {status === 'verified' && <Button variant="secondaryStrong" disabled={busy} onClick={() => update('in_progress')}>Mark in progress</Button>}
        <Button variant="primaryStrong" disabled={busy || !note.trim()} onClick={() => update('completed')}>Done</Button>
        <Button variant="secondaryStrong" disabled={busy || !note.trim()} onClick={() => update('refused')}>Refuse</Button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  )
}
