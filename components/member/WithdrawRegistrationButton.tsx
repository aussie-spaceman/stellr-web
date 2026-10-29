'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Dialog, Field, Textarea } from '@stellr/web-ui'

// "Withdraw" on an individual registration in My Event Registrations. Shows
// what withdrawing refunds (the 45-day money-back guarantee) before anything
// happens; the account stays either way. Server:
// /api/members/registrations/[id]/withdraw.

export function WithdrawRegistrationButton({ registrationId, eventTitle }: { registrationId: string; eventTitle: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [refundLine, setRefundLine] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function openDialog() {
    setOpen(true)
    setRefundLine(null)
    setError(null)
    setDone(null)
    setReason('')
    const res = await fetch(`/api/members/registrations/${registrationId}/withdraw`)
    const data = await res.json().catch(() => null)
    if (!res.ok) setError(data?.error ?? 'Could not check this registration.')
    else setRefundLine(data.refund as string)
  }

  async function withdraw() {
    // A double-click must not withdraw (or refund) twice.
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/members/registrations/${registrationId}/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) {
      setError(data?.error ?? 'Something went wrong. Please try again.')
      return
    }
    setDone(data.message as string)
  }

  function close() {
    setOpen(false)
    if (done) router.refresh()
  }

  const footer = done ? (
    <Button variant="secondary" className="!px-4 !py-2" onClick={close}>Close</Button>
  ) : (
    <>
      <Button variant="secondary" className="!px-4 !py-2" onClick={close} disabled={busy}>Keep my place</Button>
      <button
        type="button"
        onClick={withdraw}
        disabled={busy || refundLine === null}
        className="rounded-control bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Withdrawing…' : 'Withdraw'}
      </button>
    </>
  )

  return (
    <>
      <button type="button" onClick={openDialog} className="text-xs font-medium text-content-muted hover:text-danger">
        Withdraw
      </button>
      <Dialog open={open} onClose={close} title={<>Withdraw from {eventTitle}?</>} role="alertdialog" size="md" dismissible={!busy} footer={footer} bodyClassName="space-y-4">
        {done ? (
          <p role="status" className="text-sm text-ink">{done}</p>
        ) : (
          <>
            <p className="text-sm text-content-secondary">
              Your place will be cancelled and any agreements still waiting to be signed will be withdrawn. Your Stellr
              account stays, so we can let you know about future events.
            </p>
            <p className="text-sm font-medium text-ink">{refundLine ?? 'Checking your payment…'}</p>
            <Field label="Anything you’d like us to know? (optional)">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
            </Field>
          </>
        )}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </Dialog>
    </>
  )
}
