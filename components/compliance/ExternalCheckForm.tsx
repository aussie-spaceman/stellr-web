'use client'

import { useState } from 'react'
import { Field, Input } from '@stellr/web-ui'
import { postUpload, uploadDirectToStorage } from '@/lib/upload-client'

// Submit a background check the member already holds from another
// organisation. Used by the member (account page) and an admin (member page).
// The document is mandatory, so it is part of the one submit: the file goes
// browser → storage first, then the details are posted with its path. Nothing
// is saved if either step fails.

export interface ExternalCheckFormValues {
  issuer: string
  completed_on: string
  document_expires_on: string | null
}

export function ExternalCheckForm({
  mode,
  memberId,
  initial,
  onSaved,
  onCancel,
}: {
  mode: 'member' | 'admin'
  /** Required for mode 'admin'. */
  memberId?: string
  initial?: ExternalCheckFormValues | null
  onSaved: () => void | Promise<void>
  onCancel?: () => void
}) {
  const [issuer, setIssuer] = useState(initial?.issuer ?? '')
  const [completedOn, setCompletedOn] = useState(initial?.completed_on ?? '')
  const [expiresOn, setExpiresOn] = useState(initial?.document_expires_on ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const today = new Date().toISOString().slice(0, 10)

  async function submit() {
    setError('')
    if (!issuer.trim()) return setError('Say who ran the check.')
    if (!completedOn) return setError('Enter the date the check was completed.')
    // A replacement needs a document too: verification resets, so the admin must see the current one.
    if (!file) return setError('Upload the background check document (image or PDF).')

    setSaving(true)
    try {
      const stored =
        mode === 'admin'
          ? await uploadDirectToStorage(file, 'external-bc-document-admin', { memberId })
          : await uploadDirectToStorage(file, 'external-bc-document')
      if ('error' in stored) return setError(stored.error)

      const body = JSON.stringify({
        ...(mode === 'admin' ? { action: 'save' } : {}),
        issuer: issuer.trim(),
        completed_on: completedOn,
        document_expires_on: expiresOn || null,
        storagePath: stored.storagePath,
        fileType: stored.fileType,
      })
      const url = mode === 'admin' ? `/api/admin/members/${memberId}/external-check` : '/api/members/compliance/external-check'
      const result = await postUpload(url, body, { headers: { 'Content-Type': 'application/json' } })
      if ('error' in result) return setError(result.error)
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* A check's details, not the member's contact details: no autofill. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Issued by" hint="School district, state agency or screening company">
          <Input type="text" autoComplete="off" maxLength={200} value={issuer} onChange={(e) => setIssuer(e.target.value)} />
        </Field>
        <Field label="Date completed">
          <Input type="date" autoComplete="off" max={today} value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} />
        </Field>
        <Field label="Expiry date (if shown)" hint="Leave blank if the document has none">
          <Input type="date" autoComplete="off" min={completedOn || undefined} value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        </Field>
      </div>
      <Field label="Document (required)" hint="Image or PDF, up to 10 MB. Only Stellr admins can see it.">
        <input
          type="file"
          accept="image/*,application/pdf"
          disabled={saving}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-content-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink"
        />
      </Field>
      <p className="text-xs text-content-muted">
        Counts for 3 years from the date completed, or until the expiry date if that is sooner. It does not clear you until
        Stellr has checked the document.
      </p>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-deep disabled:opacity-50"
        >
          {saving ? 'Uploading…' : 'Submit background check'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={saving} className="rounded-lg px-4 py-2 text-sm font-medium text-content-muted hover:text-ink">
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
