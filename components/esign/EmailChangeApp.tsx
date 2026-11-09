'use client'

import { useEffect, useRef, useState } from 'react'
import { Button, Field, Input } from '@stellr/web-ui'

// The one-time link in a bounce notice (lib/esign/email-changes.ts). A parent
// corrects the student's bounced address; a student suggests their parent's,
// which waits for an adult. The key is read from the URL fragment and held in
// memory only, as on the signing page.

interface View {
  kind: 'direct' | 'suggestion'
  aboutFirstName: string
  eventTitle: string
  roleLabel: string
  maskedOldEmail: string
  expiresAt: string
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'ready'; view: View }
  | { kind: 'done'; outcome: 'applied' | 'pending'; view: View }

async function post(body: Record<string, unknown>) {
  const res = await fetch('/api/sign/email', {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> }
}

export function EmailChangeApp() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const tokenRef = useRef<string | null>(null)

  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (hash) {
      tokenRef.current = decodeURIComponent(hash)
      // The key leaves the address bar and the history entry straight away.
      window.history.replaceState(null, '', window.location.pathname)
    }
    if (!tokenRef.current) {
      setPhase({ kind: 'invalid' })
      return
    }
    void post({ token: tokenRef.current }).then(({ data }) => {
      if (data.state === 'ready' && data.view) setPhase({ kind: 'ready', view: data.view as View })
      else setPhase({ kind: 'invalid' })
    })
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (phase.kind !== 'ready') return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.')
      return
    }
    setSaving(true)
    setError(null)
    const { status, data } = await post({ token: tokenRef.current, email: email.trim() })
    setSaving(false)
    if (data.ok) {
      setPhase({ kind: 'done', outcome: data.outcome === 'applied' ? 'applied' : 'pending', view: phase.view })
      return
    }
    if (data.state === 'invalid' || status === 404) {
      setPhase({ kind: 'invalid' })
      return
    }
    setError(typeof data.error === 'string' ? data.error : 'That didn’t work. Try again shortly.')
  }

  return (
    <main className="min-h-screen bg-surface px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-xl" aria-live="polite">
        {phase.kind === 'loading' && <p className="text-content-muted">Opening…</p>}

        {phase.kind === 'invalid' && (
          <section className="rounded-ds-card border border-line bg-white p-6 sm:p-8">
            <h1 className="font-display text-2xl font-bold text-ink">This link no longer works</h1>
            <p className="mt-3 text-content-body">
              It may have been used already, expired, or the address may have been fixed another way. If the form still
              needs a new address, contact the teacher who registered the group or{' '}
              <a className="text-primary-deep underline" href="mailto:hello@stellreducation.org">hello@stellreducation.org</a>.
            </p>
          </section>
        )}

        {phase.kind === 'ready' && (
          <section className="rounded-ds-card border border-line bg-white p-6 sm:p-8">
            <p className="font-subheading text-xs font-semibold uppercase tracking-[0.14em] text-primary-deep">{phase.view.eventTitle}</p>
            <h1 className="mt-1 font-display text-2xl font-bold text-ink">
              {phase.view.kind === 'direct'
                ? `Update ${phase.view.aboutFirstName}’s email`
                : 'Suggest your parent or guardian’s email'}
            </h1>
            <p className="mt-3 text-content-body">
              {phase.view.kind === 'direct'
                ? `The form we sent to ${phase.view.maskedOldEmail} bounced. Enter ${phase.view.aboutFirstName}’s own address and we’ll send their part of the form to it straight away. Your signature is kept.`
                : `The form we sent to ${phase.view.maskedOldEmail} bounced. Enter the address your parent or guardian uses. An adult checks it before the form is sent again.`}
            </p>
            <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
              <Field label={phase.view.kind === 'direct' ? `${phase.view.aboutFirstName}’s email` : 'Parent or guardian’s email'} error={error ?? undefined}>
                <Input
                  type="email"
                  autoComplete="off"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={error ? true : undefined}
                  required
                />
              </Field>
              <Button type="submit" variant="primaryStrong" disabled={saving}>
                {saving ? 'Saving…' : phase.view.kind === 'direct' ? 'Send the form to this address' : 'Suggest this address'}
              </Button>
              <p className="text-sm text-content-muted">
                This link works once and expires on{' '}
                {new Date(phase.view.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.
              </p>
            </form>
          </section>
        )}

        {phase.kind === 'done' && (
          <section className="rounded-ds-card border border-line bg-white p-6 sm:p-8">
            <h1 className="font-display text-2xl font-bold text-ink">{phase.outcome === 'applied' ? 'Sent' : 'Thanks, we’ve got it'}</h1>
            <p className="mt-3 text-content-body">
              {phase.outcome === 'applied'
                ? `${phase.view.aboutFirstName}’s part of the form is on its way to the new address.`
                : 'An adult will check the address. Once they approve it, the form goes to your parent or guardian.'}
            </p>
          </section>
        )}
      </div>
    </main>
  )
}
