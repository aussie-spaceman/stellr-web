'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Check } from 'lucide-react'

const STAGE_OPTIONS = [
  { value: 'high-school', label: 'High school student' },
  { value: 'college', label: 'College / university student' },
  { value: 'other', label: 'Something else' },
]

const FOCUS_OPTIONS = [
  { value: 'portfolio', label: 'Portfolio & applications' },
  { value: 'stem-skills', label: 'Improving specific STEM skills' },
  { value: 'networking', label: 'Building professional networks' },
  { value: 'college-decisions', label: 'College decisions' },
  { value: 'internships', label: 'Internships & graduate jobs' },
  { value: 'interview', label: 'Interview confidence' },
  { value: 'other', label: 'Other' },
]

const AVAILABILITY_OPTIONS = [
  { value: 'weekday-mornings', label: 'Weekday mornings' },
  { value: 'weekday-afternoons', label: 'Weekday afternoons' },
  { value: 'weekday-evenings', label: 'Weekday evenings' },
  { value: 'weekends', label: 'Weekends' },
]

const DRAFT_KEY = 'stellr:coaching-request-draft'
const INTAKE_PATH = '/academy/coaching/request'

interface Draft {
  topic: string
  stage: string
  focusArea: string
  availability: string[]
  note: string
}

const TEAL = '#0E8C99'

export function CoachingRequestForm() {
  const [topic, setTopic] = useState('')
  const [stage, setStage] = useState('')
  const [focusArea, setFocusArea] = useState('')
  const [availability, setAvailability] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resumed, setResumed] = useState(false)

  // Restore an in-progress draft after a guest signs up and returns here.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const d = JSON.parse(raw) as Draft
      setTopic(d.topic ?? '')
      setStage(d.stage ?? '')
      setFocusArea(d.focusArea ?? '')
      setAvailability(Array.isArray(d.availability) ? d.availability : [])
      setNote(d.note ?? '')
      setResumed(true)
      sessionStorage.removeItem(DRAFT_KEY)
    } catch {
      /* ignore malformed draft */
    }
  }, [])

  const toggleAvailability = (value: string) =>
    setAvailability((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!topic.trim()) {
      setError('Please tell us what you would like coaching on.')
      return
    }
    setBusy(true)
    setError(null)
    const payload: Draft = { topic, stage, focusArea, availability, note }
    try {
      const res = await fetch('/api/community/coaching/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.status === 401) {
        // Guest → preserve the draft and route through sign-up, resuming here.
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(payload))
        window.location.href = `/sign-up?next=${encodeURIComponent(INTAKE_PATH)}`
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Could not submit your request. Please try again.')
        setBusy(false)
        return
      }
      // Land on the member status screen ("Request received" → track).
      window.location.href = `/community/coaching/request/${data.requestId}`
    } catch {
      setError('Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {resumed && (
        <div className="flex items-center gap-2 rounded-panel bg-[#E3F6F8] px-4 py-3 text-sm font-medium text-[#0E8C99]">
          <Check size={16} /> Welcome back — review your request and submit.
        </div>
      )}

      {/* Topic */}
      <div>
        <label htmlFor="topic" className="block text-sm font-bold text-ink">
          What would you like coaching on? <span className="text-danger">*</span>
        </label>
        <textarea
          id="topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          rows={3}
          required
          placeholder="e.g. Turning my Orbital Habitat project into a portfolio piece for university applications."
          className="mt-2 w-full rounded-panel border border-line bg-white px-4 py-3 text-[15px] text-ink placeholder:text-content-faint focus:border-[#0E8C99] focus:outline-none focus:ring-2 focus:ring-[#0E8C99]/20"
        />
      </div>

      {/* Stage + Focus */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="stage" className="block text-sm font-bold text-ink">
            Where are you right now?
          </label>
          <select
            id="stage"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="mt-2 w-full rounded-panel border border-line bg-white px-4 py-3 text-[15px] text-ink focus:border-[#0E8C99] focus:outline-none focus:ring-2 focus:ring-[#0E8C99]/20"
          >
            <option value="">Select…</option>
            {STAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="focus" className="block text-sm font-bold text-ink">
            Main focus area
          </label>
          <select
            id="focus"
            value={focusArea}
            onChange={(e) => setFocusArea(e.target.value)}
            className="mt-2 w-full rounded-panel border border-line bg-white px-4 py-3 text-[15px] text-ink focus:border-[#0E8C99] focus:outline-none focus:ring-2 focus:ring-[#0E8C99]/20"
          >
            <option value="">Select…</option>
            {FOCUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Availability */}
      <div>
        <span className="block text-sm font-bold text-ink">When are you usually free?</span>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {AVAILABILITY_OPTIONS.map((o) => {
            const active = availability.includes(o.value)
            return (
              <button
                type="button"
                key={o.value}
                onClick={() => toggleAvailability(o.value)}
                aria-pressed={active}
                className={`flex items-center gap-2 rounded-panel border px-4 py-2.5 text-left text-sm font-medium transition-colors ${
                  active
                    ? 'border-[#0E8C99] bg-[#E3F6F8] text-[#0E8C99]'
                    : 'border-line bg-white text-content-secondary hover:border-content-faint'
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 ${
                    active ? 'border-[#0E8C99] bg-[#0E8C99] text-white' : 'border-content-faint'
                  }`}
                >
                  {active && <Check size={11} />}
                </span>
                {o.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Note */}
      <div>
        <label htmlFor="note" className="block text-sm font-bold text-ink">
          Anything else your coach should know? <span className="font-normal text-content-faint">(optional)</span>
        </label>
        <textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="mt-2 w-full rounded-panel border border-line bg-white px-4 py-3 text-[15px] text-ink placeholder:text-content-faint focus:border-[#0E8C99] focus:outline-none focus:ring-2 focus:ring-[#0E8C99]/20"
        />
      </div>

      {error && <p className="text-sm font-medium text-danger">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-control px-6 py-3 text-sm font-semibold text-white transition-colors disabled:opacity-50"
          style={{ background: TEAL }}
        >
          {busy ? 'Submitting…' : 'Request a coaching session'} <ArrowRight size={16} />
        </button>
        <p className="text-[13px] text-content-muted">
          You’ll create a free account if you don’t have one — we’ll bring you right back here.
        </p>
      </div>
    </form>
  )
}
