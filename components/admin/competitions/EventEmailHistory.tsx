'use client'

import { Fragment, useState } from 'react'
import { AUDIENCES, ROLE_LABEL, type EventEmailSendRow } from '@/lib/event-emails/types'

const TRIGGER_LABEL: Record<EventEmailSendRow['trigger'], string> = {
  manual: 'Sent now',
  schedule: 'Scheduled',
  test: 'Test',
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver',
  })
}

const audienceLabel = (key: string) => AUDIENCES.find((a) => a.key === key)?.label ?? key

// Every send from this tab — manual, scheduled and tests. Counts only: there is
// deliberately no open/read tracking. Expanding a row lists who it went to.
export function EventEmailHistory({ history }: { history: EventEmailSendRow[] }) {
  const [open, setOpen] = useState<string | null>(null)

  if (history.length === 0) {
    return <p className="text-sm text-brand-muted-soft">Nothing has been sent from this tab yet.</p>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-brand-border bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-brand-hairline text-left text-xs uppercase tracking-wide text-brand-muted-soft">
            <th className="px-4 py-2 font-medium">When (MT)</th>
            <th className="px-4 py-2 font-medium">Email</th>
            <th className="px-4 py-2 font-medium">Sent to</th>
            <th className="px-4 py-2 font-medium">Result</th>
            <th className="px-4 py-2 font-medium">How</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <Fragment key={h.id}>
              <tr
                className="cursor-pointer border-b border-brand-hairline last:border-0 hover:bg-surface"
                onClick={() => setOpen(open === h.id ? null : h.id)}
                aria-expanded={open === h.id}
              >
                <td className="whitespace-nowrap px-4 py-2.5 text-brand-muted">{when(h.started_at)}</td>
                <td className="px-4 py-2.5">
                  <p className="font-medium text-ink">{h.email_name}</p>
                  <p className="text-xs text-brand-muted-soft">{h.subject}</p>
                </td>
                <td className="px-4 py-2.5 text-brand-muted">{h.audiences.map(audienceLabel).join(', ')}</td>
                <td className="whitespace-nowrap px-4 py-2.5">
                  {h.finished_at == null ? (
                    <span className="text-orange-700">Incomplete</span>
                  ) : (
                    <>
                      <span className="text-ink">{h.sent_count} sent</span>
                      {h.failed_count > 0 && <span className="ml-2 text-red-600">{h.failed_count} failed</span>}
                      {h.docusign_resent > 0 && (
                        <span className="block text-xs text-brand-muted-soft">{h.docusign_resent} DocuSign re-sent</span>
                      )}
                    </>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-brand-muted">
                  {TRIGGER_LABEL[h.trigger]}
                  {h.triggered_by && h.trigger !== 'schedule' && (
                    <span className="block text-xs text-brand-muted-soft">{h.triggered_by}</span>
                  )}
                </td>
              </tr>
              {open === h.id && (
                <tr className="border-b border-brand-hairline bg-surface">
                  <td colSpan={5} className="px-4 py-3">
                    {h.recipients.length === 0 ? (
                      <p className="text-xs text-brand-muted-soft">Nobody matched these groups when it ran.</p>
                    ) : (
                      <ul className="grid gap-1 text-xs sm:grid-cols-2">
                        {h.recipients.map((r) => (
                          <li key={r.email} className={r.status === 'failed' ? 'text-red-600' : 'text-brand-muted'}>
                            {r.name !== r.email && <span className="text-ink">{r.name} · </span>}
                            {r.email}
                            {r.roles.length > 0 && ` (${r.roles.map((x) => ROLE_LABEL[x] ?? x).join(', ')})`}
                            {r.status === 'failed' && ` — failed${r.error ? `: ${r.error}` : ''}`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
