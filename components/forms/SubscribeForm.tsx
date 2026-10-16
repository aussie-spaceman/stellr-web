'use client'

import { useState } from 'react'
import { usePrefillFields } from '@/components/forms/useMemberPrefill'
import { trackLeadSubmitted } from '@/lib/analytics'

export function SubscribeForm() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [email, setEmail] = useState('')

  // Pre-fill from the signed-in member's record; only fills an empty field.
  usePrefillFields({ email: [email, setEmail] })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (res.ok) trackLeadSubmitted('newsletter')
      setStatus(res.ok ? 'success' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <p className="text-center text-green-400 font-semibold">
        ✓ You&apos;re subscribed! We&apos;ll be in touch.
      </p>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
      <input
        type="email"
        required
        // deep review PUB-10 (WCAG 1.3.1 / 4.1.2): a placeholder is not a label.
        // This footer field is site-wide, so it needs a programmatic name for
        // screen readers and voice control.
        aria-label="Email address"
        placeholder="your@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="flex-1 px-4 py-3 rounded-lg border border-line-strong text-input mouse:text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
        disabled={status === 'loading'}
      />
      <button
        type="submit"
        disabled={status === 'loading'}
        className="btn-primary whitespace-nowrap disabled:opacity-60"
      >
        {status === 'loading' ? 'Subscribing…' : 'Subscribe'}
      </button>
      {status === 'error' && (
        // role="alert" so the failure is announced when it appears (PUB-10).
        <p role="alert" className="text-red-400 text-sm mt-1 sm:mt-0 sm:self-center">
          Something went wrong — please try again.
        </p>
      )}
    </form>
  )
}
