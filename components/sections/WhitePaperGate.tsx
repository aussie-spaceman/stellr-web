'use client'

import { useState } from 'react'
import { Check, X } from 'lucide-react'

const PDF_URL = '/files/Stellr-STEM-Power-Skills-White-Paper.pdf'
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
  const [submitted, setSubmitted] = useState(false)

  const valid = name.trim().length > 0 && /\S+@\S+\.\S+/.test(email)
  const greeting = name.trim().split(/\s+/)[0] || 'there'

  function close() {
    setOpen(false)
    setSubmitted(false)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    setSubmitted(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
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
          <div className="w-full max-w-[460px] bg-white rounded-panel overflow-hidden shadow-[0_40px_90px_-28px_rgba(8,12,28,.72)]">
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
                    disabled={!valid}
                    className={`w-full inline-flex items-center justify-center rounded-[9px] px-6 py-3.5 font-display text-[15px] font-semibold text-white transition-colors ${
                      valid ? 'bg-primary hover:bg-primary-deep' : 'bg-[#A9BEF5] cursor-not-allowed'
                    }`}
                  >
                    Email me the white paper ↓
                  </button>
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
                  <a
                    href={PDF_URL}
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
