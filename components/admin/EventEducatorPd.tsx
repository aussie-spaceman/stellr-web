'use client'

import { useEffect, useState } from 'react'
import type { CredentialRow } from '@/lib/credentials-core'
import { formatPdHours } from '@/lib/pd-standards'
import PdCertificateArtwork from '@/components/admin/PdCertificateArtwork'

// Educator PD panel on the competition Settings tab: record the hours a teacher
// gave at this event and issue their PD certificate + LinkedIn-ready credential.
// Manual only (decision Q1, 7 Oct 2026) — the admin finds the educator, types
// the hours, and issues. A teacher with no account is created through the
// normal Add member flow first, which sends the "complete your account" email.
// Design: docs/PLAN-educator-pd-2026-10-07.md.

interface MemberHit {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
}

const STATE: Record<string, { label: string; cls: string }> = {
  issued:  { label: 'Valid',   cls: 'bg-green-50 text-green-700' },
  revoked: { label: 'Revoked', cls: 'bg-red-50 text-red-700' },
}

export default function EventEducatorPd({ eventSlug, theme }: { eventSlug: string; theme: 'space' | 'environmental' }) {
  const base = `/api/admin/events/${eventSlug}/pd-credentials`
  const [rows, setRows] = useState<CredentialRow[] | null>(null)
  const [canIssue, setCanIssue] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<MemberHit[]>([])
  const [picked, setPicked] = useState<MemberHit | null>(null)
  const [hours, setHours] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const [revoking, setRevoking] = useState<{ id: string; reason: string } | null>(null)

  async function load() {
    const res = await fetch(base)
    if (!res.ok) { setMsg({ text: 'Could not load PD credentials.', error: true }); return }
    const d = (await res.json()) as { credentials: CredentialRow[]; canIssue: boolean }
    setRows(d.credentials)
    setCanIssue(d.canIssue)
  }
  useEffect(() => { void load() }, [eventSlug]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced member search (admins only — the endpoint is admin-gated).
  useEffect(() => {
    if (!canIssue || picked || query.trim().length < 2) { setHits([]); return }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/admin/members/search?q=${encodeURIComponent(query.trim())}`)
      if (res.ok) setHits(((await res.json()) as { members: MemberHit[] }).members)
    }, 250)
    return () => clearTimeout(t)
  }, [query, picked, canIssue])

  const nameOf = (m: MemberHit) => [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email

  async function issue() {
    if (!picked) return
    const n = Number(hours)
    if (!Number.isFinite(n) || n <= 0 || n > 40) { setMsg({ text: 'Hours must be between 0.1 and 40.', error: true }); return }
    if (!window.confirm(`Issue a PD credential to ${nameOf(picked)} for ${formatPdHours(n)} hours? They are emailed straight away.`)) return
    setBusy('issue'); setMsg(null)
    try {
      const res = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId: picked.id, hours: n }) })
      const d = (await res.json()) as { error?: string; created?: boolean; emailed?: boolean; credential?: CredentialRow }
      if (!res.ok) throw new Error(d.error ?? 'Issue failed')
      setMsg({
        text: d.created
          ? `Issued ${d.credential?.number} to ${nameOf(picked)}${d.emailed ? ' and emailed them.' : ' — the email did not send; use Re-send email.'}`
          : `${nameOf(picked)} already holds a PD credential for this event (${d.credential?.number}). To change the hours, revoke it and issue again.`,
        error: !d.created || !d.emailed,
      })
      setPicked(null); setQuery(''); setHours('')
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

  const input = 'rounded-md border border-brand-border px-3 py-2 text-sm text-brand-blue-dark focus:outline-none focus:ring-2 focus:ring-brand-blue'
  const newMemberHref = `/admin/members/new?return=${encodeURIComponent(`/admin/competitions/${eventSlug}?tab=settings`)}`

  return (
    <div className="bg-white rounded-xl border border-brand-border p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-brand-muted uppercase tracking-wide">Educator PD</h3>
        <p className="text-xs text-brand-muted-soft mt-1">
          Teachers who supported this event get a PD certificate showing their hours, aligned to Common
          Core, plus a credential they can add to LinkedIn. One per educator per event; to change the hours, revoke
          and issue again.
        </p>
      </div>

      {msg && <p className={`text-xs ${msg.error ? 'text-red-600' : 'text-green-700'}`}>{msg.text}</p>}

      {/* ── Issue ────────────────────────────────────────────────────── */}
      {canIssue && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-brand-muted-soft space-y-1 relative min-w-64 flex-1">
            <span>Educator</span>
            {picked ? (
              <div className={`${input} flex items-center justify-between`}>
                <span>{nameOf(picked)} <span className="text-brand-muted-soft">· {picked.email}</span></span>
                <button type="button" onClick={() => setPicked(null)} className="text-brand-muted-soft hover:text-brand-blue-dark">Change</button>
              </div>
            ) : (
              <input className={`${input} w-full`} value={query} placeholder="Search by name or email"
                onChange={(e) => setQuery(e.target.value)} />
            )}
            {!picked && hits.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded-md border border-brand-border bg-white shadow-sm max-h-60 overflow-auto">
                {hits.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => { setPicked(m); setHits([]) }}
                      className="w-full text-left px-3 py-2 text-sm text-brand-blue-dark hover:bg-brand-canvas">
                      {nameOf(m)} <span className="text-xs text-brand-muted-soft">· {m.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </label>
          <label className="text-xs text-brand-muted-soft space-y-1">
            <span>Hours</span>
            <input className={`${input} w-24`} type="number" min={0.5} max={40} step={0.5} value={hours}
              onChange={(e) => setHours(e.target.value)} />
          </label>
          <button onClick={issue} disabled={busy !== null || !picked || !hours}
            className="text-xs font-medium px-3 py-2 rounded-md bg-brand-blue text-white hover:bg-brand-blue-bright disabled:opacity-50">
            {busy === 'issue' ? 'Issuing…' : 'Issue PD credential'}
          </button>
          <a href={newMemberHref} className="text-xs font-medium text-brand-blue hover:underline py-2">
            Not a member yet? Add them first
          </a>
        </div>
      )}

      {/* ── Issued ───────────────────────────────────────────────────── */}
      {rows && rows.length > 0 && (
        <div className="border-t border-brand-hairline pt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-brand-hairline">
                {['Educator', 'Hours', 'Number', 'Status', 'Visibility', ''].map((h) => (
                  <th key={h} className="pr-4 py-2 font-medium text-brand-muted-soft text-xs uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-hairline">
              {rows.map((c) => {
                const st = STATE[c.status] ?? STATE.issued
                return (
                  <tr key={c.id}>
                    <td className="pr-4 py-2 text-brand-blue-dark whitespace-nowrap">
                      {c.tombstoned_at ? <span className="italic text-brand-muted-soft">withdrawn</span> : c.recipient_name}
                    </td>
                    <td className="pr-4 py-2 text-brand-muted text-xs whitespace-nowrap">{c.pd_hours ? formatPdHours(Number(c.pd_hours)) : '—'}</td>
                    <td className="pr-4 py-2 text-xs font-mono whitespace-nowrap">
                      <a href={`/credentials/${encodeURIComponent(c.number)}`} target="_blank" rel="noopener noreferrer" className="text-brand-blue hover:underline">{c.number}</a>
                    </td>
                    <td className="pr-4 py-2 whitespace-nowrap">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="pr-4 py-2 text-xs text-brand-muted whitespace-nowrap capitalize">{c.visibility}</td>
                    <td className="py-2 text-right text-xs whitespace-nowrap space-x-3">
                      {canIssue && c.status === 'issued' && !c.tombstoned_at && (
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
      {rows && rows.length === 0 && <p className="text-xs text-brand-muted-soft">No PD credentials issued for this event yet.</p>}

      {/* ── Certificate artwork (global, admins) ───────────────────── */}
      {canIssue && <PdCertificateArtwork theme={theme} />}
    </div>
  )
}
