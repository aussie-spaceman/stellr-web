'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { usePrefillNameEmail } from '@/components/forms/useMemberPrefill'
import { trackLeadSubmitted } from '@/lib/analytics'
import { isEmailLike } from '@/lib/utils'

// The full paper is gated: it goes out only by email, as an expiring link from
// /api/white-paper, so this component holds no file URL at all.
const PAPER_TITLE = 'From “Soft Skills” to STEM Power Skills'

/* Mock PDF cover thumbnail (navy gradient) shared by the card + modal header. */
function CoverThumb({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-md bg-[linear-gradient(160deg,#20264F,#0E1330)] border border-white/10 flex flex-col justify-end p-2 ${className}`}
    >
      <span className="block w-6 h-[3px] rounded-full bg-star-gold mb-1" />
      <span className="text-[7px] font-display font-bold uppercase tracking-[0.1em] text-white leading-tight">
        Power Skills
      </span>
    </div>
  )
}

export function WhitePaperGate() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  // Pre-fill from the signed-in member's record; only fills empty fields.
  usePrefillNameEmail(name, setName, email, setEmail)
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const lastFocused = useRef<HTMLElement | null>(null)

  const valid = name.trim().length > 0 && isEmailLike(email)
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

  // deep review PUB-10: give the modal real dialog behaviour (matching AssetGate,
  // README §9). Esc closes, Tab is trapped inside the dialog, body scroll locks,
  // the first field is focused on open, and focus is restored to the trigger on
  // close — otherwise a screen-reader/keyboard user can tab into the page behind.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on open/close only; the handler reads the dialog through refs
  }, [open])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid || loading) return
    setLoading(true)
    setError(false)
    try {
      const res = await fetch('/api/white-paper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      })
      if (!res.ok) throw new Error('Request failed')
      trackLeadSubmitted('white_paper')
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
        className="inline-flex items-center justify-center gap-2 rounded-[9px] bg-primary px-6 py-3.5 font-display text-[15px] font-semibold text-white hover:bg-primary-deep transition-colors"
      >
        Get the white paper ↓
      </button>
      <p className="mt-2.5 text-[13px] text-content-faint">Free · 6-page PDF, sent to your inbox.</p>

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
            aria-label={PAPER_TITLE}
            className="w-full max-w-[460px] bg-white rounded-panel overflow-hidden shadow-[0_40px_90px_-28px_rgba(8,12,28,.72)]"
          >
            {/* Header band */}
            <div className="relative bg-[linear-gradient(135deg,#20264F,#0E1330)] px-7 py-6 flex items-center gap-4">
              <CoverThumb className="w-14 h-[72px] shrink-0" />
              <div>
                <p className="text-[10.5px] font-display font-bold uppercase tracking-[0.13em] text-star-gold">
                  White paper · free
                </p>
                <p className="mt-1 font-display text-[15px] font-bold text-white leading-tight">
                  {PAPER_TITLE}
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
                    <h3 className="font-display text-[21px] font-bold text-ink">Where should we send it?</h3>
                    <p className="mt-1.5 text-sm text-content-secondary leading-relaxed">
                      Add your details and we&rsquo;ll email you the PDF. You&rsquo;ll get the occasional
                      update from our community — unsubscribe anytime.
                    </p>
                  </div>

                  <div>
                    <label htmlFor="wp-name" className="block text-[13px] font-semibold text-ink mb-1.5">
                      Full name
                    </label>
                    <input
                      id="wp-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-3.5 py-3 rounded-[9px] border border-[#D7DCEC] text-[15px] text-ink focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/[0.16]"
                    />
                  </div>
                  <div>
                    <label htmlFor="wp-email" className="block text-[13px] font-semibold text-ink mb-1.5">
                      Email address
                    </label>
                    <input
                      id="wp-email"
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
                    {loading ? 'Sending…' : 'Email me the white paper ↓'}
                  </button>
                  {error && (
                    <p className="text-center text-[13px] text-[#9A4A41]">
                      Something went wrong sending it. Please try again in a moment.
                    </p>
                  )}
                  <p className="text-center text-[12.5px] text-content-faint">
                    We respect your inbox. No spam — just the paper and the occasional update.
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
                    We&rsquo;ve sent {PAPER_TITLE} to{' '}
                    <span className="font-semibold text-ink">{email}</span>. It should arrive in a minute or
                    two.
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
      )}
    </>
  )
}
