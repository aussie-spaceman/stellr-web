'use client'

import { useRef, useState } from 'react'
import { Button } from '@stellr/web-ui'
import {
  FOCUS_AREAS,
  LEADERSHIP_INTEREST,
  MAX_NAME_CHARS,
  MAX_NOTES_CHARS,
  MAX_OTHER_CHARS,
  OTHER_COMPETITIONS,
  RATING_LEVELS,
  SKILL_AREAS,
  SOFT_SKILLS,
  TEAM_STYLES,
  missingAnswers,
  type TeamProfileAnswers,
} from '@/lib/team-profile/questions'

// The team profile form (lib/team-profile/questions.ts), on one page.
// Submitting saves; the student can come back and change answers until the
// event starts.

type Opt = { key: string; label: string }

export function TeamProfileForm({
  token,
  initial,
  studentFirstName,
  eventTitle,
  prefilled,
  submitted,
}: {
  token: string
  initial: TeamProfileAnswers
  studentFirstName: string
  eventTitle: string
  prefilled: boolean
  submitted: boolean
}) {
  const [a, setA] = useState<TeamProfileAnswers>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const [done, setDone] = useState(submitted)
  const [editing, setEditing] = useState(!submitted)
  const topRef = useRef<HTMLDivElement>(null)

  const set = <K extends keyof TeamProfileAnswers>(k: K, v: TeamProfileAnswers[K]) => setA((x) => ({ ...x, [k]: v }))
  const toggle = (k: 'strengths' | 'weaknesses' | 'competitions', key: string, exclusive?: string) =>
    setA((x) => {
      const cur = x[k] as string[]
      if (cur.includes(key)) return { ...x, [k]: cur.filter((c) => c !== key) }
      if (exclusive && key === exclusive) return { ...x, [k]: [key] }
      return { ...x, [k]: [...cur.filter((c) => c !== exclusive), key] }
    })
  const err = (key: string) => (missing.has(key) ? 'Please answer this question.' : null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const gaps = missingAnswers(a)
    setMissing(new Set(gaps))
    if (gaps.length) {
      setError('A few questions still need an answer. They’re marked below.')
      document.getElementById(`q-${gaps[0].split('.')[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/team-profile/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: a }),
    }).catch(() => null)
    setBusy(false)
    if (!res?.ok) {
      const body = await res?.json().catch(() => null)
      setError(body?.error ?? 'Saving failed. Please try again.')
      if (Array.isArray(body?.missing)) setMissing(new Set(body.missing))
      return
    }
    setDone(true)
    setEditing(false)
    topRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  if (done && !editing) {
    return (
      <div ref={topRef}>
        <section className="rounded-ds-card border border-line bg-white p-6 sm:p-8">
          <p className="font-subheading text-xs font-semibold uppercase tracking-[0.14em] text-primary-deep">Team profile</p>
          <h1 className="mt-2 font-display text-2xl font-bold text-ink">Thanks, {studentFirstName}. You’re all set.</h1>
          <p className="mt-3 text-content-body">
            We’ll use your answers to build balanced companies for {eventTitle}. You can change them any time before the event starts.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="secondaryStrong" onClick={() => setEditing(true)}>Change my answers</Button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div ref={topRef}>
      <section className="rounded-ds-card border border-line bg-white p-6 sm:p-8">
        <p className="font-subheading text-xs font-semibold uppercase tracking-[0.14em] text-primary-deep">Team profile · about 5 min</p>
        <h1 className="mt-2 font-display text-3xl font-bold text-ink">{eventTitle}</h1>
        <p className="mt-4 text-content-body">
          At the event you’ll work in a company with students from other schools. Tell us about your skills and how you like to
          work, and we’ll build companies with a good mix of both. There are no wrong answers.
        </p>
        {prefilled && (
          <p className="mt-4 rounded-control border border-pathway-amber bg-pathway-amber-bg px-4 py-3 text-sm text-brand-gold-ink">
            Welcome back! We’ve filled this in with your answers from last time. Check them, change anything that’s different,
            and submit.
          </p>
        )}
      </section>

      <form onSubmit={submit} noValidate className="mt-5 space-y-6 rounded-ds-card border border-line bg-white p-5 sm:p-8">
        {error && <p role="alert" className="rounded-control border border-danger bg-white px-4 py-3 text-sm text-danger">{error}</p>}

        <Question id="q-skills" n={1} label="Rate your skills" help="Be honest: a mix of levels makes the best companies." error={SKILL_AREAS.some((s) => missing.has(`skills.${s.key}`)) ? 'Please rate every area.' : null}>
          <div className="space-y-3">
            {SKILL_AREAS.map((s) => (
              <fieldset key={s.key} className={`rounded-control border p-3 ${missing.has(`skills.${s.key}`) ? 'border-danger' : 'border-line-light'}`}>
                <legend className="px-1 text-sm font-semibold text-ink">{s.label}</legend>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  {RATING_LEVELS.map((r) => (
                    <Choice
                      key={r.key}
                      name={`skills-${s.key}`}
                      label={r.label}
                      compact
                      checked={a.skills[s.key] === r.key}
                      onSelect={() => set('skills', { ...a.skills, [s.key]: r.key })}
                    />
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        </Question>

        <Question id="q-strengths" n={2} label="What are your STEM strengths?" help="Select all that apply." error={err('strengths')}>
          <Checks options={SOFT_SKILLS} value={a.strengths} onToggle={(k) => toggle('strengths', k)} disabled={a.weaknesses} />
        </Question>

        <Question id="q-weaknesses" n={3} label="Which would you like to get better at?" help="Select all that apply. Optional: everyone has something to work on." optional>
          <Checks options={SOFT_SKILLS} value={a.weaknesses} onToggle={(k) => toggle('weaknesses', k)} disabled={a.strengths} />
        </Question>

        <Question id="q-focus" n={4} label="Which area would you most like to work on?" error={err('focus')}>
          <Radios name="focus" options={FOCUS_AREAS} value={a.focus} onSelect={(k) => set('focus', k)} />
        </Question>

        <Question id="q-teamStyle" n={5} label="How do you usually help a team most?" error={err('teamStyle')}>
          <Radios name="teamStyle" options={TEAM_STYLES} value={a.teamStyle} onSelect={(k) => set('teamStyle', k)} />
        </Question>

        <Question id="q-leadership" n={6} label="Would you like a leadership role in your company?" error={err('leadership')}>
          <Radios name="leadership" options={LEADERSHIP_INTEREST} value={a.leadership} onSelect={(k) => set('leadership', k)} />
        </Question>

        <Question id="q-presentingComfort" n={7} label="How comfortable are you presenting to a panel of judges?" error={err('presentingComfort')}>
          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <Choice key={n} name="presentingComfort" label={String(n)} compact checked={a.presentingComfort === n} onSelect={() => set('presentingComfort', n)} />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-content-muted">
            <span>1 = not at all</span>
            <span>5 = very comfortable</span>
          </div>
        </Question>

        <Question id="q-competitions" n={8} label="Have you taken part in other STEM or team competitions?" help="Select all that apply." error={err('competitions')}>
          <Checks options={OTHER_COMPETITIONS} value={a.competitions} onToggle={(k) => toggle('competitions', k, 'none')} />
          {a.competitions.includes('other') && (
            <label className="mt-3 block">
              <span className="text-sm font-semibold text-ink">Which ones?</span>
              <input
                type="text"
                maxLength={MAX_OTHER_CHARS}
                value={a.competitionsOther}
                onChange={(e) => set('competitionsOther', e.target.value)}
                className="mt-1 w-full rounded-control border border-line px-3 py-2 text-ink"
              />
            </label>
          )}
        </Question>

        <Question id="q-teammates" n={9} label="Want to be in the same company as someone?" help="Add their full name (up to two people). We’ll do our best, but can’t promise." optional>
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <input
                key={i}
                type="text"
                maxLength={MAX_NAME_CHARS}
                aria-label={`Teammate ${i + 1}`}
                placeholder={`Teammate ${i + 1}`}
                value={a.teammates[i] ?? ''}
                onChange={(e) => {
                  const next = [a.teammates[0] ?? '', a.teammates[1] ?? '']
                  next[i] = e.target.value
                  set('teammates', next)
                }}
                className="w-full rounded-control border border-line px-3 py-2 text-ink"
              />
            ))}
          </div>
        </Question>

        <Question id="q-notes" n={10} label="Anything else that would help us put you in a company where you’ll do your best work?" optional>
          <textarea
            rows={3}
            maxLength={MAX_NOTES_CHARS}
            value={a.notes}
            onChange={(e) => set('notes', e.target.value)}
            className="w-full rounded-control border border-line px-3 py-2 text-ink"
          />
          <p className="mt-1 text-xs text-content-muted">Only Stellr staff and your event managers see this.</p>
        </Question>

        <div className="flex flex-wrap items-center gap-3 border-t border-line-light pt-5">
          <Button type="submit" variant="primaryStrong" disabled={busy}>
            {busy ? 'Saving…' : done ? 'Save changes' : 'Submit'}
          </Button>
          {done && (
            <Button type="button" variant="secondaryStrong" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}

function Question({
  id,
  n,
  label,
  help,
  error,
  optional,
  children,
}: {
  id: string
  n: number
  label: string
  help?: string
  error?: string | null
  optional?: boolean
  children: React.ReactNode
}) {
  return (
    <fieldset id={id} aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="flex flex-wrap items-baseline gap-2">
        <span className="font-semibold text-ink">
          {n}. {label}
        </span>
        {optional && <span className="text-xs font-semibold text-content-muted">Optional</span>}
      </legend>
      {help && <p className="mt-1 text-sm text-content-muted">{help}</p>}
      <div className="mt-3">{children}</div>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </fieldset>
  )
}

function Radios({ name, options, value, onSelect }: { name: string; options: readonly Opt[]; value: string | null; onSelect: (k: string) => void }) {
  return (
    <div className="space-y-2">
      {options.map((o) => (
        <Choice key={o.key} name={name} label={o.label} checked={value === o.key} onSelect={() => onSelect(o.key)} />
      ))}
    </div>
  )
}

function Checks({
  options,
  value,
  onToggle,
  disabled = [],
}: {
  options: readonly Opt[]
  value: string[]
  onToggle: (k: string) => void
  /** Keys picked in the sibling question: a skill can't be both. */
  disabled?: string[]
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => {
        const checked = value.includes(o.key)
        const off = !checked && disabled.includes(o.key)
        return (
          <label
            key={o.key}
            className={`flex items-start gap-3 rounded-control border px-3 py-3 ${
              off ? 'cursor-not-allowed border-line-light bg-surface text-content-muted' : 'cursor-pointer'
            } ${checked ? 'border-primary-deep bg-primary-soft' : off ? '' : 'border-line bg-white'}`}
          >
            <input type="checkbox" className="mt-1 h-5 w-5" checked={checked} disabled={off} onChange={() => onToggle(o.key)} />
            <span className={off ? '' : 'text-ink'}>{o.label}</span>
          </label>
        )
      })}
    </div>
  )
}

function Choice({ name, checked, label, onSelect, compact }: { name: string; checked: boolean; label: string; onSelect: () => void; compact?: boolean }) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-control border ${compact ? 'justify-center px-3 py-2 text-sm' : 'px-3 py-3'} ${
        checked ? 'border-primary-deep bg-primary-soft font-semibold text-primary-deep' : 'border-line bg-white text-ink'
      }`}
    >
      <input type="radio" name={name} value={label} checked={checked} onChange={onSelect} className={compact ? 'sr-only' : 'h-5 w-5'} />
      <span>{label}</span>
    </label>
  )
}
