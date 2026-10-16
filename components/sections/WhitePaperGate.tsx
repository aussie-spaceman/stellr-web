'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { Dialog, fieldControlClass } from '@stellr/web-ui'
import { usePrefillNameEmail } from '@/components/forms/useMemberPrefill'
import { trackLeadSubmitted } from '@/lib/analytics'
import { isEmailLike } from '@/lib/utils'

// The full paper is gated: it goes out only by email, as a signed link from
// /api/white-paper, so this component holds no file URL at all.
const PAPER_TITLE = 'From “Soft Skills” to STEM Power Skills'

export function WhitePaperGate() {
  const [open, setOpen] = useState(false)
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
    setOpen(false)
    setSubmitted(false)
    setError(false)
    setLoading(false)
  }

  // deep review PUB-10: real dialog behaviour (matching AssetGate, README §9)
  // comes from the shared Dialog — Esc closes, Tab stays inside, the page behind
  // is inert, the first field takes focus and the trigger gets it back on close.
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
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-2 rounded-[9px] bg-primary px-6 py-3.5 font-display text-[15px] font-semibold text-white hover:bg-primary-deep transition-colors"
      >
        Get the white paper ↓
      </button>
      <p className="mt-2.5 text-[13px] text-content-faint">Free · 6-page PDF, sent to your inbox.</p>

      <Dialog
        open={open}
        onClose={close}
        title={PAPER_TITLE}
        description="White paper · free"
        size="md"
        dismissible={!loading}
        footer={
          !submitted ? (
            <>
              {error && (
                <p role="alert" className="w-full text-center text-ds-meta text-danger">
                  Something went wrong sending it. Please try again in a moment.
                </p>
              )}
              <button
                type="submit"
                form={formId}
                disabled={!valid || loading}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-control bg-primary px-6 py-3 font-display text-ds-body font-semibold text-white transition-colors hover:bg-primary-deep disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Sending…' : 'Email me the white paper ↓'}
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
              <h3 className="font-display text-ds-h3 font-bold text-ink">Where should we send it?</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-content-secondary">
                Add your details and we&rsquo;ll email you the PDF. You&rsquo;ll get the occasional
                update from our community — unsubscribe anytime.
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
              We respect your inbox. No spam — just the paper and the occasional update.
            </p>
          </form>
        ) : (
          <div className="flex flex-col items-center py-2 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-enviro-green-bg">
              <Check size={30} strokeWidth={2.4} className="text-enviro-green-text" aria-hidden="true" />
            </div>
            <h3 className="mt-5 font-display text-ds-h3 font-bold text-ink">Check your inbox, {greeting}</h3>
            <p className="mt-2 text-sm leading-relaxed text-content-secondary">
              We&rsquo;ve sent {PAPER_TITLE} to <span className="font-semibold text-ink">{email}</span>. It should
              arrive in a minute or two.
            </p>
          </div>
        )}
      </Dialog>
    </>
  )
}
