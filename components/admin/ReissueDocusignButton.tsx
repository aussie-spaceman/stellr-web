'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Re-sends a participant's outstanding DocuSign from the roster. A live envelope
// is resent for free; if a new envelope is needed (voided, declined, never
// issued, or a bounced address) the server says so first and we ask before
// spending one of the plan's 40 monthly envelopes.
export function ReissueDocusignButton({
  eventSlug,
  participantId,
  className,
}: {
  eventSlug: string
  participantId: string
  className?: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  async function call(confirmNewEnvelope: boolean) {
    const res = await fetch(`/api/admin/events/${eventSlug}/docusign-reissue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId, confirmNewEnvelope }),
    })
    return { res, data: await res.json().catch(() => null) }
  }

  async function reissue() {
    setBusy(true)
    setResult(null)
    try {
      let { res, data } = await call(false)
      if (res.status === 409 && data?.needsConfirm) {
        const ok = confirm(
          `${data.message}\n\nIssue a new DocuSign? This uses 1 of the 40 envelopes available each month.`,
        )
        if (!ok) {
          setBusy(false)
          return
        }
        ;({ res, data } = await call(true))
      }
      if (!res.ok) {
        setResult({ ok: false, text: data?.error ?? 'Failed to reissue.' })
      } else {
        setResult(
          data.action === 'resent'
            ? { ok: true, text: data.recipients > 0 ? 'Re-sent' : 'Nobody left to sign' }
            : { ok: true, text: data.outcome === 'issued' ? 'New envelope issued' : `No envelope sent (${data.outcome})` },
        )
        router.refresh() // so the DocuSign pill shows the new envelope
      }
    } catch {
      setResult({ ok: false, text: 'Failed to reissue.' })
    }
    setBusy(false)
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <button
        type="button"
        onClick={reissue}
        disabled={busy}
        className="text-xs font-medium text-brand-blue hover:text-brand-blue-dark disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Reissue DocuSign'}
      </button>
      {result && (
        <span className={`text-xs ${result.ok ? 'text-green-700' : 'text-red-600'}`}>{result.text}</span>
      )}
    </span>
  )
}
