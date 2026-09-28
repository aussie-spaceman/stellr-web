'use client'

import { useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/react'
import { Button } from '@stellr/web-ui'
import { Paperclip, X } from 'lucide-react'
import { RichTextEditor } from '@/components/community/RichTextEditor'
import { uploadDirectToStorage } from '@/lib/upload-client'
import {
  AUDIENCES,
  EVENT_MERGE_FIELDS,
  ROLE_LABEL,
  type AudienceKey,
  type EventEmailRow,
} from '@/lib/event-emails/types'
import { scheduledSendDate } from '@/lib/event-emails/schedule'

interface Preview {
  recipients: { email: string; name: string; roles: (keyof typeof ROLE_LABEL)[]; reasons: AudienceKey[] }[]
  count: number
  max: number
  docusignOutstanding: number
  sampleEmail: string | null
  rendered: { subject: string; html: string } | null
  renderError: string | null
}

const EDITABLE = ['draft', 'scheduled', 'cancelled']

function longDate(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function EventEmailEditor({
  eventSlug,
  eventDate,
  email,
  onChanged,
  onDeleted,
  onDuplicated,
}: {
  eventSlug: string
  eventDate: string | null
  email: EventEmailRow
  onChanged: (email: EventEmailRow, opts?: { refreshHistory?: boolean }) => void
  onDeleted: (id: string) => void
  onDuplicated: (email: EventEmailRow) => void
}) {
  const editable = EDITABLE.includes(email.status)
  const [name, setName] = useState(email.name)
  const [subject, setSubject] = useState(email.subject)
  const [body, setBody] = useState<JSONContent | null>((email.body_json as JSONContent) ?? null)
  const [audiences, setAudiences] = useState<AudienceKey[]>(email.audiences)
  const [resendDocusign, setResendDocusign] = useState(email.resend_docusign)
  const [daysBefore, setDaysBefore] = useState<string>(email.schedule_days_before == null ? '' : String(email.schedule_days_before))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const base = `/api/admin/events/${eventSlug}/emails/${email.id}`
  const touch = () => { setDirty(true); setPreview(null) }

  async function call(path: string, init?: RequestInit) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init })
    const data = await res.json().catch(() => null)
    return { ok: res.ok, data }
  }

  const payload = () => ({
    name,
    subject,
    body_json: body,
    audiences,
    resend_docusign: resendDocusign,
    schedule_days_before: daysBefore === '' ? null : Number(daysBefore),
  })

  /** Save pending edits; returns false (and shows why) on failure. */
  async function save(extra: Record<string, unknown> = {}, quiet = false): Promise<boolean> {
    if (!editable) return true
    const { ok, data } = await call(base, { method: 'PATCH', body: JSON.stringify({ ...payload(), ...extra }) })
    if (!ok) {
      setMessage({ ok: false, text: data?.error ?? 'Could not save.' })
      return false
    }
    setDirty(false)
    onChanged(data.email)
    if (!quiet) setMessage({ ok: true, text: 'Saved.' })
    return true
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label)
    setMessage(null)
    try { await fn() } catch { setMessage({ ok: false, text: 'Something went wrong — try again.' }) }
    setBusy(null)
  }

  const loadPreview = () => run('preview', async () => {
    if (dirty && !(await save({}, true))) return
    const { ok, data } = await call(`${base}/preview`)
    if (!ok) return setMessage({ ok: false, text: data?.error ?? 'Could not load the preview.' })
    setPreview(data)
  })

  const previewAs = (addr: string) => run('preview', async () => {
    const { ok, data } = await call(`${base}/preview?as=${encodeURIComponent(addr)}`)
    if (ok) setPreview(data)
  })

  const sendTest = () => run('test', async () => {
    if (dirty && !(await save({}, true))) return
    const { ok, data } = await call(`${base}/send`, { method: 'POST', body: JSON.stringify({ test: true }) })
    if (!ok) return setMessage({ ok: false, text: data?.error ?? 'Test failed.' })
    setMessage({ ok: true, text: `Test sent to ${data.testTo}.` })
    onChanged(email, { refreshHistory: true })
  })

  const sendNow = () => run('send', async () => {
    if (dirty && !(await save({}, true))) return
    const { ok, data: pv } = await call(`${base}/preview`)
    if (!ok) return setMessage({ ok: false, text: pv?.error ?? 'Could not count recipients.' })
    if (pv.renderError) return setMessage({ ok: false, text: pv.renderError })
    if (pv.count === 0) return setMessage({ ok: false, text: 'Nobody matches these groups right now.' })
    const docusign = resendDocusign && audiences.includes('docusign_outstanding') && pv.docusignOutstanding > 0
      ? `\n\nDocuSign will also be re-sent for ${pv.docusignOutstanding} participant${pv.docusignOutstanding === 1 ? '' : 's'} first.`
      : ''
    if (!confirm(`Send “${subject}” to ${pv.count} ${pv.count === 1 ? 'person' : 'people'} now?${docusign}`)) return
    setMessage({ ok: true, text: `Sending to ${pv.count}… this can take up to a minute.` })
    const { ok: sent, data } = await call(`${base}/send`, { method: 'POST', body: '{}' })
    if (!sent) return setMessage({ ok: false, text: data?.error ?? 'Send failed.' })
    setMessage({
      ok: data.failed === 0,
      text: `Sent to ${data.sent} of ${data.recipients}${data.failed ? ` — ${data.failed} failed (see History)` : ''}.`,
    })
    onChanged({ ...email, status: 'sent', sent_at: new Date().toISOString() }, { refreshHistory: true })
  })

  const schedule = () => run('schedule', async () => {
    if (daysBefore === '') return setMessage({ ok: false, text: 'Choose how many days before the event to send it.' })
    if (await save({ status: 'scheduled' }, true)) setMessage({ ok: true, text: 'Scheduled.' })
  })

  const unschedule = () => run('schedule', async () => {
    if (await save({ status: 'draft' }, true)) setMessage({ ok: true, text: 'Unscheduled — back to draft.' })
  })

  const remove = () => run('delete', async () => {
    if (!confirm(`Delete “${name}”? This can't be undone.`)) return
    const { ok, data } = await call(base, { method: 'DELETE' })
    if (!ok) return setMessage({ ok: false, text: data?.error ?? 'Could not delete.' })
    onDeleted(email.id)
  })

  const duplicate = () => run('duplicate', async () => {
    const { ok, data } = await call(`/api/admin/events/${eventSlug}/emails`, {
      method: 'POST',
      body: JSON.stringify({ duplicateOf: email.id }),
    })
    if (!ok) return setMessage({ ok: false, text: data?.error ?? 'Could not duplicate.' })
    onDuplicated(data.email)
  })

  const attach = (file: File) => run('attach', async () => {
    if (dirty && !(await save({}, true))) return
    const stored = await uploadDirectToStorage(file, 'event-email-attachment', { slug: eventSlug })
    if ('error' in stored) return setMessage({ ok: false, text: stored.error })
    const { ok, data } = await call(`${base}/attachments`, {
      method: 'POST',
      body: JSON.stringify({ storagePath: stored.storagePath, filename: file.name, contentType: file.type }),
    })
    if (!ok) return setMessage({ ok: false, text: data?.error ?? 'Could not attach the file.' })
    onChanged(data.email)
    setMessage({ ok: true, text: `Attached ${file.name}.` })
  })

  const detach = (path: string) => run('attach', async () => {
    const { ok, data } = await call(base, {
      method: 'PATCH',
      body: JSON.stringify({ attachments: email.attachments.filter((a) => a.path !== path) }),
    })
    if (!ok) return setMessage({ ok: false, text: data?.error ?? 'Could not remove the file.' })
    onChanged(data.email)
  })

  const toggleAudience = (key: AudienceKey) => {
    setAudiences((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))
    touch()
  }

  const sendDate = eventDate && daysBefore !== '' ? scheduledSendDate(eventDate, Number(daysBefore)) : null
  const input = 'w-full rounded-md border border-brand-border px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-surface'
  const link = 'text-sm font-medium text-primary hover:text-primary-deep disabled:opacity-50'

  return (
    <div className="space-y-5 rounded-xl border border-brand-border bg-white p-5">
      {!editable && (
        <p className="rounded-md bg-surface px-3 py-2 text-sm text-brand-muted">
          {email.status === 'sent'
            ? `Sent ${email.sent_at ? new Date(email.sent_at).toLocaleString('en-US', { timeZone: 'America/Denver' }) + ' MT' : ''}. Duplicate it to send again.`
            : email.status === 'sending'
              ? 'Sending now.'
              : 'Skipped — the event had already happened when this was due.'}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-brand-muted">Name (only you see this)</span>
          <input className={input} value={name} disabled={!editable} maxLength={200} onChange={(e) => { setName(e.target.value); touch() }} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-brand-muted">Subject</span>
          <input className={input} value={subject} disabled={!editable} maxLength={300} onChange={(e) => { setSubject(e.target.value); touch() }} />
        </label>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-brand-muted">Send to</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {AUDIENCES.map((a) => (
            <label key={a.key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={audiences.includes(a.key)}
                disabled={!editable}
                onChange={() => toggleAudience(a.key)}
              />
              <span>
                <span className="text-ink">{a.label}</span>
                <span className="block text-xs text-brand-muted-soft">{a.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {audiences.includes('docusign_outstanding') && (
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={resendDocusign}
              disabled={!editable}
              onChange={(e) => { setResendDocusign(e.target.checked); touch() }}
            />
            <span>
              <span className="text-ink">Also re-send their DocuSign envelopes first</span>
              <span className="block text-xs text-brand-muted-soft">
                Re-sends existing envelopes only — never issues new ones, so it uses none of the monthly quota.
              </span>
            </span>
          </label>
        )}
      </fieldset>

      <div>
        <span className="mb-1 block text-sm font-medium text-brand-muted">Message</span>
        <RichTextEditor
          key={email.id}
          variant="email"
          value={body}
          editable={editable}
          mergeFields={EVENT_MERGE_FIELDS}
          onChange={(doc) => { setBody(doc); touch() }}
        />
        <p className="mt-1 text-xs text-brand-muted-soft">
          Fields like <code>{'{{first_name}}'}</code> are filled in for each person. Your signature is added automatically.
          Sent from “David Shaw, Stellr Education”; replies go to david.shaw@stellreducation.org.
        </p>
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium text-brand-muted">Attachments</span>
        {email.attachments.length > 0 && (
          <ul className="mb-2 space-y-1">
            {email.attachments.map((a) => (
              <li key={a.path} className="flex items-center gap-2 text-sm text-ink">
                <Paperclip className="h-3.5 w-3.5 text-brand-muted-soft" aria-hidden />
                {a.filename}
                <span className="text-xs text-brand-muted-soft">{fileSize(a.size)}</span>
                {editable && (
                  <button type="button" onClick={() => detach(a.path)} aria-label={`Remove ${a.filename}`} className="text-brand-muted-soft hover:text-red-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {editable && (
          <>
            <button type="button" className={link} disabled={busy !== null} onClick={() => fileRef.current?.click()}>
              {busy === 'attach' ? 'Uploading…' : '+ Attach a file'}
            </button>
            <span className="ml-2 text-xs text-brand-muted-soft">Up to 10 MB each.</span>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) attach(f)
                e.target.value = ''
              }}
            />
          </>
        )}
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium text-brand-muted">Schedule</span>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            type="number"
            min={0}
            max={365}
            placeholder="—"
            className="w-20 rounded-md border border-brand-border px-2 py-1.5 text-sm disabled:bg-surface"
            value={daysBefore}
            disabled={!editable || email.status === 'scheduled'}
            onChange={(e) => { setDaysBefore(e.target.value.replace(/[^0-9]/g, '')); touch() }}
            aria-label="Days before the event"
          />
          <span className="text-brand-muted">days before the event</span>
          {sendDate && (
            <span className="text-brand-muted-soft">
              — sends ~9am Mountain on {longDate(sendDate)}
              {sendDate < new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' }) && ' (already past: it will go at the next run)'}
            </span>
          )}
          {!eventDate && <span className="text-brand-muted-soft">— this event has no date yet</span>}
        </div>
        {email.status === 'scheduled' && (
          <p className="mt-1 text-xs text-brand-muted-soft">
            Scheduled. Groups like “Outstanding DocuSigns” are worked out on the day it sends, so anyone who has finished by then is left out.
          </p>
        )}
      </div>

      {message && <p className={`text-sm ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</p>}

      <div className="flex flex-wrap items-center gap-3 border-t border-brand-hairline pt-4">
        {editable ? (
          <>
            <Button variant="primary" className="!px-4 !py-2" disabled={busy !== null} onClick={sendNow}>
              {busy === 'send' ? 'Sending…' : 'Send now'}
            </Button>
            {email.status === 'scheduled' ? (
              <Button variant="softBlue" className="!py-2" disabled={busy !== null} onClick={unschedule}>Unschedule</Button>
            ) : (
              <Button variant="softBlue" className="!py-2" disabled={busy !== null} onClick={schedule}>Schedule</Button>
            )}
            <button type="button" className={link} disabled={busy !== null || !dirty} onClick={() => run('save', async () => { await save() })}>
              {busy === 'save' ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </button>
            <button type="button" className={link} disabled={busy !== null} onClick={loadPreview}>
              {busy === 'preview' ? 'Loading…' : 'Preview recipients'}
            </button>
            <button type="button" className={link} disabled={busy !== null} onClick={sendTest}>
              {busy === 'test' ? 'Sending…' : 'Send test to me'}
            </button>
            <button type="button" className="ml-auto text-sm text-red-600 hover:text-red-800 disabled:opacity-50" disabled={busy !== null} onClick={remove}>
              Delete
            </button>
          </>
        ) : (
          <>
            <Button variant="softBlue" className="!py-2" disabled={busy !== null} onClick={duplicate}>Duplicate</Button>
            <button type="button" className={link} disabled={busy !== null} onClick={loadPreview}>Preview recipients</button>
          </>
        )}
      </div>

      {preview && (
        <div className="grid gap-4 border-t border-brand-hairline pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div>
            <p className="mb-2 text-sm font-medium text-ink">
              {preview.count} {preview.count === 1 ? 'recipient' : 'recipients'} right now
              {preview.count > preview.max && <span className="ml-2 text-red-600">over the {preview.max} limit — split the groups</span>}
            </p>
            {preview.count === 0 ? (
              <p className="text-sm text-brand-muted-soft">Nobody matches these groups at the moment.</p>
            ) : (
              <ul className="max-h-96 space-y-1 overflow-y-auto text-sm">
                {preview.recipients.map((r) => (
                  <li key={r.email}>
                    <button
                      type="button"
                      onClick={() => previewAs(r.email)}
                      className={`w-full rounded px-2 py-1 text-left hover:bg-surface ${preview.sampleEmail === r.email ? 'bg-surface' : ''}`}
                    >
                      <span className="text-ink">{r.name}</span>
                      <span className="block text-xs text-brand-muted-soft">
                        {r.email !== r.name && `${r.email} · `}
                        {r.roles.map((x) => ROLE_LABEL[x] ?? x).join(', ')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            {preview.renderError ? (
              <p className="text-sm text-red-600">{preview.renderError}</p>
            ) : preview.rendered ? (
              <>
                <p className="mb-2 text-sm text-brand-muted">
                  As {preview.sampleEmail ?? 'a recipient'} sees it: <span className="font-medium text-ink">{preview.rendered.subject}</span>
                </p>
                <iframe
                  title="Email preview"
                  sandbox=""
                  srcDoc={preview.rendered.html}
                  className="h-[28rem] w-full rounded-md border border-brand-border bg-white"
                />
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
