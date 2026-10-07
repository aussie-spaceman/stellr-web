'use client'

import { useState } from 'react'
import type { HistoryEntry } from '@/lib/team-profile/store'
import { diffAnswers } from '@/lib/team-profile/diff'
import {
  FOCUS_AREAS,
  LEADERSHIP_INTEREST,
  OTHER_COMPETITIONS,
  RATING_LEVELS,
  SKILL_AREAS,
  SOFT_SKILLS,
  TEAM_STYLES,
  labelOf,
  type TeamProfileAnswers,
} from '@/lib/team-profile/questions'

// Account → Profile: the student's team profile for each event, and what
// changed since the one before. Answers can be updated until an event starts.

const fmt = (d: string | null) =>
  d ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

export function TeamProfileHistory({ entries }: { entries: HistoryEntry[] }) {
  const [open, setOpen] = useState<string | null>(null)
  if (entries.length === 0) return null

  // Each submitted profile compared with the previous submitted one (entries are newest first).
  const submitted = entries.filter((e) => e.submittedAt)

  return (
    <div className="rounded-xl border border-brand-border bg-white p-5">
      <h2 className="text-base font-semibold text-brand-blue-dark">My Team Profiles</h2>
      <p className="mt-1 mb-4 text-xs text-brand-muted-soft">
        Your skills and how you like to work, used to build balanced companies at each event.
      </p>
      <ul className="divide-y divide-brand-hairline">
        {entries.map((e) => {
          const prev = e.submittedAt ? submitted[submitted.indexOf(e) + 1] : undefined
          const changes = prev ? diffAnswers(prev.answers, e.answers) : []
          return (
            <li key={e.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex-1 min-w-48">
                  <p className="font-medium text-brand-blue-dark">{e.eventTitle}</p>
                  <p className="text-xs text-brand-muted-soft">
                    {e.submittedAt ? `Submitted ${fmt(e.submittedAt)}` : 'Not submitted yet'}
                    {e.eventDate ? ` · event ${fmt(e.eventDate)}` : ''}
                  </p>
                </div>
                {e.submittedAt && (
                  <button
                    onClick={() => setOpen(open === e.id ? null : e.id)}
                    className="text-xs font-medium text-brand-blue hover:text-brand-blue-dark"
                  >
                    {open === e.id ? 'Hide answers' : 'View answers'}
                  </button>
                )}
                {e.editUrl && (
                  <a
                    href={e.editUrl}
                    className="inline-flex text-xs px-3 py-1 rounded-full font-medium bg-brand-blue text-white hover:bg-brand-blue-dark"
                  >
                    {e.submittedAt ? 'Update answers' : 'Fill in now'}
                  </a>
                )}
              </div>
              {open === e.id && (
                <div className="mt-3 space-y-3">
                  {prev && (
                    <div className="rounded-lg bg-brand-canvas p-3">
                      <p className="text-xs font-semibold text-brand-muted">Since {prev.eventTitle}</p>
                      {changes.length === 0 ? (
                        <p className="mt-1 text-xs text-brand-muted-soft">No changes.</p>
                      ) : (
                        <ul className="mt-1 space-y-0.5 text-xs text-brand-muted">
                          {changes.map((c) => (
                            <li key={c.label}>
                              <span className="text-brand-muted-soft">{c.label}:</span> {c.from} → <strong>{c.to}</strong>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <AnswerList a={e.answers} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function AnswerList({ a }: { a: TeamProfileAnswers }) {
  const rows: [string, string][] = [
    ...SKILL_AREAS.map((s) => [s.label, labelOf(RATING_LEVELS, a.skills[s.key]) || '—'] as [string, string]),
    ['Strengths', a.strengths.map((k) => labelOf(SOFT_SKILLS, k)).join(', ') || '—'],
    ['Would like to get better at', a.weaknesses.map((k) => labelOf(SOFT_SKILLS, k)).join(', ') || '—'],
    ['Wants to work on', labelOf(FOCUS_AREAS, a.focus) || '—'],
    ['Helps a team by', labelOf(TEAM_STYLES, a.teamStyle) || '—'],
    ['Leadership role', labelOf(LEADERSHIP_INTEREST, a.leadership) || '—'],
    ['Presenting comfort', a.presentingComfort ? `${a.presentingComfort} / 5` : '—'],
    ['Other competitions', [a.competitions.map((k) => labelOf(OTHER_COMPETITIONS, k)).join(', '), a.competitionsOther].filter(Boolean).join(': ') || '—'],
    ['Teammate requests', a.teammates.join(', ') || '—'],
  ]
  return (
    <dl className="grid gap-y-1 text-xs sm:grid-cols-2 sm:gap-x-6">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="w-40 shrink-0 text-brand-muted-soft">{k}</dt>
          <dd className="text-brand-muted">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
