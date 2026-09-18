'use client'

import { useState } from 'react'

// One click emails the durable pay page for an unpaid card registration to
// everyone on it (registrant + emergency contact, or organiser + teacher POC).
// Sits in the roster beside the delete action; the prompt lets an admin add an
// address that isn't on the registration — a parent who wrote in from their
// own inbox, for instance.
export function SendPayLinkButton({
  eventSlug,
  registrationId,
  className,
}: {
  eventSlug: string
  registrationId: string
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  async function send() {
    const extra = prompt(
      'Email the pay link to everyone on this registration.\n\nAdd any other address to include (optional, comma-separated):',
      '',
    )
    if (extra === null) return
    const extraRecipients = extra.split(',').map((e) => e.trim()).filter(Boolean)

    setBusy(true)
    setResult(null)
    try {
      const res = await fetch(`/api/admin/events/${eventSlug}/payment-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId, extraRecipients }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) setResult({ ok: false, text: data?.error ?? 'Failed to send.' })
      else setResult({ ok: true, text: `Sent to ${(data.recipients as string[]).join(', ')}` })
    } catch {
      setResult({ ok: false, text: 'Failed to send.' })
    }
    setBusy(false)
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <button
        type="button"
        onClick={send}
        disabled={busy}
        className="text-xs font-medium text-brand-blue hover:text-brand-blue-dark disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Send pay link'}
      </button>
      {result && (
        <span className={`text-xs ${result.ok ? 'text-green-700' : 'text-red-600'}`}>{result.text}</span>
      )}
    </span>
  )
}
