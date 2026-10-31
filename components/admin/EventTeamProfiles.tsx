'use client'

import { Fragment, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'
import type { CompanyPlan, PlanningStudent, ProfileStatus } from '@/lib/team-profile/assign'
import {
  FOCUS_AREAS,
  LEADERSHIP_INTEREST,
  OTHER_COMPETITIONS,
  RATING_LEVELS,
  SKILL_AREAS,
  SOFT_SKILLS,
  TEAM_STYLES,
  labelOf,
} from '@/lib/team-profile/questions'

// Roster tab → "Team profiles": who has answered, what they said, best-fit
// suggestions for unplaced students, the send / resend buttons, and the
// override that lets Auto-Assign place a student without a team profile.
// Admins and this event's event managers.

const STATUS: Record<ProfileStatus | 'overridden', { label: string; cls: string }> = {
  submitted: { label: 'Submitted', cls: 'bg-green-100 text-green-800' },
  overridden: { label: 'Overridden', cls: 'bg-primary-soft text-primary-deep' },
  sent: { label: 'Sent', cls: 'bg-amber-100 text-amber-800' },
  not_sent: { label: 'Not sent', cls: 'bg-gray-100 text-gray-700' },
  waiting: { label: 'Waiting on forms', cls: 'bg-gray-100 text-gray-500' },
}

// The pill: Overridden stands in for Sent / Not sent / Waiting; Submitted wins.
const pill = (s: PlanningStudent) => (s.overridden ? 'overridden' : s.status)

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''

const sendDetail = (s: PlanningStudent) =>
  s.status === 'submitted' ? fmt(s.submittedAt) : s.lastSentAt ? `${fmt(s.lastSentAt)}${s.sendCount > 1 ? ` · ×${s.sendCount}` : ''}` : ''

export default function EventTeamProfiles({ eventSlug, plan }: { eventSlug: string; plan: CompanyPlan }) {
  const router = useRouter()
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [filter, setFilter] = useState<'all' | 'unassigned' | 'outstanding' | 'overridden'>('all')

  const companyLabel = (n: number | null) => {
    if (n === null) return null
    const c = plan.companies.find((x) => x.number === n)
    return c?.name ? `${n} — ${c.name}` : `Company ${n}`
  }

  const counts = useMemo(() => {
    const c = { submitted: 0, overridden: 0, sent: 0, not_sent: 0, waiting: 0 }
    for (const s of plan.students) c[pill(s)]++
    return c
  }, [plan.students])
  // Overridden students still get the team profile emails.
  const sendable = plan.students.filter((s) => s.status === 'sent' || s.status === 'not_sent').length
  const overridable = plan.students.filter((s) => s.status !== 'submitted' && !s.overridden).length

  const shown = plan.students
    .filter((s) =>
      filter === 'unassigned'
        ? s.companyNumber === null
        : filter === 'outstanding'
          ? s.status !== 'submitted'
          : filter === 'overridden'
            ? s.overridden !== null
            : true,
    )
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))

  async function post(url: string, body: unknown, key: string) {
    setBusy(key)
    setNote(null)
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const data = await res?.json().catch(() => null)
    setBusy(null)
    return { ok: !!res?.ok, data }
  }

  async function resend(s: PlanningStudent) {
    const { ok, data } = await post(`/api/admin/events/${eventSlug}/team-profiles`, { participantId: s.participantId }, s.participantId)
    setNote({ ok, text: ok ? `Sent to ${s.firstName} ${s.lastName}.` : data?.error ?? 'Sending failed.' })
    if (ok) router.refresh()
  }

  async function sendAll() {
    if (!window.confirm(`Send the team profile to ${sendable} student${sendable === 1 ? '' : 's'} who haven’t submitted one yet?`)) return
    const { ok, data } = await post(`/api/admin/events/${eventSlug}/team-profiles`, { all: true }, 'all')
    setNote(
      ok
        ? {
            ok: data.failed === 0,
            text: `Sent ${data.sent}${data.failed ? `, ${data.failed} failed` : ''}${data.remaining ? `. ${data.remaining} still to send: click again.` : '.'}`,
          }
        : { ok: false, text: data?.error ?? 'Sending failed.' },
    )
    if (ok) router.refresh()
  }

  async function apply(s: PlanningStudent) {
    const companyId = plan.companies.find((c) => c.number === s.suggestedCompany)?.id
    if (!companyId) return
    const { ok, data } = await post(`/api/admin/events/${eventSlug}/companies`, { action: 'move', participantId: s.participantId, companyId }, s.participantId)
    if (ok) router.refresh()
    else setNote({ ok: false, text: data?.error ?? 'Move failed.' })
  }

  async function override(s: PlanningStudent, overridden: boolean) {
    const name = `${s.firstName} ${s.lastName}`
    const { ok, data } = await post(
      `/api/admin/events/${eventSlug}/companies`,
      { action: 'override', participantId: s.participantId, overridden },
      `override:${s.participantId}`,
    )
    setNote(
      !ok
        ? { ok, text: data?.error ?? 'Saving failed.' }
        : overridden
          ? { ok, text: `Auto-Assign will place ${name} without a team profile.` }
          : {
              ok,
              text: `Override removed for ${name}.${s.companyNumber !== null && !s.locked ? ' They stay in their company until Auto-Assign runs again.' : ''}`,
            },
    )
    if (ok) router.refresh()
  }

  async function overrideAll() {
    if (
      !window.confirm(
        `Let Auto-Assign place the ${overridable} student${overridable === 1 ? '' : 's'} who haven’t submitted a team profile? ` +
          'They’re balanced on age, school, experience, gender and ethnicity. Anyone who submits later is placed on their answers the next time Auto-Assign runs.',
      )
    )
      return
    const { ok, data } = await post(`/api/admin/events/${eventSlug}/companies`, { action: 'override_all' }, 'override_all')
    setNote(
      ok
        ? { ok, text: `Overrode ${data.overridden} student${data.overridden === 1 ? '' : 's'}. Run Auto-Assign to place them.` }
        : { ok: false, text: data?.error ?? 'Saving failed.' },
    )
    if (ok) router.refresh()
  }

  if (plan.students.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-brand-border p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold text-brand-muted">Team profiles</h3>
        <span className="text-xs text-brand-muted-soft">
          {[
            `${counts.submitted} submitted`,
            counts.overridden ? `${counts.overridden} overridden` : null,
            `${counts.sent} sent`,
            `${counts.not_sent} not sent`,
            `${counts.waiting} waiting on forms`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="border border-line-strong rounded-lg px-2 py-1.5 text-input mouse:text-sm text-brand-muted bg-white"
            aria-label="Filter students"
          >
            <option value="all">All students</option>
            <option value="unassigned">Unassigned</option>
            <option value="outstanding">Not submitted</option>
            <option value="overridden">Overridden</option>
          </select>
          <button
            onClick={sendAll}
            disabled={busy !== null || sendable === 0}
            className="text-sm font-medium border border-brand-border rounded-lg px-3 py-1.5 text-brand-muted hover:bg-brand-canvas disabled:opacity-50"
          >
            {busy === 'all' ? 'Sending…' : 'Send to everyone not submitted'}
          </button>
          <button
            onClick={overrideAll}
            disabled={busy !== null || overridable === 0}
            className="text-sm font-medium border border-brand-border rounded-lg px-3 py-1.5 text-brand-muted hover:bg-brand-canvas disabled:opacity-50"
          >
            {busy === 'override_all' ? 'Overriding…' : 'Override all not submitted'}
          </button>
        </div>
      </div>

      <p className="text-xs text-brand-muted-soft">
        Team profiles go out automatically once a student’s permission form is complete. Auto-Assign places students who have
        submitted one, and any you override; anyone else stays unassigned, with a suggested company. An overridden student is
        balanced on age, school, experience, gender and ethnicity, and still gets the team profile emails. If they submit, the
        next Auto-Assign uses their answers. <Lock className="inline h-3 w-3" aria-label="Locked" /> marks a
        student placed by hand, whom Auto-Assign leaves alone.
      </p>

      {note && <p className={`text-xs ${note.ok ? 'text-green-700' : 'text-red-600'}`}>{note.text}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-brand-muted-soft uppercase tracking-wide border-b border-brand-border">
              <th className="px-3 py-2 font-semibold">Student</th>
              <th className="px-3 py-2 font-semibold">Company</th>
              <th className="px-3 py-2 font-semibold">Profile</th>
              <th className="px-3 py-2 font-semibold">Strengths</th>
              <th className="px-3 py-2 font-semibold">Teammates</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <Fragment key={s.participantId}>
                <tr className="border-b border-brand-border/60 align-top">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-brand-blue-dark">{s.firstName} {s.lastName}</div>
                    <div className="text-xs text-brand-muted-soft">
                      {[s.school, s.grade && (/^(?:grade_)?(\d+)$/.exec(s.grade) ? `Grade ${/(\d+)/.exec(s.grade)![1]}` : s.grade)]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-brand-muted whitespace-nowrap">
                    {s.companyNumber !== null ? (
                      <span className="inline-flex items-center gap-1">
                        {companyLabel(s.companyNumber)}
                        {s.locked && <Lock className="h-3 w-3 text-brand-muted-soft" aria-label="Placed by hand" />}
                      </span>
                    ) : s.suggestedCompany !== null ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-brand-muted-soft">Suggested: {companyLabel(s.suggestedCompany)}</span>
                        <button
                          onClick={() => apply(s)}
                          disabled={busy !== null}
                          className="text-xs font-medium text-brand-blue hover:text-brand-blue-dark disabled:opacity-50"
                        >
                          Apply
                        </button>
                      </span>
                    ) : (
                      <span className="text-brand-muted-soft">Unassigned</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[pill(s)].cls}`}>{STATUS[pill(s)].label}</span>
                    <div className="mt-0.5 text-xs text-brand-muted-soft">
                      {s.overridden ? [STATUS[s.status].label, sendDetail(s)].filter(Boolean).join(' · ') : sendDetail(s)}
                    </div>
                    {s.overridden && (
                      <div className="text-xs text-brand-muted-soft">
                        {[s.overridden.by && `by ${s.overridden.by}`, fmt(s.overridden.at)].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    {s.lastSendError && <div className="mt-0.5 text-xs text-red-600">{s.lastSendError}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-brand-muted">
                    {s.answers ? (
                      <>
                        <div>{s.answers.strengths.map((k) => labelOf(SOFT_SKILLS, k)).join(', ')}</div>
                        <div className="text-brand-muted-soft">
                          {labelOf(FOCUS_AREAS, s.answers.focus)}
                          {s.answers.leadership === 'yes' ? ' · wants to lead' : ''}
                        </div>
                      </>
                    ) : (
                      <span className="text-brand-muted-soft">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {s.teammates.length === 0 ? (
                      <span className="text-brand-muted-soft">—</span>
                    ) : (
                      s.teammates.map((t, i) => {
                        const mate = t.participantId ? plan.students.find((x) => x.participantId === t.participantId) : null
                        return (
                          <div key={i} className={mate ? 'text-brand-muted' : 'text-amber-700'}>
                            {mate ? `${mate.firstName} ${mate.lastName}${mate.companyNumber !== null && mate.companyNumber === s.companyNumber ? ' ✓' : ''}` : `“${t.typed}” (no match)`}
                          </div>
                        )
                      })
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap space-x-3">
                    {s.answers && (
                      <button
                        onClick={() => setOpen(open === s.participantId ? null : s.participantId)}
                        className="text-xs font-medium text-brand-blue hover:text-brand-blue-dark"
                      >
                        {open === s.participantId ? 'Hide' : 'Answers'}
                      </button>
                    )}
                    {s.status !== 'submitted' && (
                      <button
                        onClick={() => override(s, !s.overridden)}
                        disabled={busy !== null}
                        title={s.overridden ? 'Auto-Assign leaves them unassigned again unless they submit' : 'Let Auto-Assign place them without a team profile'}
                        className="text-xs font-medium text-brand-blue hover:text-brand-blue-dark disabled:opacity-50"
                      >
                        {busy === `override:${s.participantId}` ? 'Saving…' : s.overridden ? 'Undo override' : 'Override'}
                      </button>
                    )}
                    {s.status !== 'waiting' && (
                      <button
                        onClick={() => resend(s)}
                        disabled={busy !== null}
                        className="text-xs font-medium text-brand-blue hover:text-brand-blue-dark disabled:opacity-50"
                      >
                        {busy === s.participantId ? 'Sending…' : s.status === 'not_sent' ? 'Send' : 'Resend'}
                      </button>
                    )}
                  </td>
                </tr>
                {open === s.participantId && s.answers && (
                  <tr className="border-b border-brand-border/60 bg-brand-canvas">
                    <td colSpan={6} className="px-3 py-3">
                      <Answers s={s} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Answers({ s }: { s: PlanningStudent }) {
  const a = s.answers!
  const rows: [string, string][] = [
    ...SKILL_AREAS.map((k) => [k.label, labelOf(RATING_LEVELS, a.skills[k.key])] as [string, string]),
    ['Strengths', a.strengths.map((k) => labelOf(SOFT_SKILLS, k)).join(', ') || '—'],
    ['Would like to get better at', a.weaknesses.map((k) => labelOf(SOFT_SKILLS, k)).join(', ') || '—'],
    ['Wants to work on', labelOf(FOCUS_AREAS, a.focus)],
    ['Helps a team by', labelOf(TEAM_STYLES, a.teamStyle)],
    ['Leadership role', labelOf(LEADERSHIP_INTEREST, a.leadership)],
    ['Presenting comfort', a.presentingComfort ? `${a.presentingComfort} / 5` : '—'],
    [
      'Other competitions',
      [a.competitions.map((k) => labelOf(OTHER_COMPETITIONS, k)).join(', '), a.competitionsOther].filter(Boolean).join(': ') || '—',
    ],
    ['Notes', a.notes || '—'],
    ['Age · gender', [s.age !== null ? `${Math.floor(s.age)}` : null, s.gender].filter(Boolean).join(' · ') || '—'],
    ['Ethnicity', s.ethnicity.join(', ') || '—'],
    ['Previous Stellr events', String(s.experience)],
  ]
  return (
    <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="w-44 shrink-0 text-brand-muted-soft">{k}</dt>
          <dd className="text-brand-muted whitespace-pre-wrap">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
