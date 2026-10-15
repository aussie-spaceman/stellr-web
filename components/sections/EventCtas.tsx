'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Bell, Check } from 'lucide-react'
import { Dialog, fieldControlClass } from '@stellr/web-ui'
import { usePrefillNameEmail } from '@/components/forms/useMemberPrefill'
import { trackLeadSubmitted } from '@/lib/analytics'
import { isEmailLike } from '@/lib/utils'

type RegStatus = 'open' | 'coming-soon' | 'closed'

/** Which registration the visitor reached for before registration was open. */
type Interest = 'individual' | 'group' | 'unspecified'

/* ── Subscriber modal ─────────────────────────────────────────────────────────
 * Name + email capture for event updates, posting to /api/subscribe. Same
 * shared Dialog as the AssetGate / WhitePaperGate lead-capture flows (focus
 * held inside, Esc to close, page behind inert, success state).
 *
 * Only the slug and the intent go over the wire — the route resolves every CRM
 * field from Sanity server-side. */
function EventNotifyModal({
  open,
  onClose,
  eventTitle,
  eventSlug,
  status,
  interest,
}: {
  open: boolean
  onClose: () => void
  eventTitle: string
  eventSlug: string
  status: RegStatus
  interest: Interest
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  // Pre-fill from the signed-in member's record; only fills empty fields.
  usePrefillNameEmail(name, setName, email, setEmail)

  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const doneRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const formId = `${id}-form`

  const valid = name.trim().length > 0 && isEmailLike(email)
  const greeting = name.trim().split(/\s+/)[0] || 'there'

  function close() {
    onClose()
    setSubmitted(false)
    setError(false)
    setLoading(false)
  }

  // The submit button is replaced by Close on success; keep focus in the dialog.
  useEffect(() => {
    if (submitted) doneRef.current?.focus()
  }, [submitted])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid || loading) return
    setLoading(true)
    setError(false)
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          source: 'event-notify',
          eventSlug,
          interest,
        }),
      })
      if (!res.ok) throw new Error('Request failed')
      trackLeadSubmitted('event_notify', {
        competition_id: eventSlug,
        registration_interest: interest,
      })
      setSubmitted(true)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={eventTitle}
      description="Event updates"
      size="md"
      dismissible={!loading}
      footer={
        !submitted ? (
          <>
            {error && (
              <p role="alert" className="w-full text-center text-ds-meta text-danger">
                Something went wrong — please try again.
              </p>
            )}
            <button
              type="submit"
              form={formId}
              disabled={!valid || loading}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-control bg-primary px-6 py-3 font-display text-ds-body font-semibold text-white transition-colors hover:bg-primary-deep disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Signing you up…' : 'Notify me'}
            </button>
          </>
        ) : (
          <button
            ref={doneRef}
            type="button"
            onClick={close}
            className="min-h-11 rounded-control px-4 text-sm font-semibold text-content-muted transition-colors hover:bg-surface hover:text-ink"
          >
            Close
          </button>
        )
      }
    >
      {!submitted ? (
        <form id={formId} onSubmit={submit} className="space-y-4" noValidate>
          <div>
            <h3 className="font-display text-ds-h3 font-bold text-ink">We&rsquo;ll save you a spot in line</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-content-secondary">
              {status === 'closed'
                ? 'Registration has closed for this event. Leave your details and we’ll email you the moment the next one opens.'
                : 'Leave your details and we’ll email you the moment registration opens — no spam, just the heads-up.'}
            </p>
          </div>

          <div>
            <label htmlFor={`${id}-name`} className="mb-1.5 block text-ds-meta font-semibold text-ink">
              Full name
            </label>
            <input
              id={`${id}-name`}
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={fieldControlClass}
            />
          </div>
          <div>
            <label htmlFor={`${id}-email`} className="mb-1.5 block text-ds-meta font-semibold text-ink">
              Email address
            </label>
            <input
              id={`${id}-email`}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={fieldControlClass}
            />
          </div>

          <p className="text-center text-ds-meta text-content-faint">
            We respect your inbox. Just the heads-up and the occasional update.
          </p>
        </form>
      ) : (
        <div className="flex flex-col items-center py-2 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-enviro-green-bg">
            <Check size={30} strokeWidth={2.4} className="text-enviro-green" aria-hidden="true" />
          </div>
          <h3 className="mt-5 font-display text-ds-h3 font-bold text-ink">You&rsquo;re on the list, {greeting}</h3>
          <p className="mt-2 text-sm leading-relaxed text-content-secondary">
            We&rsquo;ll email <span className="font-semibold text-ink">{email}</span> with registration news for{' '}
            {eventTitle}.
          </p>
        </div>
      )}
    </Dialog>
  )
}

/* ── Hero CTAs ────────────────────────────────────────────────────────────────
 * "Compete Now" block in the event hero: Individual + Group registration when
 * registration is open; when it isn't, both buttons open the subscriber modal
 * (and are styled as outline buttons with a status note to signal the state). */
export function EventHeroCtas({
  slug,
  title,
  status,
  opensLabel,
}: {
  slug: string
  title: string
  status: RegStatus
  opensLabel?: string | null
}) {
  // null = closed. Otherwise it records which button opened it, so the CRM
  // captures whether they wanted to enter alone or bring a team.
  const [intent, setIntent] = useState<Interest | null>(null)
  const isOpen = status === 'open'

  return (
    <div className="mt-8 short:mt-3">
      <p className="text-xs font-display font-bold uppercase tracking-[0.13em] text-blue-300">
        Compete Now
      </p>
      <div className="mt-3 flex flex-wrap gap-4">
        {isOpen ? (
          <>
            <a href={`/register/${slug}/individual`} className="btn-primary text-base px-8 py-4 short:py-2.5">
              Individual Registration
            </a>
            <a
              href={`/register/${slug}/group`}
              className="bg-white text-brand-blue font-semibold text-base px-8 py-4 short:py-2.5 rounded-lg hover:bg-blue-50 transition-colors"
            >
              Group Registration
            </a>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setIntent('individual')}
              className="btn-outline-white text-base px-8 py-4 short:py-2.5 inline-flex items-center gap-2"
            >
              <Bell size={16} /> Individual Registration
            </button>
            <button
              type="button"
              onClick={() => setIntent('group')}
              className="btn-outline-white text-base px-8 py-4 short:py-2.5 inline-flex items-center gap-2"
            >
              <Bell size={16} /> Group Registration
            </button>
          </>
        )}
      </div>
      {!isOpen && (
        <p className="mt-3 text-sm text-blue-300">
          {status === 'coming-soon'
            ? `Registration opens ${opensLabel ?? 'soon'} — tap a button and we'll email you the moment it does.`
            : "Registration has closed for this event — tap a button and we'll tell you about the next one."}
        </p>
      )}
      <EventNotifyModal
        open={intent !== null}
        onClose={() => setIntent(null)}
        eventTitle={title}
        eventSlug={slug}
        status={status}
        interest={intent ?? 'unspecified'}
      />
    </div>
  )
}

/* ── Side-panel "Get Notified" button ────────────────────────────────────────
 * Replaces the old link that (incorrectly) sent visitors to /register — now it
 * opens the same subscriber modal as the hero buttons. */
export function EventNotifyButton({
  slug,
  title,
  status,
}: {
  slug: string
  title: string
  status: RegStatus
}) {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="btn-primary w-full justify-center text-sm"
      >
        Get Notified
      </button>
      <EventNotifyModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        eventTitle={title}
        eventSlug={slug}
        status={status}
        interest="unspecified"
      />
    </>
  )
}
