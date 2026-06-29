'use client'

import * as React from 'react'
import { tierButtonColor, type TierId } from '@stellr/web-ui'

interface Props {
  tierSlug: TierId
  tierName: string
  priceLabel: string
  priceNote: string
  invoiceEligible: boolean
}

// The payment step of the join flow. The member is signed in and onboarded by the
// time they reach here. Card → Stripe Checkout (auto-renewing subscription).
// Invoice → emailed Stripe invoice (one-time 12 months, granted on payment).
export function JoinCheckout({ tierSlug, tierName, priceLabel, priceNote, invoiceEligible }: Props) {
  const [loading, setLoading] = React.useState<null | 'card' | 'invoice'>(null)
  const [error, setError] = React.useState('')
  const [invoiceSentTo, setInvoiceSentTo] = React.useState<string | null>(null)
  const color = tierButtonColor(tierSlug)

  async function payByCard() {
    setLoading('card')
    setError('')
    try {
      const res = await fetch('/api/stripe/membership-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tierName, billingInterval: 'annual' }),
      })
      const data = await res.json()
      if (res.ok && data.url) {
        window.location.href = data.url as string
        return
      }
      setError(data.error ?? 'Could not start checkout.')
    } catch {
      setError('Network error. Please try again.')
    }
    setLoading(null)
  }

  async function payByInvoice() {
    setLoading('invoice')
    setError('')
    try {
      const res = await fetch('/api/stripe/membership-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tierName }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setInvoiceSentTo(data.email ?? '')
      } else {
        setError(data.error ?? 'Could not create the invoice.')
      }
    } catch {
      setError('Network error. Please try again.')
    }
    setLoading(null)
  }

  if (invoiceSentTo !== null) {
    return (
      <div className="bg-white border border-line rounded-panel p-8 text-center">
        <div className="mx-auto mb-4 w-12 h-12 rounded-full flex items-center justify-center text-white" style={{ background: color }}>✓</div>
        <h1 className="font-display font-semibold text-[24px] text-ink mb-2">Your invoice is on its way</h1>
        <p className="text-[15px] leading-[1.6] text-content-body">
          We&rsquo;ve emailed a Stellr <b>{tierName}</b> invoice{invoiceSentTo ? <> to <b>{invoiceSentTo}</b></> : null}. It&rsquo;s
          payable online and due within 14 days. Your {tierName} membership activates as soon as the invoice is paid.
        </p>
        <a href="/home" className="inline-block mt-6 text-[14px] font-semibold" style={{ color }}>Go to my dashboard →</a>
      </div>
    )
  }

  return (
    <div className="bg-white border border-line rounded-panel p-8">
      <p className="text-[12px] font-bold uppercase tracking-[.08em] text-content-faint mb-1.5">Join Stellr</p>
      <h1 className="font-display font-semibold text-[26px] text-ink">{tierName} membership</h1>
      <p className="flex items-baseline gap-1.5 mt-1 mb-6">
        <span className="font-display font-bold text-[28px]" style={{ color }}>{priceLabel}</span>
        <span className="text-[13px] text-content-faint">{priceNote}</span>
      </p>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={payByCard}
          disabled={loading !== null}
          className="w-full text-center rounded-[9px] px-5 py-3 text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ background: color }}
        >
          {loading === 'card' ? 'Starting checkout…' : 'Pay by card'}
        </button>

        {invoiceEligible && (
          <button
            type="button"
            onClick={payByInvoice}
            disabled={loading !== null}
            className="w-full text-center rounded-[9px] px-5 py-3 text-[15px] font-semibold bg-white transition-colors hover:bg-surface disabled:opacity-60"
            style={{ color, border: `1.5px solid ${color}` }}
          >
            {loading === 'invoice' ? 'Sending invoice…' : 'Request an invoice'}
          </button>
        )}
      </div>

      {error && <p className="mt-4 text-[14px] text-danger">{error}</p>}

      <p className="mt-5 text-[12.5px] leading-[1.55] text-content-faint">
        {invoiceEligible
          ? 'Card payments renew annually and can be cancelled anytime. Invoices are billed once for 12 months — ideal for school or district purchase orders.'
          : 'Your membership renews annually and can be cancelled anytime.'}
      </p>
    </div>
  )
}
