'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button } from '@stellr/web-ui'
import type { Option, Question } from '@/lib/survey/definition'
import { withRuntimeOptions } from '@/lib/survey/definition'
import { fillTemplate, visiblePages, type AnswerValue, type Answers } from '@/lib/survey/branching'
import { missingRequired } from '@/lib/survey/answers'
import type { ClientView } from '@/lib/survey/access'
import { SurveyAfterSubmit } from './SurveyAfterSubmit'

// The post-event survey a respondent fills in (handover §3 P1/P2, §6 UI):
// an intro with the privacy notice and the time promise, then one question
// group per page with a progress bar. Answers save on every page change and
// 10 s after the last edit; the same link (or the dashboard) resumes on the
// page they left. Submitting asks for confirmation first, then nothing can be
// changed — the server and the database both refuse.

const AUTOSAVE_MS = 10_000

type Phase = 'intro' | 'page' | 'confirm' | 'done'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function SurveyApp({ apiBase, view, signedIn }: { apiBase: string; view: ClientView; signedIn: boolean }) {
  const def = view.definition
  const ctx = view.context
  const [answers, setAnswers] = useState<Answers>(view.answers ?? {})
  const pages = useMemo(() => visiblePages(def, ctx, answers), [def, ctx, answers])
  const resumeIndex = Math.max(0, pages.findIndex((p) => p.id === view.currentPage))
  const [phase, setPhase] = useState<Phase>(view.submittedAt ? 'done' : 'intro')
  const [index, setIndex] = useState(resumeIndex)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const page = pages[Math.min(index, pages.length - 1)]
  const hasDraft = Object.keys(view.answers ?? {}).length > 0

  const save = useCallback(
    async (pageId: string | undefined, current: Answers) => {
      if (timer.current) clearTimeout(timer.current)
      dirty.current = false
      setSaveState('saving')
      try {
        const res = await fetch(apiBase, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers: current, page: pageId }),
          cache: 'no-store',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setSaveState('error')
          if (data.fieldErrors) setErrors(data.fieldErrors)
          setMessage(data.error ?? 'Saving failed. Your answers are still here; try again.')
          return false
        }
        setSaveState('saved')
        return true
      } catch {
        setSaveState('error')
        return false
      }
    },
    [apiBase],
  )

  // Autosave 10 s after the last edit.
  const update = (key: string, value: AnswerValue) => {
    setAnswers((prev) => {
      const next = { ...prev }
      if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) delete next[key]
      else next[key] = value
      dirty.current = true
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void save(page?.id, next), AUTOSAVE_MS)
      return next
    })
    setErrors((e) => {
      if (!e[key]) return e
      const { [key]: _gone, ...rest } = e
      return rest
    })
  }

  // Save when the tab is hidden (phone locked, app switched).
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && dirty.current) void save(page?.id, answers)
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [save, page?.id, answers])

  useEffect(() => {
    window.scrollTo({ top: 0 })
    if (phase === 'page' || phase === 'confirm') headingRef.current?.focus({ preventScroll: true })
  }, [phase, index])

  const go = async (to: number) => {
    setMessage(null)
    const target = pages[to]
    await save(target?.id, answers)
    setIndex(to)
  }

  const next = async () => {
    const pageKeys = new Set(page.questions.map((q) => q.key))
    const missing = Object.fromEntries(Object.entries(missingRequired(def, ctx, answers)).filter(([k]) => pageKeys.has(k)))
    if (Object.keys(missing).length) {
      setErrors(missing)
      setMessage('Please answer the questions marked required.')
      document.getElementById(`q-${Object.keys(missing)[0]}`)?.scrollIntoView({ block: 'center' })
      return
    }
    if (index >= pages.length - 1) {
      await save(page.id, answers)
      setPhase('confirm')
      return
    }
    await go(index + 1)
  }

  const submit = async () => {
    setSubmitting(true)
    setMessage(null)
    try {
      const res = await fetch(`${apiBase}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
        cache: 'no-store',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.fieldErrors) {
          setErrors(data.fieldErrors)
          const first = pages.findIndex((p) => p.questions.some((q) => data.fieldErrors[q.key]))
          if (first >= 0) {
            setIndex(first)
            setPhase('page')
          }
        }
        setMessage(data.error ?? 'Submitting failed. Your answers are saved; try again.')
        return
      }
      setPhase('done')
    } finally {
      setSubmitting(false)
    }
  }

  const minutes = Math.ceil(def.targetMinutes[ctx.role])
  const progress = phase === 'confirm' ? 100 : Math.round((index / Math.max(1, pages.length)) * 100)

  return (
    <main className="min-h-screen bg-surface px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-2xl" aria-live="polite">
        {phase === 'intro' && (
          <section className="rounded-ds-card border border-line bg-white p-6 sm:p-8">
            <p className="font-subheading text-xs font-semibold uppercase tracking-[0.14em] text-primary-deep">Stellr survey · about {minutes} min</p>
            <h1 className="mt-2 font-display text-3xl font-bold text-ink">{fillTemplate(def.intro.heading, ctx)}</h1>
            <p className="mt-4 text-content-body">{ctx.role === 'student' ? def.intro.bodyStudent : def.intro.bodyAdult}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button variant="primaryStrong" onClick={() => setPhase('page')}>
                {hasDraft ? 'Continue where you left off' : 'Start'}
              </Button>
              {hasDraft && resumeIndex > 0 && (
                <Button variant="secondaryStrong" onClick={() => { setIndex(0); setPhase('page') }}>
                  Start from the first page
                </Button>
              )}
            </div>
          </section>
        )}

        {phase === 'page' && page && (
          <div className="space-y-5">
            <h1 ref={headingRef} tabIndex={-1} className="font-display text-xl font-bold text-ink outline-none">
              {fillTemplate(def.intro.heading, ctx)}
            </h1>
            <Progress value={progress} label={`Page ${index + 1} of ${pages.length}`} />
            {message && <p role="alert" className="rounded-control border border-danger bg-white px-4 py-3 text-sm text-danger">{message}</p>}
            <form
              className="space-y-6 rounded-ds-card border border-line bg-white p-5 sm:p-8"
              onSubmit={(e) => {
                e.preventDefault()
                void next()
              }}
              noValidate
            >
              {page.questions.map((q) => (
                <QuestionField
                  key={q.key}
                  q={withRuntimeOptions(q, view.runtimeOptions)}
                  value={answers[q.key] ?? null}
                  error={errors[q.key]}
                  onChange={(v) => update(q.key, v)}
                />
              ))}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-light pt-5">
                <div className="flex gap-3">
                  {index > 0 && (
                    <Button variant="secondaryStrong" type="button" onClick={() => void go(index - 1)}>
                      Back
                    </Button>
                  )}
                  <Button variant="primaryStrong" type="submit">
                    {index >= pages.length - 1 ? 'Review and submit' : 'Next'}
                  </Button>
                </div>
                <SaveStatus state={saveState} />
              </div>
            </form>
          </div>
        )}

        {phase === 'confirm' && (
          <section className="rounded-ds-card border border-line bg-white p-6 sm:p-8">
            <Progress value={100} label="Ready to submit" />
            <h1 ref={headingRef} tabIndex={-1} className="mt-6 font-display text-2xl font-bold text-ink outline-none">
              Submit your answers?
            </h1>
            <p className="mt-3 text-content-body">Once you submit, your answers can’t be changed. Go back if you’d like to check anything first.</p>
            {message && <p role="alert" className="mt-4 rounded-control border border-danger bg-white px-4 py-3 text-sm text-danger">{message}</p>}
            <div className="mt-6 flex flex-wrap gap-3">
              <Button variant="secondaryStrong" type="button" onClick={() => { setPhase('page'); setIndex(pages.length - 1) }} disabled={submitting}>
                Go back
              </Button>
              <Button variant="primaryStrong" type="button" onClick={() => void submit()} disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit'}
              </Button>
            </div>
          </section>
        )}

        {phase === 'done' && (
          <SurveyAfterSubmit eventTitle={ctx.event_title} signedIn={signedIn} justSubmitted={!view.submittedAt} />
        )}
      </div>
    </main>
  )
}

function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs font-semibold text-content-muted">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-pill bg-line-light" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label="Survey progress">
        <div className="h-full rounded-pill bg-primary-deep transition-all" style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function SaveStatus({ state }: { state: SaveState }) {
  const text = { idle: '', saving: 'Saving…', saved: 'Saved', error: 'Not saved — check your connection' }[state]
  return (
    <p className={`text-sm ${state === 'error' ? 'text-danger' : 'text-content-muted'}`} role="status">
      {text}
    </p>
  )
}

// ── Question widgets ─────────────────────────────────────────────────────────

function QuestionField({ q, value, error, onChange }: { q: Question; value: AnswerValue; error?: string; onChange: (v: AnswerValue) => void }) {
  const id = `q-${q.key}`
  const describedBy = [q.help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined
  const label = (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-semibold text-ink">{q.label}</span>
      {q.required && <span className="text-xs font-semibold text-content-muted">Required</span>}
      {q.quotable && <Badge className="bg-pathway-amber-bg text-brand-gold-ink">{q.labelTag ?? 'may be quoted'}</Badge>}
    </span>
  )
  const help = q.help ? <p id={`${id}-help`} className="mt-1 text-sm text-content-muted">{q.help}</p> : null
  const err = error ? <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-danger">{error}</p> : null

  if (q.type === 'boolean') {
    return (
      <div>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 h-5 w-5" checked={value === true} onChange={(e) => onChange(e.target.checked)} aria-describedby={describedBy} />
          {label}
        </label>
        {help}
        {err}
      </div>
    )
  }

  if (q.type === 'text_short' || q.type === 'text_long' || q.type === 'school_lookup' || q.type === 'number') {
    const str = value === null ? '' : String(value)
    const common = {
      id,
      'aria-describedby': describedBy,
      'aria-invalid': !!error,
      className: 'mt-2 w-full rounded-control border border-line px-3 py-2 text-ink',
    }
    return (
      <div>
        <label htmlFor={id}>{label}</label>
        {help}
        {q.type === 'text_long' ? (
          <textarea {...common} rows={4} maxLength={q.maxChars} value={str} onChange={(e) => onChange(e.target.value)} />
        ) : q.type === 'number' ? (
          <div className="flex items-center gap-2">
            <input
              {...common}
              className="mt-2 w-32 rounded-control border border-line px-3 py-2 text-ink"
              type="number"
              inputMode="decimal"
              min={q.min}
              max={q.max}
              value={str}
              onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
            />
            {q.unit && <span className="mt-2 text-content-muted">{q.unit}</span>}
          </div>
        ) : (
          <input {...common} type="text" maxLength={q.maxChars} value={str} onChange={(e) => onChange(e.target.value)} autoComplete={q.type === 'school_lookup' ? 'organization' : 'off'} />
        )}
        {q.maxChars && q.type !== 'number' && (
          <p className="mt-1 text-right text-xs text-content-muted">
            {str.length}/{q.maxChars}
          </p>
        )}
        {err}
      </div>
    )
  }

  if (q.type === 'nps') {
    return (
      <fieldset id={id} aria-describedby={describedBy}>
        <legend>{label}</legend>
        {help}
        <div className="mt-3 grid grid-cols-6 gap-2 sm:grid-cols-11">
          {Array.from({ length: 11 }, (_, n) => (
            <Choice key={n} name={q.key} checked={value === n} onSelect={() => onChange(n)} label={String(n)} compact />
          ))}
        </div>
        {q.npsLabels && (
          <div className="mt-2 flex justify-between text-xs text-content-muted">
            <span>0 = {q.npsLabels.min}</span>
            <span>10 = {q.npsLabels.max}</span>
          </div>
        )}
        {err}
      </fieldset>
    )
  }

  if (q.type === 'grid') {
    const v = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, string>
    return (
      <fieldset id={id} aria-describedby={describedBy}>
        <legend>{label}</legend>
        {help}
        <div className="mt-3 space-y-4">
          {(q.rows ?? []).map((row) => (
            <fieldset key={row.key} className="rounded-control border border-line-light p-3">
              <legend className="px-1 text-sm font-semibold text-ink">{row.label}</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {(q.options ?? []).map((o) => (
                  <Choice
                    key={o.key}
                    name={`${q.key}-${row.key}`}
                    checked={v[row.key] === o.key}
                    label={o.label}
                    compact
                    onSelect={() => onChange({ ...v, [row.key]: o.key })}
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        {err}
      </fieldset>
    )
  }

  if (q.type === 'multi') {
    const v = Array.isArray(value) ? value : []
    const toggle = (o: Option) => {
      if (v.includes(o.key)) return onChange(v.filter((x) => x !== o.key))
      if (o.exclusive) return onChange([o.key])
      const exclusive = new Set((q.options ?? []).filter((x) => x.exclusive).map((x) => x.key))
      onChange([...v.filter((x) => !exclusive.has(x)), o.key])
    }
    return (
      <fieldset id={id} aria-describedby={describedBy}>
        <legend>{label}</legend>
        {help}
        <div className="mt-3 space-y-2">
          {(q.options ?? []).map((o) => (
            <label key={o.key} className={`flex cursor-pointer items-start gap-3 rounded-control border px-3 py-3 ${v.includes(o.key) ? 'border-primary-deep bg-primary-soft' : 'border-line bg-white'}`}>
              <input type="checkbox" value={o.key} className="mt-1 h-5 w-5" checked={v.includes(o.key)} onChange={() => toggle(o)} />
              <span className="text-ink">{o.label}</span>
            </label>
          ))}
        </div>
        {err}
      </fieldset>
    )
  }

  // single
  return (
    <fieldset id={id} aria-describedby={describedBy}>
      <legend>{label}</legend>
      {help}
      <div className="mt-3 space-y-2">
        {(q.options ?? []).map((o) => (
          <Choice key={o.key} name={q.key} checked={value === o.key} label={o.label} onSelect={() => onChange(o.key)} />
        ))}
      </div>
      {err}
    </fieldset>
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
