'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@stellr/web-ui'
import { SCHOLARSHIP_LEVELS, discountedCents, formatUsd } from '@/lib/scholarship-levels'

// The decision panel on /admin/scholarships/[id]: event, member, level, then
// "Offer & register" (or "Not offered"). Sequenced one choice at a time, and
// the confirm step states exactly what will happen — who is emailed, what they
// will pay, and whether an existing registration is being reused.

export interface ReviewEvent {
  slug: string
  title: string
  dateLabel: string | null
  feeCents: number | null
}

export interface ReviewMember {
  id: string
  name: string
  email: string
  membershipId: string | null
  profileComplete: boolean
  /** Why it was suggested. */
  reason: 'email' | 'guardian_email' | 'name'
}

export interface ReviewRegistration {
  id: string
  eventSlug: string
  eventTitle: string
  status: string
  type: string
  amountDueCents: number | null
  memberId: string | null
}

const REASON: Record<ReviewMember['reason'], string> = {
  email: 'same email',
  guardian_email: 'application email is their emergency contact',
  name: 'same name',
}

const NEW_MEMBER = '__new__'

// The quote couldn't be fetched. The offer still works: the server quotes again
// when it issues the refund.
const QUOTE_UNAVAILABLE = {
  status: 'manual',
  refundCents: 0,
  feePaidCents: null,
  targetCents: null,
  detail: 'Couldn’t check what they paid just now — the refund is worked out again when you offer',
} as const

/** lib/scholarship-refund ScholarshipRefundQuote, as the quote route returns it. */
interface RefundQuote {
  status: 'refund' | 'nothing_due' | 'already_done' | 'manual' | 'not_paid'
  refundCents: number
  feePaidCents: number | null
  targetCents: number | null
  detail: string
}

export function ScholarshipReview({
  id,
  applicantEmail,
  initialEventSlug,
  events,
  members,
  registrations,
  couponProblems = {},
}: {
  id: string
  applicantEmail: string
  initialEventSlug: string | null
  events: ReviewEvent[]
  members: ReviewMember[]
  registrations: ReviewRegistration[]
  /** Per level, why its Stripe coupon can't be used (absent = fine). */
  couponProblems?: Record<number, string | null>
}) {
  const router = useRouter()
  const exactEmail = members.find((m) => m.email.toLowerCase() === applicantEmail.toLowerCase())
  const [eventSlug, setEventSlug] = useState(initialEventSlug ?? '')
  // An account already on the application email is the only valid choice for
  // a new record (emails are unique), so it is preselected; otherwise the
  // reviewer picks a suggestion or creates the student.
  const [memberChoice, setMemberChoice] = useState<string>(exactEmail?.id ?? (members.length === 0 ? NEW_MEMBER : ''))
  const [percent, setPercent] = useState<number | null>(null)
  const [sendEmails, setSendEmails] = useState(true)
  const [refundMethod, setRefundMethod] = useState<'cash' | 'credit'>('cash')
  const [quote, setQuote] = useState<RefundQuote | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const event = events.find((e) => e.slug === eventSlug) ?? null
  const chosenMember = members.find((m) => m.id === memberChoice) ?? null
  const existing = useMemo(
    () =>
      registrations.find(
        (r) => r.eventSlug === eventSlug && (memberChoice === NEW_MEMBER ? !r.memberId : r.memberId === memberChoice || !r.memberId),
      ) ?? null,
    [registrations, eventSlug, memberChoice],
  )

  // Already registered and paid: ask what the chosen level would reimburse.
  const paidRegistrationId = existing?.status === 'confirmed' && existing.type === 'individual' ? existing.id : null
  useEffect(() => {
    setQuote(null)
    if (!paidRegistrationId || percent == null) return
    let live = true
    fetch(`/api/admin/scholarships/${id}/refund-quote?registrationId=${paidRegistrationId}&percent=${percent}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((q: RefundQuote | null) => { if (live) setQuote(q ?? QUOTE_UNAVAILABLE) })
      .catch(() => { if (live) setQuote(QUOTE_UNAVAILABLE) })
    return () => { live = false }
  }, [id, paidRegistrationId, percent])
  const refunding = quote?.status === 'refund' && quote.refundCents > 0

  const recipients = [...new Set([applicantEmail, chosenMember?.email].filter(Boolean).map((e) => e!.toLowerCase()))]
  const due = event?.feeCents != null && percent != null ? discountedCents(event.feeCents, percent) : null
  const couponProblem = percent != null ? couponProblems[percent] ?? null : null
  const ready = !!eventSlug && !!memberChoice && percent != null && existing?.type !== 'group'

  async function post(path: string, body?: unknown) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/scholarships/${id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? 'Something went wrong.')
        setBusy(false)
        return
      }
      router.refresh()
    } catch {
      setError('Something went wrong.')
      setBusy(false)
    }
  }

  function offer() {
    post('offer', {
      percent,
      eventSlug,
      memberId: memberChoice === NEW_MEMBER ? null : memberChoice,
      sendEmails,
      refundMethod,
    })
  }

  function notOffered() {
    if (!confirm('Close this application without an offer? No email is sent to the applicant.')) return
    post('not-offered')
  }

  return (
    <section className="rounded-ds-card border border-line bg-white p-6 space-y-6">
      <h2 className="font-display text-lg font-bold text-ink">Decision</h2>

      {/* 1 — Event */}
      <div>
        <label htmlFor="sch-event" className="block text-sm font-semibold text-ink mb-1.5">1. Event</label>
        <select
          id="sch-event"
          value={eventSlug}
          onChange={(e) => { setEventSlug(e.target.value); setConfirming(false) }}
          className="w-full rounded-control border border-line bg-white px-3 py-2 text-sm text-ink"
        >
          <option value="">Choose an event…</option>
          {events.map((e) => (
            <option key={e.slug} value={e.slug}>
              {e.title}{e.dateLabel ? ` — ${e.dateLabel}` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* 2 — Student */}
      <fieldset>
        <legend className="block text-sm font-semibold text-ink mb-1.5">2. Student’s member record</legend>
        <div className="space-y-2">
          {members.map((m) => (
            <label key={m.id} className="flex items-start gap-2 rounded-lg border border-line px-3 py-2 text-sm cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
              <input
                type="radio"
                name="sch-member"
                checked={memberChoice === m.id}
                onChange={() => { setMemberChoice(m.id); setConfirming(false) }}
                className="mt-1"
              />
              <span>
                <span className="font-semibold text-ink">{m.name}</span>{' '}
                <span className="text-content-body">· {m.email}{m.membershipId ? ` · #${m.membershipId}` : ''}</span>
                <span className="block text-xs text-content-body">
                  {REASON[m.reason]}{m.profileComplete ? '' : ' · profile incomplete'}
                </span>
              </span>
            </label>
          ))}
          {!exactEmail && (
            <label className="flex items-start gap-2 rounded-lg border border-line px-3 py-2 text-sm cursor-pointer has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
              <input
                type="radio"
                name="sch-member"
                checked={memberChoice === NEW_MEMBER}
                onChange={() => { setMemberChoice(NEW_MEMBER); setConfirming(false) }}
                className="mt-1"
              />
              <span>
                <span className="font-semibold text-ink">Create a new member</span>
                <span className="block text-xs text-content-body">From the application, under {applicantEmail}. They fill in the rest when they register.</span>
              </span>
            </label>
          )}
        </div>
      </fieldset>

      {/* 3 — Level */}
      <fieldset>
        <legend className="block text-sm font-semibold text-ink mb-1.5">3. Scholarship</legend>
        <div className="grid grid-cols-4 gap-2">
          {SCHOLARSHIP_LEVELS.map((l) => (
            <button
              key={l.percent}
              type="button"
              onClick={() => { setPercent(l.percent); setConfirming(false) }}
              aria-pressed={percent === l.percent}
              className={`rounded-lg border px-2 py-3 text-center ${
                percent === l.percent ? 'border-primary bg-primary-soft text-ink' : 'border-line bg-white text-content-body hover:border-primary'
              }`}
            >
              <span className="block font-display text-lg font-bold">{l.percent}%</span>
              <span className="block text-xs">
                {event?.feeCents != null ? (l.percent === 100 ? 'free' : `pays ${formatUsd(discountedCents(event.feeCents, l.percent))}`) : l.code}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      {couponProblem && percent !== 100 && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          Stripe problem with this level: {couponProblem}. The student won’t be able to pay until it’s fixed in Stripe.
        </div>
      )}

      {existing && (
        <div className={`rounded-lg px-4 py-3 text-sm ${existing.type === 'group' ? 'bg-red-50 text-red-800' : 'bg-surface text-ink'}`}>
          {existing.type === 'group'
            ? 'This student is on a group registration for this event, so a scholarship can’t be applied here. Talk to the group organiser.'
            : existing.status === 'confirmed'
              ? 'Already registered and paid for this event. The scholarship is applied to that registration and the difference is reimbursed.'
              : `Already registered for this event (unpaid${existing.amountDueCents != null ? `, ${formatUsd(existing.amountDueCents)} due` : ''}). The scholarship attaches to that registration — their details are already in.`}
        </div>
      )}

      {paidRegistrationId && percent != null && (
        <div className="rounded-lg border border-line px-4 py-3 text-sm text-ink space-y-2">
          <p className="font-semibold">Reimbursement</p>
          {!quote ? (
            <p className="text-content-body">Checking what they paid…</p>
          ) : refunding ? (
            <>
              <p>
                {formatUsd(quote.refundCents)} back to the student
                <span className="text-content-body"> — {quote.detail}.</span>
              </p>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2">
                  <input type="radio" name="sch-refund" checked={refundMethod === 'cash'} onChange={() => setRefundMethod('cash')} />
                  Refund to the card they paid with
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="sch-refund" checked={refundMethod === 'credit'} onChange={() => setRefundMethod('credit')} />
                  Stellr account credit
                </label>
              </div>
            </>
          ) : (
            <p className="text-content-body">{quote.detail}.</p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!confirming ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => setConfirming(true)} disabled={!ready || busy || (!!paidRegistrationId && !quote)}>
            Offer &amp; register…
          </Button>
          <button type="button" onClick={notOffered} disabled={busy} className="text-sm font-medium text-content-body hover:text-ink disabled:opacity-50">
            Not offered
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-primary bg-primary-soft p-4 space-y-3 text-sm text-ink">
          <p className="font-semibold">Confirm the offer</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              {percent}% scholarship for <strong>{event?.title}</strong>
              {percent !== 100 && due != null ? ` — they pay ${formatUsd(due)}${event?.feeCents != null ? ` instead of ${formatUsd(event.feeCents)}` : ''}` : ''}
              {percent === 100 ? ' — nothing to pay' : ''}.
            </li>
            <li>
              {memberChoice === NEW_MEMBER ? `A new member is created for ${applicantEmail}.` : `Linked to ${chosenMember?.name}.`}{' '}
              {existing ? 'Their existing registration is used.' : 'Their place is reserved; they complete their details from email 2, and DocuSign follows.'}
            </li>
            {refunding && (
              <li>
                <strong>{formatUsd(quote!.refundCents)}</strong>{' '}
                {refundMethod === 'cash' ? 'is refunded to their card in Stripe now.' : 'is added to their Stellr account as credit.'}
              </li>
            )}
          </ul>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={sendEmails} onChange={(e) => setSendEmails(e.target.checked)} />
            Email {recipients.join(' and ')} now ({existing?.status === 'confirmed' ? '1 email, plus a consent reminder if unsigned' : percent === 100 ? '2 emails' : '3 emails'})
          </label>
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={offer} disabled={busy}>
              {busy ? 'Offering…' : 'Offer & register'}
            </Button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="text-sm font-medium text-content-body hover:text-ink">
              Back
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/** "Resend offer emails" on an application already offered. */
export function ScholarshipResendButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  async function resend() {
    if (!confirm('Send the offer emails again? They are worded for where the student has got to.')) return
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch(`/api/admin/scholarships/${id}/resend`, { method: 'POST' })
      const data = await res.json().catch(() => null)
      setResult(res.ok ? { ok: true, text: `Sent to ${(data.emailedTo as string[]).join(', ')}` } : { ok: false, text: data?.error ?? 'Failed to send.' })
    } catch {
      setResult({ ok: false, text: 'Failed to send.' })
    }
    setBusy(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-3 pt-2">
      <Button variant="softBlue" className="text-sm !py-2" onClick={resend} disabled={busy}>
        {busy ? 'Sending…' : 'Resend offer emails'}
      </Button>
      {result && <span className={`text-xs ${result.ok ? 'text-enviro-green-text' : 'text-red-600'}`}>{result.text}</span>}
    </div>
  )
}

/** "Retry reimbursement" — shown when an already-paid student's refund needs handling. */
export function ScholarshipRetryRefundButton({ id }: { id: string }) {
  const router = useRouter()
  const [method, setMethod] = useState<'cash' | 'credit'>('cash')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function retry() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/admin/scholarships/${id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) router.refresh()
      else setMessage(data?.result?.detail ?? data?.error ?? 'The reimbursement still didn’t go through.')
    } catch {
      setMessage('The reimbursement still didn’t go through.')
    }
    setBusy(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={method}
        onChange={(e) => setMethod(e.target.value as 'cash' | 'credit')}
        className="rounded-control border border-line bg-white px-2 py-1.5 text-sm text-ink"
        aria-label="Reimburse as"
      >
        <option value="cash">Refund to card</option>
        <option value="credit">Account credit</option>
      </select>
      <Button variant="softBlue" className="text-sm !py-2" onClick={retry} disabled={busy}>
        {busy ? 'Trying…' : 'Retry reimbursement'}
      </Button>
      {message && <span className="text-xs text-red-600">{message}</span>}
    </div>
  )
}
