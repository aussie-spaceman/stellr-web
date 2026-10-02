'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@stellr/web-ui'
import { ROLE_LABEL, type RecipientRole } from '@/lib/event-emails/types'

interface Status {
  eligible: boolean
  open: boolean
  pending: { email: string; name: string; roles: RecipientRole[] }[]
}

// Shown on a sent All-participants email: who has registered since it went out
// and is still owed it. The cron catches them up three times a day; the button
// does it now. Each catch-up shows in History as "Late registrants".
export function EventEmailCatchUp({
  eventSlug,
  emailId,
  onSent,
}: {
  eventSlug: string
  emailId: string
  onSent: () => void
}) {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const url = `/api/admin/events/${eventSlug}/emails/${emailId}/catch-up`

  const load = useCallback(async () => {
    const res = await fetch(url)
    const data = await res.json().catch(() => null)
    if (res.ok) setStatus(data)
    else setMessage({ ok: false, text: data?.error ?? 'Could not check for late registrants.' })
  }, [url])

  useEffect(() => { void load() }, [load])

  async function send() {
    if (!status?.pending.length) return
    const n = status.pending.length
    if (!confirm(`Send this email to ${n} late registrant${n === 1 ? '' : 's'} now?`)) return
    setBusy(true)
    setMessage(null)
    const res = await fetch(url, { method: 'POST' })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) return setMessage({ ok: false, text: data?.error ?? 'Send failed.' })
    setMessage({
      ok: data.failed === 0,
      text: data.recipients === 0
        ? 'Nobody was waiting for it. Everyone registered has it.'
        : `Sent to ${data.sent} of ${data.recipients}${data.failed ? `. ${data.failed} failed (see History)` : ''}.`,
    })
    onSent()
    void load()
  }

  if (!status?.eligible && !message) return null

  return (
    <div className="space-y-2 rounded-md border border-brand-border px-3 py-3 text-sm">
      <p className="font-medium text-ink">Late registrants</p>
      {status && !status.open ? (
        <p className="text-brand-muted">The event has passed, so late registrants are no longer sent this.</p>
      ) : status && status.pending.length === 0 ? (
        <p className="text-brand-muted">
          Everyone registered has this. Anyone who registers before the event gets it automatically
          at the next send (9am, 11am or 1pm MT).
        </p>
      ) : status ? (
        <>
          <p className="text-brand-muted">
            {status.pending.length} {status.pending.length === 1 ? 'person has' : 'people have'} registered since this went out.
            They get it at the next automatic send (9am, 11am or 1pm MT), or you can send it now.
          </p>
          <ul className="grid gap-1 text-xs text-brand-muted sm:grid-cols-2">
            {status.pending.map((r) => (
              <li key={r.email}>
                {r.name !== r.email && <span className="text-ink">{r.name} · </span>}
                {r.email}
                {r.roles.length > 0 && ` (${r.roles.map((x) => ROLE_LABEL[x] ?? x).join(', ')})`}
              </li>
            ))}
          </ul>
          <Button variant="primary" className="!px-4 !py-2" disabled={busy} onClick={send}>
            {busy ? 'Sending…' : `Send to ${status.pending.length} late registrant${status.pending.length === 1 ? '' : 's'}`}
          </Button>
        </>
      ) : null}
      {message && <p className={message.ok ? 'text-green-700' : 'text-red-600'}>{message.text}</p>}
    </div>
  )
}
