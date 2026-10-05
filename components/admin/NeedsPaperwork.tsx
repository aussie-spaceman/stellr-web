'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@stellr/web-ui'
import { formatDateShort } from '@/lib/utils'
import type { GapReason, PaperworkGap } from '@/lib/esign/needs-paperwork'

const REASON_LABEL: Record<GapReason, string> = {
  not_issued: 'Never sent',
  issue_failed: 'Could not be sent',
  voided: 'Voided or expired',
  declined: 'Declined',
  bounced: 'Email bounced: use Correct email on the roster',
}

// Admin → Consent forms → Needs paperwork: people at upcoming events with no
// agreement signed and none out for signature. "Send again" uses the roster's
// reissue route, which asks first when it would use a DocuSign envelope.

type RowState = { busy?: boolean; confirm?: string; done?: string; error?: string }

export function NeedsPaperwork({ gaps }: { gaps: PaperworkGap[] }) {
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const set = (id: string, s: RowState) => setRows((r) => ({ ...r, [id]: s }))

  async function send(g: PaperworkGap, confirmNewEnvelope = false) {
    set(g.participantId, { busy: true })
    try {
      const res = await fetch(`/api/admin/events/${encodeURIComponent(g.eventSlug)}/docusign-reissue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId: g.participantId, confirmNewEnvelope }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && data.needsConfirm) return set(g.participantId, { confirm: String(data.message ?? 'This sends a new agreement.') })
      if (!res.ok) return set(g.participantId, { error: String(data.error ?? 'Could not send it. Try again shortly.') })
      set(g.participantId, { done: 'Sent' })
    } catch {
      set(g.participantId, { error: 'Could not send it. Try again shortly.' })
    }
  }

  return (
    <section className="rounded-xl border border-line bg-white p-5 space-y-3" aria-labelledby="needs-paperwork-heading">
      <div>
        <h2 id="needs-paperwork-heading" className="font-heading text-lg font-semibold text-ink">Needs paperwork</h2>
        <p className="text-sm text-content-muted mt-0.5">
          {gaps.length
            ? 'People at upcoming events with no agreement signed and none out for signature.'
            : 'Everyone at an upcoming event has signed, or has an agreement out for signature.'}
        </p>
      </div>
      {gaps.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-content-muted">
              <tr className="border-b border-line">
                <th className="py-2 pr-4 font-semibold">Person</th>
                <th className="py-2 pr-4 font-semibold">Event</th>
                <th className="py-2 pr-4 font-semibold">What happened</th>
                <th className="py-2 font-semibold"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((g) => {
                const s = rows[g.participantId] ?? {}
                return (
                  <tr key={g.participantId} className="border-b border-line last:border-0 align-top">
                    <td className="py-2 pr-4 text-ink">{g.name}</td>
                    <td className="py-2 pr-4">
                      <Link href={`/admin/competitions/${encodeURIComponent(g.eventSlug)}`} className="text-primary underline">{g.eventTitle}</Link>
                      <span className="block text-xs text-content-muted">{formatDateShort(g.eventDate)}</span>
                    </td>
                    <td className="py-2 pr-4 text-ink">
                      {REASON_LABEL[g.reason]}
                      {g.since && <span className="text-content-muted">{` · ${formatDateShort(g.since)}`}</span>}
                      {g.detail && <span className="block text-xs text-content-muted">{g.detail.slice(0, 160)}</span>}
                    </td>
                    <td className="py-2 text-right">
                      {s.done ? (
                        <span role="status" className="text-ink">{s.done}</span>
                      ) : s.confirm ? (
                        <div className="space-y-1 text-left">
                          <p className="text-xs text-content-muted">{s.confirm}</p>
                          <Button variant="softAmber" disabled={s.busy} onClick={() => send(g, true)}>Yes, send it</Button>
                        </div>
                      ) : (
                        <Button variant="softBlue" disabled={s.busy} onClick={() => send(g)}>
                          {s.busy ? 'Sending…' : g.reason === 'not_issued' ? 'Send' : 'Send again'}
                        </Button>
                      )}
                      {s.error && <p role="alert" className="mt-1 text-xs text-danger">{s.error}</p>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
