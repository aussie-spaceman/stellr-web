'use client'

import { useState } from 'react'
import { Button, Field, Input } from '@stellr/web-ui'

// The pay button for a student in a group that shares the teacher's cost. A
// discount code is typed here, not on Stripe's page: Stripe would apply it to the
// teacher's share too, and the share never takes a code (lib/teacher-share.ts).
export default function SharedSeatPay({ token, totalLabel }: { token: string; totalLabel: string }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function pay() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/register/pay-seat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, code: code.trim() || undefined }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.waived) {
        setDone(body.message ?? 'Nothing to pay: your place is confirmed.')
        setBusy(false)
        return
      }
      if (!res.ok || !body.url) throw new Error(body.error ?? 'Payment could not be started. Please try again.')
      window.location.href = body.url
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment could not be started. Please try again.')
      setBusy(false)
    }
  }

  if (done) return <p role="status" className="font-medium text-enviro-green-text">{done}</p>

  return (
    <div className="space-y-4 text-left">
      <Field label="Discount code (optional)" hint="Applies to your place only, not the teacher’s share.">
        <Input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" maxLength={64} disabled={busy} />
      </Field>
      <div className="text-center">
        <Button type="button" onClick={pay} disabled={busy} className="w-full sm:w-auto disabled:opacity-60">
          {busy ? 'Opening secure checkout…' : code.trim() ? 'Apply code and pay →' : `Pay ${totalLabel} now →`}
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  )
}
