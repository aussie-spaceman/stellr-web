'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { Dialog, fieldControlClass } from '@stellr/web-ui'
import { usePrefillNameEmail } from '@/components/forms/useMemberPrefill'
import { trackLeadSubmitted } from '@/lib/analytics'
import { isEmailLike } from '@/lib/utils'

type AssetGateProps = {
  /** Asset key registered in /api/asset-request. */
  asset: string
  /** Title of the gated asset (shown in the modal + success state). */
  title: string
  /** Trigger button label. */
  triggerLabel: string
  /** Small line shown under the title in the modal header. */
  eyebrow?: string
  /** Helper line shown under the trigger button. */
  helper?: string
  /** Optional className override for the trigger button. */
  triggerClassName?: string
  /** README §8 — one-field gate: makes the name field optional (email only). */
  emailOnly?: boolean
}

/**
 * Generic lead-capture gate: a trigger button that opens a name/email modal and
 * posts to /api/asset-request (HubSpot subscriber + an emailed, signed link).
 * The full file never reaches the page — no URL, prop or direct-download
 * fallback — so the email is the only way to it. Reused for every gated download.
 *
 * Accessibility (README §9) comes from the shared Dialog: focus moves in and
 * back to the trigger, Tab stays inside, Esc closes, the page behind is inert.
 */
export function AssetGate({
  asset,
  title,
  triggerLabel,
  eyebrow = 'Free resource',
  helper,
  triggerClassName,
  emailOnly = false,
}: AssetGateProps) {
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

  const emailValid = isEmailLike(email)
  const valid = emailValid && (emailOnly || name.trim().length > 0)
  const greeting = name.trim().split(/\s+/)[0] || 'there'

  function close() {
    setOpen(false)
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
      const res = await fetch('/api/asset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), asset }),
      })
      if (!res.ok) throw new Error('Request failed')
      // No "already subscribed" shortcut: a gated file only ever goes out by
      // email, so every request comes through here.
      trackLeadSubmitted('asset_request', { asset })
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
        className={
          triggerClassName ??
          'inline-flex items-center justify-center gap-2 rounded-[9px] bg-primary px-6 py-3.5 font-display text-[15px] font-semibold text-white hover:bg-primary-deep transition-colors'
        }
      >
        {triggerLabel}
      </button>
      {helper && <p className="mt-2.5 text-[13px] text-content-faint">{helper}</p>}

      <Dialog
        open={open}
        onClose={close}
        title={title}
        description={eyebrow}
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
                {loading ? 'Sending…' : 'Email it to me ↓'}
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
                Add your details and we&rsquo;ll email you the file. You&rsquo;ll get the occasional
                update from our community — unsubscribe anytime.
              </p>
            </div>

            <div>
              <label htmlFor={`${id}-name`} className="mb-1.5 block text-ds-meta font-semibold text-ink">
                {emailOnly ? 'Full name (optional)' : 'Full name'}
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
              We respect your inbox. No spam — just the file and the occasional update.
            </p>
          </form>
        ) : (
          <div className="flex flex-col items-center py-2 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-enviro-green-bg">
              <Check size={30} strokeWidth={2.4} className="text-enviro-green" aria-hidden="true" />
            </div>
            <h3 className="mt-5 font-display text-ds-h3 font-bold text-ink">Check your inbox, {greeting}</h3>
            <p className="mt-2 text-sm leading-relaxed text-content-secondary">
              We&rsquo;ve sent {title} to <span className="font-semibold text-ink">{email}</span>. It should arrive
              in a minute or two.
            </p>
          </div>
        )}
      </Dialog>
    </>
  )
}
