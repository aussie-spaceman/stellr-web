'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell, Check, X } from 'lucide-react'

type RegStatus = 'open' | 'coming-soon' | 'closed'

/* ── Subscriber modal ─────────────────────────────────────────────────────────
 * Name + email capture for event updates, posting to /api/subscribe. Same
 * modal pattern as the AssetGate / WhitePaperGate lead-capture flows (focus
 * trap, Esc to close, body-scroll lock, success state). */
function EventNotifyModal({
  open,
  onClose,
  eventTitle,
  eventSlug,
  status,
}: {
  open: boolean
  onClose: () => void
  eventTitle: string
  eventSlug: string
  status: RegStatus
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  const valid = name.trim().length > 0 && /\S+@\S+\.\S+/.test(email)
  const greeting = name.trim().split(/\s+/)[0] || 'there'

  function close() {
    onClose()
    setSubmitted(false)
    setError(false)
    setLoading(false)
  }

  // A11y: Esc closes, Tab is trapped inside the dialog, body scroll locks,
  // and the first field is focused on open.
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.querySelector<HTMLElement>('input, button, a[href]')?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
        return
      }
      if (e.key !== 'Tab') return
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled])',
      )
      if (!focusables || focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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
          event: eventSlug,
        }),
      })
      if (!res.ok) throw new Error('Request failed')
      setSubmitted(true)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[rgba(8,12,28,.62)]"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Get notified about ${eventTitle}`}
        className="w-full max-w-[460px] bg-white rounded-panel overflow-hidden shadow-[0_40px_90px_-28px_rgba(8,12,28,.72)]"
      >
        {/* Header band */}
        <div className="relative bg-[linear-gradient(135deg,#20264F,#0E1330)] px-7 py-6 flex items-center gap-4">
          <div className="w-12 h-12 shrink-0 rounded-full bg-white/10 border border-white/10 flex items-center justify-center">
            <Bell size={22} className="text-star-gold" />
          </div>
          <div>
            <p className="text-[10.5px] font-display font-bold uppercase tracking-[0.13em] text-star-gold">
              Event updates
            </p>
            <p className="mt-1 font-display text-[15px] font-bold text-white leading-tight">
              {eventTitle}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="px-7 py-6">
          {!submitted ? (
            <form onSubmit={submit} className="space-y-4" noValidate>
              <div>
                <h3 className="font-display text-[21px] font-bold text-ink">
                  We&rsquo;ll save you a spot in line
                </h3>
                <p className="mt-1.5 text-sm text-content-secondary leading-relaxed">
                  {status === 'closed'
                    ? 'Registration has closed for this event. Leave your details and we’ll email you the moment the next one opens.'
                    : 'Leave your details and we’ll email you the moment registration opens — no spam, just the heads-up.'}
                </p>
              </div>

              <div>
                <label htmlFor="en-name" className="block text-[13px] font-semibold text-ink mb-1.5">
                  Full name
                </label>
                <input
                  id="en-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-3 rounded-[9px] border border-[#D7DCEC] text-[15px] text-ink focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/[0.16]"
                />
              </div>
              <div>
                <label htmlFor="en-email" className="block text-[13px] font-semibold text-ink mb-1.5">
                  Email address
                </label>
                <input
                  id="en-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-3 rounded-[9px] border border-[#D7DCEC] text-[15px] text-ink focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/[0.16]"
                />
              </div>

              <button
                type="submit"
                disabled={!valid || loading}
                className={`w-full inline-flex items-center justify-center rounded-[9px] px-6 py-3.5 font-display text-[15px] font-semibold text-white transition-colors ${
                  valid && !loading ? 'bg-primary hover:bg-primary-deep' : 'bg-[#A9BEF5] cursor-not-allowed'
                }`}
              >
                {loading ? 'Signing you up…' : 'Notify me'}
              </button>
              {error && (
                <p className="text-center text-[13px] text-[#9A4A41]">
                  Something went wrong — please try again.
                </p>
              )}
              <p className="text-center text-[12.5px] text-content-faint">
                We respect your inbox. Just the heads-up and the occasional update.
              </p>
            </form>
          ) : (
            <div className="flex flex-col items-center text-center py-2">
              <div className="w-16 h-16 rounded-full bg-enviro-green-bg flex items-center justify-center">
                <Check size={30} strokeWidth={2.4} className="text-enviro-green" />
              </div>
              <h3 className="font-display text-[21px] font-bold text-ink mt-5">
                You&rsquo;re on the list, {greeting}
              </h3>
              <p className="mt-2 text-sm text-content-secondary leading-relaxed">
                We&rsquo;ll email <span className="font-semibold text-ink">{email}</span> with
                registration news for {eventTitle}.
              </p>
              <button
                type="button"
                onClick={close}
                className="mt-5 text-sm font-semibold text-content-muted hover:text-ink transition-colors"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
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
  const [modalOpen, setModalOpen] = useState(false)
  const isOpen = status === 'open'

  return (
    <div className="mt-8">
      <p className="text-xs font-display font-bold uppercase tracking-[0.13em] text-blue-300">
        Compete Now
      </p>
      <div className="mt-3 flex flex-wrap gap-4">
        {isOpen ? (
          <>
            <a href={`/register/${slug}/individual`} className="btn-primary text-base px-8 py-4">
              Individual Registration
            </a>
            <a
              href={`/register/${slug}/group`}
              className="bg-white text-brand-blue font-semibold text-base px-8 py-4 rounded-lg hover:bg-blue-50 transition-colors"
            >
              Group Registration
            </a>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="btn-outline-white text-base px-8 py-4 inline-flex items-center gap-2"
            >
              <Bell size={16} /> Individual Registration
            </button>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="btn-outline-white text-base px-8 py-4 inline-flex items-center gap-2"
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
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        eventTitle={title}
        eventSlug={slug}
        status={status}
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
      />
    </>
  )
}
