'use client'

import { useEffect, useState } from 'react'
import type { CredentialRow } from '@/lib/credentials-core'

// Participation credentials panel on the competition admin page: the
// per-event config (what the credential says), the issue button, and the
// list of what has been issued with revoke / re-send per row.
//
// Sits beside EventBadges (the print path) and does not replace it.

interface Settings {
  credential_title: string | null
  credential_description: string | null
  credential_criteria: string | null
  credential_skills: string[]
}

interface Loaded {
  settings: Settings
  credentials: CredentialRow[]
  checkedInCount: number
}

const STATE: Record<string, { label: string; cls: string }> = {
  issued:  { label: 'Valid',   cls: 'bg-green-50 text-green-700' },
  revoked: { label: 'Revoked', cls: 'bg-red-50 text-red-700' },
}

export default function EventCredentials({ eventSlug, eventTitle }: { eventSlug: string; eventTitle: string }) {
  const base = `/api/admin/events/${eventSlug}/credentials`
  const [data, setData] = useState<Loaded | null>(null)
  const [form, setForm] = useState<Settings>({ credential_title: '', credential_description: '', credential_criteria: '', credential_skills: [] })
  const [skillsText, setSkillsText] = useState('')
  const [mode, setMode] = useState<'checked_in' | 'all'>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const [revoking, setRevoking] = useState<{ id: string; reason: string } | null>(null)

  async function load() {
    const res = await fetch(base)
    if (!res.ok) { setMsg({ text: 'Could not load credentials.', error: true }); return }
    const d = (await res.json()) as Loaded
    setData(d)
    setForm({ ...d.settings, credential_skills: d.settings.credential_skills ?? [] })
    setSkillsText((d.settings.credential_skills ?? []).join(', '))
    // D2: default to checked-in when the event used check-in at all.
    setMode(d.checkedInCount > 0 ? 'checked_in' : 'all')
  }
  useEffect(() => { void load() }, [eventSlug]) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveSettings() {
    setBusy('save'); setMsg(null)
    try {
      const res = await fetch(base, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, credential_skills: skillsText.split(',').map((s) => s.trim()).filter(Boolean) }),
      })
      const d = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(d.error ?? 'Save failed')
      setMsg({ text: 'Credential details saved.' })
      await load()
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Save failed', error: true })
    } finally { setBusy(null) }
  }

  async function issue() {
    const who = mode === 'checked_in' ? 'everyone who checked in' : 'every registered participant'
    if (!window.confirm(`Issue participation credentials to ${who}? Each person is emailed once; anyone who already has one is skipped.`)) return
    setBusy('issue'); setMsg(null)
    try {
      const res = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) })
      const d = (await res.json()) as { error?: string; created?: number; existing?: number; emailed?: number; considered?: number; failures?: string[] }
      if (!res.ok) throw new Error(d.error ?? 'Issue failed')
      const bits = [`${d.created} issued`, `${d.existing} already held one`, `${d.emailed} emailed`]
      if (d.failures?.length) bits.push(`${d.failures.length} failed: ${d.failures.join('; ')}`)
      setMsg({ text: `${d.considered} considered — ${bits.join(', ')}.`, error: !!d.failures?.length })
      await load()
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Issue failed', error: true })
    } finally { setBusy(null) }
  }

  async function revoke(id: string, reason: string) {
    setBusy(id); setMsg(null)
    try {
      const res = await fetch(`/api/admin/credentials/${id}/revoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason }) })
      const d = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(d.error ?? 'Revoke failed')
      setRevoking(null)
      setMsg({ text: 'Credential revoked; the holder has been told.' })
      await load()
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Revoke failed', error: true })
    } finally { setBusy(null) }
  }

  async function resend(id: string) {
    setBusy(id); setMsg(null)
    try {
      const res = await fetch(`/api/admin/credentials/${id}/resend`, { method: 'POST' })
      const d = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(d.error ?? 'Re-send failed')
      setMsg({ text: 'Email re-sent.' })
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Re-send failed', error: true })
    } finally { setBusy(null) }
  }

  const input = 'w-full rounded-md border border-brand-border px-3 py-2 text-sm text-brand-blue-dark focus:outline-none focus:ring-2 focus:ring-brand-blue'

  return (
    <div className="bg-white rounded-xl border border-brand-border p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-brand-muted uppercase tracking-wide">Participation credentials</h3>
        <p className="text-xs text-brand-muted-soft mt-1">
          A verifiable record per person with its own page, which they can make public and add to LinkedIn (16+).
          Award credentials are issued from Judging &amp; awards above; every credential for this event is listed
          here.
        </p>
      </div>

      {msg && <p className={`text-xs ${msg.error ? 'text-red-600' : 'text-green-700'}`}>{msg.text}</p>}

      {/* ── What the credential says ─────────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-3">
        <label className="text-xs text-brand-muted-soft space-y-1 md:col-span-2">
          <span>Title (the name on LinkedIn)</span>
          <input className={input} value={form.credential_title ?? ''} placeholder={`${eventTitle} — Participant`}
            onChange={(e) => setForm({ ...form, credential_title: e.target.value })} />
        </label>
        <label className="text-xs text-brand-muted-soft space-y-1">
          <span>Description</span>
          <textarea className={input} rows={3} value={form.credential_description ?? ''}
            onChange={(e) => setForm({ ...form, credential_description: e.target.value })} />
        </label>
        <label className="text-xs text-brand-muted-soft space-y-1">
          <span>How it was earned</span>
          <textarea className={input} rows={3} value={form.credential_criteria ?? ''}
            onChange={(e) => setForm({ ...form, credential_criteria: e.target.value })} />
        </label>
        <label className="text-xs text-brand-muted-soft space-y-1 md:col-span-2">
          <span>Skills (comma-separated)</span>
          <input className={input} value={skillsText} onChange={(e) => setSkillsText(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={saveSettings} disabled={busy !== null}
          className="text-xs font-medium px-3 py-2 rounded-md border border-brand-border text-brand-blue-dark hover:bg-brand-canvas disabled:opacity-50">
          {busy === 'save' ? 'Saving…' : 'Save details'}
        </button>
        <span className="text-xs text-brand-muted-soft">Changes apply to credentials issued from now on; existing ones keep what they were issued with.</span>
      </div>

      {/* ── Issue ────────────────────────────────────────────────────── */}
      <div className="border-t border-brand-hairline pt-4 flex flex-wrap items-center gap-3">
        <label className="text-xs text-brand-muted-soft flex items-center gap-2">
          <span>Issue to</span>
          <select className="rounded-md border border-brand-border px-2 py-1.5 text-sm text-brand-blue-dark" value={mode}
            onChange={(e) => setMode(e.target.value as 'checked_in' | 'all')}>
            <option value="checked_in">Checked-in participants{data ? ` (${data.checkedInCount})` : ''}</option>
            <option value="all">All registered participants</option>
          </select>
        </label>
        <button onClick={issue} disabled={busy !== null || !data}
          className="text-xs font-medium px-3 py-2 rounded-md bg-brand-blue text-white hover:bg-brand-blue-bright disabled:opacity-50">
          {busy === 'issue' ? 'Issuing…' : 'Issue credentials'}
        </button>
      </div>

      {/* ── Issued ───────────────────────────────────────────────────── */}
      {data && data.credentials.length > 0 && (
        <div className="border-t border-brand-hairline pt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-brand-hairline">
                {['Holder', 'Role', 'Number', 'Status', 'Visibility', ''].map((h) => (
                  <th key={h} className="pr-4 py-2 font-medium text-brand-muted-soft text-xs uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-hairline">
              {data.credentials.map((c) => {
                const st = STATE[c.status] ?? STATE.issued
                return (
                  <tr key={c.id}>
                    <td className="pr-4 py-2 text-brand-blue-dark whitespace-nowrap">
                      {c.tombstoned_at ? <span className="italic text-brand-muted-soft">withdrawn</span> : c.recipient_name}
                      {c.award && <span className="ml-2 text-xs text-brand-muted-soft">· {c.award}</span>}
                    </td>
                    <td className="pr-4 py-2 text-brand-muted text-xs whitespace-nowrap">{c.role_label ?? '—'}</td>
                    <td className="pr-4 py-2 text-xs font-mono whitespace-nowrap">
                      <a href={`/credentials/${encodeURIComponent(c.number)}`} target="_blank" rel="noopener noreferrer" className="text-brand-blue hover:underline">{c.number}</a>
                    </td>
                    <td className="pr-4 py-2 whitespace-nowrap">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="pr-4 py-2 text-xs text-brand-muted whitespace-nowrap capitalize">{c.visibility}</td>
                    <td className="py-2 text-right text-xs whitespace-nowrap space-x-3">
                      {c.status === 'issued' && !c.tombstoned_at && (
                        revoking?.id === c.id ? (
                          <span className="inline-flex items-center gap-2">
                            <input className="rounded-md border border-brand-border px-2 py-1 text-xs" placeholder="Reason" value={revoking.reason}
                              onChange={(e) => setRevoking({ id: c.id, reason: e.target.value })} />
                            <button onClick={() => revoke(c.id, revoking.reason)} disabled={!revoking.reason.trim() || busy === c.id}
                              className="text-red-600 font-medium disabled:opacity-50">{busy === c.id ? 'Revoking…' : 'Confirm'}</button>
                            <button onClick={() => setRevoking(null)} className="text-brand-muted-soft">Cancel</button>
                          </span>
                        ) : (
                          <>
                            <button onClick={() => resend(c.id)} disabled={busy !== null} className="text-brand-blue font-medium disabled:opacity-50">
                              {busy === c.id ? 'Sending…' : 'Re-send email'}
                            </button>
                            <button onClick={() => setRevoking({ id: c.id, reason: '' })} disabled={busy !== null} className="text-red-600 font-medium disabled:opacity-50">
                              Revoke
                            </button>
                          </>
                        )
                      )}
                      {c.status === 'revoked' && c.revoked_reason && (
                        <span className="text-brand-muted-soft" title={c.revoked_reason}>{c.revoked_reason}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
