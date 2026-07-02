'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, FileText, X } from 'lucide-react'

type AssetGateProps = {
  /** Asset key registered in /api/asset-request. */
  asset: string
  /** Title of the gated asset (shown in the modal + success state). */
  title: string
  /** Public path to the file, used for the direct-download fallback. */
  fileUrl: string
  /** Trigger button label. */
  triggerLabel: string
  /** Small uppercase badge shown in the modal header. */
  eyebrow?: string
  /** Helper line shown under the trigger button. */
  helper?: string
  /** Optional className override for the trigger button. */
  triggerClassName?: string
  /** README §8 — one-field gate: makes the name field optional (email only). */
  emailOnly?: boolean
}

/**
 * Generic lead-capture gate: a trigger button that opens a name/email modal,
 * posts to /api/asset-request (HubSpot subscriber + emailed link), then offers
 * an immediate download. Reused for any gated marketing download.
 *
 * Accessibility (README §9): the modal traps focus, closes on Esc, restores
 * focus to the trigger on close, and locks body scroll while open.
 */
export function AssetGate({
  asset,
  title,
  fileUrl,
  triggerLabel,
  eyebrow = 'Free resource',
  helper,
  triggerClassName,
  emailOnly = false,
}: AssetGateProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const lastFocused = useRef<HTMLElement | null>(null)

  const emailValid = /\S+@\S+\.\S+/.test(email)
  const valid = emailValid && (emailOnly || name.trim().length > 0)
  const greeting = name.trim().split(/\s+/)[0] || 'there'

  function openModal() {
    lastFocused.current = document.activeElement as HTMLElement
    setOpen(true)
  }

  function close() {
    setOpen(false)
    setSubmitted(false)
    setError(false)
    setLoading(false)
    lastFocused.current?.focus()
  }

  // A11y: Esc closes, Tab is trapped inside the dialog, body scroll locks,
  // and the first field is focused on open (README §9).
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
      const res = await fetch('/api/asset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), asset }),
      })
      if (!res.ok) throw new Error('Request failed')
      // Persist the subscriber flag so other gated downloads skip the modal
      // (README §8). Best-effort — never block the success path on storage.
      try {
        localStorage.setItem('stellr_subscriber', email.trim())
      } catch {
        /* storage unavailable (private mode) — gate just asks again next time */
      }
      setSubmitted(true)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={
          triggerClassName ??
          'inline-flex items-center justify-center gap-2 rounded-[9px] bg-primary px-6 py-3.5 font-display text-[15px] font-semibold text-white hover:bg-primary-deep transition-colors'
        }
      >
        {triggerLabel}
      </button>
      {helper && <p className="mt-2.5 text-[13px] text-content-faint">{helper}</p>}

      {open && (
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
            aria-label={title}
            className="w-full max-w-[460px] bg-white rounded-panel overflow-hidden shadow-[0_40px_90px_-28px_rgba(8,12,28,.72)]"
          >
            {/* Header band */}
            <div className="relative bg-[linear-gradient(135deg,#20264F,#0E1330)] px-7 py-6 flex items-center gap-4">
              <div className="w-14 h-[72px] shrink-0 rounded-md bg-[linear-gradient(160deg,#20264F,#0E1330)] border border-white/10 flex items-center justify-center">
                <FileText size={26} className="text-star-gold" />
              </div>
              <div>
                <p className="text-[10.5px] font-display font-bold uppercase tracking-[0.13em] text-star-gold">
                  {eyebrow}
                </p>
                <p className="mt-1 font-display text-[15px] font-bold text-white leading-tight">{title}</p>
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
                    <h3 className="font-display text-[21px] font-bold text-ink">Where should we send it?</h3>
                    <p className="mt-1.5 text-sm text-content-secondary leading-relaxed">
                      Add your details and we&rsquo;ll email you the file. You&rsquo;ll get the occasional
                      update from our community — unsubscribe anytime.
                    </p>
                  </div>

                  <div>
                    <label htmlFor="ag-name" className="block text-[13px] font-semibold text-ink mb-1.5">
                      {emailOnly ? 'Full name (optional)' : 'Full name'}
                    </label>
                    <input
                      id="ag-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-3.5 py-3 rounded-[9px] border border-[#D7DCEC] text-[15px] text-ink focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/[0.16]"
                    />
                  </div>
                  <div>
                    <label htmlFor="ag-email" className="block text-[13px] font-semibold text-ink mb-1.5">
                      Email address
                    </label>
                    <input
                      id="ag-email"
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
                    {loading ? 'Sending…' : 'Email it to me ↓'}
                  </button>
                  {error && (
                    <p className="text-center text-[13px] text-[#9A4A41]">
                      Something went wrong sending it. Please try again, or{' '}
                      <a href={fileUrl} download className="font-semibold underline">
                        download it directly
                      </a>
                      .
                    </p>
                  )}
                  <p className="text-center text-[12.5px] text-content-faint">
                    We respect your inbox. No spam — just the file and the occasional update.
                  </p>
                </form>
              ) : (
                <div className="flex flex-col items-center text-center py-2">
                  <div className="w-16 h-16 rounded-full bg-enviro-green-bg flex items-center justify-center">
                    <Check size={30} strokeWidth={2.4} className="text-enviro-green" />
                  </div>
                  <h3 className="font-display text-[21px] font-bold text-ink mt-5">
                    Check your inbox, {greeting}
                  </h3>
                  <p className="mt-2 text-sm text-content-secondary leading-relaxed">
                    We&rsquo;ve sent {title} to{' '}
                    <span className="font-semibold text-ink">{email}</span>. It should arrive in a minute or
                    two.
                  </p>
                  <a
                    href={fileUrl}
                    download
                    className="mt-5 w-full inline-flex items-center justify-center rounded-[9px] bg-primary px-6 py-3.5 font-display text-[15px] font-semibold text-white hover:bg-primary-deep transition-colors"
                  >
                    Download it now ↓
                  </a>
                  <button
                    type="button"
                    onClick={close}
                    className="mt-3 text-sm font-semibold text-content-muted hover:text-ink transition-colors"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
