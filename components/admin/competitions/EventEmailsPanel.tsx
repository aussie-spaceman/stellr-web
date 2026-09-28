'use client'

import { useCallback, useEffect, useState } from 'react'
import { EVENT_EMAIL_DEFAULTS } from '@/lib/event-emails/defaults'
import { scheduledSendDate } from '@/lib/event-emails/schedule'
import { AUDIENCES, type EventEmailRow, type EventEmailSendRow } from '@/lib/event-emails/types'
import { EventEmailEditor } from './EventEmailEditor'
import { EventEmailHistory } from './EventEmailHistory'

const STATUS_PILL: Record<EventEmailRow['status'], { label: string; className: string }> = {
  draft:     { label: 'Draft',     className: 'bg-brand-hairline text-brand-muted' },
  scheduled: { label: 'Scheduled', className: 'bg-primary-soft text-primary' },
  sending:   { label: 'Sending',   className: 'bg-orange-100 text-orange-700' },
  sent:      { label: 'Sent',      className: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Cancelled', className: 'bg-brand-hairline text-brand-muted-soft' },
  skipped:   { label: 'Skipped',   className: 'bg-brand-hairline text-brand-muted-soft' },
}

function shortDate(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// The event's "Email Reminders" tab: compose, schedule and send merge-field
// emails to groups on this event's roster, and see what has been sent.
export function EventEmailsPanel({ eventSlug, eventDate }: { eventSlug: string; eventDate: string | null }) {
  const [emails, setEmails] = useState<EventEmailRow[]>([])
  const [history, setHistory] = useState<EventEmailSendRow[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/events/${eventSlug}/emails`)
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setError(data?.error ?? 'Could not load emails.')
    } else {
      setEmails(data.emails)
      setHistory(data.history)
    }
    setLoading(false)
  }, [eventSlug])

  useEffect(() => { void load() }, [load])

  async function add(templateKey: string) {
    if (!templateKey) return
    setAdding(true)
    const res = await fetch(`/api/admin/events/${eventSlug}/emails`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateKey }),
    })
    const data = await res.json().catch(() => null)
    setAdding(false)
    if (!res.ok) return setError(data?.error ?? 'Could not add the email.')
    setEmails((cur) => [...cur, data.email])
    setSelected(data.email.id)
  }

  const current = emails.find((e) => e.id === selected) ?? null

  if (loading) return <p className="text-sm text-brand-muted-soft">Loading…</p>

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-muted">Emails</h2>
            <p className="mt-0.5 text-xs text-brand-muted-soft">
              One email per person, filled in with their details. Schedule relative to the event date, or send now.
            </p>
          </div>
          <select
            value=""
            disabled={adding}
            onChange={(e) => void add(e.target.value)}
            className="rounded-lg border border-brand-border bg-white px-3 py-1.5 text-sm text-brand-muted"
            aria-label="Add an email"
          >
            <option value="">{adding ? 'Adding…' : '+ Add email…'}</option>
            {EVENT_EMAIL_DEFAULTS.map((d) => (
              <option key={d.key} value={d.key}>{d.name}</option>
            ))}
            <option value="blank">Blank email</option>
          </select>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {emails.length === 0 ? (
          <p className="rounded-xl border border-dashed border-brand-border bg-white px-4 py-6 text-center text-sm text-brand-muted-soft">
            No emails yet. Add one from a starter template above.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {emails.map((e) => {
              const pill = STATUS_PILL[e.status]
              const when =
                e.status === 'scheduled' && e.schedule_days_before != null && eventDate
                  ? `Sends ${shortDate(scheduledSendDate(eventDate, e.schedule_days_before))}`
                  : e.status === 'sent' && e.sent_at
                    ? `Sent ${new Date(e.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Denver' })}`
                    : null
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(e.id === selected ? null : e.id)}
                    aria-pressed={e.id === selected}
                    className={`w-full rounded-xl border bg-white p-3 text-left transition-colors hover:border-primary ${
                      e.id === selected ? 'border-primary' : 'border-brand-border'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-ink">{e.name}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${pill.className}`}>{pill.label}</span>
                    </div>
                    <p className="mt-1 text-xs text-brand-muted-soft">
                      {e.audiences.length
                        ? e.audiences.map((k) => AUDIENCES.find((a) => a.key === k)?.label ?? k).join(', ')
                        : 'No groups chosen'}
                      {when && ` · ${when}`}
                    </p>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {current && (
          <EventEmailEditor
            key={current.id}
            eventSlug={eventSlug}
            eventDate={eventDate}
            email={current}
            onChanged={(updated, opts) => {
              setEmails((cur) => cur.map((e) => (e.id === updated.id ? updated : e)))
              if (opts?.refreshHistory) void load()
            }}
            onDeleted={(id) => {
              setEmails((cur) => cur.filter((e) => e.id !== id))
              setSelected(null)
            }}
            onDuplicated={(copy) => {
              setEmails((cur) => [...cur, copy])
              setSelected(copy.id)
            }}
          />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-muted">History</h2>
        <EventEmailHistory history={history} />
      </section>
    </div>
  )
}
