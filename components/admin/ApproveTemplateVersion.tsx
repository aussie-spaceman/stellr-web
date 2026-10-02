'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@stellr/web-ui'

// Approving a document version puts it in use for every new agreement of its
// kind. The approver types the version's name, so it is never a stray click,
// and the server runs every check again before accepting it.

export function ApproveTemplateVersion({ id, label }: { id: string; label: string }) {
  const router = useRouter()
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; issues?: string[] } | null>(null)

  async function approve(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const res = await fetch(`/api/admin/esign/templates/${id}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setError({ text: data.error ?? 'Approval failed.', issues: data.issues })
    router.refresh()
  }

  return (
    <form onSubmit={approve} className="space-y-2 rounded-xl border border-line bg-white p-4">
      <h3 className="font-heading text-base font-semibold text-ink">Approve this version</h3>
      <p className="text-sm text-content-muted">
        {`Once approved, every new agreement of this kind uses it, and it can never be changed. Read both copies above and check every field first. Type ${label} to confirm.`}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-ink">
          <span className="sr-only">{`Type ${label} to confirm`}</span>
          <input className="rounded-control border border-line px-2 py-1.5" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={label} />
        </label>
        <Button type="submit" variant="primaryStrong" disabled={busy || confirm.trim() !== label}>
          {busy ? 'Checking…' : 'Approve and put in use'}
        </Button>
      </div>
      {error && (
        <div role="alert" className="text-sm text-danger">
          <p>{error.text}</p>
          {error.issues?.length ? <ul className="list-disc pl-5">{error.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null}
        </div>
      )}
    </form>
  )
}
