'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Circle } from 'lucide-react'
import { Field, Select } from '@stellr/web-ui'
import { formatDateShort } from '@/lib/utils'

// Classification → Staff (lib/staff.ts). Admins only: the parent renders this only
// for an admin, and every route behind it checks again (roles:manage).
//
// Staff is Stellr's role between Event Manager and Admin. A grant starts waiting
// and activates on its own once every prerequisite is met; this panel shows the
// checklist the server decides, and grants, re-checks and removes. The Staff
// training module is chosen here too, because nobody can activate without one.

type Status = 'pending' | 'active' | 'suspended' | 'revoked' | 'expired'

interface Grant {
  status: Status
  granted_at: string
  granted_by_label: string | null
  activated_at: string | null
  expires_at: string | null
  ended_at: string | null
  ended_reason: string | null
}

interface Check {
  key: 'member' | 'clearance' | 'agreement' | 'training' | 'mfa'
  ok: boolean
  message: string
  until: string | null
}

interface StaffState {
  grant: Grant | null
  history: Grant[]
  decision: { ok: boolean; checks: Check[]; until: string | null }
}

const CHECK_LABEL: Record<Check['key'], string> = {
  member: 'Adult member with a Stellr login',
  clearance: 'Background check',
  agreement: 'Staff agreement',
  training: 'Staff safeguarding and privacy training',
  mfa: 'Two-step verification',
}

const AGREEMENT_NOTE: Record<string, string> = {
  sent: 'The Staff agreement is on its way to them.',
  in_flight: 'A Staff agreement is already out for their signature.',
  on_file: 'Their Staff agreement is already on file.',
  document_not_ready: 'No Staff agreement could be sent: the document isn’t published yet (Admin → Agreement documents, key “staff”).',
  failed: 'The Staff agreement could not be sent. Try again from here once the document is published.',
}

function statusText(g: Grant): string {
  if (g.status === 'active') return `Active${g.expires_at ? ` until ${formatDateShort(g.expires_at.slice(0, 10))}` : ''}`
  if (g.status === 'pending') return 'Waiting: starts when everything below is done'
  if (g.status === 'suspended') return 'Paused: comes back when everything below is done'
  if (g.status === 'expired') return `Ended ${g.ended_at ? formatDateShort(g.ended_at.slice(0, 10)) : ''}: the term ran out`
  return `Removed ${g.ended_at ? formatDateShort(g.ended_at.slice(0, 10)) : ''}${g.ended_reason ? `: ${g.ended_reason}` : ''}`
}

export function MemberStaffRole({ memberId }: { memberId: string }) {
  const [state, setState] = useState<StaffState | null>(null)
  const [modules, setModules] = useState<{ id: string; title: string }[]>([])
  const [moduleId, setModuleId] = useState<string>('')
  const [savedModuleId, setSavedModuleId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    setError('')
    const [res, settings] = await Promise.all([fetch(`/api/admin/members/${memberId}/staff`), fetch('/api/admin/staff-settings')])
    if (!res.ok) {
      setError('Staff details could not be loaded.')
      return
    }
    setState((await res.json()) as StaffState)
    if (settings.ok) {
      const s = (await settings.json()) as { trainingModuleId: string | null; modules: { id: string; title: string }[] }
      setModules(s.modules)
      setModuleId(s.trainingModuleId ?? '')
      setSavedModuleId(s.trainingModuleId ?? '')
    }
  }, [memberId])

  useEffect(() => {
    void load()
  }, [load])

  async function call(method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
    setBusy(true)
    setError('')
    setNote('')
    const res = await fetch(`/api/admin/members/${memberId}/staff`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = (await res.json().catch(() => null)) as { error?: string; agreement?: string } | null
    setBusy(false)
    if (!res.ok) {
      setError(data?.error ?? 'That didn’t work. Try again.')
      return
    }
    if (method === 'POST' && data?.agreement) setNote(AGREEMENT_NOTE[data.agreement] ?? '')
    await load()
  }

  async function saveModule() {
    setBusy(true)
    setError('')
    const res = await fetch('/api/admin/staff-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trainingModuleId: moduleId || null }),
    })
    setBusy(false)
    if (!res.ok) {
      setError('The training module could not be saved.')
      return
    }
    await load()
  }

  if (!state) return <p className="text-xs text-content-muted">{error || 'Loading Staff…'}</p>

  const live = state.grant
  const past = state.history.find((h) => h.status === 'revoked' || h.status === 'expired')

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-ink">Staff</p>
        <p className="text-xs text-content-muted">
          Reads the whole admin portal and changes Competitions and Members. Starts only when every item below is done, and pauses if one lapses.
        </p>
      </div>

      {live ? (
        <p className="text-sm text-ink">
          {statusText(live)}
          {live.granted_by_label ? <span className="text-xs text-content-muted"> · granted by {live.granted_by_label}</span> : null}
        </p>
      ) : past ? (
        <p className="text-xs text-content-muted">Not Staff now. Last grant: {statusText(past)}</p>
      ) : (
        <p className="text-xs text-content-muted">Not Staff.</p>
      )}

      <ul className="divide-y divide-line-light rounded-lg border border-line-light">
        {state.decision.checks.map((c) => (
          <li key={c.key} className="flex items-start gap-2 p-2.5">
            {c.ok ? <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> : <Circle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-content-muted" />}
            <div className="min-w-0">
              <p className="text-sm text-ink">
                {CHECK_LABEL[c.key]}
                <span className="sr-only">{c.ok ? ' (done)' : ' (to do)'}</span>
              </p>
              <p className="text-xs text-content-muted">
                {c.message}
                {c.ok && c.until ? ` Until ${formatDateShort(c.until)}.` : ''}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-3">
        {!live ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Grant Staff? They’ll be emailed the checklist and sent the Staff agreement. Access starts once everything is done.')) void call('POST')
            }}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Grant Staff'}
          </button>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={() => void call('PATCH')} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink disabled:opacity-50">
              {busy ? 'Checking…' : 'Check again'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt('Why is Staff being removed? This goes in their activity log. Access ends now.')
                if (reason && reason.trim()) void call('DELETE', { reason: reason.trim() })
              }}
              className="text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
            >
              Remove Staff
            </button>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 rounded-lg border border-line-light p-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Staff training module (for everyone)" labelSize="small" hint="The Academy module every Staff member completes. Nobody can start until one is chosen.">
          <Select value={moduleId} disabled={busy} onChange={(e) => setModuleId(e.target.value)}>
            <option value="">Not chosen</option>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </Select>
        </Field>
        {moduleId !== savedModuleId && (
          <button type="button" disabled={busy} onClick={() => void saveModule()} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            Save
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="text-xs text-gold-ink">
          {note}
        </p>
      )}
    </div>
  )
}
