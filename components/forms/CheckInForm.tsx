'use client'

import { useState } from 'react'
import { Check, ClipboardList, FolderOpen, Mail } from 'lucide-react'
import { Button, Eyebrow } from '@stellr/web-ui'
import type { CheckInView } from '@/lib/check-in-view'

// Phone-first check-in at the door (PRD 6.7; reworked after CO, Oct 2026).
// Step 1 is name + date of birth, because participants often don't know which
// email they were registered under. Email is the fallback. Success shows a big
// screen the desk can read at a glance — company number and shirt size — and
// the participant's links for the event. The phone is remembered, so reopening
// the page comes straight back here.

type Step = 'name' | 'email'

const INPUT =
  'mt-1.5 w-full rounded-control border border-line bg-white px-4 py-3.5 text-base text-ink placeholder:text-content-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30'
const LABEL = 'block font-subheading text-sm font-medium text-content-body'

export default function CheckInForm({
  slug,
  token,
  isVirtual,
  initialView,
}: {
  slug: string
  token: string | null
  isVirtual: boolean
  /** Set when the phone is already remembered for this event. */
  initialView: CheckInView | null
}) {
  const [step, setStep] = useState<Step>('name')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [dob, setDob] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<CheckInView | null>(initialView)
  const [already, setAlready] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const payload = step === 'name' ? { slug, token, firstName, lastName, dob } : { slug, token, email }
    const res = await fetch('/api/check-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null)
    const body = await res?.json().catch(() => null)
    setBusy(false)
    if (!res?.ok) {
      if (body?.code === 'need_email') setStep('email')
      setError(body?.error ?? 'Something went wrong. Please see the registration desk.')
      return
    }
    setAlready(Boolean(body.alreadyCheckedIn))
    setView(body.view)
  }

  async function forget() {
    await fetch(`/api/check-in?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' }).catch(() => null)
    setView(null)
    setAlready(false)
    setStep('name')
    setFirstName('')
    setLastName('')
    setDob('')
    setEmail('')
    setError(null)
  }

  if (view) return <CheckedIn view={view} isVirtual={isVirtual} already={already} onForget={forget} canCheckInAnother={!!token} />

  if (!token) {
    return (
      <p className="text-center text-sm text-danger">
        This check-in link is incomplete. Scan the event QR code again, or use the link from your email.
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {step === 'name' ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>
              First name
              <input
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
                autoCapitalize="words"
                className={INPUT}
              />
            </label>
            <label className={LABEL}>
              Last name
              <input
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                autoCapitalize="words"
                className={INPUT}
              />
            </label>
          </div>
          <label className={LABEL}>
            Date of birth
            <input
              type="date"
              required
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              autoComplete="bday"
              max={new Date().toISOString().slice(0, 10)}
              className={INPUT}
            />
          </label>
        </>
      ) : (
        <label className={LABEL}>
          Email address you registered with
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            autoComplete="email"
            className={INPUT}
          />
          <span className="mt-1.5 block text-xs text-content-muted">
            If a parent or teacher registered you, it may be their email.
          </span>
        </label>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <Button type="submit" disabled={busy} className="w-full py-4 text-base">
        {busy ? 'Checking…' : isVirtual ? 'Confirm attendance' : 'Check in'}
      </Button>

      <button
        type="button"
        onClick={() => {
          setStep(step === 'name' ? 'email' : 'name')
          setError(null)
        }}
        className="flex min-h-11 w-full items-center justify-center gap-2 text-sm font-medium text-primary"
      >
        {step === 'name' ? (
          <>
            <Mail className="h-4 w-4" aria-hidden /> Use my email instead
          </>
        ) : (
          'Use my name and date of birth'
        )}
      </button>
    </form>
  )
}

function CheckedIn({
  view,
  isVirtual,
  already,
  onForget,
  canCheckInAnother,
}: {
  view: CheckInView
  isVirtual: boolean
  already: boolean
  onForget: () => void
  canCheckInAnother: boolean
}) {
  const status = !view.checkedInAt
    ? null
    : already
      ? 'Already checked in'
      : isVirtual
        ? 'Attendance confirmed'
        : 'You’re checked in'

  return (
    <div className="space-y-6">
      <div className="text-center">
        {status && (
          <div className="mx-auto mb-3 inline-flex h-14 w-14 items-center justify-center rounded-full bg-enviro-green-bg">
            <Check className="h-7 w-7 text-enviro-green" strokeWidth={3} aria-hidden />
          </div>
        )}
        {status && <Eyebrow className="text-enviro-green-text">{status}</Eyebrow>}
        <h2 className="mt-1 font-display text-3xl font-bold text-ink">
          {view.firstName} {view.lastName}
        </h2>
      </div>

      {!isVirtual && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-ds-card bg-midnight px-4 py-5 text-center text-white">
            <p className="font-subheading text-xs uppercase tracking-wide text-hero-dim">Company</p>
            {view.companyNumber != null ? (
              <p className="mt-1 font-display text-6xl font-bold leading-none tabular-nums">{view.companyNumber}</p>
            ) : (
              <p className="mt-3 text-sm text-hero-lead">Ask at the desk</p>
            )}
          </div>
          <div className="rounded-ds-card border border-line bg-surface px-4 py-5 text-center">
            <p className="font-subheading text-xs uppercase tracking-wide text-content-muted">Shirt size</p>
            {view.shirtSize ? (
              <p className="mt-1 font-display text-5xl font-bold leading-none text-ink">{view.shirtSize}</p>
            ) : (
              <p className="mt-3 text-sm text-content-muted">Not on file</p>
            )}
          </div>
        </div>
      )}

      {!isVirtual && view.checkedInAt && (
        <p className="text-center text-sm text-content-muted">Show this screen at the registration desk.</p>
      )}

      {(view.resourcesUrl || view.survey) && (
        <div className="space-y-3 border-t border-line-light pt-5">
          <Eyebrow className="text-content-muted">Your event links</Eyebrow>
          {view.resourcesUrl && (
            <Button
              href={view.resourcesUrl}
              target="_blank"
              rel="noopener noreferrer"
              variant="softBlue"
              className="w-full justify-start py-4 text-base"
            >
              <FolderOpen className="h-5 w-5" aria-hidden /> Event documents
            </Button>
          )}
          {view.survey && <SurveyLink survey={view.survey} />}
        </div>
      )}

      {canCheckInAnother && (
        <button
          type="button"
          onClick={onForget}
          className="flex min-h-11 w-full items-center justify-center text-sm text-content-muted underline underline-offset-2"
        >
          Not you? Check in someone else
        </button>
      )}
    </div>
  )
}

function SurveyLink({ survey }: { survey: NonNullable<CheckInView['survey']> }) {
  if (survey.state === 'open') {
    return (
      <Button href={survey.url} variant="softBlue" className="w-full justify-start py-4 text-base">
        <ClipboardList className="h-5 w-5" aria-hidden /> Post-event survey
      </Button>
    )
  }
  const note =
    survey.state === 'scheduled'
      ? `Opens ${survey.opensOn}. Come back to this page then.`
      : survey.state === 'guardian'
        ? 'The link goes to your parent or guardian’s email.'
        : survey.state === 'submitted'
          ? 'Done — thank you for your feedback.'
          : 'This survey has closed.'
  return (
    <div className="flex items-start gap-3 rounded-control border border-line-light bg-surface px-4 py-3.5">
      <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-content-faint" aria-hidden />
      <div>
        <p className="font-subheading text-sm font-semibold text-content-body">Post-event survey</p>
        <p className="text-sm text-content-muted">{note}</p>
      </div>
    </div>
  )
}
