'use client'

import { useCallback, useEffect, useState } from 'react'
import { Collapsible } from '@stellr/web-ui'
import { EVENT_EMAIL_DEFAULTS } from '@/lib/event-emails/defaults'
import { scheduledSendDate } from '@/lib/event-emails/schedule'
import type { EventEmailTemplateRow } from '@/lib/event-emails/templates'
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
  const [templates, setTemplates] = useState<EventEmailTemplateRow[]>([])
  const [managing, setManaging] = useState(false)

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

  const loadTemplates = useCallback(async () => {
    const res = await fetch(`/api/admin/events/${eventSlug}/email-templates`)
    const data = await res.json().catch(() => null)
    if (res.ok) setTemplates(data.templates)
  }, [eventSlug])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadTemplates() }, [loadTemplates])

  const sortTemplates = (list: EventEmailTemplateRow[]) => [...list].sort((a, b) => a.name.localeCompare(b.name))

  async function add(choice: string) {
    if (!choice) return
    setAdding(true)
    const saved = choice.startsWith('saved:') ? choice.slice(6) : null
    const res = await fetch(`/api/admin/events/${eventSlug}/emails`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(saved ? { savedTemplateId: saved } : { templateKey: choice }),
    })
    const data = await res.json().catch(() => null)
    setAdding(false)
    if (!res.ok) return setError(data?.error ?? 'Could not add the email.')
    setEmails((cur) => [...cur, data.email])
    setSelected(data.email.id)
  }

  async function renameTemplate(t: EventEmailTemplateRow) {
    const name = prompt('Rename the template', t.name)?.trim()
    if (!name || name === t.name) return
    const res = await fetch(`/api/admin/events/${eventSlug}/email-templates/${t.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) return setError(data?.error ?? 'Could not rename the template.')
    setTemplates((cur) => sortTemplates(cur.map((x) => (x.id === t.id ? data.template : x))))
  }

  async function deleteTemplate(t: EventEmailTemplateRow) {
    if (!confirm(`Delete the template “${t.name}” for every event? Emails already made from it are not affected.`)) return
    const res = await fetch(`/api/admin/events/${eventSlug}/email-templates/${t.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => null)
    if (!res.ok) return setError(data?.error ?? 'Could not delete the template.')
    setTemplates((cur) => cur.filter((x) => x.id !== t.id))
  }

  const current = emails.find((e) => e.id === selected) ?? null
  const scheduledCount = emails.filter((e) => e.status === 'scheduled').length
  const sentCount = emails.filter((e) => e.status === 'sent').length
  const emailsSummary = [`${emails.length} email${emails.length === 1 ? '' : 's'}`, scheduledCount && `${scheduledCount} scheduled`, sentCount && `${sentCount} sent`]
    .filter(Boolean)
    .join(' · ')

  if (loading) return <p className="text-sm text-brand-muted-soft">Loading…</p>

  return (
    <div className="space-y-4">
      <Collapsible
        id="emails"
        title="Emails"
        summary={emailsSummary}
        description="One email per person, filled in with their details. Schedule relative to the event date, or send now."
        actions={
          <select
            value=""
            disabled={adding}
            onChange={(e) => void add(e.target.value)}
            className="rounded-lg border border-line-strong bg-white px-3 py-1.5 text-input mouse:text-sm text-brand-muted"
            aria-label="Add an email"
          >
            <option value="">{adding ? 'Adding…' : '+ Add email…'}</option>
            {templates.length > 0 && (
              <optgroup label="Saved templates">
                {templates.map((t) => (
                  <option key={t.id} value={`saved:${t.id}`}>{t.name}</option>
                ))}
              </optgroup>
            )}
            <optgroup label="Starter templates">
              {EVENT_EMAIL_DEFAULTS.map((d) => (
                <option key={d.key} value={d.key}>{d.name}</option>
              ))}
              <option value="blank">Blank email</option>
            </optgroup>
          </select>
        }
        bodyClassName="space-y-3 p-4"
      >

        {templates.length > 0 && (
          <div className="text-xs text-brand-muted-soft">
            <button type="button" className="font-medium text-primary hover:text-primary-deep" onClick={() => setManaging((m) => !m)} aria-expanded={managing}>
              {managing ? 'Hide saved templates' : `Manage saved templates (${templates.length})`}
            </button>
            {managing && (
              <ul className="mt-2 divide-y divide-brand-hairline rounded-xl border border-brand-border bg-white">
                {templates.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <span className="font-medium text-ink">{t.name}</span>
                    <span className="text-xs text-brand-muted-soft">
                      Saved {new Date(t.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Denver' })}
                      {t.updated_by && ` by ${t.updated_by}`}
                    </span>
                    <span className="ml-auto flex gap-3">
                      <button type="button" className="text-sm font-medium text-primary hover:text-primary-deep" onClick={() => void renameTemplate(t)}>Rename</button>
                      <button type="button" className="text-sm text-red-600 hover:text-red-800" onClick={() => void deleteTemplate(t)}>Delete</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {managing && <p className="mt-1">Saved templates are shared across every event. To update one, open an email and choose “Save as template” with the same name.</p>}
          </div>
        )}

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
            templates={templates}
            onTemplateSaved={(t) => setTemplates((cur) => sortTemplates([...cur.filter((x) => x.id !== t.id), t]))}
          />
        )}
      </Collapsible>

      <Collapsible
        id="emails-history"
        title="History"
        summary={`${history.length} send${history.length === 1 ? '' : 's'}`}
        bodyClassName="p-4"
      >
        <EventEmailHistory history={history} />
      </Collapsible>
    </div>
  )
}
