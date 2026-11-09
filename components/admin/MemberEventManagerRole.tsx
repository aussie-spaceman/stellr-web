'use client'

import { useCallback, useEffect, useState } from 'react'
import { Choice, Field, Input, Select } from '@stellr/web-ui'
import { formatDateShort } from '@/lib/utils'

// Classification → Event Manager. Admins only (the parent renders this only
// for an admin, and every route behind it checks again).
//
// The checkbox is the role; the rows under it are the events it covers, each
// with its own expiry date. Ticking opens the "add an event" row; unticking
// removes every assignment (after a confirm). The server decides eligibility —
// a cleared adult with a login — and this only shows its answer.

type Basis = 'background_check' | 'external_background_check' | 'teacher_license'

type Eligibility =
  | { ok: true; basis: Basis; clearanceUntil: string | null; detail: string | null }
  | { ok: false; code: string; message: string }

interface Assignment {
  eventSlug: string
  eventTitle: string
  expiresOn: string | null
  active: boolean
  clearanceBasis: Basis | null
  grantedByLabel: string | null
  createdAt: string
}

interface EventOption {
  slug: string
  title: string
  lastDay: string | null
  defaultExpiresOn: string
}

interface State {
  eligibility: Eligibility
  assignments: Assignment[]
  events: EventOption[]
}

const BASIS_LABEL: Record<Basis, string> = {
  background_check: 'background check',
  external_background_check: 'verified uploaded background check',
  teacher_license: 'verified teaching license',
}

export function MemberEventManagerRole({ memberId }: { memberId: string }) {
  const [state, setState] = useState<State | null>(null)
  const [loadError, setLoadError] = useState('')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const [newSlug, setNewSlug] = useState('')
  const [newExpiry, setNewExpiry] = useState('')
  const [edits, setEdits] = useState<Record<string, string>>({})
  const url = `/api/admin/members/${memberId}/event-manager`

  const load = useCallback(async () => {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) {
      setLoadError('Event Manager access could not be loaded.')
      return
    }
    setState((await res.json()) as State)
    setEdits({})
  }, [url])

  useEffect(() => {
    load()
  }, [load])

  async function call(method: 'POST' | 'PATCH' | 'DELETE', body: unknown): Promise<boolean> {
    setBusy(true)
    setError('')
    setNotes([])
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json().catch(() => null)
      if (!res.ok) {
        setError(d?.error ?? 'That didn’t work. Try again.')
        return false
      }
      if (Array.isArray(d?.warnings)) setNotes(d.warnings)
      await load()
      return true
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <p className="text-xs text-red-600">{loadError}</p>
  if (!state) return <p className="text-xs text-content-muted">Loading Event Manager access…</p>

  const { eligibility, assignments, events } = state
  const holds = assignments.length > 0
  const checked = holds || adding
  const assigned = new Set(assignments.map((a) => a.eventSlug))
  const available = events.filter((e) => !assigned.has(e.slug))
  const today = new Date().toISOString().slice(0, 10)

  async function toggle(next: boolean) {
    if (next) {
      setAdding(true)
      setError('')
      return
    }
    if (!holds) {
      setAdding(false)
      return
    }
    const n = assignments.length
    if (!window.confirm(`Remove Event Manager access for ${n === 1 ? 'this event' : `all ${n} events`}? They will be emailed.`)) return
    if (await call('DELETE', { all: true })) setAdding(false)
  }

  function chooseEvent(slug: string) {
    setNewSlug(slug)
    setNewExpiry(events.find((e) => e.slug === slug)?.defaultExpiresOn ?? '')
  }

  async function assign() {
    if (!newSlug) return setError('Choose an event.')
    const ok = await call('POST', { eventSlug: newSlug, expiresOn: newExpiry || null })
    if (ok) {
      setNewSlug('')
      setNewExpiry('')
      setAdding(false)
    }
  }

  return (
    <div className="space-y-3">
      <Choice
        checked={checked}
        disabled={busy || (!eligibility.ok && !holds)}
        onChange={(e) => toggle(e.target.checked)}
        label={
          <span>
            <span className="font-medium text-ink">Event Manager</span>{' '}
            <span className="text-content-muted">— can see and run the events they’re assigned, including students’ personal details</span>
          </span>
        }
      />

      {!eligibility.ok && (
        <p className="text-xs text-content-muted" role="note">
          {holds ? 'No longer eligible: ' : 'Not available yet: '}
          {eligibility.message}
        </p>
      )}
      {eligibility.ok && checked && (
        <p className="text-xs text-content-muted">
          Cleared by a {BASIS_LABEL[eligibility.basis]}
          {eligibility.clearanceUntil ? `, valid until ${formatDateShort(eligibility.clearanceUntil)}` : ''}. Access can’t run past that.
        </p>
      )}

      {holds && (
        <ul className="divide-y divide-line-light rounded-lg border border-line-light">
          {assignments.map((a) => {
            const edited = edits[a.eventSlug]
            const value = edited ?? a.expiresOn ?? ''
            const changed = edited !== undefined && edited !== (a.expiresOn ?? '')
            return (
              <li key={a.eventSlug} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{a.eventTitle}</p>
                  <p className="text-xs text-content-muted">
                    {!a.active
                      ? 'Expired — removed at the next daily check'
                      : !a.expiresOn
                        ? 'No expiry date (granted before expiries). Set one.'
                        : `Active until ${formatDateShort(a.expiresOn)}`}
                    {a.active && !a.clearanceBasis ? ' · No clearance recorded: set the expiry to re-confirm it.' : ''}
                    {a.grantedByLabel ? ` · Granted by ${a.grantedByLabel}` : ''}
                  </p>
                </div>
                <div className="flex items-end gap-2">
                  <Field label="Expiry date" labelSize="small">
                    <Input
                      type="date"
                      autoComplete="off"
                      min={today}
                      max={eligibility.ok && eligibility.clearanceUntil ? eligibility.clearanceUntil : undefined}
                      value={value}
                      disabled={busy || !eligibility.ok}
                      onChange={(e) => setEdits((m) => ({ ...m, [a.eventSlug]: e.target.value }))}
                    />
                  </Field>
                  {changed && (
                    <button
                      type="button"
                      disabled={busy || !value}
                      onClick={() => call('PATCH', { eventSlug: a.eventSlug, expiresOn: value })}
                      className="mb-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      Save
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Remove Event Manager access for ${a.eventTitle}? They will be emailed.`)) {
                        call('DELETE', { eventSlug: a.eventSlug })
                      }
                    }}
                    className="mb-1 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {checked && eligibility.ok && (
        adding || !holds ? (
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-line-light p-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <Field label="Event" labelSize="small">
              <Select value={newSlug} disabled={busy} onChange={(e) => chooseEvent(e.target.value)}>
                <option value="">Choose an event…</option>
                {available.map((e) => (
                  <option key={e.slug} value={e.slug}>
                    {e.title}
                    {e.lastDay ? ` (${formatDateShort(e.lastDay)})` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Expiry date" labelSize="small" hint="Default: event end + 30 days">
              <Input
                type="date"
                autoComplete="off"
                min={today}
                max={eligibility.clearanceUntil ?? undefined}
                value={newExpiry}
                disabled={busy || !newSlug}
                onChange={(e) => setNewExpiry(e.target.value)}
              />
            </Field>
            <div className="flex gap-2 sm:pb-1">
              <button
                type="button"
                onClick={assign}
                disabled={busy || !newSlug}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Assign'}
              </button>
              {holds && (
                <button type="button" onClick={() => setAdding(false)} disabled={busy} className="text-sm font-medium text-content-muted">
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={busy || available.length === 0}
            className="text-xs font-medium text-primary disabled:opacity-50"
          >
            + Add another event
          </button>
        )
      )}

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {notes.map((n) => (
        <p key={n} role="status" className="text-xs text-gold-ink">
          {n}
        </p>
      ))}
    </div>
  )
}
