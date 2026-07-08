'use client'

import { useEffect, useState } from 'react'
import { formatDateShort } from '@/lib/utils'

interface Invoice {
  id: string
  number: string | null
  created: number
  due_date: number | null
  status: string | null
  amount_due: number
  amount_paid: number
  currency: string
  description: string | null
  pdf_url: string | null
  hosted_url: string | null
}

interface ParticipationReg {
  id: string
  event_slug: string
  event_title: string
  school_name: string | null
  status: string
  created_at: string
  type: string | null
  member_pays_individually: boolean
  invoice_requested: boolean
  invoice_paid_at: string | null
  teacher_first_name: string | null
  teacher_last_name: string | null
}

interface Participation {
  id: string
  event_role: string
  join_completed_at: string | null
  individual_payment_status: string | null
  school_name: string | null
  registrations: ParticipationReg | ParticipationReg[] | null
  // Computed server-side: 'self' = this member owes (active "Pay now"),
  // 'organiser' = a group payment the organiser owes (greyed), null = nothing due.
  pay_kind?: 'self' | 'organiser' | null
  is_owner?: boolean
}

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100)
}

// Stripe invoice timestamps are unix seconds; participation dates are ISO strings.
function formatDate(ts: number | string) {
  return formatDateShort(typeof ts === 'number' ? ts * 1000 : ts)
}

const STATUS_STYLES: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  open: 'bg-yellow-100 text-yellow-700',
  void: 'bg-brand-hairline text-brand-muted-soft',
  uncollectible: 'bg-red-100 text-red-600',
  draft: 'bg-brand-hairline text-brand-muted-soft',
}

function paymentLabel(p: Participation, reg: ParticipationReg): { label: string; style: string } {
  if (reg.type === 'individual') {
    if (reg.status === 'confirmed') return { label: 'Paid', style: 'bg-green-100 text-green-700' }
    if (reg.status === 'cancelled') return { label: 'Cancelled', style: 'bg-brand-hairline text-brand-muted-soft' }
    return { label: 'Payment Pending', style: 'bg-brand-orange/10 text-brand-gold-ink' }
  }
  if (reg.member_pays_individually) {
    if (p.individual_payment_status === 'paid') return { label: 'Paid', style: 'bg-green-100 text-green-700' }
    if (p.individual_payment_status === 'pending') return { label: 'Payment Pending', style: 'bg-brand-orange/10 text-brand-gold-ink' }
  }
  if (reg.invoice_requested) {
    // An invoiced registration is "paid" only once an admin records the invoice as
    // settled (invoice_paid_at). registrations.status='confirmed' is NOT proof of
    // payment (it's set on card checkout / campaign auto-confirm and reused for
    // access), so it must not drive a green "Invoice paid" pill.
    if (reg.invoice_paid_at) return { label: 'Invoice paid', style: 'bg-green-100 text-green-700' }
    return { label: 'Invoice sent to organiser', style: 'bg-brand-blue/10 text-brand-blue' }
  }
  return { label: 'Paid by group', style: 'bg-green-100 text-green-700' }
}

// A receipt exists once the payment behind this row has settled — the member's
// own checkout, the group card payment, or an invoice an admin marked paid. An
// unpaid invoice offers no receipt (showing the invoice as a "receipt" implied a
// payment that hadn't happened).
function receiptAvailable(p: Participation, reg: ParticipationReg): boolean {
  if (reg.member_pays_individually) return p.individual_payment_status === 'paid'
  if (reg.invoice_requested) return !!reg.invoice_paid_at
  return reg.status === 'confirmed'
}

// `impersonateMemberId` + `readOnly` back the admin "view as member" page: the
// data is fetched for that member (admin-gated server-side) and the interactive
// payment controls are suppressed.
interface BillingHistoryProps {
  impersonateMemberId?: string
  readOnly?: boolean
}

export function BillingHistory({ impersonateMemberId, readOnly = false }: BillingHistoryProps = {}) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [participations, setParticipations] = useState<Participation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [payingId, setPayingId] = useState<string | null>(null)

  const memberQuery = impersonateMemberId ? `?memberId=${impersonateMemberId}` : ''

  async function handlePay(registrationId: string) {
    setPayingId(registrationId)
    try {
      const res = await fetch('/api/members/billing/payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId }),
      })
      const data = await res.json()
      if (res.ok && data.url) {
        window.location.href = data.url
      } else {
        setError(data.error ?? 'Could not start payment. Please try again.')
        setPayingId(null)
      }
    } catch {
      setError('Could not start payment. Please try again.')
      setPayingId(null)
    }
  }

  useEffect(() => {
    fetch(`/api/members/billing${memberQuery}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setInvoices(data.invoices ?? [])
        setParticipations(data.participations ?? [])
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [memberQuery])

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-brand-border p-6">
        <p className="text-sm text-brand-muted-soft">Loading billing history…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-brand-border p-6">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* ── Event participation payment history ─────────────────────────── */}
      <div className="bg-white rounded-xl border border-brand-border">
        <div className="p-6 border-b border-brand-hairline">
          <h2 className="text-base font-semibold text-brand-blue-dark">Event Payment History</h2>
          <p className="text-sm text-brand-muted-soft mt-0.5">Payment status for all events you have participated in.</p>
        </div>

        {participations.length === 0 ? (
          <div className="p-6">
            <p className="text-sm text-brand-muted-soft">No event participations found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-hairline text-left">
                  <th className="px-6 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">Date Joined</th>
                  <th className="px-6 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">Event</th>
                  <th className="px-6 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">School</th>
                  <th className="px-6 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">Organiser</th>
                  <th className="px-6 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">Payment</th>
                  <th className="px-6 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-hairline">
                {participations.map(p => {
                  const reg = Array.isArray(p.registrations) ? p.registrations[0] : p.registrations
                  if (!reg) return null
                  const { label, style } = paymentLabel(p, reg)
                  return (
                    <tr key={p.id} className="hover:bg-brand-canvas">
                      <td className="px-6 py-4 text-brand-muted">
                        {formatDate(p.join_completed_at ?? reg.created_at)}
                      </td>
                      <td className="px-6 py-4 font-medium text-brand-blue-dark">{reg.event_title}</td>
                      <td className="px-6 py-4 text-brand-muted-soft">{reg.school_name ?? p.school_name ?? '—'}</td>
                      <td className="px-6 py-4 text-brand-muted-soft">
                        {reg.teacher_first_name
                          ? `${reg.teacher_first_name} ${reg.teacher_last_name ?? ''}`
                          : '—'}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${style}`}>
                          {label}
                        </span>
                        {!readOnly && p.pay_kind === 'self' && (
                          <div className="mt-1">
                            <button
                              onClick={() => handlePay(reg.id)}
                              disabled={payingId === reg.id}
                              className="text-xs font-medium text-brand-blue hover:text-brand-blue-dark disabled:opacity-50"
                            >
                              {payingId === reg.id ? 'Starting…' : 'Pay now →'}
                            </button>
                          </div>
                        )}
                        {p.pay_kind === 'organiser' && (
                          <div className="mt-1">
                            <span
                              className="text-xs font-medium text-brand-muted-soft cursor-not-allowed"
                              title={p.is_owner
                                ? 'Settle this using the invoice below.'
                                : 'Your group organiser will pay this.'}
                            >
                              Pay now →
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {receiptAvailable(p, reg) ? (
                          readOnly ? (
                            <span className="text-xs text-brand-muted-soft">Available</span>
                          ) : (
                            <a
                              href={`/api/members/billing/receipt?participation=${p.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-brand-blue hover:text-brand-blue-dark text-xs font-medium"
                            >
                              Download
                            </a>
                          )
                        ) : (
                          <span className="text-xs text-brand-muted-soft">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Stripe invoices (group managers / organisers) ───────────────── */}
      {invoices.length > 0 && (
        <div className="bg-white rounded-xl border border-brand-border">
          <div className="p-6 border-b border-brand-hairline">
            <h2 className="text-base font-semibold text-brand-blue-dark">Invoices</h2>
            <p className="text-sm text-brand-muted-soft mt-0.5">Invoices raised for group registrations you organised.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-hairline text-left">
                  <th className="px-6 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">Date</th>
                  <th className="px-6 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">Invoice #</th>
                  <th className="px-6 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">Description</th>
                  <th className="px-6 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">Amount</th>
                  <th className="px-6 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide">Status</th>
                  <th className="px-6 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-hairline">
                {(invoices as Invoice[]).map(inv => (
                  <tr key={inv.id} className="hover:bg-brand-canvas">
                    <td className="px-6 py-4 text-brand-muted">{formatDate(inv.created)}</td>
                    <td className="px-6 py-4 font-mono text-brand-muted text-xs">{inv.number ?? '—'}</td>
                    <td className="px-6 py-4 text-brand-muted max-w-xs truncate">{inv.description ?? '—'}</td>
                    <td className="px-6 py-4 text-brand-blue-dark font-medium">
                      {formatAmount(inv.amount_due, inv.currency)}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[inv.status ?? ''] ?? 'bg-brand-hairline text-brand-muted-soft'}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right space-x-3">
                      {inv.pdf_url && (
                        <a href={inv.pdf_url} target="_blank" rel="noopener noreferrer" className="text-brand-blue hover:text-brand-blue-dark text-xs font-medium">
                          PDF
                        </a>
                      )}
                      {inv.hosted_url && (
                        <a href={inv.hosted_url} target="_blank" rel="noopener noreferrer" className="text-brand-blue hover:text-brand-blue-dark text-xs font-medium">
                          View
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  )
}
