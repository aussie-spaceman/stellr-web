'use client'

import { useState } from 'react'
import { Button } from '@stellr/web-ui'

// Mints a fresh Stripe Checkout for the registration behind `token` and sends
// the browser there. A session URL is never embedded in the page or the email:
// Stripe sessions expire in 24 hours, the pay link must not.
export default function PayNowButton({ token, amountLabel }: { token: string; amountLabel: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pay() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/register/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.url) throw new Error(body.error ?? 'Payment could not be started. Please try again.')
      window.location.href = body.url
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment could not be started. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <Button type="button" onClick={pay} disabled={busy} className="w-full sm:w-auto disabled:opacity-60">
        {busy ? 'Opening secure checkout…' : `Pay ${amountLabel} now →`}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
