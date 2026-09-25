'use client'

import { useEffect, useState } from 'react'
import {
  EVENT_AWARDS,
  SPECIALIST_AWARD_TYPES,
  type AssignedAwardType,
  type Assignment,
} from '@/lib/event-awards'

// Judging results → award certificates + credentials.
// Assigning is a draft: students see nothing until "Issue awards", which
// issues a credential per award (and revokes any taken away since the last
// issue). Rules live in lib/event-awards.ts and are enforced again server-side.

interface Company { id: string; number: number; name: string | null }
interface Student { id: string; name: string; companyId: string | null }
interface Loaded {
  companies: Company[]
  students: Student[]
  assignments: Assignment[]
  issuedAt: string | null
  pending: number
}

const NO_COMPANY = '__none__'

function companyLabel(c: Company | undefined) {
  if (!c) return 'No company'
  return c.name ? `Company ${c.number} · ${c.name}` : `Company ${c.number}`
}

export default function EventAwards({ eventSlug }: { eventSlug: string }) {
  const base = `/api/admin/events/${eventSlug}/awards`
  const [data, setData] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)

  async function load() {
    const res = await fetch(base)
    if (!res.ok) { setMsg({ text: 'Could not load awards.', error: true }); return }
    setData((await res.json()) as Loaded)
  }
  useEffect(() => { void load() }, [eventSlug]) // eslint-disable-line react-hooks/exhaustive-deps

  async function change(body: Record<string, unknown>) {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(base, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const d = (await res.json()) as Loaded & { error?: string }
      if (!res.ok) throw new Error(d.error ?? 'Could not save that change')
      setData(d)
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Could not save that change', error: true })
    } finally { setBusy(false) }
  }

  async function issue() {
    if (!data) return
    if (!window.confirm('Issue awards now? Each winner gets a credential and an email, and can download their certificate. Anyone whose award was taken away since the last issue has it revoked.')) return
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`${base}/issue`, { method: 'POST' })
      const d = (await res.json()) as { error?: string; issued: number; reinstated: number; revoked: number; unchanged: number; emailed: number; failures: string[] }
      if (!res.ok) throw new Error(d.error ?? 'Issue failed')
      const bits = [`${d.issued} issued`]
      if (d.reinstated) bits.push(`${d.reinstated} reinstated`)
      if (d.revoked) bits.push(`${d.revoked} revoked`)
      bits.push(`${d.unchanged} unchanged`, `${d.emailed} emailed`)
      if (d.failures.length) bits.push(`${d.failures.length} failed: ${d.failures.join('; ')}`)
      setMsg({ text: `Awards issued — ${bits.join(', ')}.`, error: d.failures.length > 0 })
      await load()
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Issue failed', error: true })
    } finally { setBusy(false) }
  }

  if (!data) {
    return (
      <div className="bg-white rounded-xl border border-brand-border p-4">
        <h3 className="text-sm font-semibold text-brand-muted uppercase tracking-wide">Judging &amp; awards</h3>
        {msg ? <p className="text-xs text-red-600 mt-2">{msg.text}</p> : <p className="text-xs text-brand-muted-soft mt-2">Loading…</p>}
      </div>
    )
  }

  const companyById = new Map(data.companies.map((c) => [c.id, c]))
  const holds = (participantId: string, award: AssignedAwardType) =>
    data.assignments.some((a) => a.participantId === participantId && a.awardType === award)
  const specialistOf = (participantId: string) =>
    data.assignments.find((a) => a.participantId === participantId && SPECIALIST_AWARD_TYPES.includes(a.awardType))

  const champions = data.assignments.filter((a) => a.awardType === 'overall_champion')
  const championCompanyId = champions[0]?.companyId ?? null
  // The winning company's students (ticked or not), plus anyone else holding it.
  const championMembers = data.students.filter(
    (s) => (championCompanyId && s.companyId === championCompanyId) || holds(s.id, 'overall_champion'),
  )

  // Company rows: every company, plus "No company" if any student is unplaced.
  const groups: { id: string | null; label: string; students: Student[] }[] = data.companies.map((c) => ({
    id: c.id, label: companyLabel(c), students: data.students.filter((s) => s.companyId === c.id),
  }))
  const unplaced = data.students.filter((s) => !s.companyId || !companyById.has(s.companyId))
  if (unplaced.length) groups.push({ id: null, label: 'No company', students: unplaced })

  const status = data.issuedAt
    ? `Issued ${new Date(data.issuedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : 'Not issued yet — students can’t see any of this'

  return (
    <div className="bg-white rounded-xl border border-brand-border p-4 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-brand-muted uppercase tracking-wide">Judging &amp; awards</h3>
          <p className="text-xs text-brand-muted-soft mt-1">
            Record the judges&rsquo; decisions, print the certificates, then issue them. A student can win one
            specialist award per event.
          </p>
        </div>
        <div className="text-right space-y-1">
          <button
            onClick={issue}
            disabled={busy || data.pending === 0}
            className="text-xs font-medium px-3 py-2 rounded-md bg-brand-blue text-white hover:bg-brand-blue-bright disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Issue awards'}
          </button>
          <p className="text-xs text-brand-muted-soft">
            {status}
            {data.pending > 0 && <span className="text-brand-blue-dark font-medium"> · {data.pending} change{data.pending === 1 ? '' : 's'} not yet issued</span>}
          </p>
        </div>
      </div>

      {msg && <p className={`text-xs ${msg.error ? 'text-red-600' : 'text-green-700'}`}>{msg.text}</p>}

      {data.students.length === 0 ? (
        <p className="text-sm text-brand-muted-soft">No students are registered yet.</p>
      ) : (
        <>
          {/* ── Overall Champion ───────────────────────────────────────────── */}
          <section className="space-y-2">
            <p className="font-medium text-brand-blue-dark text-sm">{EVENT_AWARDS.overall_champion.label}</p>
            <select
              className="rounded-md border border-brand-border px-2 py-1.5 text-sm text-brand-blue-dark"
              value={championCompanyId ?? ''}
              disabled={busy || data.companies.length === 0}
              onChange={(e) => change({ action: 'set_champion', companyId: e.target.value || null })}
              aria-label="Winning company"
            >
              <option value="">{data.companies.length ? 'No winner chosen' : 'Place students in companies first'}</option>
              {data.companies.map((c) => <option key={c.id} value={c.id}>{companyLabel(c)}</option>)}
            </select>
            {championMembers.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {championMembers.map((s) => {
                  const on = holds(s.id, 'overall_champion')
                  return (
                    <label key={s.id} className="flex items-center gap-1.5 text-sm text-brand-blue-dark">
                      <input
                        type="checkbox" checked={on} disabled={busy}
                        onChange={() => change({ action: on ? 'remove' : 'add', awardType: 'overall_champion', participantId: s.id })}
                      />
                      <span className={on ? '' : 'text-brand-muted-soft line-through'}>{s.name}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </section>

          {/* ── Specialist awards, one winner per company ────────────────────── */}
          <section className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-brand-hairline">
                  <th className="pr-4 py-2 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">Company</th>
                  {SPECIALIST_AWARD_TYPES.map((t) => (
                    <th key={t} className="pr-4 py-2 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">{EVENT_AWARDS[t].label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-hairline">
                {groups.map((g) => (
                  <tr key={g.id ?? NO_COMPANY}>
                    <td className="pr-4 py-2 text-brand-blue-dark whitespace-nowrap">{g.label}</td>
                    {SPECIALIST_AWARD_TYPES.map((award) => {
                      const current = g.students.find((s) => holds(s.id, award))
                      return (
                        <td key={award} className="pr-4 py-2">
                          <select
                            className="w-full min-w-[12rem] rounded-md border border-brand-border px-2 py-1.5 text-sm text-brand-blue-dark"
                            value={current?.id ?? ''}
                            disabled={busy}
                            onChange={(e) => change({ action: 'set_specialist', awardType: award, companyId: g.id, participantId: e.target.value || null })}
                            aria-label={`${EVENT_AWARDS[award].label}, ${g.label}`}
                          >
                            <option value="">No winner</option>
                            {g.students.map((s) => {
                              const other = specialistOf(s.id)
                              const blocked = !!other && other.awardType !== award
                              return (
                                <option key={s.id} value={s.id} disabled={blocked}>
                                  {s.name}{blocked ? ' — has the other award' : ''}
                                </option>
                              )
                            })}
                          </select>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}
