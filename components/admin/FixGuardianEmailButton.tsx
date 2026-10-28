'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Button } from '@stellr/web-ui'
import { X } from 'lucide-react'

// "Fix guardian email" on a student whose consent form could not be sent (or
// was never issued): saves the corrected parent/guardian address on the
// participant and member records, then sends the form. Uses one new envelope.
// Server: /api/admin/events/[slug]/participants/[pid]/guardian.
// A form already out for signing is fixed with Correct email instead.

export function FixGuardianEmailButton({
  eventSlug,
  participantId,
  studentName,
  currentEmail,
  className,
}: {
  eventSlug: string
  participantId: string
  studentName: string
  currentEmail: string | null
  className?: string
}) {
  const router = useRouter()
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(currentEmail ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  // Rendered into <body> so a table cell's nowrap doesn't clip it.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  function open() {
    setDraft(currentEmail ?? '')
    setError(null)
    setDone(null)
    dialog.current?.showModal()
  }

  async function save() {
    setBusy(true)
    setError(null)
    setDone(null)
    const res = await fetch(`/api/admin/events/${eventSlug}/participants/${participantId}/guardian`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: draft }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (data?.saved) router.refresh()
    if (!res.ok) {
      setError(data?.error ?? 'The email was not saved.')
      return
    }
    setDone(
      data.outcome === 'issued'
        ? 'Saved. The consent form has been sent.'
        : `Saved. No new form was sent (${String(data.outcome).replace(/_/g, ' ')}).`,
    )
  }

  const unchanged = draft.trim().toLowerCase() === (currentEmail ?? '').trim().toLowerCase()

  return (
    <>
      <button type="button" onClick={open} className={`text-xs font-medium text-danger hover:text-primary-deep ${className ?? ''}`}>
        Fix guardian email
      </button>
      {mounted && createPortal(
        <dialog
          ref={dialog}
          className="w-[calc(100%-2rem)] max-w-lg rounded-ds-card border border-line p-0 text-left text-ink shadow-featured backdrop:bg-ink/40"
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 className="font-heading text-lg font-semibold">Parent / guardian email</h2>
              <p className="mt-1 text-sm text-content-secondary">
                For {studentName}. Saving updates their record and sends the consent form, which uses one
                new envelope.
              </p>
            </div>
            <button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className="text-content-muted hover:text-ink">
              <X size={18} />
            </button>
          </div>
          <div className="space-y-4 px-5 py-4">
            <label className="block text-xs text-content-secondary">
              Email
              <input
                type="email"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="mt-1 w-full rounded-control border border-line-strong px-3 py-2 text-input mouse:text-sm text-ink"
              />
            </label>
            <div className="flex justify-end">
              <Button
                variant="primaryStrong"
                className="!px-4 !py-2"
                disabled={!draft.trim() || unchanged || busy}
                onClick={save}
              >
                {busy ? 'Saving…' : 'Save and send'}
              </Button>
            </div>
            {done && <p role="status" className="text-sm text-enviro-green-text">{done}</p>}
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          </div>
        </dialog>,
        document.body,
      )}
    </>
  )
}
